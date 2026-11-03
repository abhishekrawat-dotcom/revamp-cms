/* node functions/lib/event-portal.test.js — which ET portal an existing event is on (lib/event-portal.js), for the
   owner's decision of 3 Nov 2026: a portal is filled in only where the event's own records make it certain, never
   guessed. Checks the evidence rules table by table (fixtures in the shapes the real events have: map.md §2), the
   read-only report (only live, named events; its counts, groups and order; who may fill in), and the backfill
   (only the ticked pairs, checked again as they are written; never overwriting; logged; refusals). Runs against an
   in-memory Firestore with the helpers lib/api.js hands over (portalHelpers). No network. Exits 1 on any failure. */
'use strict';
const path = require('path');
const childProcess = require('child_process');
const fs = require('fs');

var passed = 0, failed = 0;
function check(name, ok, detail) { if (ok) { passed++; return; } failed++; console.error('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); }
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }

/* ---------- loading: no environment, no side effects (run first, before anything here is loaded) ---------- */
var MOD = path.join(__dirname, 'event-portal.js');
var loaded = childProcess.spawnSync(process.execPath, ['-e', 'require(' + JSON.stringify(MOD) + ')'], { env: {}, encoding: 'utf8' });
check('the module loads with no environment at all, and says nothing', loaded.status === 0 && !loaded.stdout && !loaded.stderr, { status: loaded.status, out: loaded.stdout, err: loaded.stderr });
var SRC = fs.readFileSync(MOD, 'utf8');
var requires = (SRC.match(/require\(\s*['"][^'"]+['"]\s*\)/g) || []).map(function (r) { return r.replace(/^require\(\s*['"]|['"]\s*\)$/g, ''); });
check('it requires only lib/et-events.js and lib/et-previous.js', same(requires.sort(), ['./et-events', './et-previous']), requires);
var timersBefore = process.getActiveResourcesInfo().filter(function (r) { return r === 'Timeout'; }).length;
const ep = require('./event-portal');
check('loading it starts no timer', process.getActiveResourcesInfo().filter(function (r) { return r === 'Timeout'; }).length === timersBefore);
check('it exports the contract (K4)', ['wire', 'evidenceOf', 'nameOf', 'handleEvidence', 'handleBackfill', 'KINDS', '_test'].every(function (k) { return k in ep; }));
check('the kinds, in the order they are weighed', same(ep.KINDS, ['et-record', 'et-link', 'design-reference', 'logo-unit-page', 'site-bar', 'site-footer']), ep.KINDS);
check('nameOf: the roster name, and nothing for anything off it', ep.nameOf('hr') === 'ETHRWorld' && ep.nameOf('brandequity') === 'ET BrandEquity' &&
  ep.nameOf('hrworld') === '' && ep.nameOf('__proto__') === '' && ep.nameOf('toString') === '' && ep.nameOf(7) === '' && ep.nameOf(null) === '');
const T = ep._test;
const etEvents = require('./et-events');

/* ---------- fixtures, in the shapes map.md §2 found on the real events ---------- */
function ET(sub, p) { return 'https://' + sub + '.economictimes.indiatimes.com/' + (p || 'x'); }
/* a previous-edition source whose ET record was read (previous.portal is pick.portal || portalOf(url)) */
function prevSrc(portal, url, award) {
  var u = url || ET(portal, 'last-year');
  return { type: 'previousEdition', url: u, fetchedAt: '2026-10-01T00:00:00Z', previous: { portal: portal, id: '4276', name: 'Last year', url: u, speakers: [{ name: 'A' }] }, award: award || null };
}
/* an ET link whose records ET's API did not return (previous: null) */
function linkSrc(type, url) { return { type: type, url: url, fetchedAt: '2026-10-01T00:00:00Z', previous: null, award: null }; }
function compSrc(url) { return { type: 'competitor', url: url, previous: null, award: null }; }
function ref(type, url) { return { reference: { type: type, url: url } }; }
/* the generated top bar, as lib/et-nav.js writes it */
function navSec(slug, light) {
  var on = '/templates/_shared/img/portals/' + slug + '.png', dark = light === false ? '/templates/_shared/img/et-business-verticals-on-dark.svg' : '/templates/_shared/img/portals/' + (light || slug) + '-light.png';
  return { id: 'nav', kind: 'custom', html: '<nav class="rv-et-nav"><a href="https://' + slug + '.economictimes.indiatimes.com/"><img data-rv-et-logo data-rv-on-light="' + on + '" data-rv-on-dark="' + dark + '" src="' + on + '" alt="x" width="190" height="20"></a></nav>' };
}
var BV_NAV = { id: 'nav', html: '<nav><a href="#hero"><img data-rv-et-logo data-rv-on-light="/templates/_shared/img/et-business-verticals-on-light.svg" data-rv-on-dark="/templates/_shared/img/et-business-verticals-on-dark.svg" src="/templates/_shared/img/et-business-verticals-on-light.svg"></a></nav>' };
function footerSec(slug) { return { id: 'footer', html: '<footer id="footer" class="rv-etf" data-rv-et-footer="' + slug + '"><div>ET</div></footer>' }; }

/* ---------- 1. evidenceOf, table by table ---------- */
var E = ep.evidenceOf;
var v;

/* digiplus-awards-2027: previous {portal:'brandequity'} and award {portal:'brandequity'} */
v = E({ name: 'DigiPlus Awards 2027' }, [prevSrc('brandequity', ET('brandequity', 'digiplus-awards-2026'), { portal: 'brandequity', awardId: '382', micrositeId: '4276' })]);
check('digiplus-awards: brandequity, from its ET record', v.certain === true && v.portal === 'brandequity' && v.from === 'et-record', v);
check('digiplus-awards: the record and the link are both listed, the record first, each once', same(v.evidence.map(function (e) { return e.kind; }), ['et-record', 'et-link']), v.evidence);
check('digiplus-awards: said in words', v.evidence[0].where === 'its previous edition\'s ET record' && v.evidence[1].where === 'the ET link of its previous edition', v.evidence);
check('digiplus-awards: no conflict, blocker or hint', !v.conflict.length && !v.blockers.length && !v.hints.length && !v.disagrees.length, v);

/* a cloned QA event: designPlan.reference survives the clone, sources do not */
v = E({ name: 'QA UX Editor AI BWS', designPlan: ref('previousEdition', ET('brandequity', 'brand-world-summit')) }, []);
check('a clone with only its design reference: brandequity, from design-reference, hint design-only',
  v.certain && v.portal === 'brandequity' && v.from === 'design-reference' && same(v.hints, ['design-only']) && v.evidence[0].where === 'the ET page its design was modelled on', v);

/* trendies-awards-2027: a competitor link only */
v = E({ name: 'Trendies Awards 2027' }, [compSrc(ET('brandequity', 'trendies'))]);
check('trendies-awards: a competitor\'s page is never evidence', !v.certain && v.portal === '' && !v.evidence.length && !v.conflict.length && !v.blockers.length, v);
v = E({ name: 'Brand Summit', designPlan: ref('competitor', ET('brandequity', 'x')) }, []);
check('a competitor-type design reference is never evidence', !v.certain && !v.evidence.length, v);
v = E({ name: 'Brand Summit', designPlan: ref('none', ET('brandequity', 'x')) }, []);
check('a design reference of type none is never evidence', !v.certain && !v.evidence.length, v);

/* cio ("Cio", published) and etcio-awards-2027: only a typed ETHRWorld link, their names say ETCIO */
var HR_LINK = linkSrc('currentEdition', 'https://hr.economictimes.indiatimes.com/nextech2026');
v = E({ name: 'Cio', published: true }, [HR_LINK]);
check('cio: not certain, blocked by its name, link-only', !v.certain && v.portal === '' && same(v.blockers, ['name-mentions:cio']) && same(v.hints, ['link-only']), v);
check('cio: the link is said as this edition\'s own page', v.evidence.length === 1 && v.evidence[0].kind === 'et-link' && v.evidence[0].portal === 'hr' && v.evidence[0].where === 'the ET link of this edition\'s own ET page', v.evidence);
v = E({ name: 'ETCIO Awards 2027' }, [HR_LINK]);
check('etcio-awards-2027: the same', !v.certain && same(v.blockers, ['name-mentions:cio']) && same(v.hints, ['link-only']), v);

/* names */
v = E({ name: 'ETCIO Annual Conclave 2027' }, [prevSrc('cio')]);
check('a name naming its own portal is no blocker', v.certain && v.portal === 'cio' && !v.blockers.length, v);
v = E({ name: 'Retail Leadership Summit' }, [prevSrc('retail')]);
check('"Retail Leadership Summit" on ETRetail evidence: certain', v.certain && v.portal === 'retail', v);
v = E({ name: 'Retail Leadership Summit' }, [prevSrc('hr')]);
check('"Retail Leadership Summit" on ETHRWorld evidence: blocked', !v.certain && v.portal === '' && same(v.blockers, ['name-mentions:retail']), v);
[['et cio', 'cio'], ['ET-CIO Summit', 'cio'], ['The ETBrandEquity Show', 'brandequity'], ['ET Brand Equity Awards', 'brandequity'], ['BrandEquity Awards', 'brandequity'],
 ['ETHR Awards', 'hr'], ['ET HR Awards', 'hr'], ['HR Excellence', 'hr'], ['ETHR World Forum', 'hr'], ['Supply Chain Summit', 'supplychain'], ['ETCFO', 'cfo'], ['TechMonk Day', 'techmonk'],
 ['Tech Monk Day', 'techmonk'], ['ET Enterprise AI Summit', 'enterpriseai'], ['Leadership Summit 2027', null], ['Agentic AI Summit', null], ['ET Immersion', null]].forEach(function (c) {
  var m = T.mentionsIn(c[0]);
  check('the name "' + c[0] + '" names ' + (c[1] || 'no portal'), c[1] ? m.indexOf(c[1]) !== -1 : !m.length, m);
});
check('a name never matches inside a word', !T.mentionsIn('Autotech Summit').length && !T.mentionsIn('CHRO Conclave').length && !T.mentionsIn('Martech Summit 2027').length && !T.mentionsIn('').length && !T.mentionsIn(null).length);
/* where two portals' words overlap, the longer name wins */
check('"ETHRWorld Southeast Asia Summit" names ETHRWorld Southeast Asia, not ETHRWorld', same(T.mentionsIn('ETHRWorld Southeast Asia Summit'), ['hrsea']), T.mentionsIn('ETHRWorld Southeast Asia Summit'));
v = E({ name: 'ETHRWorld Southeast Asia Summit' }, [prevSrc('hrsea', ET('hrsea', 'summit'))]);
check('so its own evidence is certain', v.certain && v.portal === 'hrsea', v);
v = E({ name: 'ETCIO Southeast Asia Awards' }, [prevSrc('cio')]);
check('"ETCIO Southeast Asia Awards" on ETCIO evidence names another portal: blocked', !v.certain && same(v.blockers, ['name-mentions:ciosea']), v);
v = E({ name: 'ET EnergyWorld MEA Forum' }, [prevSrc('energymea', ET('energymea', 'forum'))]);
check('"ET EnergyWorld MEA Forum" on its own evidence: certain', v.certain && v.portal === 'energymea', v);
/* the regional portals as ET shortens them (its own handles: lib/et-footer.js ETCIOSEA, ETCIOME, ETHRWorldSEA,
   ETHRWorldME, etenergymea) name the regional portal, so a home-portal link never fills one in as the home portal */
check('the regional portals are found from the roster: each one\'s parent and region',
  same(T.regionalOf().map(function (r) { return r.slug + '<' + r.parent + '+' + r.region; }).sort(), ['ciome<cio+me', 'ciosea<cio+sea', 'energymea<energy+mea', 'hrme<hr+me', 'hrsea<hr+sea']), T.regionalOf());
[['ETCIO SEA Annual Conclave', 'ciosea'], ['ETCIOSEA Awards', 'ciosea'], ['CIO South East Asia Forum', 'ciosea'], ['ETCIO ME Awards', 'ciome'], ['ETCIOME Summit', 'ciome'],
 ['ETCIO The Middle East Awards', 'ciome'], ['ETHRWorldSEA Awards', 'hrsea'], ['ETHRWorld SEA Awards', 'hrsea'], ['HR SEA Summit', 'hrsea'], ['ETHRWorld ME Summit', 'hrme'],
 ['ETHRWorldME Summit', 'hrme'], ['ETHR Middle East Forum', 'hrme'], ['ETEnergyMEA Forum', 'energymea'], ['ETEnergyWorld Middle East Forum', 'energymea']].forEach(function (c) {
  var m = T.mentionsIn(c[0]);
  check('the short form "' + c[0] + '" names ' + c[1] + ' alone', same(m, [c[1]]), m);
});
check('a word that only starts with a region\'s code is no region', same(T.mentionsIn('CIO Meet 2027'), ['cio']) && same(T.mentionsIn('HR Seasons'), ['hr']), [T.mentionsIn('CIO Meet 2027'), T.mentionsIn('HR Seasons')]);
v = E({ name: 'ETCIO SEA Annual Conclave' }, [prevSrc('cio')]);
check('"ETCIO SEA Annual Conclave" on ETCIO evidence: blocked name-mentions:ciosea', !v.certain && v.portal === '' && same(v.blockers, ['name-mentions:ciosea']), v);
v = E({ name: 'ETCIO SEA Annual Conclave 2027' }, [linkSrc('previousEdition', ET('cio', 'annual-conclave-2026'))]);
check('the same name on only an ETCIO link: blocked, not certain', !v.certain && same(v.blockers, ['name-mentions:ciosea']), v);
v = E({ name: 'ETHRWorldSEA Awards 2027' }, [linkSrc('previousEdition', ET('hr', 'awards-2026'))]);
check('"ETHRWorldSEA Awards" on an ETHRWorld link: blocked name-mentions:hrsea', !v.certain && v.portal === '' && same(v.blockers, ['name-mentions:hrsea']), v);
v = E({ name: 'ETHRWorld ME Summit' }, [prevSrc('hr')]);
check('"ETHRWorld ME Summit" on ETHRWorld evidence: blocked name-mentions:hrme', !v.certain && v.portal === '' && same(v.blockers, ['name-mentions:hrme']), v);
v = E({ name: 'ETEnergyMEA Forum' }, [prevSrc('energy')]);
check('"ETEnergyMEA Forum" on ETEnergyworld evidence: blocked name-mentions:energymea', !v.certain && same(v.blockers, ['name-mentions:energymea']), v);
v = E({ name: 'ETCIO SEA Annual Conclave' }, [prevSrc('ciosea', ET('ciosea', 'conclave'))]);
check('a short regional name on its own portal\'s evidence: certain', v.certain && v.portal === 'ciosea' && !v.blockers.length, v);
v = E({ name: 'ETHRWorldME Summit' }, [prevSrc('hrme', ET('hrme', 'summit'))]);
check('a joined regional handle on its own portal\'s evidence: certain', v.certain && v.portal === 'hrme' && !v.blockers.length, v);
v = E({ name: 'CIO and HR Roundtable' }, [prevSrc('hr')]);
check('a name naming its own portal and another: blocked by the other', !v.certain && same(v.blockers, ['name-mentions:cio']), v);
/* no form of a name is shared by two portals, so a match never names the wrong one */
var owner = {}, shared = [];
T.formsOf().forEach(function (f) { var k = f.words.join(' '); if (owner[k] && owner[k] !== f.slug) shared.push(k + ': ' + owner[k] + ', ' + f.slug); owner[k] = f.slug; });
check('no name form belongs to two portals', !shared.length, shared);
/* the names of the real events map.md §3 found certain (as their ids read) stay certain on their own evidence */
[['Brand World Summit 2026', 'brandequity'], ['India Communication Summit 2027', 'brandequity'], ['MarTech Summit 2027', 'brandequity'], ['Trendies Award 2027', 'brandequity'],
 ['DigiPlus 2027', 'brandequity'], ['Autotech Summit 2027', 'auto'], ['ETAuto Tech Summit 2027', 'auto'], ['Agentic AI Summit 2027', 'enterpriseai'],
 ['ETCIO Annual Conclave 2027', 'cio'], ['NutriWell Conclave', 'health'], ['GCC Annual Conclave', 'gcc'], ['ET Immersion: Global Experiential Learning', 'b2b'],
 ['NextTech Summit', 'hr']].forEach(function (c) {
  var r = E({ name: c[0] }, [prevSrc(c[1])]);
  check('"' + c[0] + '" stays certain on ' + c[1], r.certain && r.portal === c[1], r.blockers);
});

/* conflict */
v = E({ name: 'Conclave', designPlan: ref('previousEdition', ET('cio', 'conclave')) }, [prevSrc('hr')]);
check('a record and a design reference that disagree: a conflict, no portal', !v.certain && v.portal === '' && same(v.conflict, ['cio', 'hr']) && !v.blockers.length, v);
v = E({ name: 'Conclave' }, [prevSrc('hr'), linkSrc('previousEdition', ET('cio', 'other'))]);
check('two sources that disagree: a conflict', !v.certain && same(v.conflict, ['cio', 'hr']), v);
v = E({ name: 'Conclave' }, [prevSrc('hr', ET('cio', 'odd'))]);
check('a record and its own address that disagree: a conflict', !v.certain && same(v.conflict, ['cio', 'hr']), v);

/* ignored */
v = E({ name: 'Summit', designPlan: { design: { logoUnitFrom: 'https://storage.googleapis.com/revamp/events/x/logo.png' } } }, []);
check('a storage.googleapis.com logo unit page is not evidence', !v.evidence.length, v);
v = E({ name: 'Summit', designPlan: { design: { logoUnitFrom: ET('hr', 'nextech2026') } } }, []);
check('an ET logo unit page is: hr, from logo-unit-page', v.certain && v.portal === 'hr' && v.from === 'logo-unit-page' && v.evidence[0].where === 'the ET page its logo unit came from', v);
v = E({ name: 'Summit', designPlan: ref('previousEdition', 'https://www.techgig.com/hackathon') }, [linkSrc('previousEdition', 'https://www.economictimes.indiatimes.com/x'), linkSrc('currentEdition', 'https://techgig.com/x'),
  linkSrc('previousEdition', 'https://m.economictimes.indiatimes.com/x'), linkSrc('previousEdition', 'https://evil.com/?u=https://hr.economictimes.indiatimes.com/x')]);
check('techgig.com, www. and m.economictimes and other hosts are not evidence', !v.evidence.length, v.evidence);
v = E({ name: 'Summit', generatedSections: [footerSec('et'), BV_NAV] }, []);
check('the "et" footer and the ET Business Verticals logo are not evidence', !v.evidence.length, v.evidence);
v = E({ name: 'Summit' }, [{ type: 'previousEdition', url: '', previous: { portal: '__proto__' }, award: { portal: 'toString' } }, { type: 'previousEdition', previous: { portal: 'hrworld' } }]);
check('a previous.portal of __proto__, toString or hrworld is not evidence', !v.evidence.length, v.evidence);
v = E({ name: 'Summit' }, [{ type: '__proto__', previous: { portal: 'hr' } }, { previous: { portal: 'hr' } }, null, 7, 'x']);
check('a source of no own-edition type, or no object at all, is not read', !v.evidence.length, v.evidence);
v = E({ name: 'Summit' }, [{ type: 'previousEdition', previous: { portal: 'HR' } }]);
check('a slug off the roster by case is not evidence', !v.evidence.length);
v = E(null, null);
check('no event and no sources: nothing, without throwing', !v.certain && !v.evidence.length && Array.isArray(v.conflict));
v = E({ name: 'Summit', designPlan: ref('previousEdition', ET('cio')) , generatedSections: [footerSec('et'), BV_NAV, null, { id: 'nav', html: 7 }] }, [{ type: 'previousEdition', previous: { portal: '__proto__' } }]);
check('ignored values beside real evidence change nothing', v.certain && v.portal === 'cio' && v.evidence.length === 1, v);

/* the site's generated bar and footer only corroborate */
var SITE = [navSec('retail'), footerSec('retail')];
v = E({ name: 'Summit', generatedSections: SITE }, []);
check('site-only: not certain, blocked site-only', !v.certain && v.portal === '' && same(v.blockers, ['site-only']), v);
check('site-only: both are listed, in words', same(v.evidence.map(function (e) { return e.kind + ':' + e.portal; }), ['site-bar:retail', 'site-footer:retail']) &&
  v.evidence[0].where === 'the ET bar its site was generated with' && v.evidence[1].where === 'the ET footer its site was generated with', v.evidence);
v = E({ name: 'Summit', generatedSections: SITE }, [prevSrc('retail')]);
check('site plus a matching record: retail, from et-record', v.certain && v.portal === 'retail' && v.from === 'et-record' && !v.blockers.length, v);
check('the evidence keeps the table\'s order whatever order it was found in', same(v.evidence.map(function (e) { return e.kind; }), ['et-record', 'et-link', 'site-bar', 'site-footer']), v.evidence);
v = E({ name: 'Summit', generatedSections: SITE }, [prevSrc('hr')]);
check('site plus a record of another portal: a conflict', !v.certain && same(v.conflict, ['hr', 'retail']), v);
v = E({ name: 'Summit', generatedSections: [{ id: 'nav', html: navSec('hr').html + navSec('cio').html }] }, [prevSrc('hr')]);
check('a bar naming two portals: a conflict', !v.certain && same(v.conflict, ['cio', 'hr']), v);
v = E({ name: 'Summit', generatedSections: [navSec('hr', false)] }, [prevSrc('hr')]);
check('a portal with no light-ink wordmark (the BV logo on dark) is still read from its dark-ink one', v.certain && v.evidence.some(function (e) { return e.kind === 'site-bar' && e.portal === 'hr'; }), v.evidence);
v = E({ name: 'Summit', generatedSections: [{ id: 'footer', html: '<footer data-rv-et-footer=\'cio\'></footer>' }] }, [prevSrc('cio')]);
check('a footer mark in single quotes is read too', v.certain && v.evidence.some(function (e) { return e.kind === 'site-footer'; }));
v = E({ name: 'Summit', generatedSections: [{ id: 'hero', html: navSec('cio').html + footerSec('cio').html }] }, [prevSrc('hr')]);
check('only the nav and footer sections are read', v.certain && v.portal === 'hr', v);

/* an event that already has a portal is never changed */
v = E({ name: 'Auto Summit', portal: 'auto' }, [prevSrc('hr')]);
check('portal auto with hr evidence: disagrees hr, nothing offered', !v.certain && v.portal === '' && same(v.disagrees, ['hr']), v);
v = E({ name: 'Summit', portal: 'hr' }, [prevSrc('hr')]);
check('portal hr with hr evidence: nothing offered, nothing disagrees', !v.certain && v.portal === '' && !v.disagrees.length, v);
v = E({ name: 'Summit', portal: 'hrworld' }, [prevSrc('hr')]);
check('a stored value off the roster is no portal: the evidence is offered', v.certain && v.portal === 'hr' && !v.disagrees.length, v);
v = E({ name: 'Summit', portal: '__proto__' }, [prevSrc('hr')]);
check('a stored __proto__ is no portal either', v.certain && v.portal === 'hr', v);

/* current-edition sources and their words */
v = E({ name: 'Summit' }, [{ type: 'currentEdition', url: ET('gcc', 'conclave-2027'), previous: { portal: 'gcc', url: ET('gcc', 'conclave-2027') } }]);
check('a current edition\'s record is said as this edition\'s own', v.certain && v.portal === 'gcc' && v.evidence[0].where === 'this edition\'s own ET record' && v.evidence[1].where === 'the ET link of this edition\'s own ET page', v.evidence);
v = E({ name: 'Summit' }, [linkSrc('previousEdition', ET('auto', 'a')), linkSrc('previousEdition', ET('auto', 'b'))]);
check('the same kind, portal and words from two sources is listed once', v.certain && v.evidence.length === 1 && same(v.hints, ['link-only']), v.evidence);
v = E({ name: 'Summit', designPlan: ref('previousEdition', ET('auto')) }, [linkSrc('previousEdition', ET('auto', 'a'))]);
check('a link and a design reference together: no hint', v.certain && !v.hints.length, v);

/* ---------- the helpers lib/api.js hands over (portalHelpers), over an in-memory Firestore ---------- */
function segsOf(f) { return typeof f === 'string' ? f.split('.') : f.segments; }
/* a document as Firestore hands it back for a select() / fieldMask: only the asked-for fields */
function project(d, fields) {
  var out = {};
  fields.forEach(function (f) {
    var segs = segsOf(f), x = d;
    for (var i = 0; i < segs.length; i++) { if (x == null || typeof x !== 'object' || !(segs[i] in x)) return; x = x[segs[i]]; }
    var o = out;
    for (var j = 0; j < segs.length - 1; j++) { o[segs[j]] = o[segs[j]] || {}; o = o[segs[j]]; }
    o[segs[segs.length - 1]] = clone(x);
  });
  return out;
}
function fakeFb() {
  var f = { docs: {}, queries: [], getAllCalls: [], txCount: 0, txReads: [], updates: [], failGetAll: null, failTxFor: '', beforeTx: null };
  var docs = f.docs, seq = 0;
  function snapOf(p, mask) {
    var d = docs[p];
    return { id: p.split('/').pop(), exists: !!d, ref: docRef(p), data: function () { return d ? (mask ? project(d, mask) : clone(d)) : undefined; } };
  }
  function run(q) {
    f.queries.push({ path: q.path, fields: q.fields, lim: q.lim });
    var list = Object.keys(docs).filter(function (k) { return k.indexOf(q.path + '/') === 0 && k.slice(q.path.length + 1).indexOf('/') === -1; }).sort().map(function (k) { return snapOf(k, q.fields); });
    if (q.lim) list = list.slice(0, q.lim);
    return { docs: list, size: list.length, empty: !list.length };
  }
  function query(p, fields, lim) {
    var q = { path: p, fields: fields, lim: lim };
    q.select = function () { return query(p, [].slice.call(arguments), lim); };
    q.limit = function (n) { return query(p, fields, n); };
    q.get = function () { return Promise.resolve(run(q)); };
    return q;
  }
  function colRef(p) {
    var c = query(p, null, null);
    c.doc = function (id) { return docRef(p + '/' + id); };
    c.add = function (data) { var r = docRef(p + '/auto' + String(++seq).padStart(8, '0')); docs[r.path] = clone(data); return Promise.resolve(r); };
    return c;
  }
  function docRef(p) {
    return { id: p.split('/').pop(), path: p,
      collection: function (n) { return colRef(p + '/' + n); },
      get: function () { return Promise.resolve(snapOf(p)); },
      update: function (data) { if (!docs[p]) return Promise.reject(new Error('NOT_FOUND')); Object.assign(docs[p], clone(data)); return Promise.resolve(); } };
  }
  f.db = {
    collection: function (n) { return colRef(n); },
    getAll: function () {
      var args = [].slice.call(arguments), opts = null;
      if (args.length && !args[args.length - 1].path) opts = args.pop();
      f.getAllCalls.push({ paths: args.map(function (r) { return r.path; }), fieldMask: opts && opts.fieldMask });
      if (f.failGetAll) return Promise.reject(f.failGetAll);
      return Promise.resolve(args.map(function (r) { return snapOf(r.path, opts && opts.fieldMask); }));
    },
    /* reads go to the store as it is; writes are held and applied when the callback has resolved (a commit) */
    runTransaction: function (fn) {
      f.txCount++;
      var pending = [];
      var tx = {
        get: function (x) {
          if (typeof x.select === 'function') { f.txReads.push('query ' + x.path + ' ' + JSON.stringify(x.fields)); return Promise.resolve(run(x)); }
          f.txReads.push('doc ' + x.path);
          if (f.failTxFor && x.path === 'events/' + f.failTxFor) return Promise.reject(new Error('DEADLINE_EXCEEDED'));
          if (f.beforeTx) { var b = f.beforeTx; f.beforeTx = null; b(x.path); }
          return Promise.resolve(snapOf(x.path));
        },
        update: function (r, data) { pending.push({ path: r.path, data: clone(data) }); return tx; }
      };
      return Promise.resolve().then(function () { return fn(tx); }).then(function (out) {
        pending.forEach(function (w) { f.updates.push(w); Object.assign(docs[w.path], w.data); });
        return out;
      });
    }
  };
  return f;
}
var FB = fakeFb();
var fbPath = require.resolve('./firebase');
require.cache[fbPath] = { id: fbPath, filename: fbPath, loaded: true, exports: { getFirebase: function () { return FB; } } };
const http = require('./http');
const activity = require('./activity');

/* lib/api.js's own helpers, as they are there (eventStateOf, approvalsConfig, httpError, sendFailure) */
function httpError(status, message, extra) { var e = new Error(message); e.status = status; e.body = Object.assign({ error: message }, extra || {}); return e; }
var failures = [];
function sendFailure(res, what, err, friendly) {
  if (err && err.status && err.body) return http.sendJson(res, err.status, err.body);
  failures.push(what);
  http.sendJson(res, 500, { error: friendly || 'Something went wrong on the server. Please try again.' });
}
function eventStateOf(snap) {
  if (!snap || !snap.exists) return 'missing';
  var d = snap.data() || {};
  if (d.deletedAt) return 'deleted';
  return d.createdAt ? 'live' : 'shell';
}
function approvalsConfig(fb) {
  return fb.db.collection('config').doc('approvals').get().then(function (snap) {
    var d = snap.exists ? (snap.data() || {}) : {};
    return {
      approvers: (Array.isArray(d.approvers) ? d.approvers : []).map(function (e) { return String(e || '').trim().toLowerCase(); }).filter(function (e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }),
      allowSelf: d.allowSelf === true,
      required: d.required !== false
    };
  });
}
var limitsSeen = [];
function whoOf(req) {
  var m = /^Bearer (.+)$/.exec(String(req.headers.authorization || ''));
  return m ? { email: m[1] + '@timesinternet.in', uid: 'u-' + m[1] } : null;
}
var HELPERS = Object.freeze({
  withAdmin: function (req, res, cb) { var d = whoOf(req); if (!d) return http.sendJson(res, 401, { error: 'Sign in required.' }); cb(FB, d); },
  withAdminBody: function (req, res, maxBytes, cb) {
    limitsSeen.push(maxBytes);
    HELPERS.withAdmin(req, res, function (fb, d) {
      var raw = req.rawBody || '{}';
      if (raw.length > maxBytes) return http.sendJson(res, 413, { error: 'That request is too large.' });
      var body;
      try { body = JSON.parse(raw); } catch (e) { return http.sendJson(res, 400, { error: 'Invalid JSON body' }); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) return http.sendJson(res, 400, { error: 'Invalid JSON body' });
      cb(fb, d, body);
    });
  },
  eventDocRef: function (fb, id) { return fb.db.collection('events').doc(id); },
  eventStateOf: eventStateOf, approvalsConfig: approvalsConfig, actorOf: activity.actorOf, logActivity: activity.logActivity,
  sendJson: http.sendJson, sendFailure: sendFailure, httpError: httpError,
  BODY_LIMITS: Object.freeze({ small: 256 * 1024, tiny: 16 * 1024, event: 512 * 1024 }), isEventId: http.isEventId
});

function call(handler, method, url, body, who) {
  return new Promise(function (resolve) {
    var headers = { host: 'localhost' };
    if (who !== null) headers.authorization = 'Bearer ' + (who || 'owner');
    var req = { method: method, url: url, headers: headers, rawBody: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) };
    var res = { statusCode: 200, headersSent: false,
      writeHead: function (s) { res.statusCode = s; res.headersSent = true; return res; },
      setHeader: function () {}, end: function (b) { var j = null; try { j = JSON.parse(String(b || '')); } catch (e) { /* not json */ } resolve({ status: res.statusCode, body: j }); } };
    handler(req, res);
  });
}
function activityOf(id) {
  var pre = 'events/' + id + '/activity/';
  return Object.keys(FB.docs).filter(function (k) { return k.indexOf(pre) === 0; }).map(function (k) { return FB.docs[k]; });
}
function seed(fb, id, ev, sources) {
  fb.docs['events/' + id] = Object.assign({ createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-10-20T10:00:00Z', detailsUpdatedAt: '2026-10-20T10:00:00Z', status: 'draft' }, ev);
  (sources || []).forEach(function (s, i) { fb.docs['events/' + id + '/sources/s' + i] = clone(s); });
}
function quietly(fn) {
  var err = console.error, said = [];
  console.error = function () { said.push([].join.call(arguments, ' ')); };
  return fn().then(function (v) { console.error = err; return { value: v, said: said }; }, function (e) { console.error = err; throw e; });
}

async function main() {
  /* before lib/api.js hands its helpers over, a route answers like a missing module */
  var unwired = await call(ep.handleEvidence, 'GET', '/api/events/portal-evidence');
  check('unwired: 503 module-unavailable, nothing read', unwired.status === 503 && unwired.body.code === 'module-unavailable' && !FB.queries.length);
  unwired = await call(ep.handleBackfill, 'POST', '/api/events/portal-backfill', { items: [] });
  check('unwired backfill: 503 too', unwired.status === 503);
  ep.wire(HELPERS);

  /* ---------- 2. the report ---------- */
  seed(FB, 'nexttech-summit', { name: 'NextTech Summit', published: true, generatedAt: '2026-10-01T00:00:00Z', generatedSections: [navSec('hr'), footerSec('hr')] }, [prevSrc('hr'), compSrc(ET('cio', 'rival'))]);
  seed(FB, 'brand-world-summit-2026', { name: 'Brand World Summit 2026', designPlan: Object.assign(ref('previousEdition', ET('brandequity', 'bws-2025')), { design: { logoUnitFrom: 'https://storage.googleapis.com/b/l.png' } }) });
  seed(FB, 'cio', { name: 'Cio', published: true }, [HR_LINK]);
  seed(FB, 'mixed-up', { name: 'Mixed Up Conclave', designPlan: ref('currentEdition', ET('cio', 'mixed')) }, [prevSrc('hr')]);
  seed(FB, 'tech500', { name: 'Tech500', templateId: 'tech500' }, [compSrc(ET('brandequity', 'x'))]);
  seed(FB, 'autotech', { name: 'Autotech Summit', portal: 'auto', portalFrom: 'set' }, [prevSrc('hr')]);
  seed(FB, 'gone', { name: 'Gone', deletedAt: '2026-10-21T00:00:00Z' }, [prevSrc('hr')]);
  FB.docs['events/shell-only'] = { name: 'Shell', designPlan: ref('previousEdition', ET('hr')) };
  seed(FB, 'being-discarded', { name: 'Discarded', discardingAt: '2026-10-22T00:00:00Z' }, [prevSrc('hr')]);
  seed(FB, 'unnamed', { name: '  ' }, [prevSrc('hr')]);
  FB.docs['config/approvals'] = { approvers: ['Owner@timesinternet.in'] };

  var out = await call(ep.handleEvidence, 'GET', '/api/events/portal-evidence', undefined, null);
  check('signed out: 401, nothing read', out.status === 401 && !FB.queries.length && !FB.getAllCalls.length);
  out = await call(ep.handleEvidence, 'GET', '/api/events/portal-evidence', undefined, 'asha');
  var r = out.body;
  check('any admin may read the report', out.status === 200 && r && Array.isArray(r.items), out);
  check('only live, named events: no deleted, shell, discarded or unnamed one',
    same(r.items.map(function (i) { return i.eventId; }).sort(), ['autotech', 'brand-world-summit-2026', 'cio', 'mixed-up', 'nexttech-summit', 'tech500']), r.items.map(function (i) { return i.eventId; }));
  check('the counts', same(r.counts, { live: 6, withPortal: 1, certain: 2, blocked: 1, conflict: 1, none: 1 }), r.counts);
  check('the order: certain (by name), blocked, conflict, none, then those with a portal',
    same(r.items.map(function (i) { return i.eventId; }), ['brand-world-summit-2026', 'nexttech-summit', 'cio', 'mixed-up', 'tech500', 'autotech']), r.items.map(function (i) { return i.eventId; }));
  var byId = {};
  r.items.forEach(function (i) { byId[i.eventId] = i; });
  var nt = byId['nexttech-summit'];
  check('a certain item: its portal to offer, named, with where it was found', nt.certain === 'hr' && nt.certainName === 'ETHRWorld' && nt.from === 'et-record' && nt.portal === '' && nt.portalName === '' &&
    nt.published === true && nt.hasGeneratedSite === true && nt.name === 'NextTech Summit' && same(nt.evidence.map(function (e) { return e.kind; }), ['et-record', 'et-link', 'site-bar', 'site-footer']), nt);
  check('every item carries the whole contract', r.items.every(function (i) {
    return ['eventId', 'name', 'published', 'hasGeneratedSite', 'portal', 'portalFrom', 'certain', 'certainName', 'from', 'evidence', 'conflict', 'disagrees', 'blockers', 'hints'].every(function (k) { return k in i; });
  }));
  var bws = byId['brand-world-summit-2026'];
  check('a clone with only its design reference: offered, with the design-only hint', bws.certain === 'brandequity' && bws.from === 'design-reference' && same(bws.hints, ['design-only']) && bws.hasGeneratedSite === false, bws);
  check('cio is blocked by its name, not offered', byId.cio.certain === '' && same(byId.cio.blockers, ['name-mentions:cio']) && same(byId.cio.hints, ['link-only']), byId.cio);
  check('a conflict lists its portals', byId['mixed-up'].certain === '' && same(byId['mixed-up'].conflict, ['cio', 'hr']), byId['mixed-up']);
  check('no evidence: nothing', byId.tech500.certain === '' && !byId.tech500.evidence.length, byId.tech500);
  var at = byId.autotech;
  check('an event with a portal: its own, never offered another, the rest as disagrees', at.portal === 'auto' && at.portalName === 'ETAuto' && at.portalFrom === 'set' && at.certain === '' && same(at.disagrees, ['hr']), at);
  check('canFill: false for an admin who is not a named approver, and the approvers are named', r.canFill === false && same(r.approvers, ['owner@timesinternet.in']), { canFill: r.canFill, approvers: r.approvers });
  check('generatedAt is a time', typeof r.generatedAt === 'string' && !isNaN(Date.parse(r.generatedAt)));
  /* how it read */
  var list = FB.queries.filter(function (q) { return q.path === 'events'; });
  check('one list read of the events, select-only and bounded', list.length === 1 && list[0].lim === 1000 && same(list[0].fields, T.LIST_FIELDS) && list[0].fields.indexOf('generatedSections') === -1, list);
  check('each listed event is read with only the fields the evidence needs', FB.getAllCalls.length === 1 && same(FB.getAllCalls[0].fieldMask, ['designPlan.reference', 'designPlan.design.logoUnitFrom', 'generatedSections']) &&
    FB.getAllCalls[0].paths.length === 6 && FB.getAllCalls[0].paths.every(function (p) { return !/gone|shell|discarded|unnamed/.test(p); }), FB.getAllCalls);
  var srcReads = FB.queries.filter(function (q) { return /\/sources$/.test(q.path); });
  check('and its sources with only theirs', srcReads.length === 6 && srcReads.every(function (q) { return same(q.fields, ['type', 'url', 'previous.portal', 'previous.url', 'award.portal']); }), srcReads);
  check('the report writes nothing', !FB.updates.length && !FB.txCount && !Object.keys(FB.docs).some(function (k) { return /\/activity\//.test(k); }));

  out = await call(ep.handleEvidence, 'GET', '/api/events/portal-evidence', undefined, 'owner');
  check('canFill: true for a named approver (case aside)', out.status === 200 && out.body.canFill === true);
  FB.docs['config/approvals'] = { approvers: [] };
  out = await call(ep.handleEvidence, 'GET', '/api/events/portal-evidence', undefined, 'asha');
  check('canFill: true for any admin when no approvers are named', out.body.canFill === true && same(out.body.approvers, []));
  delete FB.docs['config/approvals'];
  out = await call(ep.handleEvidence, 'GET', '/api/events/portal-evidence', undefined, 'asha');
  check('canFill: true when there is no approvals config at all', out.body.canFill === true);

  /* ten events at a time */
  var BIG = fakeFb();
  FB = BIG;
  for (var n = 0; n < 23; n++) seed(BIG, 'ev-' + String(n).padStart(2, '0'), { name: 'Event ' + n }, n % 2 ? [prevSrc('cfo')] : []);
  out = await call(ep.handleEvidence, 'GET', '/api/events/portal-evidence', undefined, 'asha');
  check('23 events are read in three batches of at most ten', out.status === 200 && BIG.getAllCalls.length === 3 && same(BIG.getAllCalls.map(function (c) { return c.paths.length; }), [10, 10, 3]), BIG.getAllCalls.map(function (c) { return c.paths.length; }));
  check('and every one is in the report', out.body.items.length === 23 && out.body.counts.certain === 11 && out.body.counts.none === 12, out.body.counts);
  BIG.failGetAll = new Error('UNAVAILABLE: firestore.googleapis.com');
  var fl = await quietly(function () { return call(ep.handleEvidence, 'GET', '/api/events/portal-evidence', undefined, 'asha'); });
  check('a failed read: 500 with a plain sentence, never Firestore\'s text', fl.value.status === 500 && fl.value.body.error === 'The portal report could not be made. Please try again.' && failures.indexOf('portal evidence') !== -1, fl.value);

  /* ---------- 3. the backfill ---------- */
  var B = fakeFb();
  FB = B;
  seed(B, 'qa-portal-prev', { name: 'QA Prev Summit' }, [prevSrc('hr')]);
  seed(B, 'qa-portal-link', { name: 'QA Link Summit' }, [linkSrc('currentEdition', ET('cio', 'link-summit'))]);
  seed(B, 'qa-portal-ref', { name: 'QA Ref Summit', designPlan: ref('previousEdition', ET('brandequity', 'bws')) });
  seed(B, 'qa-portal-site', { name: 'QA Site Summit', generatedAt: '2026-10-01T00:00:00Z', generatedSections: [navSec('retail'), footerSec('retail')] });
  seed(B, 'qa-portal-name', { name: 'QA ETCIO Awards' }, [linkSrc('currentEdition', ET('hr', 'nextech2026'))]);
  seed(B, 'qa-portal-conflict', { name: 'QA Conflict Summit', designPlan: ref('previousEdition', ET('cio')) }, [prevSrc('hr')]);
  seed(B, 'qa-portal-comp', { name: 'QA Comp Summit' }, [compSrc(ET('brandequity'))]);
  seed(B, 'qa-portal-none', { name: 'QA None Summit' });
  seed(B, 'qa-portal-has', { name: 'QA Has Summit', portal: 'auto', portalFrom: 'set' }, [prevSrc('hr')]);
  seed(B, 'qa-portal-del', { name: 'QA Del Summit', deletedAt: '2026-10-21T00:00:00Z' }, [prevSrc('hr')]);
  seed(B, 'qa-portal-disc', { name: 'QA Disc Summit', discardingAt: '2026-10-21T00:00:00Z' }, [prevSrc('hr')]);
  B.docs['events/qa-portal-shell'] = { name: 'QA Shell', designPlan: ref('previousEdition', ET('hr')) };
  B.docs['config/approvals'] = { approvers: ['owner@timesinternet.in'] };
  function post(items, who) { return call(ep.handleBackfill, 'POST', '/api/events/portal-backfill', { items: items }, who); }
  function pair(id, portal) { return { eventId: 'qa-portal-' + id, portal: portal }; }
  var before = clone(B.docs);

  /* refusals before anything is read */
  limitsSeen = [];
  var bad = [
    ['no items', { items: [] }, 'no-items'], ['items missing', {}, 'no-items'], ['items not a list', { items: { eventId: 'x' } }, 'no-items'],
    ['201 pairs', { items: Array.apply(null, Array(201)).map(function (_, i) { return { eventId: 'e' + i, portal: 'hr' }; }) }, 'too-many'],
    ['an id given twice', { items: [pair('prev', 'hr'), pair('prev', 'hr')] }, 'duplicate-event'],
    ['a portal off the roster', { items: [pair('prev', 'hrworld')] }, 'unknown-portal'], ['__proto__', { items: [pair('prev', '__proto__')] }, 'unknown-portal'],
    ['toString', { items: [pair('prev', 'toString')] }, 'unknown-portal'], ['no portal', { items: [{ eventId: 'qa-portal-prev' }] }, 'unknown-portal'],
    ['a bad event id', { items: [{ eventId: 'A/B', portal: 'hr' }] }, 'invalid-event-id'], ['an item that is not an object', { items: ['qa-portal-prev'] }, 'invalid-event-id']
  ];
  for (var b = 0; b < bad.length; b++) {
    var res = await call(ep.handleBackfill, 'POST', '/api/events/portal-backfill', bad[b][1], 'owner');
    check('400 for ' + bad[b][0], res.status === 400 && res.body.code === bad[b][2] && typeof res.body.error === 'string', res);
  }
  check('the unknown portal is named in the answer, cut short', (await post([pair('prev', 'x'.repeat(90))], 'owner')).body.error === 'Unknown portal "' + 'x'.repeat(40) + '".');
  check('a refused body reads and writes nothing', !B.txCount && !B.queries.length && same(B.docs, before));
  check('the body is read with the small limit', limitsSeen.every(function (l) { return l === 256 * 1024; }) && limitsSeen.length >= bad.length, limitsSeen);
  res = await post([pair('prev', 'hr')], null);
  check('signed out: 401', res.status === 401 && !B.txCount);
  res = await post([pair('prev', 'hr')], 'asha');
  check('approvers named and the caller not one: 403 not-an-approver, in words', res.status === 403 && res.body.code === 'not-an-approver' &&
    res.body.error === 'Only an approver (owner@timesinternet.in) can fill in portals.' && !B.txCount && same(B.docs, before), res);

  /* the portal ticked is not what the records say now */
  res = await post([pair('prev', 'cio')], 'owner');
  check('a pair whose portal is not the evidence\'s now: skipped changed-since-review, nothing written', res.status === 200 &&
    same(res.body.results, [{ eventId: 'qa-portal-prev', status: 'skipped', reason: 'changed-since-review' }]) && !B.updates.length && !activityOf('qa-portal-prev').length, res.body);

  /* the whole set, as QA sends it (11b.7): each the portal its row expects, or hr where none */
  var ids = ['prev', 'link', 'ref', 'site', 'name', 'conflict', 'comp', 'none', 'has', 'del', 'disc', 'shell', 'missing'];
  var ticks = { prev: 'hr', link: 'cio', ref: 'brandequity', site: 'retail', name: 'hr' };
  B.txReads = [];
  var txBefore = B.txCount;
  res = await post(ids.map(function (id) { return pair(id, ticks[id] || 'hr'); }), 'owner');
  var got = {};
  (res.body.results || []).forEach(function (x) { got[x.eventId.replace('qa-portal-', '')] = x; });
  check('200, one result per pair, in the order sent', res.status === 200 && same(res.body.results.map(function (x) { return x.eventId; }), ids.map(function (id) { return 'qa-portal-' + id; })), res.body);
  check('set: prev, link and ref, each to the portal ticked', same(got.prev, { eventId: 'qa-portal-prev', status: 'set', portal: 'hr' }) && same(got.link, { eventId: 'qa-portal-link', status: 'set', portal: 'cio' }) &&
    same(got.ref, { eventId: 'qa-portal-ref', status: 'set', portal: 'brandequity' }), [got.prev, got.link, got.ref]);
  var reasons = {};
  ids.forEach(function (id) { if (got[id] && got[id].status === 'skipped') reasons[id] = got[id].reason; });
  check('skipped, each for its reason', same(reasons, { site: 'blocked', name: 'blocked', conflict: 'conflict', comp: 'not-certain', none: 'not-certain', has: 'has-portal', del: 'not-live', disc: 'not-live', shell: 'not-found', missing: 'not-found' }), reasons);
  check('has-portal says which portal it already has', got.has.portal === 'auto');
  check('each pair is its own transaction, with the event and its sources read inside it', B.txCount - txBefore === ids.length &&
    B.txReads.filter(function (x) { return /^query events\/qa-portal-prev\/sources /.test(x); }).length === 1 &&
    B.txReads.some(function (x) { return x === 'query events/qa-portal-prev/sources ' + JSON.stringify(T.SOURCE_FIELDS); }), B.txReads);
  var setDocs = { prev: 'hr', link: 'cio', ref: 'brandequity' };
  Object.keys(setDocs).forEach(function (id) {
    var d = B.docs['events/qa-portal-' + id];
    check(id + ': stored as backfill', d.portal === setDocs[id] && d.portalFrom === 'backfill', d);
    check(id + ': updatedAt and detailsUpdatedAt left as they were', d.updatedAt === '2026-10-20T10:00:00Z' && d.detailsUpdatedAt === '2026-10-20T10:00:00Z', d);
  });
  check('only the portal and portalFrom are written, three times in all', B.updates.length === 3 && B.updates.every(function (u) { return same(Object.keys(u.data).sort(), ['portal', 'portalFrom']); }), B.updates);
  var a = activityOf('qa-portal-prev');
  check('one portal-set line each, by the person who ran it, in the event area, with the evidence in words', a.length === 1 && a[0].action === 'portal-set' && a[0].area === 'event' && a[0].by === 'owner@timesinternet.in' &&
    a[0].detail === 'No portal → ETHRWorld (filled in from its previous edition\'s ET record)' && same(a[0].fields, [{ field: 'portal', before: 'No portal', after: 'ETHRWorld' }]), a);
  a = activityOf('qa-portal-link');
  check('the link one says so', a.length === 1 && a[0].detail === 'No portal → ETCIO (filled in from the ET link of this edition\'s own ET page)', a);
  a = activityOf('qa-portal-ref');
  check('the design one says so', a.length === 1 && a[0].detail === 'No portal → ET BrandEquity (filled in from the ET page its design was modelled on)', a);
  check('a skipped event gets no line and no write', ['site', 'name', 'conflict', 'comp', 'none', 'has', 'del'].every(function (id) {
    return !activityOf('qa-portal-' + id).length && same(B.docs['events/qa-portal-' + id], before['events/qa-portal-' + id]);
  }));
  check('a missing event is not created', !B.docs['events/qa-portal-missing']);

  /* again: nothing twice */
  var updatesBefore = B.updates.length;
  res = await post(ids.map(function (id) { return pair(id, ticks[id] || 'hr'); }), 'owner');
  check('a second run sets nothing', res.status === 200 && res.body.results.every(function (x) { return x.status === 'skipped'; }) && B.updates.length === updatesBefore, res.body);
  check('the ones set before are now has-portal', res.body.results.filter(function (x) { return x.reason === 'has-portal'; }).length === 4);
  check('and logged nothing more', activityOf('qa-portal-prev').length === 1);

  /* never overwritten, even when a portal is set between the report and the write */
  seed(B, 'qa-portal-race', { name: 'QA Race Summit' }, [prevSrc('hr')]);
  B.beforeTx = function (p) { if (p === 'events/qa-portal-race') B.docs[p].portal = 'cio'; };
  res = await post([pair('race', 'hr')], 'owner');
  check('a portal set meanwhile is kept: skipped has-portal', same(res.body.results, [{ eventId: 'qa-portal-race', status: 'skipped', portal: 'cio', reason: 'has-portal' }]) && B.docs['events/qa-portal-race'].portal === 'cio', res.body);
  /* a source added since the review is read in the write's own transaction */
  seed(B, 'qa-portal-late', { name: 'QA Late Summit' }, [prevSrc('hr')]);
  B.docs['events/qa-portal-late/sources/added'] = linkSrc('previousEdition', ET('cio', 'other'));
  res = await post([pair('late', 'hr')], 'owner');
  check('a source added since the review that disagrees: skipped conflict', same(res.body.results, [{ eventId: 'qa-portal-late', status: 'skipped', reason: 'conflict' }]) && !B.docs['events/qa-portal-late'].portal, res.body);
  /* a regional portal's short name on its home portal's link (the QA run that wrote cio to "QA ETCIO SEA Conclave") */
  seed(B, 'qa-portal-sea', { name: 'QA ETCIO SEA Conclave' }, [linkSrc('previousEdition', ET('cio', 'conclave-2026'))]);
  seed(B, 'qa-portal-hrsea', { name: 'QA ETHRWorldSEA Awards 2027' }, [prevSrc('hr')]);
  var seaUpdates = B.updates.length;
  res = await post([pair('sea', 'cio'), pair('hrsea', 'hr')], 'owner');
  check('a regional short name on the home portal\'s evidence: skipped blocked, nothing written or logged', same(res.body.results, [{ eventId: 'qa-portal-sea', status: 'skipped', reason: 'blocked' },
    { eventId: 'qa-portal-hrsea', status: 'skipped', reason: 'blocked' }]) && B.updates.length === seaUpdates && !B.docs['events/qa-portal-sea'].portal && !B.docs['events/qa-portal-hrsea'].portal &&
    !activityOf('qa-portal-sea').length && !activityOf('qa-portal-hrsea').length, res.body);

  /* who may */
  B.docs['config/approvals'] = { approvers: [] };
  seed(B, 'qa-portal-open', { name: 'QA Open Summit' }, [prevSrc('gcc')]);
  res = await post([pair('open', 'gcc')], 'asha');
  check('no approvers named: any admin may fill in', res.status === 200 && res.body.results[0].status === 'set' && activityOf('qa-portal-open')[0].by === 'asha@timesinternet.in', res.body);

  /* a failure part-way: what was set stays set, and the page is told how far it got */
  seed(B, 'qa-portal-ok1', { name: 'QA One' }, [prevSrc('cfo')]);
  seed(B, 'qa-portal-boom', { name: 'QA Boom' }, [prevSrc('cfo')]);
  seed(B, 'qa-portal-ok2', { name: 'QA Two' }, [prevSrc('cfo')]);
  B.failTxFor = 'qa-portal-boom';
  var stop = await quietly(function () { return post([pair('ok1', 'cfo'), pair('boom', 'cfo'), pair('ok2', 'cfo')], 'owner'); });
  B.failTxFor = '';
  check('a failed transaction stops the run: 500 backfill-stopped with the results so far', stop.value.status === 500 && stop.value.body.code === 'backfill-stopped' &&
    same(stop.value.body.results, [{ eventId: 'qa-portal-ok1', status: 'set', portal: 'cfo' }]) && /stopped after 1 of 3/.test(stop.value.body.error), stop.value.body);
  check('the one before it is set and logged; the rest untouched', B.docs['events/qa-portal-ok1'].portal === 'cfo' && activityOf('qa-portal-ok1').length === 1 && !B.docs['events/qa-portal-ok2'].portal && !B.docs['events/qa-portal-boom'].portal);
  check('the cause is logged for us, not shown', stop.said.some(function (s) { return /DEADLINE_EXCEEDED/.test(s); }) && !/DEADLINE/.test(stop.value.body.error));

  /* 200 pairs is the most, and it is allowed */
  var many = [];
  for (var k = 0; k < 200; k++) many.push({ eventId: 'qa-portal-bulk-' + k, portal: 'hr' });
  res = await post(many, 'owner');
  check('200 pairs are accepted (each missing here: not-found)', res.status === 200 && res.body.results.length === 200 && res.body.results.every(function (x) { return x.reason === 'not-found'; }));
}

main().then(function () {
  console.log('event-portal: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
}, function (err) {
  console.error('event-portal: the test itself failed — ' + (err && err.stack || err));
  process.exit(1);
});
