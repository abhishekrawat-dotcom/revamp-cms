/* node functions/lib/portal-readers.test.js — exits 1 on any failure. The places that READ an event's portal
   (events/<id>.portal, a slug on the et-events.js roster) and must never work one out: the site's ET bar
   (lib/et-nav.js sectionFor), the registration forms' consent links (lib/api-forms.js loadConsent, its callers
   and GET /api/public/forms), the Promotions kit (lib/promo.js buildKit's brand.portal), the mailer studio's
   event (lib/promo-mailer.js) and the studio's portal name (promo-studio/oneworld.js).
   No network, no Firebase and no model: lib/firebase.js, lib/safe-fetch.js and lib/llm.js are in-memory
   stand-ins, each call counted; Firestore is a small fake that records every read it is asked for. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

var passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; return; }
  failed++;
  console.error('FAIL ' + name + (detail !== undefined ? ' — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''));
}
function clone(v) { return v === undefined ? v : JSON.parse(JSON.stringify(v)); }
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function read(rel) { return fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8'); }

/* ---------- stand-ins, in place before any module under test is loaded ---------- */

/* lib/firebase.js: the routes ask getFirebase() for the database; here it is the fake below (FB.current) */
var FB = { current: null };
var FIREBASE_PATH = require.resolve('./firebase');
require.cache[FIREBASE_PATH] = { id: FIREBASE_PATH, filename: FIREBASE_PATH, loaded: true, children: [], paths: [],
  exports: { getFirebase: function () { return FB.current; } } };
/* lib/safe-fetch.js: never the network — every address asked for is counted, and fails as an unreachable site would */
var FETCHED = [];
var SAFE_FETCH_PATH = require.resolve('./safe-fetch');
require.cache[SAFE_FETCH_PATH] = { id: SAFE_FETCH_PATH, filename: SAFE_FETCH_PATH, loaded: true, children: [], paths: [],
  exports: Object.assign({}, require('./safe-fetch'), {
    safeFetch: function (url) { FETCHED.push(url); return Promise.reject(new Error('stand-in: no network here')); }
  }) };
/* lib/llm.js: no model is ever asked here */
var LLM_CALLS = 0, LLM_PATH = require.resolve('./llm');
require.cache[LLM_PATH] = { id: LLM_PATH, filename: LLM_PATH, loaded: true, children: [], paths: [], exports: {
  callJson: function () { LLM_CALLS++; return Promise.reject(new Error('stand-in: no model here')); }
} };

/* ---------- an in-memory Firestore that records what is read ---------- */
function fakeFb(seed, o) {
  o = o || {};
  var docs = clone(seed || {}), reads = [];
  function snapOf(p) {
    return { id: p.split('/').pop(), exists: Object.prototype.hasOwnProperty.call(docs, p), data: function () { return clone(docs[p]); } };
  }
  function listOf(p, n) {
    var pre = p + '/';
    var ids = Object.keys(docs).filter(function (k) { return k.indexOf(pre) === 0 && k.slice(pre.length).indexOf('/') === -1; }).sort();
    if (n != null) ids = ids.slice(0, n);
    var list = ids.map(snapOf);
    return { docs: list, empty: !list.length, size: list.length };
  }
  function query(p, n, sel) {
    return {
      limit: function (m) { return query(p, m, sel); },
      orderBy: function () { return query(p, n, sel); },
      where: function () { return query(p, n, sel); },
      select: function () { return query(p, n, Array.prototype.slice.call(arguments)); },
      get: function () {
        reads.push({ path: p, select: sel || null });
        if (o.failSources && /\/sources$/.test(p)) return Promise.reject(new Error('stand-in: the sources cannot be read'));
        return Promise.resolve(listOf(p, n));
      }
    };
  }
  function col(p) { var q = query(p, null, null); q.doc = function (id) { return docRef(p + '/' + id); }; return q; }
  function docRef(p) {
    return { _path: p, id: p.split('/').pop(), collection: function (name) { return col(p + '/' + name); },
      get: function () { reads.push({ path: p, doc: true }); return Promise.resolve(snapOf(p)); } };
  }
  return { db: { collection: col }, bucket: { name: 'qa-bucket' }, reads: reads, docs: docs };
}
function sourceReads(fb) { return fb.reads.filter(function (r) { return /\/sources$/.test(r.path); }).length; }

/* the sources an event's previous edition and its own page leave (lib/api.js handleIngestSource) */
var CIO_SOURCES = {
  previousEdition: { type: 'previousEdition', url: 'https://cio.economictimes.indiatimes.com/etcio-annual-conclave-2026', previous: { portal: 'cio', url: 'https://cio.economictimes.indiatimes.com/etcio-annual-conclave-2026' } }
};
var BE_SOURCES = {
  previousEdition: { type: 'previousEdition', url: 'https://brandequity.economictimes.indiatimes.com/brand-world-summit-south2025' }
};
function seedEvent(seed, id, ev, sources) {
  seed['events/' + id] = Object.assign({ name: 'QA ' + id, createdAt: '2026-11-01T10:00:00.000Z' }, ev || {});
  Object.keys(sources || {}).forEach(function (k) { seed['events/' + id + '/sources/' + k] = sources[k]; });
  return seed;
}

const etEvents = require('./et-events');
const etFooter = require('./et-footer');
const forms = require('./forms');
const nav = require('./et-nav');
const AF = require('./api-forms');
const promo = require('./promo');
const pm = require('./promo-mailer')._test;
const ROSTER = Object.keys(etEvents.PORTALS);

/* =====================================================================================================
   1. The site's ET bar (lib/et-nav.js): o.portal, when the caller passes it, is the portal
   ===================================================================================================== */
function logoOf(html) {
  var img = /<img data-rv-et-logo[^>]*>/.exec(html) || [''];
  return { src: (/ src="([^"]*)"/.exec(img[0]) || [])[1] || '', alt: (/ alt="([^"]*)"/.exec(img[0]) || [])[1] || '',
    href: (/class="rv-etnav-logo" href="([^"]*)"/.exec(html) || [])[1] || '' };
}
var navEvent = { name: 'QA Summit', designPlan: { design: { mode: 'light' }, reference: { type: 'previousEdition', url: 'https://cio.economictimes.indiatimes.com/x' }, sections: [] } };
var navSources = [CIO_SOURCES.previousEdition];
var hrLogo = logoOf(nav.sectionFor(navEvent, { order: ['nav', 'hero', 'footer'], portal: 'hr', sources: navSources }).html);
check('nav: portal "hr" with ETCIO sources and an ETCIO reference page gives ETHRWorld\'s wordmark', hrLogo.src === '/templates/_shared/img/portals/hr.png' && hrLogo.alt === 'ETHRWorld', hrLogo);
var noLogo = logoOf(nav.sectionFor(navEvent, { order: ['nav', 'hero', 'footer'], portal: '', sources: navSources }).html);
check('nav: portal "" gives The Economic Times Business Verticals logo, though the sources say ETCIO', /et-business-verticals-on-light\.svg$/.test(noLogo.src) && noLogo.href === '#hero', noLogo);
var oldLogo = logoOf(nav.sectionFor(navEvent, { order: ['nav', 'hero', 'footer'], sources: navSources }).html);
check('nav: with no portal key, the candidates as before (ETCIO)', oldLogo.src === '/templates/_shared/img/portals/cio.png', oldLogo);
check('nav: TechMonk and ET Startup link to their real homes', nav.logoOf('techmonk', 'light').href === etFooter.info('techmonk').home + '/' &&
  nav.logoOf('startup', 'light').href === etFooter.info('startup').home + '/', [nav.logoOf('techmonk').href, nav.logoOf('startup').href].join(' '));

/* =====================================================================================================
   2. The consent links (lib/api-forms.js loadConsent(fb, eventId, ev))
   ===================================================================================================== */
var seed = {};
seedEvent(seed, 'qa-c-hr', { portal: 'hr' }, CIO_SOURCES);
seedEvent(seed, 'qa-c-none', {}, CIO_SOURCES);
seedEvent(seed, 'qa-c-bare', {}, {});
seedEvent(seed, 'qa-c-cache', {}, CIO_SOURCES);
seedEvent(seed, 'qa-c-cache2', { portal: 'hr' }, CIO_SOURCES);
seedEvent(seed, 'qa-c-off', { portal: 'hrworld' }, CIO_SOURCES);
seedEvent(seed, 'qa-c-proto', { portal: '__proto__' }, BE_SOURCES);
seedEvent(seed, 'qa-c-old', {}, BE_SOURCES);
var fb = fakeFb(seed);
var fbDown = fakeFb(seedEvent({}, 'qa-c-down', {}, CIO_SOURCES), { failSources: true });

function consentOf(f, id, ev) { var before = sourceReads(f); return AF.loadConsent(f, id, ev).then(function (c) { return { c: c, reads: sourceReads(f) - before }; }); }
function hrefsOf(c) { return (c && c.links || []).map(function (l) { return l.href; }); }

var consentChecks = Promise.resolve().then(function () {
  return consentOf(fb, 'qa-c-hr', { portal: 'hr' });
}).then(function (r) {
  check('consent: an event on ETHRWorld with ETCIO sources gets ETHRWorld\'s links', r.c.portal === 'hr' && same(r.c, forms.consentFor('hr')) &&
    hrefsOf(r.c).every(function (h) { return h.indexOf('https://hr.economictimes.indiatimes.com/') === 0; }), hrefsOf(r.c));
  check('consent: with a portal set, the sources are never read', r.reads === 0, r.reads);
  return consentOf(fb, 'qa-c-none', {});
}).then(function (r) {
  check('consent: an event with no portal yet keeps today\'s rule — its sources say ETCIO', same(r.c, forms.consentFor('cio')) && r.reads === 1, [r.c.portal, r.reads]);
  var q = fb.reads.filter(function (x) { return x.path === 'events/qa-c-none/sources'; })[0];
  check('consent: only the four fields that say it are read', q && same(q.select, ['type', 'url', 'previous.portal', 'previous.url']), q);
  return consentOf(fb, 'qa-c-none', {});
}).then(function (r) {
  check('consent: that answer is kept for a few minutes (a busy page reads the sources once in a while)', same(r.c, forms.consentFor('cio')) && r.reads === 0, r.reads);
  return consentOf(fb, 'qa-c-bare', {});
}).then(function (r) {
  check('consent: no portal and no sources: ETCIO\'s links', same(r.c, forms.consentFor('')) && r.c.portal === 'cio', r.c.portal);
  return consentOf(fb, 'qa-c-old', {});
}).then(function (r) {
  check('consent: no portal, ET BrandEquity sources: ET BrandEquity\'s links, as before', r.c.portal === 'brandequity' && same(r.c, forms.consentFor('brandequity')), r.c.portal);
  return consentOf(fb, 'qa-c-old', undefined);
}).then(function (r) {
  check('consent: a caller that passes no event gets today\'s rule', r.c.portal === 'brandequity', r.c.portal);
  /* the no-portal answer is kept; a portal set meanwhile is shown at once, not after the cache runs out */
  return consentOf(fb, 'qa-c-cache', {});
}).then(function (r) {
  check('consent (cache): before its portal is set, the event has ETCIO\'s from its sources', r.c.portal === 'cio' && r.reads === 1, [r.c.portal, r.reads]);
  return consentOf(fb, 'qa-c-cache', { portal: 'cfo' });
}).then(function (r) {
  check('consent (cache): portal set to ETCFO — ETCFO\'s links at once, nothing read', r.c.portal === 'cfo' && same(r.c, forms.consentFor('cfo')) && r.reads === 0, [r.c.portal, r.reads]);
  return consentOf(fb, 'qa-c-cache2', { portal: 'hr' });
}).then(function (r) {
  check('consent (cache): an ETHRWorld answer first…', r.c.portal === 'hr', r.c.portal);
  return consentOf(fb, 'qa-c-cache2', { portal: 'cfo' });
}).then(function (r) {
  check('consent (cache): …then its portal changed to ETCFO gives ETCFO\'s at once', r.c.portal === 'cfo' && r.reads === 0, [r.c.portal, r.reads]);
  return consentOf(fb, 'qa-c-off', { portal: 'hrworld' });
}).then(function (r) {
  check('consent: a stored value off the roster ("hrworld") is no portal — today\'s rule', r.c.portal === 'cio' && r.reads === 1, [r.c.portal, r.reads]);
  return consentOf(fb, 'qa-c-proto', { portal: '__proto__' });
}).then(function (r) {
  check('consent: "__proto__" is no portal — today\'s rule', r.c.portal === 'brandequity' && r.reads === 1, [r.c.portal, r.reads]);
  return Promise.all([consentOf(fbDown, 'qa-c-down', {}), consentOf(fbDown, 'qa-c-down', { portal: 'hr' })]);
}).then(function (r) {
  check('consent: unreadable sources and no portal: ETCIO\'s links, never an error', same(r[0].c, forms.consentFor('')), r[0].c && r[0].c.portal);
  check('consent: unreadable sources, portal set: that portal\'s links (the sources are not needed)', r[1].c.portal === 'hr' && r[1].reads === 0, [r[1].c.portal, r[1].reads]);
  /* every roster portal reads as itself */
  return Promise.all(ROSTER.map(function (slug) { return AF.loadConsent(fb, 'qa-c-hr', { portal: slug }); }));
}).then(function (all) {
  var wrong = all.map(function (c, i) { return c.portal === ROSTER[i] ? '' : ROSTER[i] + '→' + c.portal; }).filter(Boolean);
  check('consent: every portal on the roster gets its own links', !wrong.length, wrong);

  /* the definitions a page is given, and the #rv-forms block publishing writes (api.js publicFormsFor) */
  return AF.loadPublicForms(fb, 'qa-c-hr', { portal: 'hr', name: 'QA', createdAt: 'x' });
}).then(function (payload) {
  check('public forms: the consent box carries ETHRWorld\'s links and version', payload.consent && payload.consent.version === forms.consentFor('hr').version &&
    hrefsOf(payload.consent).every(function (h) { return /^https:\/\/hr\.economictimes\.indiatimes\.com\//.test(h); }), payload.consent);
  return AF.loadPublicForms(fb, 'qa-c-none', { name: 'QA', createdAt: 'x' });
}).then(function (payload) {
  check('public forms: an event with no portal yet keeps the links its live page was published with', payload.consent.version === forms.consentFor('cio').version, payload.consent.version);

  /* GET /api/public/forms, through the route */
  FB.current = fakeFb(seedEvent({}, 'qa-c-route', { portal: 'hr', published: true }, CIO_SOURCES));
  return new Promise(function (resolve) {
    var res = { headersSent: false, writeHead: function (s, h) { res.status = s; res.headers = h; res.headersSent = true; },
      end: function (b) { var j = null; try { j = JSON.parse(b); } catch (e) { /* not JSON */ } resolve({ status: res.status, json: j }); } };
    AF.handlePublicForms({ method: 'GET', url: '/api/public/forms?eventId=qa-c-route', headers: {}, socket: { remoteAddress: '127.0.0.1' } }, res);
  });
}).then(function (r) {
  var c = r.json && r.json.consent;
  check('GET /api/public/forms: 200 with ETHRWorld\'s consent links, for an event on ETHRWorld whose sources say ETCIO',
    r.status === 200 && c && c.version === forms.consentFor('hr').version && hrefsOf(c).length > 0 && hrefsOf(c).every(function (h) { return h.indexOf('https://hr.economictimes.indiatimes.com/') === 0; }), [r.status, c]);
  check('GET /api/public/forms: the sources were not read', sourceReads(FB.current) === 0, FB.current.reads);
});

/* every caller hands loadConsent the event it already holds */
var afSrc = read('functions/lib/api-forms.js'), audSrc = read('functions/lib/api-audience.js');
check('static: api-forms.js calls loadConsent with the event, at both of its call sites', (afSrc.match(/(?<!function )loadConsent\(fb, eventId, ev\)/g) || []).length === 2 &&
  /function loadConsent\(fb, eventId, ev\)/.test(afSrc) && !/loadConsent\(fb, eventId\)/.test(afSrc), (afSrc.match(/loadConsent\([^)]*\)/g) || []));
check('static: api-audience.js (registration) passes ev to loadConsent', /formsApi\(\)\.loadConsent\(fb, eventId, ev\)/.test(audSrc) && !/loadConsent\(fb, eventId\)/.test(audSrc));
check('static: forms.js keeps portalOfSources (the no-portal rule, checked by forms.test.js)', typeof forms.portalOfSources === 'function');

/* =====================================================================================================
   3. The Promotions kit (lib/promo.js buildKit): brand.portal is the stored portal, never a guess
   ===================================================================================================== */
var KIT_EVENTS = {};
function gf(f) { return 'https://fonts.googleapis.com/css2?family=' + encodeURIComponent(f).replace(/%20/g, '+') + ':wght@300;400;500;600;700;800&display=swap'; }
promo.wire({
  readObject: function () { return Promise.resolve(null); },
  sitePath: function (id, f) { return 'events/' + id + '/site/' + f; },
  loadLiveEvent: function (f, id) { return KIT_EVENTS[id] ? Promise.resolve(clone(KIT_EVENTS[id])) : Promise.reject(new Error('no such event')); },
  siteVersionOf: function () { return 0; },
  publicBaseFor: function () { return 'https://cms.example'; },
  googleFontUrl: gf
});
/* the design was modelled on an ETCIO page and its logo unit came from an ET BrandEquity page: neither may decide */
var GUESSABLE = {
  name: 'QA HR Leaders Summit', start: '2027-02-10T09:00', category: 'ip', published: true,
  designPlan: { design: { mode: 'light', themeColor: '#123456', headingFont: 'Inter', bodyFont: 'Inter', logoUnitFrom: 'https://brandequity.economictimes.indiatimes.com/y' },
    reference: { type: 'previousEdition', url: 'https://cio.economictimes.indiatimes.com/x' }, sections: [] },
  previousEditionUrl: 'https://retail.economictimes.indiatimes.com/z'
};
KIT_EVENTS['qa-k-hr'] = Object.assign({}, GUESSABLE, { portal: 'hr' });
KIT_EVENTS['qa-k-none'] = Object.assign({}, GUESSABLE);
KIT_EVENTS['qa-k-off'] = Object.assign({}, GUESSABLE, { portal: 'hrworld' });
KIT_EVENTS['qa-k-proto'] = Object.assign({}, GUESSABLE, { portal: '__proto__' });
KIT_EVENTS['qa-k-techmonk'] = Object.assign({}, GUESSABLE, { portal: 'techmonk' });
/* the site data is not read here (publicSiteData answers null for a database that says it is not there) */
var kitFb = Object.assign(fakeFb({}), { error: 'stand-in: no site data here' });
function kitOf(id) { return promo.buildKit(kitFb, id, { headers: {} }, {}); }

var kitChecks = consentChecks.then(function () { return kitOf('qa-k-hr'); }).then(function (kit) {
  var p = kit.brand && kit.brand.portal;
  check('kit: portal "hr" (the design from an ETCIO page, the logo unit from an ET BrandEquity one) gives ETHRWorld',
    p && p.slug === 'hr' && p.name === 'ETHRWorld', p);
  check('kit: with ETHRWorld\'s wordmarks', p && p.logo === '/templates/_shared/img/portals/hr.png' && p.logoLight === '/templates/_shared/img/portals/hr-light.png', p);
  var ent = pm.entityOf('qa-k-hr', kit, KIT_EVENTS['qa-k-hr'], 'https://cms.example', null);
  check('mailer: the engine\'s event carries the slug and the name (the studio shows the name)', ent.portal === 'hr' && ent.portalName === 'ETHRWorld', [ent.portal, ent.portalName]);
  return kitOf('qa-k-none');
}).then(function (kit) {
  check('kit: no portal yet gives none (null) — never ETCIO from the reference page, ET BrandEquity from the logo unit or ETRetail from previousEditionUrl',
    kit.brand && kit.brand.portal === null, kit.brand && kit.brand.portal);
  var ent = pm.entityOf('qa-k-none', kit, KIT_EVENTS['qa-k-none'], 'https://cms.example', null);
  check('mailer: an event with no portal yet: no slug, no name', ent.portal === '' && ent.portalName === '', [ent.portal, ent.portalName]);
  return Promise.all([kitOf('qa-k-off'), kitOf('qa-k-proto'), kitOf('qa-k-techmonk')]);
}).then(function (kits) {
  check('kit: a stored "hrworld" (off the roster) gives none', kits[0].brand.portal === null, kits[0].brand.portal);
  check('kit: "__proto__" gives none', kits[1].brand.portal === null, kits[1].brand.portal);
  check('kit: a portal on another host (TechMonk) is named from the roster', kits[2].brand.portal && kits[2].brand.portal.slug === 'techmonk' && kits[2].brand.portal.name === 'TechMonk', kits[2].brand.portal);
  check('kit: no model was asked and nothing was fetched but font checks', LLM_CALLS === 0 && FETCHED.every(function (u) { return /^https:\/\/fonts\.googleapis\.com\//.test(u); }), FETCHED);
});

/* every roster portal, through the kit's own helper: its name, as the roster has it */
var infoWrong = ROSTER.filter(function (slug) { var i = promo._test.portalInfo(slug); return !i || i.slug !== slug || i.name !== etEvents.PORTALS[slug]; });
check('kit: every roster portal is named as the roster has it', !infoWrong.length, infoWrong);
var promoSrc = read('functions/lib/promo.js');
check('static: promo.js no longer mentions previousEditionUrl', promoSrc.indexOf('previousEditionUrl') === -1);
check('static: brand.portal comes from ev.portal', /brand\.portal = portalInfo\(ev\.portal\)/.test(promoSrc));

/* =====================================================================================================
   4. The studio shows the portal's name (promo-studio/oneworld.js)
   ===================================================================================================== */
var owSrc = read('promo-studio/oneworld.js');
var owLines = /\n(\s*S\.portal = \(j\.event && j\.event\.portal\) \|\| '';\s*\n\s*S\.portalName = [^\n]*;)\n/.exec(owSrc);
check('static: oneworld.js sets S.portalName from the event\'s portalName', /S\.portalName = \(j\.event && j\.event\.portalName\) \|\| S\.portal;/.test(owSrc) && !!owLines);
function studioName(j) {
  var box = { S: { portal: null, portalName: null }, j: j };
  vm.runInNewContext(owLines ? owLines[1] : '', box);
  return [box.S.portal, box.S.portalName];
}
check('studio: the name when the server sends it', same(studioName({ event: { portal: 'hr', portalName: 'ETHRWorld' } }), ['hr', 'ETHRWorld']), studioName({ event: { portal: 'hr', portalName: 'ETHRWorld' } }));
check('studio: an older answer with the slug alone still shows something', same(studioName({ event: { portal: 'hr' } }), ['hr', 'hr']));
check('studio: no portal: empty', same(studioName({ event: { portal: '', portalName: '' } }), ['', '']) && same(studioName({}), ['', '']));
var esbuild = null;
try { esbuild = require('esbuild'); } catch (e) { /* the run above still checks the line */ }
if (esbuild && owLines) {
  var es5 = (function () { try { esbuild.transformSync('var S = {}, j = {};\n' + owLines[1], { loader: 'js', target: 'es5' }); return true; } catch (e) { return String(e.message).split('\n').slice(0, 3).join(' '); } })();
  check('studio: the changed lines are ES5 (esbuild)', es5 === true, es5);
}
check('studio: oneworld.js still parses', (function () { try { new vm.Script(owSrc); return true; } catch (e) { return String(e.message); } })() === true);

/* =====================================================================================================
   5. One stored portal, the same in every reader
   ===================================================================================================== */
var agree = kitChecks.then(function () {
  var sample = ['hr', 'cio', 'brandequity', 'techmonk', 'startup', 'enterpriseai'];
  return Promise.all(sample.map(function (slug) {
    return Promise.all([AF.loadConsent(fb, 'qa-c-hr', { portal: slug }), Promise.resolve(promo._test.portalInfo(slug))]).then(function (r) {
      var bar = logoOf(nav.sectionFor(navEvent, { order: ['nav', 'hero', 'footer'], portal: slug, sources: navSources }).html);
      return { slug: slug, consent: r[0].portal, kit: r[1] && r[1].slug, barAlt: bar.alt, barSrc: bar.src };
    });
  })).then(function (rows) {
    var off = rows.filter(function (x) {
      return x.consent !== x.slug || x.kit !== x.slug || x.barAlt !== etEvents.PORTALS[x.slug] || x.barSrc !== '/templates/_shared/img/portals/' + x.slug + '.png';
    });
    check('every reader — the bar, the consent links, the kit — names the stored portal', !off.length, off);
  });
});

agree.then(null, function (err) { check('the checks ran without throwing', false, String(err && err.stack || err)); }).then(function () {
  delete require.cache[FIREBASE_PATH];
  delete require.cache[SAFE_FETCH_PATH];
  delete require.cache[LLM_PATH];
  if (failed) { console.error('portal-readers: ' + failed + ' of ' + (passed + failed) + ' checks FAILED'); process.exit(1); }
  console.log('portal-readers: all ' + passed + ' checks passed');
});
