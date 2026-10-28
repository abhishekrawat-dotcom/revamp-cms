// node functions/lib/promo-mailer.test.js — Promotions → Mailers (lib/promo-mailer.js): a Oneworld event as the
// promotional platform's engine reads it, the engine's own output on it, and the small helpers around it.
const pm = require('./promo-mailer')._test;
const engine = require('./vendor/promo-engine');
var passed = 0, failed = 0;
function check(name, ok, detail) { if (ok) { passed++; return; } failed++; console.error('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); }

var BASE = 'https://revamp.example';
var kit = {
  event: { id: 'demo', name: 'Healthcare Leaders Summit 2027', start: '2027-09-10T09:00', end: '2027-09-11T18:00', venue: 'Shangri-La Eros', city: 'New Delhi',
    description: 'Hospital chiefs and clinicians meet on access and quality. 7th edition.', siteUrl: BASE + '/e/demo', registerUrl: BASE + '/e/demo#register',
    hashtag: '#HealthcareLeadersSummit27', edition: '7th Edition', tagline: 'Where hospital leaders shape care' },
  brand: { mode: 'dark', colours: { theme: '#8f6118' }, heroImageUrl: '/templates/x/hero.jpg', eventLogoUrl: 'https://img.etb2bimg.com/files/logo.png', portal: { slug: 'health' } },
  content: {
    speakers: [{ id: 's1', name: 'Asha Rao', designation: 'CEO', company: 'City Hospital', photoUrl: 'https://img.etb2bimg.com/files/a.jpg', group: 'Keynote' },
      { id: 's2', name: 'Vikram Shah', designation: 'CMO', company: 'MedCo', photoUrl: '', group: '' }],
    partners: [{ id: 'p1', name: 'Medtronic', logoUrl: 'https://img.etb2bimg.com/files/m.png', tier: 'Gold Partner', url: 'https://medtronic.com' },
      { id: 'p2', name: 'Equirus', logoUrl: '', tier: 'Supporting Partner', url: 'javascript:alert(1)' }],
    sessions: [{ id: 'x1', title: 'Keynote: universal coverage', start: '10:00', end: '10:45', speakers: ['Asha Rao', 'Nobody Known'] }],
    audience: ['Hospital CEOs', 'CMOs'], topics: ['Access', 'Quality'], stats: [{ value: '2', label: 'Days' }]
  }
};

/* ---- the event, as the engine reads it ---- */
var ev = pm.entityOf('demo', kit, { category: 'ip' }, BASE, null);
check('name, portal, hashtag, tagline carried', ev.name === 'Healthcare Leaders Summit 2027' && ev.portal === 'health' && ev.hashtag === '#HealthcareLeadersSummit27' && ev.tagline === 'Where hospital leaders shape care');
check('dates labelled the platform\'s way, days counted', ev.dateLabel === '10–11 September, 2027' && ev.totalDays === 2, [ev.dateLabel, ev.totalDays]);
check('edition read from the text', ev.edition === 7, ev.edition);
check('the site\'s colour and mode drive "Match the event website"', ev.siteAccent === '#8f6118' && ev.siteTheme === 'dark');
check('a relative picture is made absolute (a mail is read outside the app)', ev.keyVisualUrl === BASE + '/templates/x/hero.jpg');
check('speakers in the site\'s order, ids kept as text', ev.speakers.length === 2 && ev.speakers[0].id === 's1' && ev.speakers[0].weightage === 1 && ev.speakers[1].weightage === 2);
check('a speaker with no photo has none (never an empty address)', ev.speakers[1].photoUrl === undefined);
check('partners grouped by tier', ev.sponsorTiers.length === 2 && ev.sponsorTiers.every(function (t) { return t.sponsors.length === 1; }));
check('a partner link that is not http(s) is dropped', ev.sponsorTiers.filter(function (t) { return t.tier === 'Supporting Partner'; })[0].sponsors[0].url === undefined);
check('session speakers by name; an unknown name is left out', ev.sessions[0].speakers.length === 1 && ev.sessions[0].speakers[0].name === 'Asha Rao');
check('audience and topics carried; why-join empty (nothing invented)', ev.whoShouldAttend.length === 2 && ev.keyPoints.length === 2 && ev.whyJoin.length === 0);
check('an event that is not an award has no award facts', ev.award === undefined && ev.ctaLabel === 'Register Now');

/* ---- an award ---- */
var future = new Date(Date.now() + 40 * 864e5).toISOString().slice(0, 16), past = new Date(Date.now() - 5 * 864e5).toISOString().slice(0, 16);
var ceremony = new Date(Date.now() + 90 * 864e5).toISOString().slice(0, 16);
var rec = { jury: [{ group: 'Grand Jury', people: [{ name: 'J One', title: 'Chair', company: 'A', photo: '/j1.jpg' }, { name: 'J Two', title: '', company: 'B' }] }], categories: [{}, {}, {}] };
var aw = pm.entityOf('demo', Object.assign({}, kit, { content: Object.assign({}, kit.content, { speakers: [] }) }),
  { category: 'awards', start: ceremony, nomination: { open: past, close: future } }, BASE, rec);
check('an award: nominations open now, its deadline labelled, its ceremony dated', aw.award && aw.award.nominationsOpen === true && /\d{4}$/.test(aw.award.nominationsCloseLabel) && aw.award.phase === 'live' && !!aw.award.ceremonyDateLabel, aw.award);
check('an award\'s button is Nominate Now, to the site', aw.ctaLabel === 'Nominate Now' && aw.award.nominateUrl === BASE + '/e/demo');
check('an award with no speakers of its own lists last edition\'s jury', aw.speakers.length === 2 && aw.speakers[0].group === 'Grand Jury' && aw.speakers[0].photoUrl === BASE + '/j1.jpg');
check('categories counted', aw.award.categories === 3);
var closed = pm.awardOf({ category: 'awards', start: ceremony, nomination: { open: past, close: past } }, BASE, null);
check('nominations that closed are not open', closed.nominationsOpen === false && closed.phase === 'upcoming');
var tbd = pm.awardOf({ category: 'awards', start: '', nomination: { open: past, close: future, closeTbd: true } }, BASE, null);
check('a deadline still to be decided is no deadline', tbd.nominationsOpen === false && tbd.nominationsCloseDate === undefined);

/* ---- the engine on it ---- */
var avail = engine.ALL_MAILERS.filter(function (m) { return m.requires(aw).ok; }).map(function (m) { return m.id; });
check('the award\'s own mailers are offered', ['mailer.award-nominations', 'mailer.award-deadline', 'mailer.award-ceremony'].every(function (id) { return avail.indexOf(id) !== -1; }), avail);
check('winners are not offered before there are any', avail.indexOf('mailer.award-winners') === -1);
var doc = engine.buildDoc(engine.getMailer('mailer.announcement'), ev, {});
var html = engine.renderDoc(doc, ev);
check('a mail renders, with no editor hooks and no script', /<\/html>/i.test(html) && !/data-block-id/.test(html) && !/<script/i.test(html));
check('the portal masthead is Oneworld\'s (the red ET square kept)', /\/templates\/_shared\/img\/portals\/health(-light)?\.png/.test(html));
check('no "0+ speakers" for an event with none', !/0\+ speakers/.test(engine.buildDoc(engine.getMailer('mailer.announcement'), Object.assign({}, ev, { speakers: [], tagline: '' }), {}).preheader));
check('on a phone a long word may break (the hashtag)', /max-width:700px\)\{[\s\S]*overflow-wrap:anywhere/.test(html));

/* ---- helpers ---- */
var sch = pm.toLlmSchema({ type: 'object', additionalProperties: false, required: ['a'], properties: { a: { type: 'array', items: { type: 'string', enum: ['x'] } } } });
check('a JSON Schema becomes the AI layer\'s form', sch.type === 'OBJECT' && sch.additionalProperties === undefined && sch.properties.a.type === 'ARRAY' && sch.properties.a.items.type === 'STRING' && sch.properties.a.items.enum[0] === 'x' && sch.required[0] === 'a');
check('a version name no other version has', pm.uniqueName('Launch', ['Launch', 'launch (2)']) === 'Launch (3)' && pm.uniqueName('  ', []) === 'Untitled');
check('absolute(): https kept, a path made absolute, anything else dropped', pm.absolute('https://a/b', BASE) === 'https://a/b' && pm.absolute('/x.png', BASE) === BASE + '/x.png' && pm.absolute('http://a/b', BASE) === '' && pm.absolute('//evil/x', BASE) === '');

/* ---- the studio page can load its own files (the server sends only an allow-list) ---- */
var fs = require('fs'), path = require('path'), access = require('./access');
var page = fs.readFileSync(path.join(__dirname, '..', '..', 'promo-mailer-studio.html'), 'utf8');
var local = (page.match(/(?:src|href)="[^"]+"/g) || []).map(function (a) { return a.replace(/^(?:src|href)="|"$/g, ''); })
  .filter(function (u) { return !/^(https?:)?\/\/|^#|^data:/.test(u); });
var unserved = local.filter(function (u) { return !access.isServableFile(u.split('?')[0]); });
check('every file the studio page loads is one the server sends', local.length > 5 && !unserved.length, unserved);

if (failed) { console.error('promo-mailer: ' + failed + ' of ' + (passed + failed) + ' checks FAILED'); process.exit(1); }
console.log('promo-mailer: all ' + passed + ' checks passed');
