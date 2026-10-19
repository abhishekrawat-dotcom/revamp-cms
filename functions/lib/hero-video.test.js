/* node functions/lib/hero-video.test.js — exits 1 on the first failure it lists.
   The banner video: the rules shared by the server, the console and the editor (templates/_shared/rv-hero-video-core.js),
   reading a video file from its own bytes (lib/video-probe.js), the request checks of its routes
   (lib/api-hero-video.js) and putting it on a page as it is served (lib/api.js applyHeroVideo).
   No network, no Firebase: the video files are built here, box by box. */
'use strict';
const core = require('../../templates/_shared/rv-hero-video-core.js');
const { probe } = require('./video-probe');
const hooks = require('./api')._testHooks;
const routes = require('./api-hero-video')._test;

var failures = [], checks = 0, pending = [];
function ok(cond, label, detail) { checks++; if (!cond) failures.push(label + (detail ? '\n      ' + detail : '')); }
function count(text, needle) { return text.split(needle).length - 1; }

/* ---------- the shared rules ---------- */
var black = { r: 0, g: 0, b: 0 }, white = { r: 255, g: 255, b: 255 };
ok(Math.abs(core.contrast(black, white) - 21) < 0.01, 'black on white is 21:1');
ok(core.parseColour('#abc').r === 0xaa && core.parseColour('rgba(7, 25, 18, 0.36)').a === 0.36, 'colours parse');
ok(core.parseColour('red') === null && core.parseColour('') === null, 'a named or empty colour is not one');
var m = core.minOpacity('#000000', 'light');
ok(m > 0.5 && m < 0.6, 'white words over a white frame need black at about 55%', m);
ok(core.minOpacity('#ffffff', 'dark') <= 0.55, 'dark words over a black frame need white at about 50%');
ok(core.minOpacity('#f42a58', 'light') === null, 'white words on the BWS pink are never 4.5:1, whatever its strength');

/* automatic: the site's own tone and scrim, at a strength that keeps the words readable */
var t500 = core.overlayFor({ mode: 'auto' }, { tone: 'light', scrim: 'rgba(249, 250, 252, 0.74)' });
ok(t500.ink === 'dark' && t500.opacity === 0.74 && t500.readable, 'tech500 (light banner): its own scrim, as strong as it was', JSON.stringify(t500));
var cx = core.overlayFor({ mode: 'auto' }, { tone: 'dark', scrim: 'rgba(7, 25, 18, 0.36)' });
ok(cx.ink === 'light' && cx.color === '#071912' && cx.opacity >= cx.needed && cx.opacity > 0.36 && cx.readable, 'CX forum: its scrim colour, made strong enough for a moving picture', JSON.stringify(cx));
var genDark = core.overlayFor(null, { tone: 'dark' }), genLight = core.overlayFor({}, { tone: 'light' });
ok(genDark.color === '#080a10' && genDark.readable && genLight.color === '#ffffff' && genLight.readable && genLight.ink === 'dark', 'an AI hero: a dark or a light veil by its tone');
var mismatch = core.overlayFor({ mode: 'auto' }, { tone: 'dark', scrim: 'rgba(255,255,255,.7)' });
ok(mismatch.color === '#080a10', 'a scrim of the other tone is not used for the overlay (one tone per site)');
var custom = core.overlayFor({ mode: 'custom', color: '#102030', opacity: 0.3 }, { tone: 'dark' });
ok(custom.color === '#102030' && custom.opacity === 0.3 && !custom.readable && custom.needed > 0.3, 'a custom overlay is kept, and said to be too weak', JSON.stringify(custom));
ok(core.overlayFor({ mode: 'custom', color: '#000', opacity: 5 }, { tone: 'dark' }).opacity === core.LIMITS.maxOpacity, 'a custom strength is capped');

/* the stored value as a page may use it */
var HV = { enabled: true, url: 'https://storage.googleapis.com/b/events/qa-x/media/a.mp4', contentType: 'video/mp4', posterUrl: 'https://storage.googleapis.com/b/events/qa-x/media/p.jpg',
  width: 1350, height: 600, overlay: { mode: 'auto' }, updatedAt: '2026-10-19T10:00:00.000Z' };
ok(core.clean(HV) && core.clean(HV).url === HV.url, 'a stored video is usable');
ok(core.clean(Object.assign({}, HV, { enabled: false })) === null, 'a video that is off is not on the page');
ok(core.clean(Object.assign({}, HV, { url: 'javascript:alert(1)' })) === null && core.clean(Object.assign({}, HV, { url: 'http://x/a.mp4' })) === null, 'only an https address');
ok(core.clean(Object.assign({}, HV, { url: 'https://x/a.mp4" onload="x' })) === null, 'an address that would break out of its attribute is refused');
ok(core.clean(Object.assign({}, HV, { contentType: 'video/quicktime' })) === null, 'only MP4 and WebM');
ok(core.clean(Object.assign({}, HV, { posterUrl: 'data:image/png;base64,xx' })).posterUrl === '', 'a still picture that is not an https address is dropped');

var tag = core.videoTag(core.clean(HV));
ok(/preload="none"/.test(tag) && /\smuted\s/.test(tag) && /\sloop\s/.test(tag) && /\splaysinline\s/.test(tag), 'the video tag waits, is silent and loops', tag);
ok(!/\ssrc=/.test(tag) && /data-rv-src="https:\/\/storage/.test(tag) && !/data-src=/.test(tag), 'no src: nothing downloads with the page (and nothing the ET banner widget would load)');
ok(!/autoplay|controls/.test(tag) && /aria-hidden="true"/.test(tag) && /tabindex="-1"/.test(tag), 'no autoplay attribute, no controls, out of the reading order');
ok(/width="1350" height="600"/.test(core.heroLayer(core.clean(HV))) && /fetchpriority="high"/.test(core.heroLayer(core.clean(HV))), 'the AI hero\'s still has its size and loads first');

ok(core.looksAt('<section id="banner"><div class="bnr-bg-video" data-rv-media="bg-video"></div></section><style>#banner{--rv-banner-scrim:rgba(249, 250, 252, 0.74)}</style>').tone === 'light', 'tech500\'s banner reads as light');
ok(core.looksAt('<section data-rv-section="hero" id="hero" class="hero-root hero-on-dark">').host === 'hero', 'an AI hero is found');
ok(core.looksAt('<section id="hero" class="hero-root hero-on-light">').tone === 'light', 'a light AI hero');
ok(core.looksAt('<div class="hero">imported</div>').host === 'none', 'an imported page has no place for it');
/* an AI hero's tone is what its words are, whatever its class says (BWS: an AI edit made them dark on a white veil) */
const gen = require('./gen-design');
['dark', 'light'].forEach(function (m) {
  var page = '<style data-rv-style="hero">' + gen.heroCss({ mode: m, image: 'https://x/h.png' }) + '</style>' + gen.heroHtml({ mode: m, tagline: 'T' });
  ok(core.looksAt(page).tone === m, 'a ' + m + ' AI hero as gen-design builds it reads as ' + m);
});
var BWS_HERO = '<style data-rv-style="hero">[data-rv-section="hero"] .hero-root,[data-rv-section="hero"].hero-root{position:relative;color:#1a1414;background:none}' +
  '[data-rv-section="hero"] .hero-veil{background:rgba(255,255,255,0.6)}[data-rv-section="hero"] .hero-tagline{font-weight:600;color:#1a1414}[data-rv-section="hero"] .hero-fact svg{color:#fff}</style>' +
  '<section data-rv-section="hero" id="hero" class="hero-root hero-on-dark"><div class="hero-veil"></div><div class="hero-inner"><h1 class="hero-tagline">B</h1></div></section>';
ok(core.looksAt(BWS_HERO).tone === 'light', 'a hero classed dark whose words were made dark reads as light (its overlay is light)');
ok(core.looksAt('<section id="hero" class="hero-root hero-on-dark"><div class="hero-inner"><div class="rv-lu rv-lu-on-light"></div></div></section>').tone === 'light', 'without a colour in its stylesheet, the logo unit\'s tone counts');
ok(core.looksAt('<style data-rv-style="hero">.hero-tagline{color:var(--rv-text)}</style><section id="hero" class="hero-root hero-on-light">').tone === 'light', 'a colour it cannot read falls back to the class');

/* ---------- the routes' checks ---------- */
ok(routes.typeOf('video/mp4', 'a.mp4') === 'video/mp4' && routes.typeOf('', 'clip.webm') === 'video/webm' && routes.typeOf('application/octet-stream', 'x.M4V') === 'video/mp4', 'types');
ok(routes.typeOf('video/quicktime', 'a.mov') === '' && routes.typeOf('image/png', 'a.mp4') === '', 'a .mov or a picture is refused');
ok(routes.mediaPathOk('qa-x', 'events/qa-x/media/lz1-abc-clip.mp4') && !routes.mediaPathOk('qa-x', 'events/qa-y/media/a.mp4') && !routes.mediaPathOk('qa-x', 'events/qa-x/media/../site/page.html') && !routes.mediaPathOk('qa-x', 'events/qa-x/media/a.html'), 'only this event\'s uploads');
ok(routes.cleanOverlay({ mode: 'custom', color: '#ABCDEF', opacity: 0.5 }).value.color === '#abcdef', 'an overlay colour is stored as #rrggbb');
ok(routes.cleanOverlay({ mode: 'custom', color: 'nope', opacity: 0.5 }).error && routes.cleanOverlay({ mode: 'custom', color: '#000', opacity: 0.95 }).error && routes.cleanOverlay({ mode: 'x' }).error, 'a bad overlay is refused');
ok(routes.cleanOverlay({ mode: 'auto', opacity: 7 }).value.opacity === null, 'automatic keeps no strength of its own');
ok(routes.cleanOrigin('https://revamp-cms--revamp-cms.us-east4.hosted.app') && routes.cleanOrigin('http://localhost:8741') && !routes.cleanOrigin('https://x.y/path') && !routes.cleanOrigin('null'), 'origins');
ok(routes.forClient(null) === null && routes.forClient({ url: 'https://a/b.mp4', overlay: {} }).overlay.mode === 'auto', 'what the console is given');

/* ---------- reading a video file ---------- */
function u32(n) { var b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b; }
function box(type) { var body = Buffer.concat(Array.prototype.slice.call(arguments, 1)); return Buffer.concat([u32(8 + body.length), Buffer.from(type, 'latin1'), body]); }
function full(v, rest) { return Buffer.concat([Buffer.from([v, 0, 0, 0]), rest]); }
function mvhd(scale, dur) { return box('mvhd', full(0, Buffer.concat([u32(0), u32(0), u32(scale), u32(dur), Buffer.alloc(80)]))); }
function tkhd(id, w, h) { return box('tkhd', full(0, Buffer.concat([u32(0), u32(0), u32(id), u32(0), u32(0), Buffer.alloc(8), Buffer.alloc(8), Buffer.alloc(36), u32(w * 65536), u32(h * 65536)]))); }
function trak(kind, codec, w, h, id) {
  return box('trak', tkhd(id || 1, w || 0, h || 0), box('mdia',
    box('mdhd', full(0, Buffer.concat([u32(0), u32(0), u32(12800), u32(0), Buffer.alloc(4)]))),
    box('hdlr', full(0, Buffer.concat([u32(0), Buffer.from(kind, 'latin1'), Buffer.alloc(12), Buffer.from('h\0')]))),
    box('minf', box('stbl', box('stsd', full(0, Buffer.concat([u32(1), box(codec, Buffer.alloc(78))])))))));
}
function mp4(o) {
  o = o || {};
  var ftyp = box('ftyp', Buffer.from(o.brand || 'isom', 'latin1'), u32(512), Buffer.from('isomiso2avc1mp41'));
  var tracks = o.noVideo ? [] : [trak('vide', o.codec || 'avc1', 1350, 600, 1)];
  if (o.audio) tracks.push(trak('soun', 'mp4a', 0, 0, 2));
  var moov = box.apply(null, ['moov', mvhd(1000, Math.round((o.seconds || 12) * 1000))].concat(tracks));
  var mdat = box('mdat', Buffer.alloc(o.mdat || 2000));
  return o.slow ? Buffer.concat([ftyp, mdat, moov]) : Buffer.concat([ftyp, moov, mdat]);
}
function reader(buf) { var n = 0; var f = function (s, e) { n++; return Promise.resolve(buf.slice(s, e + 1)); }; f.count = function () { return n; }; return f; }
function check(label, buf, want) {
  var read = reader(buf);
  pending.push(probe(read, buf.length).then(function (r) { want(r, null, read); }, function (e) { want(null, e, read); }).catch(function (e) { ok(false, label + ' threw', e.stack); }));
}
check('H.264 with sound, index first', mp4({ audio: true, seconds: 19.5 }), function (r, e) {
  ok(r && r.type === 'video/mp4' && r.duration === 19.5 && r.width === 1350 && r.height === 600 && r.codec === 'H.264' && r.hasAudio === true && r.fastStart === true, 'an MP4 is read: length, size, codec, sound, index first', JSON.stringify(r || e && e.message));
});
check('index last', mp4({ slow: true, mdat: 200000 }), function (r, e, read) {
  ok(r && r.fastStart === false && r.hasAudio === false, 'an MP4 with its index at the end is said to start late', JSON.stringify(r || e && e.message));
  ok(read.count() <= 4, 'only the box headers and the index are read', read.count());
});
check('HEVC', mp4({ codec: 'hvc1' }), function (r, e) { ok(!r && e.reason === 'codec' && /H\.264/.test(e.message), 'HEVC is refused, and the owner told what to export', e && e.message); });
check('QuickTime', mp4({ brand: 'qt  ' }), function (r, e) { ok(!r && e.reason === 'quicktime', 'a .mov is refused'); });
check('no picture', mp4({ noVideo: true, audio: true }), function (r, e) { ok(!r && e.reason === 'no-video', 'sound only is refused'); });
check('a picture', Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), Buffer.alloc(200)]), function (r, e) { ok(!r && e.reason === 'not-video', 'a PNG renamed .mp4 is refused'); });
check('cut short', mp4().slice(0, 60), function (r, e) { ok(!r && (e.reason === 'unreadable'), 'a file cut short is refused as damaged', e && e.reason); });
check('long', mp4({ seconds: 75 }), function (r) { ok(r && r.duration === 75, 'its length is read, for the route to refuse over 60 s'); });

/* WebM: EBML elements with 8-byte sizes */
function vsize(n, unknown) { var b = Buffer.alloc(8); b[0] = 0x01; if (unknown) b.fill(0xFF, 1); else for (var i = 7; i >= 1; i--) { b[i] = n & 0xFF; n = Math.floor(n / 256); } return b; }
function el(idHex, data, unknown) { var d = Buffer.isBuffer(data) ? data : Buffer.concat(data); return Buffer.concat([Buffer.from(idHex, 'hex'), vsize(d.length, unknown), d]); }
function uintB(n, len) { var b = Buffer.alloc(len); for (var i = len - 1; i >= 0; i--) { b[i] = n & 0xFF; n = Math.floor(n / 256); } return b; }
function f64(x) { var b = Buffer.alloc(8); b.writeDoubleBE(x); return b; }
function webm(o) {
  o = o || {};
  var header = el('1A45DFA3', [el('4282', Buffer.from(o.doctype || 'webm'))]);
  var info = el('1549A966', [el('2AD7B1', uintB(1000000, 3)), el('4489', f64((o.seconds || 8) * 1000))]);
  var tracks = el('1654AE6B', [el('AE', [el('83', uintB(1, 1)), el('86', Buffer.from('V_VP9')), el('E0', [el('B0', uintB(1280, 2)), el('BA', uintB(720, 2))])]),
    o.audio ? el('AE', [el('83', uintB(2, 1)), el('86', Buffer.from('A_OPUS'))]) : Buffer.alloc(0)]);
  return Buffer.concat([header, el('18538067', [info, tracks, el('1F43B675', Buffer.alloc(500))], true)]);
}
check('WebM', webm({ audio: true, seconds: 8 }), function (r, e) {
  ok(r && r.type === 'video/webm' && r.duration === 8 && r.codec === 'VP9' && r.width === 1280 && r.height === 720 && r.hasAudio, 'a WebM is read', JSON.stringify(r || e && e.message));
});
check('Matroska', webm({ doctype: 'matroska' }), function (r, e) { ok(!r && e.reason === 'not-video', 'a .mkv is not a WebM'); });

/* ---------- on a page, as it is served ---------- */
var TEMPLATE = [
  '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>T</title>',
  '<style data-rv-style="banner">#banner{overflow:hidden;position:relative;--rv-banner-scrim:rgba(7, 25, 18, 0.36)}</style>',
  '</head><body>',
  '<section id="banner" data-rv-section="banner"><img src="https://img.example/banner.jpg" srcset="https://img.example/b-800.jpg 800w" sizes="100vw" alt="" class="banner-bg-image" data-rv-media="bg-image" fetchpriority="high" loading="eager">',
  '<div class="bnr-bg-video" data-rv-media="bg-video"><video class="lazy-video" data-src="https://old/footage.mp4"></video></div><div class="overlay-lyr"></div>',
  '<div class="cntnd-bx"><h1 class="banner-title">Summit</h1></div></section>',
  '<section id="about">About</section>',
  '</body></html>'
].join('\n');
var on = hooks.applyHeroVideo(TEMPLATE, { heroVideo: HV });
ok(count(on, '<video') === 1 && on.indexOf('lazy-video') === -1, 'a template banner: its layer holds the event\'s video only', on.match(/<video[^>]*>/g));
ok(/<div class="bnr-bg-video" data-rv-media="bg-video"><video class="rv-hv-video" data-rv-bg-video/.test(on), 'the video goes into the banner\'s video layer');
ok(/<img src="https:\/\/storage\.googleapis\.com\/b\/events\/qa-x\/media\/p\.jpg" alt="" class="banner-bg-image"/.test(on) && !/srcset=/.test(on.match(/<img[^>]*banner-bg-image[^>]*>/)[0]), 'the banner\'s picture becomes the video\'s still (no other source left)', on.match(/<img[^>]*banner-bg-image[^>]*>/)[0]);
ok(count(on, '<link rel="preload" as="image" href="' + HV.posterUrl + '" fetchpriority="high" data-rv-hero-video>') === 1, 'the still is preloaded, first');
ok(/#banner \.overlay-lyr\{background:rgba\(7,25,18,0\.\d+\)!important\}/.test(on), 'the overlay layer takes the overlay colour (CX: its own scrim, stronger)', (on.match(/#banner \.overlay-lyr\{[^}]*\}/) || [''])[0]);
ok(count(on, '/templates/_shared/rv-hero-video.js') === 1 && on.indexOf('<script src="/templates/_shared/rv-hero-video.js" defer data-rv-hero-video></script>\n</body>') !== -1, 'the loader once, deferred, at the end');
ok(hooks.applyHeroVideo(on, { heroVideo: HV }) === on, 'serving it again changes nothing (idempotent)');
var offAgain = hooks.applyHeroVideo(on, { heroVideo: Object.assign({}, HV, { enabled: false }) });
ok(offAgain.indexOf('data-rv-hero-video') === -1 && offAgain.indexOf('rv-hv-video') === -1, 'turned off: everything it wrote is gone again');
ok(hooks.applyHeroVideo(TEMPLATE, {}) === TEMPLATE, 'no video: a template page is served exactly as stored');

var unreadable = hooks.applyHeroVideo(TEMPLATE, { heroVideo: Object.assign({}, HV, { overlay: { mode: 'custom', color: '#ffffff', opacity: 0.8 } }) });
ok(/#banner \.overlay-lyr\{background:rgba\(7,25,18,0\.\d+\)!important\}/.test(unreadable), 'a stored colour the words cannot be read on (white on a light-text banner) is not used: the automatic overlay stands in');
ok(core.overlayFor({ mode: 'auto' }, { tone: 'dark', scrim: 'rgba(244, 42, 88, 0.4)' }).color === '#080a10', 'a scrim colour no strength makes readable is not used');
var custom2 = hooks.applyHeroVideo(TEMPLATE, { heroVideo: Object.assign({}, HV, { overlay: { mode: 'custom', color: '#000000', opacity: 0.62 } }) });
ok(/#banner \.overlay-lyr\{background:rgba\(0,0,0,0\.62\)!important\}/.test(custom2), 'a custom overlay (ET\'s reference: black at 62%)');

var AI = [
  '<!DOCTYPE html><html><head><title>G</title><style data-rv-style="hero">.hero-root{background-image:url("https://g/hero.png")}</style></head><body class="rv-generated">',
  '<section data-rv-section="hero" id="hero" class="hero-root hero-on-dark" data-rv-key="hero"><div class="hero-veil" aria-hidden="true"></div>',
  '<video class="hero-video" autoplay loop muted playsinline preload="auto" src="https://et/header.mp4"></video>',
  '<div class="hero-inner"><h1 class="hero-tagline">Brand World</h1></div></section>',
  '<section id="overview"><video controls src="https://et/talk.mp4"></video></section>',
  '</body></html>'
].join('\n');
var aiOff = hooks.applyHeroVideo(AI, {});
var heroVid = (aiOff.match(/<video class="hero-video"[^>]*>/) || [''])[0];
ok(heroVid && !/autoplay/.test(heroVid) && !/\ssrc=/.test(heroVid) && /data-rv-src="https:\/\/et\/header\.mp4"/.test(heroVid) && /preload="none"/.test(heroVid) && /data-rv-bg-video/.test(heroVid),
  'a video an AI edit set to play by itself in the hero waits like the banner video', heroVid);
ok(/data-rv-bg-start="early"/.test(heroVid), 'it has no still of its own, so where it plays it starts at once (its first frame is the largest paint)');
ok(/<video controls src="https:\/\/et\/talk\.mp4">/.test(aiOff), 'a video elsewhere on the page (with its own controls) is left alone');
ok(count(aiOff, 'rv-hero-video.js') === 1 && hooks.applyHeroVideo(aiOff, {}) === aiOff, 'its loader is added, once, and a second run changes nothing');
var aiOn = hooks.applyHeroVideo(AI, { heroVideo: HV });
ok(aiOn.indexOf('https://et/header.mp4') === -1, 'with the event\'s own video on, the AI\'s one is replaced');
ok(/<section data-rv-section="hero" id="hero" class="hero-root hero-on-dark" data-rv-key="hero" data-rv-hv=""><div class="rv-hv" data-rv-hero-video aria-hidden="true"><img class="rv-hv-poster"/.test(aiOn), 'the AI hero gets its layer first: still, video, overlay', (aiOn.match(/<section[^>]*hero-root[^>]*>.{0,120}/) || [''])[0]);
ok(/section\[data-rv-hv\]\{background-image:none!important\}/.test(aiOn) && /section\[data-rv-hv\]>\.hero-veil\{display:none!important\}/.test(aiOn), 'its own picture and veil make way');
ok(/\.rv-hv>\.rv-hv-overlay\{position:absolute;inset:0;background:rgba\(8,10,16,0\.6\)\}/.test(aiOn), 'a dark hero gets the dark overlay');
ok(/@media \(max-width:767px\)\{\.rv-hv>\.rv-hv-video\{display:none\}\}/.test(aiOn) && /prefers-reduced-motion:reduce\)\{\[data-rv-bg-video\]\{display:none!important\}/.test(aiOn), 'phones and visitors who ask for less motion see the still');
ok(hooks.applyHeroVideo(aiOn, { heroVideo: HV }) === aiOn, 'idempotent on an AI page');
var noStill = hooks.applyHeroVideo(AI, { heroVideo: Object.assign({}, HV, { posterUrl: '' }) });
ok(noStill.indexOf('background-image:none') === -1 && noStill.indexOf('rel="preload"') === -1, 'without a still, the hero keeps its own picture under the overlay');

var IMPORTED = '<!DOCTYPE html><html><head></head><body><div class="hero"><video autoplay src="/__l5e/film.mp4"></video></div></body></html>';
ok(hooks.applyHeroVideo(IMPORTED, { heroVideo: HV }) === IMPORTED, 'an imported design is served as it is (the console says it has no place for one)');

ok(hooks.heroVideoStamp({ heroVideo: HV }) !== hooks.heroVideoStamp({}) && hooks.heroVideoStamp({ heroVideo: HV }) !== hooks.heroVideoStamp({ heroVideo: Object.assign({}, HV, { updatedAt: 'later' }) }),
  'a change to the video is a new page in the server\'s page cache');

/* the published-page transform leaves the stored page without it (it is added as the page is served) */
var published = hooks.publishTransform(TEMPLATE, { eventId: 'qa-x', event: { name: 'X', heroVideo: HV }, mode: 'live', templateId: 'cx-leaders-forum' });
ok(published.indexOf('rv-hv-video') === -1, 'the stored published page does not carry the video: turning it off needs no publish');

Promise.all(pending).then(function () {
  if (failures.length) {
    console.error('hero-video: ' + failures.length + ' of ' + checks + ' checks failed:\n  - ' + failures.join('\n  - '));
    process.exit(1);
  }
  console.log('hero-video: all ' + checks + ' checks passed');
});
