// node functions/lib/seo-fields.test.js — Settings › URL & SEO's fields: what is accepted and refused (cleanSeo, also through
// lib/api.js cleanSettings), the rules that need the event (an Indian postcode), which copy a page reads (the published
// one on a live page, the draft on a preview, the four old settings for a site published before the copy existed), what
// the next publish changes, the records that count, and the place of a city. No network, no Firebase.
'use strict';
var F = require('./seo-fields');

var passed = 0, failed = 0;
function ok(cond, name, detail) { if (cond) { passed++; return; } failed++; console.error('FAIL ' + name + (detail !== undefined ? ' — ' + String(detail).slice(0, 400) : '')); }
function refused(seo, field, re, name) {
  var r = F.cleanSeo(seo);
  ok(!!r.error && r.field === 'settings.seo.' + field && (!re || re.test(r.error)), name, JSON.stringify(r));
}

/* ---------- what is accepted ---------- */
var good = F.cleanSeo({
  title: '  ET Nextech 2027 |  HR Tech Summit  ', description: 'Two days\nfor HR leaders.', keywords: ['HR Summit', ' hr summit ', 'HR Tech 2027', ''],
  h1: 'ET Nextech 2027', canonicalUrl: ' https://hr.example/nextech ', noindex: false, basicSchema: true, advancedSchema: false,
  schemaTitle: 'ET Nextech 2027', schemaDescription: 'A summit.', attendanceMode: 'mixed', streetAddress: 'National Highway 8, ',
  postalCode: '122010', latitude: 28.5, longitude: 77.09, speakersOff: ['abc'], faqsOff: [],
  testimonials: [{ id: 't1', name: ' Atma Godara ', role: 'VP', company: 'ACME', title: 'Good', text: ' It was good. ', rating: 5, photoUrl: '', from: 'previous', prevId: '265' },
    { id: 't2', name: 'Asha', text: 'Fine', rating: null }],
  aiWritten: ['title', 'title', 'keywords'], previous: { portal: 'hr', id: '3543', name: 'Nextech 2026', link: 'https://hr.economictimes.indiatimes.com/nextech2026' }
});
ok(!good.error, 'a full section is accepted', good.error);
var v = good.value || {};
ok(v.title === 'ET Nextech 2027 | HR Tech Summit' && v.description === 'Two days for HR leaders.' && v.h1 === 'ET Nextech 2027', 'text is one line, trimmed', JSON.stringify([v.title, v.description]));
ok(JSON.stringify(v.keywords) === '["HR Summit","HR Tech 2027"]', 'keywords: the same one once (case aside), none empty', JSON.stringify(v.keywords));
ok(v.canonicalUrl === 'https://hr.example/nextech' && v.noindex === false && v.basicSchema === true && v.advancedSchema === false, 'the address and the switches');
ok(v.attendanceMode === 'mixed' && v.streetAddress === 'National Highway 8,' && v.postalCode === '122010' && v.latitude === 28.5 && v.longitude === 77.09, 'the place');
ok(v.testimonials.length === 2 && v.testimonials[0].name === 'Atma Godara' && v.testimonials[0].text === 'It was good.' && v.testimonials[0].from === 'previous' && v.testimonials[0].prevId === '265' &&
  v.testimonials[1].from === 'team' && v.testimonials[1].rating === null && !('prevId' in v.testimonials[1]), 'testimonials, each tidied, marked team or previous', JSON.stringify(v.testimonials));
ok(JSON.stringify(v.aiWritten) === '["title","keywords"]' && v.previous.id === '3543', 'bookkeeping', JSON.stringify(v.aiWritten));
ok(F.cleanSeo({}).value && !Object.keys(F.cleanSeo({}).value).length, 'nothing sent: nothing set');
ok(F.cleanSeo({ latitude: null, longitude: null, attendanceMode: '', previous: null, keywords: null }).value.keywords.length === 0, 'clearing is allowed');

/* ---------- what is refused, by name ---------- */
ok(/"settings\.seo\.colour" is not a setting/.test(F.cleanSeo({ colour: 'red' }).error), 'an unknown key is refused by name');
ok(!!F.cleanSeo('x').error && !!F.cleanSeo([]).error, 'not an object');
refused({ title: 'x'.repeat(71) }, 'title', /limit is 70/, 'title over 70');
refused({ description: 'x'.repeat(321) }, 'description', /limit is 320/, 'description over 320 (as before)');
refused({ h1: 'x'.repeat(121) }, 'h1', /120/, 'h1 over 120');
refused({ keywords: new Array(16).join('a,').split(',') }, 'keywords', /Up to 15/, 'over 15 keywords');
refused({ keywords: ['x'.repeat(61)] }, 'keywords', /60/, 'a keyword over 60');
refused({ keywords: 'a, b' }, 'keywords', /list/, 'keywords not a list');
refused({ schemaDescription: 'x'.repeat(501) }, 'schemaDescription', /500/, 'schema description over 500');
refused({ streetAddress: 'x'.repeat(201) }, 'streetAddress', /200/, 'address over 200');
refused({ postalCode: '12345678901234' }, 'postalCode', /12/, 'a postcode over 12');
refused({ postalCode: '12#45' }, 'postalCode', null, 'a postcode with a stray sign');
refused({ latitude: 91 }, 'latitude', /-90 to 90/, 'latitude out of range');
refused({ longitude: '77' }, 'longitude', /-180 to 180/, 'longitude as text');
refused({ attendanceMode: 'hybrid' }, 'attendanceMode', /in person, online or both/, 'an unknown mode');
refused({ noindex: 'yes' }, 'noindex', /must be true or false/, 'noindex as text (the old sentence)');
refused({ basicSchema: 1 }, 'basicSchema', null, 'a switch as a number');
refused({ canonicalUrl: 'javascript:alert(1)' }, 'canonicalUrl', null, 'a canonical address that is no web address');
refused({ shareImageUrl: 'data:image/png;base64,AAA' }, 'shareImageUrl', /uploaded image/, 'a share picture pasted in');
refused({ speakersOff: ['a/b'] }, 'speakersOff', null, 'a record id that is not one');
refused({ testimonials: Array.from({ length: 31 }, function (c, i) { return { id: 'a' + i, name: 'N', text: 'T' }; }) }, 'testimonials', /30/, 'over 30 testimonials');
refused({ testimonials: [{ id: 't', name: 'N', text: 'x'.repeat(1501) }] }, 'testimonials', /1500/, 'a testimonial over 1,500');
refused({ testimonials: [{ id: 't', name: 'N', text: 'T', rating: 6 }] }, 'testimonials', /1 to 5/, 'a rating of 6');
refused({ testimonials: [{ id: 't', name: 'N', text: 'T', rating: 4.5 }] }, 'testimonials', /1 to 5/, 'a half star');
refused({ testimonials: [{ id: 't', name: '', text: 'T' }] }, 'testimonials', /name/, 'a testimonial with no name');
refused({ testimonials: [{ id: 't', name: 'N', text: '  ' }] }, 'testimonials', /what they said/, 'a testimonial with no words');
refused({ testimonials: [{ id: 't', name: 'N', text: 'T', photoUrl: 'http://x/y.jpg' }] }, 'testimonials', /https/, 'a photo over http');
refused({ testimonials: [{ id: 't', name: 'N', text: 'T', written: 'ai' }] }, 'testimonials', /not a testimonial field/, 'a testimonial field that is not one');
refused({ testimonials: [{ id: 't', name: 'N', text: 'T' }, { id: 't', name: 'M', text: 'U' }] }, 'testimonials', /same id/, 'two testimonials, one id');
refused({ aiWritten: ['testimonials'] }, 'aiWritten', /ETB2B AI wrote/, 'testimonials are never ETB2B AI\'s');
refused({ previous: { portal: 'hr', id: 'abc' } }, 'previous', null, 'a previous edition with no ET id');
ok(F.AI_FIELDS.indexOf('testimonials') === -1 && F.AI_FIELDS.join() === 'title,description,keywords,h1,schemaTitle,schemaDescription', 'ETB2B AI writes these six fields and no testimonial');

/* through the event PATCH's own validation */
var api = require('./api');
var cs = api._testHooks.cleanSettings;
ok(cs({ seo: { title: 'T', keywords: ['a'] } }).value.seo.title === 'T', 'cleanSettings takes the new fields');
var bad = cs({ seo: { title: 'x'.repeat(80) } });
ok(!!bad.error && bad.field === 'settings.seo.title', 'cleanSettings refuses by field', JSON.stringify(bad));
ok(/"settings\.seo\.colour" is not a setting/.test(cs({ seo: { colour: 1 } }).error), 'cleanSettings still names an unknown key');
var merged = api._testHooks.mergeSettings({ seo: { title: 'Old', noindex: true } }, { seo: { title: 'New' } });
ok(merged.seo.title === 'New' && merged.seo.noindex === true, 'a PATCH changes only the keys it sends');

/* ---------- rules that need the event ---------- */
ok(F.checkWithEvent({ postalCode: '12201' }, { city: 'Gurugram' }) !== '' && F.checkWithEvent({ postalCode: '122010' }, { city: 'Gurugram' }) === '', 'an Indian postcode has 6 digits');
ok(F.checkWithEvent({ postalCode: '12201' }, { city: '' }) !== '', 'no city we can place: Indian rules (ET\'s events are held in India)');
ok(F.checkWithEvent({ postalCode: 'SW1A 1AA' }, { city: 'London' }) === '', 'abroad: letters and digits');
ok(F.checkWithEvent({}, { city: 'Gurugram' }) === '', 'no postcode: nothing to check');

/* ---------- which copy a page reads ---------- */
var ev = { settings: { seo: { title: 'Draft', noindex: false, description: 'Draft description', keywords: ['k'] } } };
ok(F.seoFor(ev, 'draft').title === 'Draft' && F.seoFor(ev, 'preview').title === 'Draft', 'a preview reads the draft');
var legacy = F.seoFor(ev, 'live');
ok(legacy.title === undefined && legacy.keywords === undefined && legacy.description === 'Draft description' && legacy.noindex === false, 'a site published before the copy: the four old settings only', JSON.stringify(legacy));
var pub = Object.assign({}, ev, { publishedSeo: { fields: { title: 'Live', keywords: ['live'] }, records: { speakers: [{ id: 's', name: 'Asha' }], faqs: [] } } });
ok(F.seoFor(pub, 'live').title === 'Live' && F.seoFor(pub, 'live').description === undefined, 'a live page reads the published copy, whatever the draft says');
ok(F.recordsFor(pub).speakers.length === 1 && F.recordsFor({}).faqs.length === 0, 'the records published with it');
ok(F.seoFor(null, 'live') && F.seoFor({}, 'draft'), 'no event: nothing, without a throw');

/* ---------- what the next publish changes ---------- */
var ch = F.changes({ title: 'New', keywords: ['b', 'a'], basicSchema: true, noindex: false, testimonials: [{ id: 't', name: 'Asha', text: 'x', rating: 5 }], aiWritten: ['title'] },
  { title: 'Old', keywords: ['a', 'b'] });
ok(ch.map(function (c) { return c.field; }).join() === 'title,testimonials' && ch[0].before === 'Old' && ch[0].after === 'New' && ch[1].after === 'Asha (5★)',
  'only real changes: a default is its value, keywords in another order are the same, bookkeeping is not a change', JSON.stringify(ch));
ok(F.changes({}, {}).length === 0, 'nothing: no change');
var rc = F.recordChanges({ speakers: [{ id: 'a', name: 'Asha' }], faqs: [] }, { speakers: [], faqs: [] });
ok(rc.length === 1 && rc[0].field === 'speakers' && rc[0].after === 'Asha', 'the speakers that count, against those published', JSON.stringify(rc));

/* ---------- the records that count ---------- */
var picked = F.pickRecords({ speakersOff: ['s2'], faqsOff: ['f2'] },
  [{ id: 's1', name: 'Asha Rao', desig: 'CHRO', comp: 'Acme', photoUrl: 'https://x/a.jpg', order: 2 }, { id: 's2', name: 'Off', order: 1 }, { id: 's3', name: 'Maybe', status: 'tentative' }, { id: 's4', name: 'First', order: 1, photoUrl: 'http://x/b.jpg' }],
  [{ id: 'f1', question: 'Q?', answer: 'A.' }, { id: 'f2', question: 'Off?', answer: 'A' }, { id: 'f3', question: 'No answer?', answer: '' }]);
ok(picked.speakers.map(function (s) { return s.id; }).join() === 's4,s1' && picked.speakers[1].role === 'CHRO' && picked.speakers[1].company === 'Acme' && picked.speakers[1].photo === 'https://x/a.jpg' && !picked.speakers[0].photo,
  'speakers: confirmed ones not taken out, in the site\'s order, an http photo left out', JSON.stringify(picked.speakers));
ok(picked.faqs.map(function (f) { return f.id; }).join() === 'f1', 'FAQs: with an answer, not taken out');
var snap = F.snapshot({ title: 'T', aiWritten: ['title'] }, picked, 'a@b');
ok(snap.fields.title === 'T' && !('aiWritten' in snap.fields) && snap.records.speakers.length === 2 && snap.by === 'a@b' && /^\d{4}-/.test(snap.at), 'the published copy');

/* ---------- the place of a city ---------- */
function place(c, p) { var x = F.placeOf(c, p); return x ? x.label : null; }
ok(place('Gurugram') === 'Gurugram, Haryana, India' && place('Gurgaon') === 'Gurugram, Haryana, India', 'Gurugram, also by its old name', place('Gurgaon'));
ok(place('Bangalore') === 'Bengaluru, Karnataka, India' && place('New Delhi') === 'New Delhi, Delhi, India' && place('mumbai') === 'Mumbai, Maharashtra, India', 'other names, and a place\'s own name first');
ok(place('Pun') === null && place('Goa') === null && place('') === null, 'never a guess: not a name it only starts with, not a small town abroad (Goa)');
ok(place('Dubai') === 'Dubai, United Arab Emirates' && place('Singapore') === 'Singapore', 'a big city abroad, not an Indian village of the same name');

/* ---------- the mode, the dates ---------- */
ok(F.attendanceOf({}, { venue: 'Taj' }) === 'offline' && F.attendanceOf({}, {}) === '' && F.attendanceOf({ attendanceMode: 'online' }, { venue: 'Taj' }) === 'online', 'the mode: the team\'s, else in person with a place');
ok(F.datesExact({ start: '2027-02-18T09:00' }) && !F.datesExact({ dateMode: 'tbd', start: '2027-02-18' }) && !F.datesExact({}), 'exact dates');

console.log(failed ? 'seo-fields: ' + failed + ' of ' + (passed + failed) + ' checks FAILED' : 'seo-fields: all ' + passed + ' checks passed');
process.exit(failed ? 1 : 0);
