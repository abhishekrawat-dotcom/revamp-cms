/* node functions/lib/share-card.test.js — exits 1 when a check fails, listing every failure.
   The share card (lib/share-card.js): the picture a link to a site shows, made from the site's own banner — its
   background as the hero shows it, with the logo unit centred on it.
     1. reading CSS: colours, positions, gradients, variables, which rules apply to the hero
     2. the plan the page pass reads off a page: an AI-designed hero, its dark-theme turn, an ET template banner, an
        imported design, the event's banner video, and the pages nothing can be made from (and why)
     3. the fingerprint: the same for the same page published and served, new for any change that shows
     4. the page pass with a card on record: og:image is the card (its size and words given), the owner's picture
        still wins, a stale or failed record is not used
     5. the drawing, with real pixels: exact size, a JPEG under 1 MB, the banner at the corners, the logo unit at the
        centre with its transparent parts showing the banner (never boxed), the hero's overlay, its crop, an SVG unit;
        a unit that is not transparent, is boxed or has lettering in a font it does not carry is refused
     6. making, storing and recording it: one card per page, never two at once, failures noted and tried again
        later, nothing for an event that is gone, nothing for a real event under the QA guard, no edit recorded
     7. going live (publishVersion, the approval's publish): the card waited for, or the page goes live without it
     8. a site already live (/e/<id>, its inner pages): the card made in the background, served on the next visit
     9. the console's words (edit-event.html): the card shown, or why there is none, said plainly
   No network: Firestore and Storage are in-memory stand-ins; the pictures are made here with sharp. */
'use strict';
delete process.env.K_SERVICE;
delete process.env.QA_SHARE_ONLY_QA;
const fs = require('fs');
const path = require('path');
const vm = require('vm');

/* ---------- a Firestore and Storage in memory ---------- */
var FB = (function () {
  var docs = {}, files = {}, meta = {}, publics = {}, updates = [], downloads = [];
  var delays = {};
  function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }
  function isDelete(v) { return v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) !== Object.prototype && /delete/i.test((v.constructor && v.constructor.name) || ''); }
  function apply(p, patch) {
    var d = docs[p];
    if (!d) { var e = new Error('NOT_FOUND: ' + p); e.code = 5; throw e; }
    Object.keys(patch).forEach(function (k) {
      updates.push({ doc: p, field: k });
      var parts = k.split('.'), o = d;
      for (var i = 0; i < parts.length - 1; i++) { if (!o[parts[i]] || typeof o[parts[i]] !== 'object') o[parts[i]] = {}; o = o[parts[i]]; }
      var last = parts[parts.length - 1], v = patch[k];
      if (isDelete(v)) delete o[last]; else o[last] = clone(v);
    });
  }
  function snap(p) { var d = docs[p]; return { id: p.split('/').pop(), exists: !!d, data: function () { return clone(d); }, get: function (k) { return d ? d[k] : undefined; } }; }
  function ref(p) {
    return {
      path: p, id: p.split('/').pop(),
      get: function () { return Promise.resolve(snap(p)); },
      update: function (patch) { return Promise.resolve().then(function () { apply(p, patch); }); },
      set: function (v) { docs[p] = clone(v); return Promise.resolve(); },
      collection: function (n) { return col(p + '/' + n); }
    };
  }
  function col(p) {
    return { doc: function (id) { return ref(p + '/' + id); }, get: function () { return Promise.resolve({ docs: [], empty: true, size: 0 }); },
      where: function () { return this; }, orderBy: function () { return this; }, limit: function () { return this; }, select: function () { return this; } };
  }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  return {
    docs: docs, files: files, meta: meta, publics: publics, updates: updates, downloads: downloads, delays: delays,
    db: {
      collection: function (n) { return col(n); },
      runTransaction: function (fn) {
        var writes = [];
        var tx = { get: function (r) { return Promise.resolve(snap(r.path)); }, update: function (r, patch) { writes.push([r.path, patch]); }, set: function (r, v) { writes.push([r.path, null, v]); } };
        return Promise.resolve(fn(tx)).then(function (v) {
          writes.forEach(function (w) { if (w[1]) apply(w[0], w[1]); else docs[w[0]] = clone(w[2]); });
          return v;
        });
      }
    },
    bucket: {
      name: 'test-bucket',
      file: function (p) {
        return {
          download: function () {
            downloads.push(p);
            var d = Object.keys(delays).filter(function (k) { return p.indexOf(k) !== -1; }).map(function (k) { return delays[k]; })[0] || 0;
            return wait(d).then(function () {
              if (!files[p]) throw Object.assign(new Error('No such object: ' + p), { code: 404 });
              return [Buffer.from(files[p])];
            });
          },
          save: function (buf, opts) { files[p] = Buffer.from(buf); meta[p] = (opts && opts.metadata) || {}; return Promise.resolve(); },
          makePublic: function () { publics[p] = true; return Promise.resolve(); },
          delete: function () { delete files[p]; delete publics[p]; return Promise.resolve(); },
          getMetadata: function () { return Promise.reject(Object.assign(new Error('No such object'), { code: 404 })); },
          exists: function () { return Promise.resolve([!!files[p]]); }
        };
      },
      getFiles: function () { return Promise.resolve([[]]); }
    }
  };
})();
require.cache[require.resolve('./firebase')] = { id: require.resolve('./firebase'), filename: require.resolve('./firebase'), loaded: true, exports: { getFirebase: function () { return FB; } } };

const sharp = require('sharp');
const hooks = require('./api')._testHooks;        // also wires share-card.js with api.js's own SVG drawing
const card = require('./share-card');
const T = card._test;

var failures = [], checks = 0;
function ok(cond, label, detail) { checks++; if (!cond) failures.push(label + (detail !== undefined ? '\n      ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : '')); }
function count(text, needle) { return text.split(needle).length - 1; }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function near(a, b, tol) { return a.length >= 3 && Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol && Math.abs(a[2] - b[2]) <= tol; }
var realError = console.error;
function quietly(fn) { console.error = function () {}; return Promise.resolve().then(fn).then(function (v) { console.error = realError; return v; }, function (e) { console.error = realError; throw e; }); }

var STORE = 'https://storage.googleapis.com/test-bucket/';

/* ---------- pages ---------- */
var BODY_STYLE = '--theme-color:#186bf9;--accent-color:#ffb020;--rv-bg:#0c0c10;--rv-surface:#18181f;--rv-text:#f4f4f6;--rv-muted:#a9a9b6';
/* an AI-designed site, as gen-design.js builds its hero and pictures.js rewrites its background */
function genPage(id, o) {
  o = o || {};
  var bg = o.bg || STORE + 'events/' + id + '/generated/hero-bg.png';
  var unit = o.unit === undefined ? '<div class="rv-lu rv-lu-pic rv-lu-on-dark" data-rv-logo-unit=""><img class="rv-lu-img" src="' + (o.logo || STORE + 'events/' + id + '/generated/logo-unit.png') + '" alt="Logo" width="471" height="241" decoding="async">' + (o.darkCopy ? '<img class="rv-lu-img rv-lu-dark" src="' + o.darkCopy + '" alt="" aria-hidden="true">' : '') + '</div>' : o.unit;
  var veil = o.veil === undefined ? 'radial-gradient(ellipse 60% 50% at 50% 100%,rgba(24,107,249,.18) 0%,rgba(24,107,249,0) 70%),linear-gradient(180deg,rgba(6,12,28,.45) 0%,rgba(8,16,40,.6) 100%)' : o.veil;
  return [
    '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>X</title>',
    '<link rel="canonical" href="https://sites.example/e/' + id + '" data-rv-head>',
    '<meta property="og:title" content="Agentic Summit 2027" data-rv-head>',
    '<meta name="twitter:card" content="summary" data-rv-head>',
    o.ownImage ? '<meta property="og:image" content="' + o.ownImage + '" data-rv-head>' : '',
    o.pagesMeta || '',
    '</head>',
    '<body id="gen" data-rv-template-id="gen-' + id + '" class="microsite rv-generated"' + (o.mode ? ' data-rv-mode="' + o.mode + '"' : '') + ' style="' + BODY_STYLE + '">',
    '<div id="content"><div class="col-md-12 no-padding">',
    '<section data-rv-section="hero" id="hero" class="hero-root ' + (o.heroClass || 'hero-on-dark') + '" data-rv-key="hero">' + (o.video || '') + '<div class="hero-veil" aria-hidden="true"></div><div class="hero-inner">' + unit + '<h1 class="hero-tagline">THE NEXT PHASE</h1></div></section>',
    '<style data-rv-style="hero">[data-rv-section="hero"]{position:relative;isolation:isolate;overflow-x:clip}',
    '[data-rv-section="hero"] .hero-root,[data-rv-section="hero"].hero-root{position:relative;min-height:88vh;color:#ffffff;background-color:var(--rv-bg);' +
      (o.heroBg !== undefined ? o.heroBg : 'background-image:url("' + bg + '");background-image:image-set(url("' + bg + '.rv-9f223e58.1024x1024.w1024.webp") type("image/webp"), url("' + bg + '"));background-size:cover;background-position:' + (o.pos || 'center')) + '}' +
      '[data-rv-section="hero"] .hero-veil{position:absolute;inset:0;background:' + veil + ';pointer-events:none}' +
      '[data-rv-section="hero"] .hero-inner{position:relative;z-index:1}@media (max-width:820px){[data-rv-section="hero"] .hero-veil{background:none}}</style>',
    '<section data-rv-section="overview" id="overview"><h2>Overview</h2><img src="' + STORE + 'events/' + id + '/generated/overview.png" alt="A hall"></section>',
    '<footer data-rv-section="footer" id="footer"><p>f</p></footer>',
    '</div></div></body></html>'
  ].join('\n');
}
/* an ET template's banner (templates/<id>/sections/banner), as the template loader puts it on a page */
function templatePage(id, o) {
  o = o || {};
  return [
    '<!DOCTYPE html><html><head><title>T</title><link rel="canonical" href="https://sites.example/e/' + id + '" data-rv-head><meta name="twitter:card" content="summary" data-rv-head></head>',
    '<body id="tech500" data-rv-template-id="tech500" style="--rv-bg:#ffffff"><div id="content"><div class="col-md-12 no-padding">',
    '<section id="banner" data-rv-section="banner" class="mb-medium bgCover_1">',
    '<img src="https://img.etb2bimg.com/files/data_file_1.jpg" alt="" class="banner-bg-image" data-rv-media="bg-image">',
    '<div class="bnr-bg-video" data-rv-media="bg-video"></div>',
    '<div class="overlay-lyr"' + (o.overlayStyle ? ' style="' + o.overlayStyle + '"' : '') + '></div>',
    '<div class="cntnd"><img alt="" class="logo" data-rv-bind="event.logo" src="' + STORE + 'events/' + id + '/logo/logo.png"><h1 class="banner-title">Event</h1></div>',
    '</section>',
    '<style data-rv-style="banner">#banner{overflow:hidden;position:relative;--rv-banner-scrim:rgba(60, 0, 6, 0.55)}#banner .cntnd .lcn{display:flex}@media(max-width:767px){#banner .overlay-lyr{display:none}}</style>',
    '</div></div></body></html>'
  ].join('\n');
}
/* an imported design: no hero named, its first section is its banner */
function importedPage(id) {
  return [
    '<!DOCTYPE html><html><head><title>I</title><link rel="canonical" href="https://sites.example/e/' + id + '" data-rv-head></head>',
    '<body id="imported" class="microsite imported-microsite" style="">',
    '<header class="site-header"><img src="https://x/et-logo-footer.svg" alt="ET"></header>',
    '<main class="flex-1"><section class="hero-section relative isolate overflow-hidden"><div aria-hidden="true" class="pointer-events-none absolute inset-0 overflow-hidden">',
    '<img src="' + STORE + 'events/import-imp-x/images/hero-awards.jpg" alt="" width="1920" height="1088" class="h-full w-full object-cover object-[62%_center] sm:object-center">',
    '<div class="absolute inset-0 bg-[linear-gradient(180deg,color-mix(in_oklab,var(--ivory)_78%,transparent)_0%,transparent_100%)]"></div></div>',
    '<h1>The Economic Times Awards</h1></section></main></body></html>'
  ].join('\n');
}
function planFor(html, event, templateId) {
  var report = {};
  var out = hooks.sitePagePass(html, { mode: 'live', event: event || { name: 'Agentic Summit 2027' }, templateId: templateId || 'gen-qa-x', report: report });
  return { plan: report.shareCard, page: out };
}

/* ===================== 1. reading CSS ===================== */
ok(JSON.stringify(T.parseColour('#fff')) === '[255,255,255,1]' && JSON.stringify(T.parseColour('rgba(8,10,16,.8)')) === '[8,10,16,0.8]' &&
  JSON.stringify(T.parseColour('rgb(1 2 3 / 50%)')) === '[1,2,3,0.5]' && JSON.stringify(T.parseColour('#11223380')) === JSON.stringify([17, 34, 51, 128 / 255]) &&
  T.parseColour('color-mix(in srgb, red, blue)') === null && T.parseColour('var(--x)') === null, 'colours: hex, rgb(a) with commas or spaces; nothing it cannot be sure of');
ok(JSON.stringify(T.parsePosition('center')) === '[0.5,0.5]' && JSON.stringify(T.parsePosition('top')) === '[0.5,0]' && JSON.stringify(T.parsePosition('left top')) === '[0,0]' &&
  JSON.stringify(T.parsePosition('top right')) === '[1,0]' && JSON.stringify(T.parsePosition('30% 80%')) === '[0.3,0.8]' && JSON.stringify(T.parsePosition('center bottom')) === '[0.5,1]' &&
  T.parsePosition('20px 10px') === null, 'background positions: keywords and percentages; a length in px is not guessed at');
var lin = T.parseLayer('linear-gradient(180deg,rgba(6,12,28,.45) 0%,rgba(8,16,40,.6) 100%)');
ok(lin && lin.t === 'linear' && lin.dir.angle === 180 && lin.stops.length === 2 && lin.stops[1].p === 1, 'a linear gradient', lin);
var rad = T.parseLayer('radial-gradient(ellipse 75% 80% at 50% 50%, rgba(8,10,16,.8) 0%, rgba(8,10,16,.58) 62%, rgba(8,10,16,.36) 100%)');
ok(rad && rad.t === 'radial' && rad.size.rx === 0.75 && rad.size.ry === 0.8 && rad.at[0] === 0.5 && rad.stops[1].p === 0.62, 'a radial gradient: its size and centre', rad);
var even = T.parseLayer('linear-gradient(to top right, #000, #fff 40%, #f00, #0f0)');
ok(even && JSON.stringify(even.dir.corner) === '[1,-1]' && even.stops.map(function (s) { return s.p; }).join() === '0,0.4,0.7,1', 'stops with no position are shared out evenly, as CSS does', even);
ok(T.parseLayer('linear-gradient(red 10px, blue)') === null && T.parseLayer('conic-gradient(red, blue)') === null && T.parseLayer('radial-gradient(circle 40px, red, blue)') === null &&
  T.parseLayer('linear-gradient(180deg, color-mix(in srgb, red 50%, transparent), blue)') === null, 'a gradient that depends on the hero\'s size, or uses what cannot be read, is not read');
ok(T.parseLayer('none') === 'none' && T.parseLayer('transparent') === 'none' && T.parseLayer('rgba(255,255,255,0.6)').t === 'solid', 'a plain colour; none and transparent paint nothing');
ok(T.resolveVars('var(--rv-banner-scrim, transparent)', [{ '--rv-banner-scrim': 'rgba(1,2,3,.5)' }]) === 'rgba(1,2,3,.5)' && T.resolveVars('var(--nope, #fff)', [{}]) === '#fff' &&
  T.resolveVars('var(--nope)', [{}]) === null && T.resolveVars('var(--a)', [{ '--a': 'var(--b)' }, { '--b': '#123' }]) === '#123', 'variables: the hero\'s own first, then the page\'s; one not known is not guessed');
var heroEl = { name: 'section', id: 'hero', classes: ['hero-root', 'hero-on-dark'], attrs: { 'data-rv-section': 'hero', id: 'hero' } };
var veilEl = { name: 'div', id: '', classes: ['hero-veil'], attrs: {} };
ok(T.selectorPicks('[data-rv-section="hero"].hero-root', heroEl, heroEl) && !T.selectorPicks('[data-rv-section="hero"] .hero-root', heroEl, heroEl) &&
  T.selectorPicks('[data-rv-section="hero"] .hero-veil', veilEl, heroEl) && T.selectorPicks('.hero-veil', veilEl, heroEl) && !T.selectorPicks('.hero-veil:hover', veilEl, heroEl) &&
  !T.selectorPicks('body.dark [data-rv-section="hero"] .hero-veil', veilEl, heroEl) && T.selectorPicks('#hero', heroEl, heroEl), 'which rules are the hero\'s own (a hover state, or one that depends on what is outside, is not read)');
ok(T.urlIn('image-set(url("a.webp") type("image/webp"), url("a.png"))') === 'a.png' && T.urlIn('url(\'b.jpg\')') === 'b.jpg', 'the picture in an image-set() is its original (pictures.js writes the WebP copy first)');
var genBase = fs.readFileSync(path.join(__dirname, '..', '..', 'templates', '_shared', 'gen-base.css'), 'utf8');
ok(genBase.indexOf('.hero-veil{background:' + T.DARK_TURN_VEIL + '}') !== -1, 'the dark theme\'s veil over a light hero is still gen-base.css\'s, word for word');

/* ===================== 2. plans ===================== */
var g = planFor(genPage('qa-x')).plan;
ok(g.needed && g.inputs.background.url === STORE + 'events/qa-x/generated/hero-bg.png' && g.inputs.background.x === 0.5 && g.inputs.background.y === 0.5 && g.inputs.background.ground === '#0c0c10',
  'an AI hero: its own picture (the original, not the WebP copy), centred, on the page\'s ground', g.inputs && g.inputs.background);
ok(g.inputs.overlay.length === 2 && g.inputs.overlay[0].t === 'radial' && g.inputs.overlay[1].t === 'linear', 'the hero\'s veil, its layers top first (the phone\'s @media rule is not the banner a link stands for)', g.inputs.overlay);
ok(g.inputs.logo.url === STORE + 'events/qa-x/generated/logo-unit.png' && g.inputs.logo.from === 'unit', 'the logo unit picture the hero shows');
ok(/^[0-9a-f]{64}$/.test(g.fingerprint) && g.fresh === false && g.card === null, 'fingerprinted; not made yet');
var top = planFor(genPage('qa-x', { pos: 'center top' })).plan;
ok(top.inputs.background.y === 0 && top.inputs.background.x === 0.5 && top.fingerprint !== g.fingerprint, 'the hero\'s own background-position is kept, and is a new fingerprint');
var light = genPage('qa-x', { heroClass: 'hero-on-light', darkCopy: STORE + 'events/qa-x/generated/logo-unit-on-dark.png', veil: 'radial-gradient(ellipse 75% 80% at 50% 50%, rgba(255,255,255,.9) 0%, rgba(255,255,255,.66) 62%, rgba(255,255,255,.38) 100%)' });
var lp = planFor(light).plan, dp = planFor(light.replace('class="microsite rv-generated"', 'class="microsite rv-generated" data-rv-mode="dark"')).plan;
ok(lp.inputs.logo.url === STORE + 'events/qa-x/generated/logo-unit.png' && lp.inputs.overlay[0].stops[0].c.join() === '255,255,255,0.9', 'a light hero in its light theme: the unit drawn for it, its light veil');
ok(dp.inputs.logo.url === STORE + 'events/qa-x/generated/logo-unit-on-dark.png' && dp.inputs.overlay.length === 1 && dp.inputs.overlay[0].stops[0].c.join() === '8,10,16,0.8' && dp.inputs.background.ground === '#0c0c10' && dp.fingerprint !== lp.fingerprint,
  'a dark theme turns that hero dark (gen-base.css): the copy for a dark ground, the dark veil', dp.inputs);
var noDark = planFor(genPage('qa-x', { heroClass: 'hero-on-light', mode: 'dark' })).plan;
ok(noDark.inputs.logo.url === STORE + 'events/qa-x/generated/logo-unit.png' && noDark.inputs.overlay.length === 2, 'a light hero with no copy for a dark ground stays light in a dark theme (as the page does)');
var tp = planFor(templatePage('qa-t'), { name: 'T' }, 'tech500').plan;
ok(tp.needed && tp.inputs.background.url === 'https://img.etb2bimg.com/files/data_file_1.jpg' && tp.inputs.logo.url === STORE + 'events/qa-t/logo/logo.png' && tp.inputs.logo.from === 'banner' &&
  tp.inputs.overlay.length === 1 && tp.inputs.overlay[0].c.join() === '60,0,6,0.55', 'an ET template banner: its picture, its logo, its own scrim colour over it', tp.inputs);
var tp2 = planFor(templatePage('qa-t', { overlayStyle: 'background:rgba(249, 250, 252, 0.74)!important' }), { name: 'T' }, 'tech500').plan;
ok(tp2.inputs.overlay[0].c.join() === '249,250,252,0.74', 'an overlay colour set on the layer itself wins');
var ip = planFor(importedPage('qa-i'), { name: 'I', logoUrl: STORE + 'events/qa-i/logo/mark' }, 'imported-imp-x').plan;
ok(ip.needed && ip.inputs.background.url === STORE + 'events/import-imp-x/images/hero-awards.jpg' && ip.inputs.logo.from === 'event' && ip.inputs.overlay.length === 0,
  'an imported design: its first section\'s big picture, the event\'s own logo (checked to be a transparent PNG or SVG when drawn), no overlay guessed at', ip.inputs);
var ipNo = planFor(importedPage('qa-i'), { name: 'I' }, 'imported-imp-x').plan;
ok(!ipNo.needed && ipNo.reason === 'no-logo-unit', 'an imported design with no logo picture: no card, and why', ipNo);
var HV = { enabled: true, url: 'https://x/v.mp4', contentType: 'video/mp4', posterUrl: STORE + 'events/qa-x/media/still.jpg', overlay: { mode: 'custom', color: '#102030', opacity: 0.5 } };
var vp = planFor(genPage('qa-x'), { name: 'V', heroVideo: HV }).plan;
ok(vp.inputs.background.url === HV.posterUrl && vp.inputs.overlay.length === 1 && vp.inputs.overlay[0].c.join() === '16,32,48,0.5', 'the event\'s banner video: its still, under the overlay the video has (it takes the veil\'s place)', vp.inputs);
var posterVideo = planFor(genPage('qa-x', { video: '<video class="hero-video" poster="' + STORE + 'events/qa-x/media/poster.jpg" muted loop></video>' })).plan;
ok(posterVideo.inputs.background.url === STORE + 'events/qa-x/media/poster.jpg', 'a video in the hero with a still: the still');
var bws = planFor(genPage('qa-x', { heroBg: 'background:none', video: '<video class="hero-video" loop muted data-rv-src="https://et/v.mp4" data-rv-bg-video></video>' })).plan;
ok(!bws.needed && bws.reason === 'video-no-still', 'a hero that is only a video with no still (BWS): no card, and why', bws);
var type = planFor(genPage('qa-x', { unit: '<div class="rv-lu rv-lu-on-light" data-rv-logo-unit=""><div class="rv-lu-name"><span class="rv-lu-key">Data Center</span></div><img class="rv-lu-et" src="/templates/_shared/img/et-business-verticals-on-light.svg"></div>' })).plan;
ok(!type.needed && type.reason === 'logo-unit-in-type', 'a logo unit set in type (NDCS): never drawn here, and why', type);
var none = planFor(genPage('qa-x', { heroBg: 'background-image:radial-gradient(120% 90% at 50% 0%, color-mix(in srgb, var(--theme-color) 34%, transparent), transparent 70%)' })).plan;
ok(!none.needed && none.reason === 'no-picture', 'a hero with no picture: no card', none);
var badVeil = planFor(genPage('qa-x', { veil: 'linear-gradient(180deg, color-mix(in srgb, var(--theme-color) 40%, transparent), transparent)' })).plan;
ok(badVeil.needed && badVeil.inputs.overlay.length === 0, 'a veil that cannot be read for certain: the picture without one (never half of one)');
var own = planFor(genPage('qa-x', { ownImage: 'https://x/owner.jpg' })).plan;
ok(own.own === true && !own.needed, 'the owner\'s own share picture: nothing to make');
var dataLogo = planFor(genPage('qa-x', { logo: 'data:image/png;base64,AAAA' })).plan;
ok(!dataLogo.needed && dataLogo.reason === 'no-logo-unit', 'a unit picture written into the page as data is not fetched');

/* ===================== 3. the fingerprint ===================== */
var published = hooks.publishTransform(genPage('qa-x'), { eventId: 'qa-x', event: { name: 'Agentic' }, mode: 'live', templateId: 'gen-qa-x', publicBase: 'https://sites.example', report: {} });
var pubReport = {};
hooks.publishTransform(genPage('qa-x'), { eventId: 'qa-x', event: { name: 'Agentic' }, mode: 'live', templateId: 'gen-qa-x', publicBase: 'https://sites.example', report: pubReport });
var served = planFor(published, { name: 'Agentic, renamed', description: 'other words' }).plan;
ok(pubReport.shareCard && pubReport.shareCard.fingerprint === served.fingerprint && served.fingerprint === g.fingerprint,
  'the same page has the same fingerprint published, served, and whatever else of the event changes', [pubReport.shareCard && pubReport.shareCard.fingerprint, served.fingerprint]);
var fps = [
  planFor(genPage('qa-x', { bg: STORE + 'events/qa-x/generated/other.png' })).plan.fingerprint,
  planFor(genPage('qa-x', { logo: STORE + 'events/qa-x/generated/other-unit.png' })).plan.fingerprint,
  planFor(genPage('qa-x', { veil: 'rgba(0,0,0,.5)' })).plan.fingerprint,
  card.fingerprintOf(Object.assign({}, g.inputs, { v: card.CARD_VERSION + 1 }))
];
ok(fps.every(function (f) { return f !== g.fingerprint; }) && fps.filter(function (f, i) { return fps.indexOf(f) === i; }).length === 4, 'a new picture, logo unit, overlay or drawing is a new fingerprint');
ok(card.fingerprintOf({ b: 1, a: { d: 2, c: 3 } }) === card.fingerprintOf({ a: { c: 3, d: 2 }, b: 1 }), 'the order of the keys does not matter');

/* ===================== 4. the page pass with a card on record ===================== */
var CARD_URL = STORE + 'events/qa-x/share-card/' + g.fingerprint.slice(0, 16) + '-abc.jpg';
var withCard = { name: 'Agentic Summit 2027 & co', start: '2027-02-05T10:00', dateMode: 'exact', venue: 'Jio', city: 'Mumbai', shareCard: { state: 'ready', fingerprint: g.fingerprint, url: CARD_URL, width: 1200, height: 630 } };
var cp = planFor(genPage('qa-x'), withCard);
ok(cp.plan.fresh && /<meta property="og:image" content="[^"]*share-card\/[0-9a-f]{16}-abc\.jpg" data-rv-seo>/.test(cp.page) && count(cp.page, 'property="og:image"') === 1,
  'a card on record for this very page: it is og:image', (cp.page.match(/<meta property="og:image[^>]*>/g) || []).join(' '));
ok(/<meta property="og:image:width" content="1200" data-rv-seo>/.test(cp.page) && /<meta property="og:image:height" content="630" data-rv-seo>/.test(cp.page) &&
  /<meta property="og:image:type" content="image\/jpeg" data-rv-seo>/.test(cp.page) && /<meta property="og:image:alt" content="Agentic Summit 2027" data-rv-seo>/.test(cp.page),
  'with its size, its type and its words (the page\'s title, else the event\'s name)');
ok(/<meta name="twitter:image" content="[^"]*-abc\.jpg" data-rv-seo>/.test(cp.page) && /<meta name="twitter:image:alt" content="Agentic Summit 2027"/.test(cp.page) && /<meta name="twitter:card" content="summary_large_image"/.test(cp.page), 'and on X, as a large card');
var ldm = /<script type="application\/ld\+json" data-rv-seo>([^<]*)<\/script>/.exec(cp.page), ld = ldm && JSON.parse(ldm[1]);
ok(ld && ld.image && ld.image[0] === CARD_URL && ld.image.indexOf(STORE + 'events/qa-x/generated/hero-bg.png') > 0, 'the schema.org Event\'s pictures lead with it', ld && ld.image);
ok(hooks.sitePagePass(cp.page, { mode: 'live', event: withCard, templateId: 'gen-qa-x' }) === cp.page, 'the pass on its own output changes nothing');
var stale = planFor(genPage('qa-x', { bg: STORE + 'events/qa-x/generated/new-picture.png' }), withCard);
ok(!stale.plan.fresh && stale.page.indexOf('share-card') === -1 && /og:image" content="https:\/\/storage\.googleapis\.com\/test-bucket\/events\/qa-x\/generated\/new-picture\.png"/.test(stale.page),
  'a card made for what the page showed before is not used: the picture as before until the new one is made');
var failedRec = planFor(genPage('qa-x'), { name: 'X', shareCard: { state: 'failed', fingerprint: g.fingerprint, reason: 'logo-boxed', at: new Date().toISOString() } });
ok(!failedRec.plan.fresh && failedRec.page.indexOf('og:image:width') === -1, 'a failed record is no card');
var ownWins = planFor(genPage('qa-x', { ownImage: 'https://x/owner.jpg' }), withCard);
ok(/og:image" content="https:\/\/x\/owner\.jpg"/.test(ownWins.page) && ownWins.page.indexOf('share-card') === -1 && count(ownWins.page, 'property="og:image"') === 1, 'the owner\'s own share picture still wins over a card');
var ownViaTransform = hooks.publishTransform(genPage('qa-x'), { eventId: 'qa-x', event: Object.assign({}, withCard, { settings: { seo: { shareImageUrl: 'https://x/owner.jpg' } } }), mode: 'live', templateId: 'gen-qa-x', publicBase: 'https://sites.example' });
ok(/og:image" content="https:\/\/x\/owner\.jpg"/.test(ownViaTransform) && ownViaTransform.indexOf('share-card') === -1, '… as Basics › Share picture sets it');
var preview = hooks.publishTransform(genPage('qa-x'), { eventId: 'qa-x', event: withCard, mode: 'preview', templateId: 'gen-qa-x' });
ok(/og:image" content="[^"]*-abc\.jpg"/.test(preview) && /noindex/.test(preview), 'a preview (and a shared preview link) of the same page shows the card too, and stays noindex');

/* ===================== 5-9, which need pictures ===================== */
function solid(w, h, rgb) { return sharp({ create: { width: w, height: h, channels: 3, background: { r: rgb[0], g: rgb[1], b: rgb[2] } } }).png().toBuffer(); }
/* the banner: four colours, one in each quarter, so its corners can be told apart */
function quadrants(w, h) {
  var px = Buffer.alloc(w * h * 3);
  for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
    var c = y < h / 2 ? (x < w / 2 ? [200, 30, 30] : [30, 160, 60]) : (x < w / 2 ? [30, 60, 200] : [230, 200, 40]);
    var i = (y * w + x) * 3; px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2];
  }
  return sharp(px, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
}
/* the logo unit: a magenta disc on nothing (transparent all round) */
function disc(w, h, frame) {
  var px = Buffer.alloc(w * h * 4);
  for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
    var i = (y * w + x) * 4, dx = x - w / 2 + 0.5, dy = y - h / 2 + 0.5, inDisc = dx * dx + dy * dy < 80 * 80;
    var inFrame = frame && (x < 8 || y < 8 || x >= w - 8 || y >= h - 8);
    if (inDisc) { px[i] = 255; px[i + 1] = 0; px[i + 2] = 255; px[i + 3] = 255; }
    else if (inFrame) { px[i] = 255; px[i + 1] = 255; px[i + 2] = 255; px[i + 3] = 255; }
  }
  return sharp(px, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
}
function pixel(raw, info, x, y) { var i = (y * info.width + x) * info.channels; return [raw[i], raw[i + 1], raw[i + 2]]; }
function decodeJpeg(buf) { return sharp(buf).raw().toBuffer({ resolveWithObject: true }); }
function inputs(bgUrl, logoUrl, extra) {
  return Object.assign({ v: card.CARD_VERSION, background: { url: bgUrl, x: 0.5, y: 0.5, ground: '#ffffff' }, overlay: [], logo: { url: logoUrl, from: 'unit' } }, extra || {});
}
function bytesFrom(map) { return function (u) { return map[u] ? Promise.resolve(map[u]) : Promise.reject(new Error('no ' + u)); }; }
function reasonOf(p) { return p.then(function () { return 'made'; }, function (e) { return e && e.reason; }); }

(async function () {
  var BG = await quadrants(1600, 900), LOGO = await disc(400, 200), BOXED = await disc(400, 200, true);
  var JPEG_LOGO = await sharp(LOGO).flatten({ background: '#ffffff' }).jpeg().toBuffer();
  var OPAQUE = await sharp(await solid(400, 200, [255, 255, 255])).ensureAlpha().png().toBuffer();
  var SVG_LOGO = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200" viewBox="0 0 400 200"><circle cx="200" cy="100" r="80" fill="#00a0ff"/></svg>');
  var SVG_TEXT = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><text x="10" y="100" font-family="Montserrat" font-size="40">Summit</text></svg>');
  var WEBP_LOGO = await sharp(LOGO).webp({ lossless: true }).toBuffer();
  var PICS = { 'u:bg': BG, 'u:logo': LOGO, 'u:boxed': BOXED, 'u:jpeg': JPEG_LOGO, 'u:opaque': OPAQUE, 'u:svg': SVG_LOGO, 'u:svgtext': SVG_TEXT, 'u:webp': WEBP_LOGO };
  var get = bytesFrom(PICS);

  /* ===================== 5. the drawing ===================== */
  var c1 = await card.compose(inputs('u:bg', 'u:logo'), get);
  var m1 = await sharp(c1.buffer).metadata(), d1 = await decodeJpeg(c1.buffer);
  ok(m1.format === 'jpeg' && m1.width === 1200 && m1.height === 630 && m1.isProgressive === true && c1.bytes < 1024 * 1024 && c1.width === 1200 && c1.height === 630,
    'the card: a progressive JPEG of exactly 1200 × 630, under 1 MB', { format: m1.format, w: m1.width, h: m1.height, progressive: m1.isProgressive, bytes: c1.bytes });
  ok(near(pixel(d1.data, d1.info, 4, 4), [200, 30, 30], 14) && near(pixel(d1.data, d1.info, 1195, 4), [30, 160, 60], 14) &&
    near(pixel(d1.data, d1.info, 4, 625), [30, 60, 200], 14) && near(pixel(d1.data, d1.info, 1195, 625), [230, 200, 40], 14),
    'the banner at all four corners, covering the card the way the hero covers its box', [pixel(d1.data, d1.info, 4, 4), pixel(d1.data, d1.info, 1195, 4), pixel(d1.data, d1.info, 4, 625), pixel(d1.data, d1.info, 1195, 625)]);
  ok(near(pixel(d1.data, d1.info, 600, 315), [255, 0, 255], 14), 'the logo unit\'s own pixels at the centre', pixel(d1.data, d1.info, 600, 315));
  ok(c1.logo.width === 656 && c1.logo.height === 328 && c1.logo.left === 272 && c1.logo.top === 151, 'the unit as large as fits in 64 % × 52 % of the card, its proportions kept, centred', c1.logo);
  ok(near(pixel(d1.data, d1.info, c1.logo.left + 12, c1.logo.top + 12), [200, 30, 30], 14) && near(pixel(d1.data, d1.info, c1.logo.left + c1.logo.width - 12, c1.logo.top + c1.logo.height - 12), [230, 200, 40], 14) &&
    near(pixel(d1.data, d1.info, 560, c1.logo.top + 6), [200, 30, 30], 20),
    'where the unit is transparent the banner shows through: no box, no plate, no shape behind it', [pixel(d1.data, d1.info, c1.logo.left + 12, c1.logo.top + 12), pixel(d1.data, d1.info, c1.logo.left + c1.logo.width - 12, c1.logo.top + c1.logo.height - 12), pixel(d1.data, d1.info, 560, c1.logo.top + 6)]);
  /* the edge of the unit's box, sampled all the way round, is the banner — not one colour of a plate */
  var boxEdge = [[c1.logo.left + 2, c1.logo.top + 2], [c1.logo.left + c1.logo.width - 3, c1.logo.top + 2], [c1.logo.left + 2, c1.logo.top + c1.logo.height - 3], [c1.logo.left + c1.logo.width - 3, c1.logo.top + c1.logo.height - 3]];
  var expect = [[200, 30, 30], [30, 160, 60], [30, 60, 200], [230, 200, 40]];
  ok(boxEdge.every(function (p, i) { return near(pixel(d1.data, d1.info, p[0], p[1]), expect[i], 16); }), 'the corners of the unit\'s place are the banner\'s four colours', boxEdge.map(function (p) { return pixel(d1.data, d1.info, p[0], p[1]); }));
  var c2 = await card.compose(inputs('u:bg', 'u:logo', { overlay: [{ t: 'solid', c: [0, 0, 0, 0.5] }] }), get), d2 = await decodeJpeg(c2.buffer);
  ok(near(pixel(d2.data, d2.info, 4, 4), [100, 15, 15], 14) && near(pixel(d2.data, d2.info, 600, 315), [255, 0, 255], 14), 'the hero\'s overlay darkens the banner, never the logo unit', [pixel(d2.data, d2.info, 4, 4), pixel(d2.data, d2.info, 600, 315)]);
  /* a banner twice as wide as the card: dark on its left half, light on its right */
  PICS['u:wide'] = await (function () {
    var w = 2400, h = 630, px = Buffer.alloc(w * h * 3);
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) { var i = (y * w + x) * 3, v = x < 1200 ? 20 : 235; px[i] = v; px[i + 1] = v; px[i + 2] = v; }
    return sharp(px, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
  })();
  var left = await decodeJpeg((await card.compose(inputs('u:wide', 'u:logo', { background: { url: 'u:wide', x: 0, y: 0.5, ground: '#ffffff' } }), get)).buffer);
  var right = await decodeJpeg((await card.compose(inputs('u:wide', 'u:logo', { background: { url: 'u:wide', x: 1, y: 0.5, ground: '#ffffff' } }), get)).buffer);
  ok(near(pixel(left.data, left.info, 1195, 4), [20, 20, 20], 12) && near(pixel(right.data, right.info, 4, 4), [235, 235, 235], 12), 'the crop follows the hero\'s background-position (left keeps the left, right the right)');
  PICS['u:clear'] = await sharp({ create: { width: 1200, height: 630, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
  var ground = await decodeJpeg((await card.compose(inputs('u:clear', 'u:logo', { background: { url: 'u:clear', x: 0.5, y: 0.5, ground: '#123456' } }), get)).buffer);
  ok(near(pixel(ground.data, ground.info, 4, 4), [18, 52, 86], 10), 'a banner picture with transparent parts shows the hero\'s ground through them');
  var svgCard = await decodeJpeg((await card.compose(inputs('u:bg', 'u:svg'), get)).buffer);
  ok(near(pixel(svgCard.data, svgCard.info, 600, 315), [0, 160, 255], 16) && near(pixel(svgCard.data, svgCard.info, 280, 160), [200, 30, 30], 16), 'an SVG unit is drawn (resvg, as the logo-unit code draws it), its clear parts clear', pixel(svgCard.data, svgCard.info, 600, 315));
  ok(await reasonOf(card.compose(inputs('u:bg', 'u:jpeg'), get)) === 'logo-not-transparent', 'a JPEG unit is never put on the card (it would be a box)');
  ok(await reasonOf(card.compose(inputs('u:bg', 'u:opaque'), get)) === 'logo-not-transparent', 'nor a PNG with nothing transparent in it');
  ok(await reasonOf(card.compose(inputs('u:bg', 'u:boxed'), get)) === 'logo-boxed', 'nor one with a box drawn round it');
  ok(await reasonOf(card.compose(inputs('u:bg', 'u:svgtext'), get)) === 'logo-text', 'nor an SVG whose lettering is in a font it does not carry (it would be redrawn in another)');
  ok(await reasonOf(card.compose(inputs('u:bg', 'u:webp', { logo: { url: 'u:webp', from: 'event' } }), get)) === 'logo-not-transparent' &&
    await reasonOf(card.compose(inputs('u:bg', 'u:webp'), get)) === 'made', 'an event\'s own logo only as a PNG or an SVG; a transparent WebP unit in the hero is fine');
  ok(await reasonOf(card.compose(inputs('u:missing', 'u:logo'), get)) === 'unavailable' && await reasonOf(card.compose(inputs('u:bg', 'u:nothing'), get)) === 'unavailable', 'a picture that cannot be had: unavailable (tried again soon)');
  ok(T.transparencyProblem(Buffer.alloc(40 * 40 * 4), 40, 40) === '' && T.transparencyProblem(Buffer.alloc(40 * 40 * 4, 255), 40, 40) === 'logo-not-transparent', 'transparency is read off the pixels');

  /* the overlay's own pixels, exactly (no JPEG in between) */
  var white = Buffer.alloc(100 * 50 * 3, 255);
  T.applyOverlay(white, 100, 50, [T.parseLayer('linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,1) 100%)')]);
  ok(white[0] >= 250 && white[(49 * 100) * 3] <= 5 && Math.abs(white[(25 * 100) * 3] - 125) <= 6, 'a linear gradient top to bottom, as CSS draws it', [white[0], white[(25 * 100) * 3], white[(49 * 100) * 3]]);
  var grey = Buffer.alloc(100 * 100 * 3, 200);
  T.applyOverlay(grey, 100, 100, [T.parseLayer('radial-gradient(circle closest-side at 50% 50%, rgba(0,0,0,.5) 0%, rgba(0,0,0,0) 100%)')]);
  ok(Math.abs(grey[(50 * 100 + 50) * 3] - 100) <= 3 && grey[0] === 200, 'a radial gradient: strongest at its centre, nothing past its edge', [grey[(50 * 100 + 50) * 3], grey[0]]);
  var two = Buffer.alloc(3, 100);
  T.applyOverlay(two, 1, 1, [{ t: 'solid', c: [255, 255, 255, 0.5] }, { t: 'solid', c: [0, 0, 0, 0.5] }]);
  ok(Math.abs(two[0] - 153) <= 1, 'layers are painted the first on top, each over the ones under it', two[0]);
  var half = Buffer.alloc(3, 0);
  T.applyOverlay(half, 1, 1, [Object.assign({ o: 0.5 }, { t: 'solid', c: [255, 255, 255, 1] })]);
  ok(Math.abs(half[0] - 128) <= 1, 'an overlay\'s own opacity is kept', half[0]);

  /* ===================== 6. making, storing, recording ===================== */
  var ID = 'qa-sc';
  FB.docs['events/' + ID] = { name: 'QA Share', createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z', detailsUpdatedAt: '2026-11-01T00:00:00.000Z' };
  FB.files['events/' + ID + '/generated/hero-bg.png'] = BG;
  FB.files['events/' + ID + '/generated/logo-unit.png'] = LOGO;
  var plan6 = planFor(genPage(ID), { name: 'QA Share' }).plan;
  var stored = [];
  var rec = await card.make(FB, ID, plan6, { onStored: function (r) { stored.push(r); } });
  var doc = FB.docs['events/' + ID];
  ok(rec && rec.state === 'ready' && rec.fingerprint === plan6.fingerprint && doc.shareCard.state === 'ready' && doc.shareCard.url === rec.url && !doc.shareCard.making && stored.length === 1,
    'made, stored and recorded on the event; the caller told once it is stored', doc.shareCard);
  var cardPath = 'events/' + ID + '/share-card/' + plan6.fingerprint.slice(0, 16) + '-';
  ok(rec.path.indexOf(cardPath) === 0 && /-[0-9a-z]+\.jpg$/.test(rec.path) && rec.url === STORE + rec.path && FB.publics[rec.path] === true &&
    FB.meta[rec.path].contentType === 'image/jpeg' && FB.meta[rec.path].cacheControl === 'public, max-age=31536000, immutable' && rec.width === 1200 && rec.height === 630,
    'stored public as events/<id>/share-card/<fingerprint 16>-<time>.jpg, cached a year', [rec.path, FB.meta[rec.path]]);
  var touched = FB.updates.filter(function (u) { return u.doc === 'events/' + ID; }).map(function (u) { return u.field; });
  ok(touched.length && touched.every(function (f) { return f === 'shareCard' || f.indexOf('shareCard.') === 0; }) && doc.updatedAt === '2026-11-01T00:00:00.000Z' && doc.detailsUpdatedAt === '2026-11-01T00:00:00.000Z',
    'only the card\'s own record is written: not an edit (updatedAt, detailsUpdatedAt and the site are untouched)', touched);
  var dl = FB.downloads.length;
  var again = await card.make(FB, ID, Object.assign({}, plan6, { fresh: false }), {});
  ok(again && again.url === rec.url && FB.downloads.length === dl, 'asked again for the same page: the stored card, nothing drawn again');
  ok(await card.make(FB, ID, Object.assign({}, plan6, { fresh: true }), {}) === null, 'nothing to do for a page whose card is fresh');
  /* two instances: one is making it, the other does not */
  var plan6b = planFor(genPage(ID, { pos: 'center top' }), { name: 'QA Share' }).plan;
  doc.shareCard.making = { fingerprint: plan6b.fingerprint, at: new Date().toISOString() };
  dl = FB.downloads.length;
  ok(await card.make(FB, ID, plan6b, {}) === null && FB.downloads.length === dl, 'another instance is making this card: this one leaves it');
  doc.shareCard.making = { fingerprint: plan6b.fingerprint, at: new Date(Date.now() - T.MAKING_TTL_MS - 1000).toISOString() };
  var taken = await card.make(FB, ID, plan6b, {});
  ok(taken && taken.fingerprint === plan6b.fingerprint && FB.docs['events/' + ID].shareCard.state === 'ready' && !FB.docs['events/' + ID].shareCard.making, 'a mark left by one that died is taken over');
  /* two calls at once on one instance: one drawing */
  var plan6c = planFor(genPage(ID, { pos: 'center bottom' }), { name: 'QA Share' }).plan;
  dl = FB.downloads.length;
  var both = await Promise.all([card.make(FB, ID, plan6c, {}), card.make(FB, ID, plan6c, {})]);
  ok(both[0] && both[1] && both[0].url === both[1].url && FB.downloads.length - dl === 2, 'two visits at once: one card made (its two pictures read once)', FB.downloads.length - dl);
  /* a unit that cannot go on a card: noted, not tried again on every visit, tried again later */
  FB.files['events/' + ID + '/generated/boxed.png'] = BOXED;
  var plan6d = planFor(genPage(ID, { logo: STORE + 'events/' + ID + '/generated/boxed.png' }), { name: 'QA Share' }).plan;
  var r6d = await quietly(function () { return card.make(FB, ID, plan6d, {}); });
  var sc = FB.docs['events/' + ID].shareCard;
  ok(r6d === null && sc.state === 'failed' && sc.reason === 'logo-boxed' && sc.fingerprint === plan6d.fingerprint, 'a boxed unit: no card, and the record says why', sc);
  dl = FB.downloads.length;
  ok(await card.make(FB, ID, plan6d, {}) === null && FB.downloads.length === dl, 'not tried again on the next visit');
  var txBefore = FB.updates.length, realTx = FB.db.runTransaction, txCalls = 0;
  FB.db.runTransaction = function (fn) { txCalls++; return realTx(fn); };
  ok(await card.make(FB, ID, plan6d, { known: JSON.parse(JSON.stringify(FB.docs['events/' + ID].shareCard)) }) === null && txCalls === 0 && FB.updates.length === txBefore,
    'a serve that has just read that record does not even ask the database again');
  ok(await card.make(FB, ID, plan6b, { known: { making: { fingerprint: plan6b.fingerprint, at: new Date().toISOString() } } }) === null && txCalls === 0, '… nor while the record says the card is being made');
  FB.db.runTransaction = realTx;
  sc.at = new Date(Date.now() - T.RETRY_MS.lasting - 1000).toISOString();
  await quietly(function () { return card.make(FB, ID, plan6d, {}); });
  ok(FB.downloads.length > dl, 'tried again a day later');
  FB.docs['events/' + ID].shareCard = { state: 'failed', reason: 'unavailable', fingerprint: plan6.fingerprint, at: new Date(Date.now() - T.RETRY_MS.passing - 1000).toISOString() };
  var retried = await card.make(FB, ID, plan6, {});
  ok(retried && retried.state === 'ready', 'a picture that could not be loaded is tried again after a few minutes');
  /* an event that is gone */
  FB.docs['events/qa-sc-gone'] = { name: 'Gone', createdAt: '2026-11-01T00:00:00.000Z', deletedAt: '2026-11-02T00:00:00.000Z' };
  var filesBefore = Object.keys(FB.files).length;
  ok(await card.make(FB, 'qa-sc-gone', plan6, {}) === null && Object.keys(FB.files).length === filesBefore && !FB.docs['events/qa-sc-gone'].shareCard, 'a deleted event: nothing made, nothing written');
  /* the QA guard */
  process.env.QA_SHARE_ONLY_QA = '1';
  FB.docs['events/real-event'] = { name: 'Real', createdAt: '2026-11-01T00:00:00.000Z' };
  var updatesBefore = FB.updates.length;
  var guarded = await quietly(function () { return card.make(FB, 'real-event', plan6, {}); });
  var guardedNote = await card.note(FB, 'real-event', {}, 'no-picture');
  ok(guarded === null && guardedNote === false && FB.updates.length === updatesBefore && !FB.docs['events/real-event'].shareCard && T.allowed('qa-sc') && !T.allowed('real-event'),
    'QA_SHARE_ONLY_QA=1 (the QA harness on production): nothing made or written for a real event');
  delete process.env.QA_SHARE_ONLY_QA;
  ok(T.allowed('real-event'), 'without it, every event');
  /* why there is none */
  FB.docs['events/qa-sc-none'] = { name: 'None', createdAt: '2026-11-01T00:00:00.000Z' };
  var n1 = await card.note(FB, 'qa-sc-none', {}, 'logo-unit-in-type');
  var n2 = await card.note(FB, 'qa-sc-none', {}, 'logo-unit-in-type');
  var n3 = await card.note(FB, 'qa-sc-none', { shareCard: { state: 'none', reason: 'no-picture' } }, 'no-picture');
  ok(n1 === true && n2 === false && n3 === false && FB.docs['events/qa-sc-none'].shareCard.state === 'none' && FB.docs['events/qa-sc-none'].shareCard.reason === 'logo-unit-in-type',
    'a page with nothing to make one from says why on its record, once', FB.docs['events/qa-sc-none'].shareCard);

  /* ===================== 7. going live ===================== */
  var REQ = { headers: { host: 'sites.example', 'x-forwarded-proto': 'https' }, socket: {} };
  var PUB = 'qa-sc-pub';
  FB.docs['events/' + PUB] = { name: 'QA Publish Summit', createdAt: '2026-11-01T00:00:00.000Z', site: { version: 1, templateId: 'gen-' + PUB } };
  FB.files['events/' + PUB + '/site/versions/1/page.html'] = Buffer.from(genPage(PUB));
  FB.files['events/' + PUB + '/generated/hero-bg.png'] = BG;
  FB.files['events/' + PUB + '/generated/logo-unit.png'] = LOGO;
  var out7 = await hooks.publishVersion(FB, REQ, PUB, 1, 'qa-agent@timesinternet.in', '', {}, {});
  var live7 = FB.files['events/' + PUB + '/published/index.html'].toString('utf8'), rec7 = FB.docs['events/' + PUB].shareCard;
  ok(out7.publishedVersion === 1 && rec7 && rec7.state === 'ready' && live7.indexOf('<meta property="og:image" content="' + rec7.url + '" data-rv-seo>') !== -1 && /og:image:width" content="1200"/.test(live7),
    'an approval going live: the card is made and the page goes live carrying it', (live7.match(/<meta property="og:image[^>]*>/g) || []).join(' '));
  ok(FB.docs['events/' + PUB].published === true && !FB.docs['events/' + PUB].siteLock, 'and the publish is recorded as before');
  /* a card not ready in time never holds the publish up */
  var SLOW = 'qa-sc-slow';
  FB.docs['events/' + SLOW] = { name: 'QA Slow', createdAt: '2026-11-01T00:00:00.000Z', site: { version: 1, templateId: 'gen-' + SLOW } };
  FB.files['events/' + SLOW + '/site/versions/1/page.html'] = Buffer.from(genPage(SLOW));
  FB.files['events/' + SLOW + '/generated/hero-bg.png'] = BG;
  FB.files['events/' + SLOW + '/generated/logo-unit.png'] = LOGO;
  FB.delays[SLOW + '/generated/hero-bg.png'] = 700;
  T.setPublishWait(150);
  var t0 = Date.now();
  await hooks.publishVersion(FB, REQ, SLOW, 1, 'qa-agent@timesinternet.in', '', {}, {});
  var took = Date.now() - t0, live7b = FB.files['events/' + SLOW + '/published/index.html'].toString('utf8');
  ok(took < 650 && live7b.indexOf('share-card') === -1 && /og:image" content="https:\/\/storage\.googleapis\.com\/test-bucket\/events\/qa-sc-slow\/generated\/hero-bg\.png"/.test(live7b) && FB.docs['events/' + SLOW].published === true,
    'a card not ready within the wait: the site goes live at once with the picture it had', took);
  for (var w8 = 0; w8 < 60 && !(FB.docs['events/' + SLOW].shareCard && FB.docs['events/' + SLOW].shareCard.state === 'ready'); w8++) await sleep(50);
  ok(FB.docs['events/' + SLOW].shareCard && FB.docs['events/' + SLOW].shareCard.state === 'ready', 'and the card is still made, and recorded, after it');
  T.setPublishWait(8000);
  delete FB.delays[SLOW + '/generated/hero-bg.png'];

  /* ===================== 8. a site already live ===================== */
  function route(url) {
    return new Promise(function (resolve) {
      var got = { status: 0, headers: {}, body: '' };
      var res = { headersSent: false, setHeader: function (k, v) { got.headers[k] = v; },
        writeHead: function (st, h) { got.status = st; Object.assign(got.headers, h || {}); this.headersSent = true; },
        end: function (b) { got.body = b == null ? '' : Buffer.isBuffer(b) ? b.toString('utf8') : String(b); resolve(got); } };
      hooks.routeApi({ method: 'GET', url: url, headers: { host: 'sites.example' } }, res);
    });
  }
  var LIVE = 'qa-sc-live';
  FB.docs['events/' + LIVE] = { name: 'QA Live Summit', createdAt: '2026-11-01T00:00:00.000Z', published: true, publishedVersion: 4, publishedAt: '2026-11-02T00:00:00.000Z', site: { version: 4, templateId: 'gen-' + LIVE } };
  /* a page published before cards existed: today's picture, no card, two inner pages */
  var oldPage = hooks.publishTransform(genPage(LIVE, { pagesMeta: '<meta name="rv-pages" content=\'[{"slug":"award-jury","title":"Jury"}]\'>' }),
    { eventId: LIVE, event: { name: 'QA Live Summit' }, mode: 'live', templateId: 'gen-' + LIVE, publicBase: 'https://sites.example' });
  FB.files['events/' + LIVE + '/published/index.html'] = Buffer.from(oldPage);
  FB.files['events/' + LIVE + '/generated/hero-bg.png'] = BG;
  FB.files['events/' + LIVE + '/generated/logo-unit.png'] = LOGO;
  ok(oldPage.indexOf('share-card') === -1, 'the stored page has no card');
  var v1 = await route('/e/' + LIVE);
  ok(v1.status === 200 && v1.body.indexOf('share-card') === -1 && /og:image" content="https:\/\/storage\.googleapis\.com\/test-bucket\/events\/qa-sc-live\/generated\/hero-bg\.png"/.test(v1.body),
    'the first visit: the picture it had, at once (nothing waits for the card)', (v1.body.match(/<meta property="og:image[^>]*>/g) || []).join(' '));
  for (var w9 = 0; w9 < 80 && !(FB.docs['events/' + LIVE].shareCard && FB.docs['events/' + LIVE].shareCard.state === 'ready'); w9++) await sleep(50);
  var rec8 = FB.docs['events/' + LIVE].shareCard;
  ok(rec8 && rec8.state === 'ready' && FB.files[rec8.path] && FB.publics[rec8.path], 'meanwhile the card is made in the background and stored', rec8);
  var v2 = await route('/e/' + LIVE);
  ok(v2.body.indexOf('<meta property="og:image" content="' + rec8.url + '" data-rv-seo>') !== -1 && /og:image:height" content="630"/.test(v2.body) && /twitter:card" content="summary_large_image"/.test(v2.body),
    'the next visit carries it: the cached page was dropped once it was stored (no publish, no approval)', (v2.body.match(/<meta property="og:image[^>]*>/g) || []).join(' '));
  var v3 = await route('/e/' + LIVE + '/award-jury');
  ok(v3.status === 200 && v3.body.indexOf('<meta property="og:image" content="' + rec8.url + '"') !== -1, 'its inner pages share the same card');
  ok(FB.files['events/' + LIVE + '/published/index.html'].toString('utf8') === oldPage, 'the stored page itself is not touched');
  dl = FB.downloads.filter(function (p) { return p.indexOf('/generated/') !== -1; }).length;
  await route('/e/' + LIVE); await sleep(100);
  ok(FB.downloads.filter(function (p) { return p.indexOf('/generated/') !== -1; }).length === dl, 'once it has its card, a visit makes nothing');
  /* a live page with nothing to make one from: why, noted from the visit */
  var NONE = 'qa-sc-type';
  FB.docs['events/' + NONE] = { name: 'QA Type', createdAt: '2026-11-01T00:00:00.000Z', published: true, publishedVersion: 1, publishedAt: '2026-11-02T00:00:00.000Z', site: { version: 1, templateId: 'gen-' + NONE } };
  FB.files['events/' + NONE + '/published/index.html'] = Buffer.from(genPage(NONE, { unit: '<div class="rv-lu"><div class="rv-lu-name"><span class="rv-lu-key">Type</span></div></div>' }));
  await route('/e/' + NONE); await sleep(50);
  ok(FB.docs['events/' + NONE].shareCard && FB.docs['events/' + NONE].shareCard.state === 'none' && FB.docs['events/' + NONE].shareCard.reason === 'logo-unit-in-type', 'a live page with its unit set in type: its record says why it has no card');
  /* under the QA guard, a real event's page is served as before and nothing is written */
  process.env.QA_SHARE_ONLY_QA = '1';
  var REAL = 'real-live-event';
  FB.docs['events/' + REAL] = { name: 'Real', createdAt: '2026-11-01T00:00:00.000Z', published: true, publishedVersion: 2, publishedAt: '2026-11-02T00:00:00.000Z', site: { version: 2, templateId: 'gen-' + REAL } };
  FB.files['events/' + REAL + '/published/index.html'] = Buffer.from(genPage(REAL));
  FB.files['events/' + REAL + '/generated/hero-bg.png'] = BG;
  FB.files['events/' + REAL + '/generated/logo-unit.png'] = LOGO;
  var real = await quietly(function () { return route('/e/' + REAL); }); await sleep(300);
  ok(real.status === 200 && !FB.docs['events/' + REAL].shareCard && !Object.keys(FB.files).some(function (p) { return p.indexOf('events/' + REAL + '/share-card/') === 0; }), 'QA_SHARE_ONLY_QA=1: a real event is served, and no card is made or recorded for it');
  delete process.env.QA_SHARE_ONLY_QA;

  /* ===================== 9. the console ===================== */
  var page = fs.readFileSync(path.join(__dirname, '..', '..', 'edit-event.html'), 'utf8');
  var main = (page.match(/<script>([\s\S]*?)<\/script>/g) || []).map(function (s) { return s.replace(/^<script>|<\/script>$/g, ''); }).filter(function (s) { return s.indexOf('function wireBasics') !== -1; })[0] || '';
  function fnSrc(name) { var m = new RegExp('\\n  function ' + name + '\\([^)]*\\)\\{[\\s\\S]*?\\n  \\}\\n').exec(main); return m ? m[0] : ''; }
  function varSrc(name) { var b = new RegExp('\\n  var ' + name + ' = \\{\\n[\\s\\S]*?\\n  \\};\\n').exec(main); if (b) return b[0]; var m = new RegExp('\\n  var ' + name + '\\b[^\\n]*\\n').exec(main); return m ? m[0] : ''; }
  var src = ['SHARE_AUTO', 'SHARE_OWN', 'SHARE_LATER', 'SHARE_WHY'].map(varSrc).join('') + ['shareUrlOf', 'shareAutoState', 'sharePictureField'].map(fnSrc).join('');
  var sb = { esc: function (s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }, imgTag: function (u) { return u ? '<img src="' + u + '" alt="">' : ''; }, svg: function () { return '<svg/>'; }, IC: {} };
  vm.runInNewContext(src, sb);
  var ready = sb.sharePictureField({ published: true, shareCard: { state: 'ready', url: 'https://storage.googleapis.com/b/events/x/share-card/a.jpg' } });
  ok(/Automatic: the banner’s picture with the logo unit on it\./.test(ready) && ready.indexOf('<img src="https://storage.googleapis.com/b/events/x/share-card/a.jpg"') !== -1 && /id="b-share-btn">Upload</.test(ready) && /id="b-share-auto" hidden/.test(ready),
    'Basics › Share picture: the automatic choice says what it is and shows the card; Upload stays', ready);
  var later = sb.sharePictureField({ published: true });
  ok(/It is made when the site is next published or visited\./.test(later) && later.indexOf('<img') === -1, 'no card yet: said plainly when it is made, and no picture pretended');
  var notLive = sb.sharePictureField({ published: false });
  ok(/It is made when the site is published\./.test(notLive), 'a site not live yet: made when it is published');
  var why = sb.sharePictureField({ published: true, shareCard: { state: 'none', reason: 'logo-unit-in-type' } });
  ok(/None can be made for this site yet: the banner’s logo unit is set in type, not a picture\. Until then a link shows the banner’s picture alone, or the first picture of the site\./.test(why), 'none can be made: why, in plain words', why);
  var ownField = sb.sharePictureField({ published: true, settings: { seo: { shareImageUrl: 'https://x/own.jpg' } }, shareCard: { state: 'ready', url: 'https://x/card.jpg' } });
  ok(/Shared links of the site show this picture\./.test(ownField) && ownField.indexOf('own.jpg') !== -1 && ownField.indexOf('card.jpg') === -1 && /id="b-share-btn">Replace</.test(ownField) && !/id="b-share-auto" hidden/.test(ownField),
    'the owner\'s own picture: shown, with Replace and Use automatic as before');
  ok(Object.keys(card.REASONS).every(function (k) { return sb.SHARE_WHY[k]; }), 'the console has words for every reason the server records', Object.keys(card.REASONS).filter(function (k) { return !sb.SHARE_WHY[k]; }));
  /* Settings › URL & SEO (edit-event-seo.js) draws the share picture with the console's own field above, so it says
     the same: the card when it is made, else when it will be or why it cannot be */
  var seoJs = fs.readFileSync(path.join(__dirname, '..', '..', 'edit-event-seo.js'), 'utf8');
  ok(/ST\.ctx\.seo\.sharePictureField\(ST\.ctx\.EV\)/.test(seoJs) && /sharePictureField: sharePictureField, wireSharePicture: wireSharePicture/.test(main) && /ctx\.seo\.wireSharePicture\(\)/.test(seoJs),
    'URL & SEO: the share picture says it is the card when it is, else when it is made or why not');
  var og = main.slice(main.indexOf("} else if (mode === 'og'){"), main.indexOf("} else if (mode === 'og'){") + 1200);
  ok(/var own = shareUrlOf\(EV\), pic = own \|\| shareAutoState\(EV\)\.url;/.test(og) && /'<div class="img pic">' \+ imgTag\(pic\)/.test(og) && /a stand-in until the site’s own is made/.test(og), 'the Social preview shows the real picture (or says its drawing is a stand-in)');
  var css = fs.readFileSync(path.join(__dirname, '..', '..', 'edit-event.css'), 'utf8');
  ok(/\.mock-og \.img\.pic img\{[^}]*object-fit:cover/.test(css), 'and fills its frame with it');
  ok(require('./api-events')._shared && fs.readFileSync(path.join(__dirname, 'api-events.js'), 'utf8').indexOf("'shareCard'];") !== -1 && /NOT_CLONED_FOLDERS = \[[^\]]*'share-card'\]/.test(fs.readFileSync(path.join(__dirname, 'api-events.js'), 'utf8')),
    'a new edition copies neither the card nor its record (its own is made from its own banner)');

  if (failures.length) {
    console.error('share-card: ' + failures.length + ' of ' + checks + ' checks FAILED\n  - ' + failures.join('\n  - '));
    process.exit(1);
  }
  console.log('share-card: all ' + checks + ' checks passed');
  process.exit(0);
})().catch(function (e) { console.error(e && e.stack || e); process.exit(1); });
