/* node functions/lib/site-outline.test.js — what a site shows of the event console's Content tabs (lib/site-outline.js)
   and GET /api/event/site-outline (lib/api.js), written for UX-066, UX-067 and UX-071 of the UX sweep of 3 Nov 2026:
     - the sections that list each kind of record, by the page's own marks (an AI-designed page's one model item, the
       editor's data-rv-bound / data-rv-empty) and by a real template's content.map; whether such a section leaves the
       page whole while it has nothing to list, or only its list does (it holds a Register button, a form…);
     - the previous edition's own sections, counted from what prev-sections.js builds;
     - the banner's logo: the logo unit's picture, never its copy for a dark background;
     - the route: the live page while the site is live, else the site as last saved; nothing for a site never saved.
   No network: an in-memory Firestore and Storage. Exits 1 on failure. */
'use strict';
var path = require('path');

var passed = 0, failed = 0;
function check(name, ok, detail) { if (ok) { passed++; return; } failed++; console.error('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail).slice(0, 700) : '')); }
function j(v) { return JSON.stringify(v); }

delete process.env.K_SERVICE;
process.env.ALLOWED_EMAIL_DOMAIN = 'timesinternet.in';

/* ---------- an in-memory Firestore (documents by path) and Storage (objects by name) ---------- */
var DOCS = {}, OBJECTS = {}, READS = [], MD5 = {};
function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
function docRef(p) {
  return { id: p.split('/').pop(), path: p, collection: function (n) { return colRef(p + '/' + n); },
    get: function () { var d = DOCS[p]; return Promise.resolve({ id: p.split('/').pop(), exists: !!d, data: function () { return clone(d); } }); },
    set: function () { return Promise.resolve(); }, update: function () { return Promise.resolve(); } };
}
function colRef(p) {
  return { path: p, doc: function (id) { return docRef(p + '/' + id); }, add: function () { return Promise.resolve(docRef(p + '/x')); },
    where: function () { return colRef(p); }, orderBy: function () { return colRef(p); }, limit: function () { return colRef(p); }, select: function () { return colRef(p); },
    get: function () { return Promise.resolve({ docs: [], size: 0, empty: true }); } };
}
var FB = {
  db: { collection: function (n) { return colRef(n); } },
  bucket: { name: 'b', file: function (name) {
    return { name: name, getMetadata: function () { return Promise.resolve([{ md5Hash: MD5[name] || '' }]); }, download: function () {
      READS.push(name);
      if (!Object.prototype.hasOwnProperty.call(OBJECTS, name)) { var e = new Error('No such object: ' + name); e.code = 404; return Promise.reject(e); }
      return Promise.resolve([Buffer.from(OBJECTS[name], 'utf8')]);
    } };
  } },
  auth: { verifyIdToken: function (t) { return Promise.resolve({ email: t + '@timesinternet.in', uid: 'u-' + t, email_verified: true, firebase: { sign_in_provider: 'google.com' } }); } }
};
var FIREBASE = require.resolve('./firebase');
require.cache[FIREBASE] = { id: FIREBASE, filename: FIREBASE, loaded: true, children: [], paths: [], exports: { getFirebase: function () { return FB; } } };

var api = require('./api');
var KIT = api._testHooks.TOKEN_KIT;
var SO = require('./site-outline');
var prev = require('./prev-sections');

/* ---------- pages ---------- */
var PREVIOUS = {
  name: 'Brand World Summit 2025',
  speakers: [{ name: 'Asha Rao', designation: 'CMO', company: 'Acme' }, { name: 'Meera Iyer', designation: 'CEO', company: 'Beta' }, { name: 'Kavya N', designation: 'CTO', company: 'Gamma' }],
  sponsors: [{ name: 'Acme', tier: 'Gold', logo: 'https://cdn.example/acme.png' }, { name: 'Beta', tier: 'Silver', logo: '' }],
  agenda: [{ title: 'Opening', start: '2025-12-05 10:00', end: '2025-12-05 10:30', speakers: ['Asha Rao'] }, { title: 'Panel', start: '2025-12-06 11:00', end: '2025-12-06 12:00', speakers: [] }],
  glimpses: ['https://cdn.example/g1.jpg', 'https://cdn.example/g2.jpg']
};
function prevSection(kind) {
  var b = prev.build(kind, PREVIOUS, {});
  return b.html.replace('<section class="', '<section data-rv-section="' + prev.IDS[kind] + '" data-rv-key="' + prev.IDS[kind] + '" class="');
}
/* an AI-designed page, as brand-world-summit-2026's live page was on 3 Nov 2026 */
var AI_PAGE = '<!doctype html><html><head><title>BWS</title><style>.x{}</style><script>var s = \'data-rv-repeat-template="speakers"\';</script></head><body>' +
  '<header data-rv-section="nav" data-rv-key="nav"><nav><a href="#sponsors">Sponsors</a></nav></header>' +
  '<section data-rv-section="hero" data-rv-key="hero"><div class="rv-lu rv-lu-pic" data-rv-logo-unit>' +
    '<img class="rv-lu-img" src="https://storage.googleapis.com/b/events/bws/generated/1-logo-unit.svg" alt="BWS">' +
    '<img class="rv-lu-img rv-lu-dark" src="https://storage.googleapis.com/b/events/bws/generated/1-logo-unit-on-dark.png" alt=""></div>' +
    '<h1>The Biggest Congregation of Marketers</h1><a data-register-cta href="#">Register</a></section>' +
  '<section data-rv-section="sponsors" data-rv-key="sponsors" data-rv-empty="partners"><h2>The brands powering<br>the South</h2>' +
    '<div class="grid"><div data-rv-repeat-template="partners"><img data-rv-field="logo"></div></div></section>' +
  prevSection('sponsors') +
  '<section data-rv-section="agenda" data-rv-key="agenda" data-rv-empty="sessions"><h2>Three days</h2><div data-rv-repeat-template="sessions"><p data-rv-field="title">T</p></div></section>' +
  '<section data-rv-section="faqs" data-rv-key="faqs" data-rv-empty="faq"><h2>Before you land</h2><div data-rv-repeat-template="faq"><h3 data-rv-field="t">Q</h3></div></section>' +
  prevSection('speakers') + prevSection('agenda') + prevSection('glimpses') +
  /* a contact section with a Register button: only its list leaves the page when there are no contacts */
  '<section data-rv-section="contact-us" data-rv-key="contact-us"><h2>Speak. Partner.</h2><div data-rv-repeat-template="contact"><p data-rv-field="name">N</p></div>' +
    '<a class="btn" data-register-cta href="#">Register now</a></section>' +
  /* a section the owner hid in the editor: not a place */
  '<section data-rv-section="speaker-grid" data-rv-key="speaker-grid" class="is-hidden-sec"><div data-rv-repeat-template="speakers"></div></section>' +
  '<footer data-rv-section="footer" data-rv-key="footer"></footer></body></html>';

var o = SO.outline(AI_PAGE, KIT, null);
check('AI page: sponsors, agenda, FAQs and contact are places; speakers and photos are not (the hidden speaker grid is the owner\'s, a script\'s text is not markup)',
  j(o.places.partners) === j([{ key: 'sponsors', name: 'Sponsors', hides: true }]) && j(o.places.sessions) === j([{ key: 'agenda', name: 'Agenda', hides: true }]) &&
  j(o.places.faq) === j([{ key: 'faqs', name: 'FAQs', hides: true }]) && o.places.speakers.length === 0 && o.places.glimpses.length === 0, o.places);
check('AI page: a contact section that also holds a Register button only loses its list (rv-data.js emptyScopeOf)',
  j(o.places.contact) === j([{ key: 'contact-us', name: 'Contact us', hides: false }]), o.places.contact);
check('AI page: the previous edition\'s four sections, each counted from what prev-sections.js builds',
  j(o.previous.map(function (p) { return [p.kind, p.key, p.name, p.count]; })) === j([
    ['sponsors', 'previous-sponsors', 'Previous Edition Sponsors', 2], ['speakers', 'previous-speakers', 'Previous Edition Speakers', 3],
    ['agenda', 'previous-agenda', 'Previous Edition Agenda', 2], ['glimpses', 'previous-glimpses', 'Previous Edition Glimpses', 2]]), o.previous);
check('AI page: the banner\'s logo is the unit\'s picture, never its dark-background copy',
  o.logo === 'https://storage.googleapis.com/b/events/bws/generated/1-logo-unit.svg', o.logo);
check('the item classes counted are the ones prev-sections.js writes', Object.keys(SO.ITEM_CLASS).every(function (k) {
  return prev.build(k, PREVIOUS, {}).html.indexOf('class="' + SO.ITEM_CLASS[k] + '"') !== -1;
}));

/* a section with records drawn (no data-rv-empty): it hides whole when it holds nothing else; a section with records of
   two kinds only loses the list that is empty */
var DRAWN = '<section data-rv-section="speakers" data-rv-key="speakers" data-rv-bound="speakers"><h2>Speakers</h2><div data-rv-list="speakers">' +
  '<div data-rv-item="speakers" data-rv-id="a1">A</div></div><template data-rv-pristine="speakers"><div data-rv-item="speakers"></div></template></section>' +
  '<section data-rv-section="people" data-rv-key="people"><div data-rv-repeat-template="speakers"></div><div data-rv-repeat-template="partners:2"></div></section>' +
  '<section data-rv-section="when" data-rv-key="when"><p data-rv-bind="event.date"></p><ul><li data-rv-repeat-template="sessions"></li></ul><ul data-rv-empty="sessions"></ul></section>';
o = SO.outline(DRAWN, KIT, null);
check('drawn records: the section hides whole; a section of two kinds, or with one of the event\'s details, keeps the rest',
  j(o.places.speakers) === j([{ key: 'speakers', name: 'Speakers', hides: true }, { key: 'people', name: 'People', hides: false }]) &&
  j(o.places.partners) === j([{ key: 'people', name: 'People', hides: false }]) && j(o.places.sessions) === j([{ key: 'when', name: 'When', hides: false }]), o.places);
check('no logo unit: no logo', o.logo === '' && o.previous.length === 0);

/* a real template: its content.map names the sections; an entry with an emptyScope keeps the section */
var MAP = [
  { from: 'hero', section: 'banner', fill: [{ text: '.t' }] },
  { from: 'faq', section: 'faq', fill: [{ list: '.faq-item', items: 'faq.items' }] },
  { from: 'agenda', section: 'programme', emptyScope: '.rows', fill: [{ list: '.row', items: 'agenda.items' }] },
  { from: 'contact', section: 'contact-us', fill: [{ list: '.card', items: 'contact.items' }] }
];
var TPL = '<section data-rv-section="banner"><h1>Tech 500</h1></section><section data-rv-section="faq"><div class="faq-item"></div></section>' +
  '<section data-rv-section="programme"><h2>Agenda</h2><div class="rows"></div></section>';
o = SO.outline(TPL, KIT, MAP);
check('real template: the content.map\'s list entries whose section is on the page; "agenda" is sessions; emptyScope keeps the section',
  j(o.places.faq) === j([{ key: 'faq', name: 'FAQ', hides: true }]) && j(o.places.sessions) === j([{ key: 'programme', name: 'Programme', hides: false }]) &&
  o.places.contact.length === 0 && o.places.speakers.length === 0, o.places);
check('nothing to read: every kind empty, no previous edition, no logo', j(SO.outline('', KIT, null)) === j({ places: { speakers: [], sessions: [], partners: [], faq: [], glimpses: [], contact: [] }, previous: [], logo: '' }));
check('a section name: FAQ kept in capitals, words from the id', SO.nameOf('faqs') === 'FAQs' && SO.nameOf('contact-us') === 'Contact us' && SO.nameOf('key-discussion-points') === 'Key discussion points');

/* ---------- the route ---------- */
function call(url, who) {
  return new Promise(function (resolve) {
    var h = { host: 'cms.example' };
    if (who !== null) h.authorization = 'Bearer ' + (who || 'maker');
    var req = { method: 'GET', url: url, headers: h, socket: {}, rawBody: Buffer.from('') };
    req.on = function () { return req; }; req.resume = function () {};
    var res = { statusCode: 200, headers: {}, headersSent: false,
      setHeader: function (k, v) { res.headers[k.toLowerCase()] = v; }, getHeader: function (k) { return res.headers[k.toLowerCase()]; },
      writeHead: function (s, hh) { res.statusCode = s; Object.keys(hh || {}).forEach(function (k) { res.headers[k.toLowerCase()] = hh[k]; }); res.headersSent = true; return res; },
      write: function () { return true; },
      end: function (b) { var t = b == null ? '' : String(b), parsed = null; try { parsed = JSON.parse(t); } catch (e) { /* not JSON */ } resolve({ status: res.statusCode, json: parsed }); } };
    api.handleApi(req, res);
  });
}
var T0 = '2026-10-01T00:00:00.000Z';
/* its design's unit is the same crop as the banner's, stored again under another name (as brand-world-summit-2026's on 5 Nov) */
DOCS['events/bws'] = { name: 'BWS', createdAt: T0, published: true, publishedVersion: 4, site: { version: 6, templateId: 'gen-bws' },
  designPlan: { design: { logoUnitUrl: 'https://storage.googleapis.com/b/events/bws/generated/2-logo-unit.svg', logoUnitSource: 'owner' } } };
MD5['events/bws/generated/1-logo-unit.svg'] = 'abc=='; MD5['events/bws/generated/2-logo-unit.svg'] = 'abc==';
OBJECTS['events/bws/published/index.html'] = AI_PAGE;
OBJECTS['events/bws/site/page.html'] = '<section data-rv-section="faqs" data-rv-key="faqs"><div data-rv-repeat-template="faq"></div></section>';
DOCS['events/draft'] = { name: 'Draft', createdAt: T0, site: { version: 2, templateId: 'tech500' } };
OBJECTS['events/draft/site/page.html'] = '<section data-rv-section="faq"><div class="faq-item"></div></section><section data-rv-section="contact-us"></section>';
DOCS['events/fresh'] = { name: 'Fresh', createdAt: T0 };
DOCS['events/lost'] = { name: 'Lost', createdAt: T0, published: true, publishedVersion: 3, site: { version: 3, templateId: 'gen-lost' } };
OBJECTS['events/lost/site/page.html'] = AI_PAGE;
DOCS['events/gone'] = { name: 'Gone', createdAt: T0, deletedAt: T0 };

(async function () {
  var r = await call('/api/event/site-outline?eventId=bws');
  check('route: a live site is read off its live page, with the live version', r.status === 200 && r.json.of === 'live' && r.json.version === 4 &&
    r.json.places.partners.length === 1 && r.json.previous.length === 4 && /1-logo-unit\.svg$/.test(r.json.logo) && READS[READS.length - 1] === 'events/bws/published/index.html', r.json);
  check('route: the banner\'s picture and the design\'s unit are the same stored file: logoIsUnit', r.json.logoIsUnit === true, r.json.logoIsUnit);
  MD5['events/bws/generated/2-logo-unit.svg'] = 'def==';
  r = await call('/api/event/site-outline?eventId=bws');
  check('route: another file: not the design\'s unit', r.json.logoIsUnit === false, r.json.logoIsUnit);
  r = await call('/api/event/site-outline?eventId=draft');
  check('route: a draft is read as last saved, through its template\'s content.map (tech500: FAQ and Contact)', r.status === 200 && r.json.of === 'saved' && r.json.version === 2 &&
    r.json.places.faq.length === 1 && r.json.places.contact.length === 1 && r.json.places.speakers.length === 0 && r.json.logo === '' && r.json.logoIsUnit === false, r.json);
  READS = [];
  r = await call('/api/event/site-outline?eventId=fresh');
  check('route: a site never saved has nothing to read: of "none", every list empty, no storage read', r.status === 200 && r.json.of === 'none' && r.json.version === 0 &&
    r.json.places.speakers.length === 0 && r.json.previous.length === 0 && READS.length === 0, r.json);
  r = await call('/api/event/site-outline?eventId=lost');
  check('route: a live site whose published copy is missing is read as last saved', r.status === 200 && r.json.of === 'saved' && r.json.version === 3 && r.json.previous.length === 4, r.json);
  r = await call('/api/event/site-outline?eventId=gone');
  check('route: a deleted event answers 404', r.status === 404, r);
  r = await call('/api/event/site-outline?eventId=bws', null);
  check('route: signed out answers 401, nothing read', r.status === 401, r);
  r = await call('/api/event/site-outline');
  check('route: no event named answers 400', r.status === 400, r);

  if (failed) { console.error('site-outline: ' + failed + ' of ' + (passed + failed) + ' checks failed'); process.exit(1); }
  console.log('site-outline: all ' + passed + ' checks passed');
})().catch(function (err) { console.error('site-outline: crashed — ' + (err && err.stack || err)); process.exit(1); });
