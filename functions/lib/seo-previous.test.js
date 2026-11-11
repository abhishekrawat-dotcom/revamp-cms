// node functions/lib/seo-previous.test.js — a previous edition's search settings, FAQs and testimonials read from ET's own
// event platform (seo-previous.js), on real answers saved from ET's API (fixtures/seo-previous: ETHRWorld's Nextech 2026,
// entity 3543 on portal hr, and ET BrandEquity's Brand World Summit South 2026, 4708 — trimmed to the fields used, no
// private data). ET's unbacked rating ("4.8 from 225") and its passes and prices are never read. No network.
'use strict';
var fs = require('fs'), path = require('path');
var P = require('./seo-previous');

var passed = 0, failed = 0;
function ok(cond, name, detail) { if (cond) { passed++; return; } failed++; console.error('FAIL ' + name + (detail !== undefined ? ' — ' + String(detail).slice(0, 500) : '')); }
function fixture(n) { return JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'seo-previous', n), 'utf8')); }
var HR = fixture('ms-hr-3543.json'), BE = fixture('ms-brandequity-4708.json'), TESTI = fixture('testimonials-hr-3543.json');

/* ---------- the edition's details ---------- */
var d = P.parseDetails(HR);
ok(d && d.id === '3543' && d.name === 'ET Nextech Human Capital India Summit 2026' && d.link === 'https://hr.economictimes.indiatimes.com/nextech2026', 'its id, name and page', d && JSON.stringify([d.id, d.name, d.link]));
ok(d.venue === 'The Leela Ambience Gurugram' && d.start === '2026-02-18 08:00:00', 'its venue and dates');
ok(d.seo.title === 'Nextech 2026 | HR Tech Events and Conferences India - Human Capital Summit' && /^HR Tech Events and Conferences - Discover/.test(d.seo.description), 'its title and description');
ok(JSON.stringify(d.seo.keywords) === JSON.stringify(['HR Events', 'HR Events 2026', 'HR Conferences', 'HR Conferences 2026', 'HR Summit', 'HR Summit 2026', 'HR events in India', 'HR Tech Summit']),
  'its keywords: ET\'s list written as text, its tab read as a space', JSON.stringify(d.seo.keywords));
ok(d.seo.h1 === 'HR Tech Events and Conferences - Nextech' && d.seo.schemaTitle === 'HR Tech Events and Conferences - NexTech Human Capital Summit', 'its H1 and schema title');
ok(d.seo.streetAddress === 'National Highway 8, Ambience Island, DLF Phase 3, Sector 24' && d.seo.postalCode === '122010' && d.seo.city === 'Gurugram' && d.seo.state === 'Haryana' && d.seo.country === 'India',
  'its address, without ET\'s trailing comma, and postcode', JSON.stringify(d.seo));
ok(d.seo.latitude === null && d.seo.longitude === null && d.seo.attendanceMode === 'offline', 'no coordinates (ET leaves them empty), in person');
ok(d.faqs.length === 5 && /senior leaders/.test(d.faqs[0].question) && d.faqs[0].answer.length > 50, 'its FAQs', d.faqs.length);
ok(JSON.stringify(d).indexOf('4.8') === -1 && JSON.stringify(d).indexOf('8999') === -1 && JSON.stringify(d).indexOf('short_url') === -1, 'never ET\'s rating, its prices or its short link');
var b = P.parseDetails(BE);
ok(b && b.venue === 'Taj Wellington, Chennai' && b.seo.postalCode === '600113' && b.seo.keywords.indexOf('BWS Chennai') !== -1 && b.seo.h1 === '', 'another portal\'s edition, read the same way', b && JSON.stringify(b.seo).slice(0, 300));
ok(P.parseDetails(null) === null && P.parseDetails({ data: [] }) === null && P.parseDetails({}) === null, 'no answer: nothing');
var bare = P.parseDetails({ data: { company_name: 'X', page_title: 'Page title', page_keywords: 'a$#$b$#$a', faq: [{ question: 'Q', answer: '<p>A &amp; B</p>', status: 0 }, { question: 'Q2?', answer: '<b>Yes</b>', status: 1 }] } });
ok(bare.seo.title === 'Page title' && bare.seo.keywords.join() === 'a,b' && bare.faqs.length === 1 && bare.faqs[0].answer === 'Yes', 'an edition with no seo record: its page\'s own, a FAQ ET hides left out, tags gone');

/* ---------- its testimonials ---------- */
var t = P.parseTestimonials(TESTI);
ok(t.length === 3, 'ET\'s three testimonials for Nextech', t.length);
ok(t[0].prevId === '265' && t[0].name === 'Atma Godara' && t[0].role === 'VP' && t[0].company === 'ACME Group' && t[0].title === 'Event was a truly pleasant experience' && t[0].rating === 5 && t[0].photoUrl === '',
  'each as ET has it: the person and their role apart, the title, the words, the rating', JSON.stringify(t[0]).slice(0, 300));
ok(/^Attending the ET Nextech 2024 event was a truly pleasant experience\./.test(t[0].text) && t[2].name === 'Vishal Sharma' && t[2].company === 'Godrej Industries', 'the words as they were written');
var odd = P.parseTestimonials({ data: { items: [{ id: 1, user_name: 'A', description: 'Hidden', status: 0 }, { id: 2, user_name: 'B, CEO', description: 'Fine', rating: '9', img: 'cp/x.jpg' }, { id: 3, user_name: '', description: 'No name' }] } });
ok(odd.length === 1 && odd[0].rating === null && odd[0].photoUrl === 'https://img.etb2bimg.com/files/cp/x.jpg' && odd[0].role === 'CEO', 'a hidden one or one with no name left out; a rating that is not 1 to 5 is none; ET\'s picture address made whole', JSON.stringify(odd));

/* ---------- reading both, with ET's API stubbed ---------- */
var asked = [];
function fetchJson(u, h) {
  asked.push({ u: u, h: h });
  if (/microsite\/details\?digital_month_id=3543$/.test(u)) return Promise.resolve(HR);
  if (/testimonial\/list\?entity_id=3543&activity=microsite&page=1&per_page=50$/.test(u)) return Promise.resolve(TESTI);
  return Promise.resolve(null);
}
(async function () {
  var prev = await P.readPreviousSeo({ portal: 'hr', id: '3543' }, { fetchJson: fetchJson });
  ok(prev && prev.portal === 'hr' && prev.id === '3543' && prev.testimonials.length === 3 && prev.seo.postalCode === '122010', 'the edition and its testimonials together');
  ok(asked.length === 2 && asked.every(function (a) { return a.h.portal === 'hr' && a.u.indexOf(P.API + '/v1/') === 0; }), 'asked of ET\'s API, with the portal as the header', JSON.stringify(asked));
  ok(await P.readPreviousSeo({ portal: 'hr', id: '9999' }, { fetchJson: fetchJson }) === null, 'an edition ET does not answer for: nothing');
  ok(await P.readPreviousSeo({ portal: 'hr', id: '3543' }, { fetchJson: function (u) { return /testimonial/.test(u) ? Promise.reject(new Error('down')) : Promise.resolve(HR); } }).then(function (p) { return p.testimonials.length === 0 && p.seo.title.length > 0; }), 'the testimonial list down: the edition without them');
  ok(await P.readPreviousSeo({ portal: 'hr/../x', id: '3543' }, { fetchJson: fetchJson }) === null && await P.readPreviousSeo({ portal: 'hr', id: '35a' }, { fetchJson: fetchJson }) === null, 'nothing a caller typed reaches ET\'s address or header');

  /* ---------- the same venue ---------- */
  ok(P.sameVenue('The Leela Ambience Gurugram', 'The Leela Ambience, Gurugram') && P.sameVenue('Taj Wellington, Chennai', 'Taj Wellington Mews Chennai'), 'the same place written two ways');
  ok(P.sameVenue('The Leela Ambience Gurugram', 'Leela Ambience') && !P.sameVenue('', 'Leela') && !P.sameVenue('The Leela Ambience Gurugram', 'Leela') && !P.sameVenue('JW Marriott Pune', 'JW Marriott Mumbai') && !P.sameVenue('Taj Lands End', 'ITC Grand Central'),
    'with or without the city; never one word, another city\'s or another hotel');

  console.log(failed ? 'seo-previous: ' + failed + ' of ' + (passed + failed) + ' checks FAILED' : 'seo-previous: all ' + passed + ' checks passed');
  process.exit(failed ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
