// node functions/lib/seo-schema.test.js — what a published page tells search engines from Settings › URL & SEO: the head
// (title, description, keywords, canonical, share title), the main heading, and the structured data — an Event with the
// full address, the attendance mode, performers, organiser and logo, a FAQPage, and reviews with a rating — holding only
// what the page shows, valid as schema.org (required properties, types, no empty values). Through the real publish
// transform and page pass (lib/api.js publishTransform, site-a11y.js pagePass). No network, no Firebase.
'use strict';
var api = require('./api');
var hooks = api._testHooks;
var S = require('./site-seo');
var schema = require('./seo-schema');
var fields = require('./seo-fields');

var passed = 0, failed = 0;
function ok(cond, name, detail) { if (cond) { passed++; return; } failed++; console.error('FAIL ' + name + (detail !== undefined ? ' — ' + String(detail).slice(0, 600) : '')); }
function lds(html) {
  var out = [], re = /<script type="application\/ld\+json" data-rv-seo>([\s\S]*?)<\/script>/g, m;
  while ((m = re.exec(html))) out.push(JSON.parse(m[1]));
  return out;
}
function typeOf(list, t) { return list.filter(function (x) { return x['@type'] === t; })[0] || null; }
function meta(html, attr, key) { var m = new RegExp('<meta ' + attr + '="' + key + '" content="([^"]*)"').exec(html); return m ? m[1] : null; }

/* an AI-designed page with a hero (logo unit, no h1), speakers, FAQs and a testimonial written into a section */
var PAGE = [
  '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Old</title><meta name="keywords" content="template, words"></head>',
  '<body class="microsite rv-generated" data-rv-template-id="gen-qa-seo" id="gen"><div class="col-md-12 no-padding">',
  '<section data-rv-section="hero" id="hero"><div class="rv-lu rv-lu-pic"><img class="rv-lu-img" src="https://x/logo-unit.png" alt="ET Nextech"></div></section>',
  '<section data-rv-section="speakers" id="speakers" data-rv-bound="speakers"><h2>Speakers</h2><div data-rv-list="speakers">',
  '<article data-rv-item="speakers" data-rv-id="sp1"><h3 data-rv-field="name">Asha Rao</h3><p data-rv-field="r">CHRO, Acme</p></article>',
  '<article data-rv-item="speakers" data-rv-id="sp2"><h3 data-rv-field="name">Vikram Shah</h3></article>',
  '</div><template data-rv-pristine="speakers"><article data-rv-item="speakers"><h3 data-rv-field="name">Hidden Person</h3></article></template></section>',
  '<section data-rv-section="faqs" id="faqs" data-rv-bound="faq"><h2>FAQs</h2><div data-rv-list="faq">',
  '<details data-rv-item="faq" data-rv-id="fq1"><summary data-rv-field="t">Who should attend?</summary><p data-rv-field="d">HR leaders.</p></details>',
  '</div></section>',
  '<section data-rv-section="voices" id="voices"><h2>What they said</h2><blockquote>“I thoroughly enjoyed my time at Nextech. The panel discussion I was part of focused on the intersection of employee and customer experiences.”</blockquote>',
  '<div hidden><p>Attending the ET Nextech 2024 event was a truly pleasant experience, hidden on this page.</p></div></section>',
  '<footer data-rv-section="footer" id="footer" data-rv-et-footer="hr"><p>f</p></footer>',
  '</div></body></html>'
].join('\n');

var EVENT = { name: 'ET Nextech 2027', start: '2027-02-18T09:00', end: '2027-02-19T18:00', dateMode: 'exact', venue: 'The Leela Ambience Gurugram', city: 'Gurugram',
  portal: 'hr', description: 'Two days for HR leaders.' };
var SEO = {
  title: 'ET Nextech 2027 | HR Tech Summit, Gurugram', description: 'ET Nextech 2027 brings HR leaders to Gurugram on 18–19 February 2027. Register now.',
  keywords: ['HR Tech Summit', 'HR events in India', 'Nextech 2027'], h1: 'ET Nextech 2027: HR Tech Summit', schemaTitle: 'ET Nextech 2027 — HR Tech Summit',
  schemaDescription: 'Two days of HR technology for India\'s HR leaders.', streetAddress: 'National Highway 8, Ambience Island', postalCode: '122010', latitude: 28.5022, longitude: 77.0969,
  testimonials: [
    { id: 't1', name: 'Pramod Bhasin', role: 'Founder', company: 'Genpact', title: 'I thoroughly enjoyed my time at Nextech', text: 'I thoroughly enjoyed my time at Nextech. The panel discussion I was part of focused on the intersection of employee and customer experiences.', rating: 5, from: 'previous', prevId: '264' },
    { id: 't2', name: 'Atma Godara', role: 'VP', text: 'Attending the ET Nextech 2024 event was a truly pleasant experience, hidden on this page.', rating: 3, from: 'previous' },
    { id: 't3', name: 'Not Shown', text: 'Words that are nowhere on the page at all.', rating: 1 },
    { id: 't4', name: 'Left Out', text: 'I thoroughly enjoyed my time at Nextech.', rating: 1, off: true }
  ]
};
var RECORDS = { speakers: [{ id: 'sp1', name: 'Asha Rao', role: 'CHRO', company: 'Acme', photo: 'https://x/asha.jpg' }, { id: 'sp9', name: 'Not On Page' }],
  faqs: [{ id: 'fq1', question: 'Who should attend?', answer: 'HR leaders.' }, { id: 'fq9', question: 'Is it free?', answer: 'Not said.' }] };
function live(seo, records, extra) {
  var ev = Object.assign({}, EVENT, extra || {}, { settings: { seo: { title: 'DRAFT title nobody approved' } }, publishedSeo: fields.snapshot(seo, records || RECORDS, 'a') });
  return hooks.publishTransform(PAGE, { eventId: 'qa-seo-x', event: ev, mode: 'live', templateId: 'gen-qa-seo', publicBase: 'https://cms.example' });
}

/* ---------- the head ---------- */
var page = live(SEO);
ok(/<title>ET Nextech 2027 \| HR Tech Summit, Gurugram<\/title>/.test(page) && meta(page, 'property', 'og:title') === 'ET Nextech 2027 | HR Tech Summit, Gurugram', 'the SEO title is the page\'s title and its share title');
ok(page.indexOf('DRAFT title') === -1, 'a live page never reads the draft');
ok(meta(page, 'name', 'description') === SEO.description && meta(page, 'property', 'og:description') === SEO.description, 'the meta description, also the share description');
ok(meta(page, 'name', 'keywords') === 'HR Tech Summit, HR events in India, Nextech 2027' && (page.match(/name="keywords"/g) || []).length === 1, 'the keywords, once (the template\'s own taken out)');
ok(/<link rel="canonical" href="https:\/\/cms\.example\/e\/qa-seo-x" data-rv-head>/.test(page), 'the canonical address is the site\'s own');
var own = live(Object.assign({}, SEO, { canonicalUrl: 'https://hr.example/nextech' }));
ok(/<link rel="canonical" href="https:\/\/hr\.example\/nextech"/.test(own), 'or the one the team gave');
ok(/<h1 class="rv-sr-only" data-rv-a11y>ET Nextech 2027: HR Tech Summit<\/h1>/.test(page), 'the page\'s main heading for search is the H1 field');
var noH1 = live({});
ok(/<title>ET Nextech 2027<\/title>/.test(noH1) && /<h1 class="rv-sr-only" data-rv-a11y>ET Nextech 2027<\/h1>/.test(noH1) && !/name="keywords"/.test(noH1), 'none set: the event\'s name, and no keywords line');
var withOwnH1 = hooks.publishTransform(PAGE.replace('<div class="rv-lu rv-lu-pic">', '<h1>Our own heading</h1><div class="rv-lu rv-lu-pic">'), { eventId: 'qa-seo-x', event: Object.assign({}, EVENT, { publishedSeo: fields.snapshot(SEO, RECORDS, '') }), mode: 'live', templateId: 'gen-qa-seo', publicBase: 'https://cms.example' });
ok(withOwnH1.indexOf('data-rv-a11y>ET Nextech 2027: HR Tech') === -1 && /<h1>Our own heading<\/h1>/.test(withOwnH1), 'a page with its own h1 keeps it (the site\'s words are the site\'s)');

/* ---------- the Event ---------- */
var all = lds(page), E = typeOf(all, 'Event'), Q = typeOf(all, 'FAQPage');
ok(!!E && E.name === SEO.schemaTitle && E.description === SEO.schemaDescription, 'the Event: its schema title and description', E && JSON.stringify([E.name, E.description]));
ok(E && E.startDate === '2027-02-18T09:00:00+05:30' && E.endDate === '2027-02-19T18:00:00+05:30', 'its dates, India time');
var A = E && E.location && E.location.address;
ok(E && E.eventAttendanceMode === 'https://schema.org/OfflineEventAttendanceMode' && E.location['@type'] === 'Place' && E.location.name === 'The Leela Ambience Gurugram', 'in person, at its venue');
ok(A && A['@type'] === 'PostalAddress' && A.streetAddress === 'National Highway 8, Ambience Island' && A.addressLocality === 'Gurugram' && A.addressRegion === 'Haryana' && A.postalCode === '122010' && A.addressCountry === 'IN', 'a full PostalAddress: the street and postcode typed, the state and country from the place list', JSON.stringify(A));
ok(E && E.location.geo && E.location.geo.latitude === 28.5022 && E.location.geo.longitude === 77.0969, 'geo, when both are given');
ok(E && E.organizer.name === 'ETHRWorld.com' && E.organizer.url === 'https://hr.economictimes.indiatimes.com' && E.organizer.logo === 'https://cms.example/templates/_shared/img/portals/hr.png', 'the organiser: the portal, its home address and logo', JSON.stringify(E && E.organizer));
ok(E && E.image && E.image.indexOf('https://x/logo-unit.png') !== -1, 'the event\'s logo unit is among its pictures', JSON.stringify(E && E.image));
ok(E && E.performer && E.performer.length === 1 && E.performer[0].name === 'Asha Rao' && E.performer[0].jobTitle === 'CHRO' && E.performer[0].worksFor.name === 'Acme' && E.performer[0].image === 'https://x/asha.jpg',
  'performers: the speakers picked AND shown (not the one the page does not show, not the template\'s)', JSON.stringify(E && E.performer));
ok(E && E.review && E.review.length === 1 && E.review[0].author.name === 'Pramod Bhasin' && E.review[0].reviewRating.ratingValue === 5 && E.review[0].name === 'I thoroughly enjoyed my time at Nextech',
  'reviews: only the testimonial whose words the page shows (not one hidden there, not one nowhere, not one left out)', JSON.stringify(E && E.review));
ok(E && E.aggregateRating && E.aggregateRating.ratingValue === 5 && E.aggregateRating.ratingCount === 1 && E.aggregateRating.bestRating === 5, 'the rating: from the ratings of the reviews given, alone', JSON.stringify(E && E.aggregateRating));
ok(!E || !E.offers, 'no passes or prices');
ok(Q && Q.mainEntity.length === 1 && Q.mainEntity[0].name === 'Who should attend?' && Q.mainEntity[0].acceptedAnswer.text === 'HR leaders.', 'a FAQPage of the FAQs picked AND shown', JSON.stringify(Q));
ok(S.checkJsonLd(E).length === 0 && S.checkJsonLd(Q).length === 0, 'both are valid: required properties, types, no empty values', JSON.stringify(S.checkJsonLd(E).concat(S.checkJsonLd(Q))));
ok(page.indexOf('ratingValue":"4.8') === -1 && page.indexOf('225') === -1, 'no unbacked rating of ET\'s');
ok(hooks.sitePagePass(page, { mode: 'live', event: Object.assign({}, EVENT, { publishedSeo: fields.snapshot(SEO, RECORDS, '') }), templateId: 'gen-qa-seo' }) === page, 'the pass again (as /e/ serves it) changes nothing');

/* ---------- the switches, the modes ---------- */
var basicOff = lds(live(Object.assign({}, SEO, { basicSchema: false })));
ok(!typeOf(basicOff, 'Event') && !!typeOf(basicOff, 'FAQPage'), 'basic schema off: no Event (the FAQs stay theirs)');
var advOff = lds(live(Object.assign({}, SEO, { advancedSchema: false })));
var E2 = typeOf(advOff, 'Event');
ok(E2 && !E2.performer && !E2.review && !E2.aggregateRating && !typeOf(advOff, 'FAQPage'), 'advanced schema off: no speakers, reviews, rating or FAQs');
var online = typeOf(lds(live(Object.assign({}, SEO, { attendanceMode: 'online' }))), 'Event');
ok(online && online.eventAttendanceMode === 'https://schema.org/OnlineEventAttendanceMode' && online.location['@type'] === 'VirtualLocation' && online.location.url === 'https://cms.example/e/qa-seo-x' && S.checkJsonLd(online).length === 0, 'online: at its own page', JSON.stringify(online && online.location));
var mixed = typeOf(lds(live(Object.assign({}, SEO, { attendanceMode: 'mixed' }))), 'Event');
ok(mixed && mixed.eventAttendanceMode === 'https://schema.org/MixedEventAttendanceMode' && Array.isArray(mixed.location) && mixed.location.length === 2 && S.checkJsonLd(mixed).length === 0, 'in person and online: both places');
var tba = lds(hooks.publishTransform(PAGE, { eventId: 'qa-seo-x', event: Object.assign({}, EVENT, { dateMode: 'tbd', start: null, end: null, publishedSeo: fields.snapshot(SEO, RECORDS, '') }), mode: 'live', templateId: 'gen-qa-seo', publicBase: 'https://cms.example' }));
ok(!typeOf(tba, 'Event') && !!typeOf(tba, 'FAQPage'), 'the date to be announced: no Event');
var legacyLive = lds(hooks.publishTransform(PAGE, { eventId: 'qa-seo-x', event: Object.assign({}, EVENT, { settings: { seo: SEO } }), mode: 'live', templateId: 'gen-qa-seo', publicBase: 'https://cms.example' }));
var EL = typeOf(legacyLive, 'Event');
ok(EL && EL.name === 'ET Nextech 2027' && !EL.performer && !EL.review && !EL.location.address.streetAddress && EL.location.address.addressRegion === 'Haryana' && !typeOf(legacyLive, 'FAQPage'),
  'a site published before the copy existed: none of the new settings until its next publish (the place list still fills the state)', JSON.stringify(EL));
var prev = hooks.publishTransform(PAGE, { eventId: 'qa-seo-x', event: Object.assign({}, EVENT, { settings: { seo: SEO } }), mode: 'preview', templateId: 'gen-qa-seo' });
ok(/<title>Preview \u00b7 ET Nextech 2027 \| HR Tech Summit, Gurugram<\/title>/.test(prev) && /data-rv-a11y>ET Nextech 2027: HR Tech Summit</.test(prev), 'a preview shows the draft');

/* ---------- the evidence, alone ---------- */
var kit = hooks.TOKEN_KIT || null;
if (kit) {
  var ev = schema.evidenceOf(PAGE, kit);
  ok(ev.ids.speakers.sp1 && ev.ids.speakers.sp2 && ev.ids.faq.fq1 && !schema.showsSpeaker(ev, { id: 'zz', name: 'Hidden Person' }), 'records the page renders; never what is in a <template>');
  ok(schema.showsSpeaker(ev, { id: 'other', name: 'Vikram Shah' }) && schema.showsFaq(ev, { id: 'x', question: 'who should attend' }), 'or the words it shows, case and punctuation aside');
  ok(!schema.showsTestimonial(ev, { text: 'Attending the ET Nextech 2024 event was a truly pleasant experience, hidden on this page.' }), 'hidden words are not shown');
  ok(schema.showsTestimonial(ev, { text: '“I thoroughly enjoyed my time at Nextech.  The panel discussion I was part of focused on the intersection of employee and customer experiences.”' }), 'quotation marks and spacing aside');
} else ok(false, 'TOKEN_KIT is exported for tests');

/* ---------- the validator itself ---------- */
ok(S.checkJsonLd({ '@context': 'https://schema.org', '@type': 'Event', name: 'X', startDate: '2027-02-18' }).some(function (p) { return /location/.test(p); }), 'an Event without a place is flagged');
ok(S.checkJsonLd({ '@context': 'https://schema.org', '@type': 'Event', name: '', startDate: 'soon', location: { '@type': 'Place', name: 'X' } }).length >= 2, 'an empty name and a date that is not ISO are flagged');
ok(S.checkJsonLd({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: [{ '@type': 'Question', name: 'Q' }] }).some(function (p) { return /acceptedAnswer/.test(p); }), 'a question with no answer is flagged');
ok(S.checkJsonLd({ '@context': 'https://schema.org', '@type': 'Event', name: 'X', startDate: '2027-02-18', location: { '@type': 'Place', name: 'P' }, aggregateRating: { '@type': 'AggregateRating', ratingValue: 9, ratingCount: 1 } }).some(function (p) { return /1 to 5/.test(p); }), 'a rating out of range is flagged');
ok(S.aggregateRating([5, 4, 4]).ratingValue === 4.3 && S.aggregateRating([]) === null, 'the rating: the average to one decimal, none for none');

console.log(failed ? 'seo-schema: ' + failed + ' of ' + (passed + failed) + ' checks FAILED' : 'seo-schema: all ' + passed + ' checks passed');
process.exit(failed ? 1 : 0);
