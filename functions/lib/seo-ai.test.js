// node functions/lib/seo-ai.test.js — ETB2B AI's SEO text (seo-ai.js), with a stubbed model's answers: what it is told (the
// event's real details only; the previous edition as a reference, never a fact), what it may answer (small strict
// schemas), and what is let through — a field that says a number, a year, a month, a price or a big city the event's
// details do not is left out, with the reason; every field is cut to its limit at a word. And the section's checklist
// (api-seo.js readiness). No network, no model.
'use strict';
var A = require('./seo-ai');

var passed = 0, failed = 0;
function ok(cond, name, detail) { if (cond) { passed++; return; } failed++; console.error('FAIL ' + name + (detail !== undefined ? ' — ' + String(detail).slice(0, 500) : '')); }

var EVENT = { name: 'ET Nextech 2027', start: '2027-02-18T09:00', end: '2027-02-19T18:00', dateMode: 'exact', venue: 'The Leela Ambience', city: 'Gurgaon', portal: 'hr', category: 'ip',
  description: 'Two days for HR leaders on the future of work.' };
var facts = A.buildFacts({ event: EVENT, portalName: 'ETHRWorld', site: { headings: ['Speakers', 'Agenda'], text: 'Where HR meets technology. 40 speakers.' } });
ok(/^Event name: ET Nextech 2027$/m.test(facts.text) && /^Dates: 18–19 February 2027$/m.test(facts.text) && /^Place: Gurugram, Haryana, India$/m.test(facts.text) && /IP event/.test(facts.text), 'the facts: name, dates, venue, place, portal, kind', facts.text);
ok(/The site's headings: Speakers · Agenda/.test(facts.text) && /40 speakers/.test(facts.text), 'and the site\'s own words');
var tba = A.buildFacts({ event: { name: 'X Awards', dateMode: 'tbd', dateLabel: 'Early 2027' } });
ok(/^Dates: to be announced \(Early 2027\)$/m.test(tba.text), 'a date to be announced says so', tba.text);

var PREV = { name: 'ET Nextech 2026', seo: { title: 'Nextech 2026 | HR Tech Events', description: 'Join 3000 HR leaders in 2026.', keywords: ['HR Summit 2026', 'HR events in India'], schemaTitle: 'NexTech 2026' } };
var prompt = A.buildPrompt({ facts: facts, fields: ['title', 'keywords'], previous: PREV });
ok(/NEVER INVENT A FACT/.test(prompt) && /no "2000\+"/.test(prompt) && /Never name a person/.test(prompt), 'the rule against inventing facts');
ok(/REFERENCE/.test(prompt) && /Never copy it/.test(prompt) && /PREVIOUS edition's/.test(prompt) && /HR Summit 2026; HR events in India/.test(prompt), 'the previous edition as a reference, its years not this edition\'s');
ok(/- title: /.test(prompt) && /- keywords: /.test(prompt) && !/- h1: /.test(prompt) && /exactly these keys: title, keywords/.test(prompt), 'only the fields asked for');
var faqPrompt = A.buildPrompt({ facts: facts, faqs: true, existingFaqs: ['Who should attend?'] });
ok(/WRITE 5 TO 6 FAQs/.test(faqPrompt) && /will be announced on this site/.test(faqPrompt) && /Who should attend\?/.test(faqPrompt), 'FAQs: from the facts alone, unknowns said to be announced');
var sch = A.schemaFor(['title', 'keywords', 'testimonials']);
ok(JSON.stringify(Object.keys(sch.properties)) === '["title","keywords"]' && sch.properties.keywords.type === 'ARRAY' && sch.required.join() === 'title,keywords', 'the schema: the fields asked for, never a testimonial');

/* ---------- what is let through ---------- */
ok(A.unbacked('ET Nextech 2027 in Gurugram, 18–19 February 2027', facts).length === 0, 'what the facts say passes');
ok(A.unbacked('With 40 speakers at The Leela Ambience', facts).length === 0, 'a number the site says passes');
ok(A.unbacked('Join 2000+ HR leaders', facts).indexOf('2000+') !== -1 && A.unbacked('Join 2,000 HR leaders', facts).indexOf('2000') !== -1, 'a made-up number does not (with or without a comma)', JSON.stringify(A.unbacked('Join 2,000 HR leaders', facts)));
ok(A.unbacked('HR Summit 2026', facts).indexOf('2026') !== -1, 'last year\'s year does not');
ok(A.unbacked('Passes from ₹4,999', facts).indexOf('a price') !== -1 && A.unbacked('Register for Rs 500', facts).indexOf('a price') !== -1, 'a price does not');
ok(A.unbacked('This March in Gurugram', facts).indexOf('March') !== -1 && A.unbacked('In Feb 2027', facts).length === 0, 'a month the dates do not have does not; their own does');
ok(A.unbacked('HR leaders meet in Mumbai', facts).indexOf('Mumbai') !== -1 && A.unbacked('Leaders, Summit, Agenda', facts).length === 0, 'a big city that is not the event\'s does not; ordinary words are not places');
var applied = A.apply({ title: '"ET Nextech 2027 | HR Tech Summit for India\'s HR leaders, in Gurugram on 18–19 February 2027"', description: 'Join 2000+ HR leaders.', keywords: ['HR Tech Summit', 'hr tech summit', 'HR Summit 2026', 'Nextech 2027', 'HR events Gurugram'], h1: '' },
  ['title', 'description', 'keywords', 'h1'], facts);
ok(applied.values.title && applied.values.title.length <= 65 && !/["“”]/.test(applied.values.title) && !/\s\S{0,2}$/.test(applied.values.title.slice(-3)), 'a long title is cut at a word, its quotes taken off', applied.values.title);
ok(!('description' in applied.values) && applied.dropped.some(function (d) { return d.field === 'description' && /2000\+/.test(d.why) && /left out/.test(d.why); }), 'a field that says what the facts do not is left out, with why');
ok(JSON.stringify(applied.values.keywords) === '["HR Tech Summit","Nextech 2027","HR events Gurugram"]' && applied.dropped.some(function (d) { return d.field === 'keywords' && /2026/.test(d.why); }), 'keywords: once each, one with a stray year left out, the rest kept', JSON.stringify(applied));
ok(applied.dropped.some(function (d) { return d.field === 'h1' && /nothing usable/.test(d.why); }), 'an empty answer is said too');
ok(A.apply({ keywords: ['a', 'bb'] }, ['keywords'], facts).dropped[0].field === 'keywords', 'too few usable keywords: left out');
ok(A.clean('description', 'x '.repeat(200)).length <= 160 && A.clean('schemaDescription', 'Short') === '', 'every field to its limit; too short is nothing');
/* the lengths the console counts against (edit-event-seo.js IDEAL): a field the AI wrote is never shown as over its length */
var LIM = { title: 60, description: 160, h1: 70, schemaTitle: 90, schemaDescription: 300 };
ok(Object.keys(LIM).every(function (k) { return A.clean(k, 'Word '.repeat(120)).length <= LIM[k]; }), 'every AI field within the length the console shows');
var sd = 'QA Summit 2026 is an ET BrandEquity conference at Taj Wellington Mews, Chennai, from 5–7 December 2026. It is built for CEOs, CMOs, brand, creative and media leaders shaping how India markets. Expect two days of keynotes, case studies and candid panels on regional brands, e.g. retail media and OTT advertising.';
var sdc = A.clean('schemaDescription', sd);
ok(sd.length > 300 && sdc.length <= 300 && /leaders shaping how India markets\.$/.test(sdc), 'a schema description over 300 ends at its last whole sentence, not mid-sentence', sdc.length + ' ' + sdc);
var oneLong = A.clean('description', 'A two day summit for brand leaders ' + 'and media planners '.repeat(10) + 'in Chennai.');
ok(oneLong.length <= 160 && !/\s(and|for|in)$/.test(oneLong), 'one long sentence: cut at a word, no small word left hanging', oneLong);
var fq = A.applyFaqs({ faqs: [{ question: 'Who should attend', answer: 'HR leaders who run people and technology.' }, { question: 'Is it free?', answer: 'Yes, entry is free for 500 delegates.' }, { question: 'x', answer: 'y' }] }, facts);
ok(fq.faqs.length === 1 && fq.faqs[0].question === 'Who should attend?' && fq.dropped.length === 1 && /500/.test(fq.dropped[0].why), 'FAQs: a made-up number left out, a question mark added, nonsense dropped', JSON.stringify(fq));

/* ---------- the checklist ---------- */
var R = require('./api-seo').readiness;
var items = R({ seo: { title: 'x'.repeat(65), keywords: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], testimonials: [{ id: 't', name: 'N', text: 'T' }] },
  head: { description: 'From Basics', ogImage: 'https://x/y.jpg' }, auto: { indexing: { on: true, text: 'On' }, dates: { exact: true, label: '18–19 February 2027' }, venue: 'Taj', place: null, organizer: { name: 'ETHRWorld.com', portal: 'hr' }, h1: { own: '' } },
  schema: { event: { '@type': 'Event' }, faq: null, report: { performers: 0, faqs: 0, reviews: 0, notShown: { speakers: [], faqs: [], testimonials: ['t'] } }, problems: ['Event needs location'] },
  speakers: [], faqs: [], event: { city: 'Goa', venue: 'Taj' } });
var by = items.reduce(function (a, i) { a[i.id] = i; return a; }, {});
ok(by.title.level === 'warn' && /65 characters/.test(by.title.text) && by.keywords.ok && !by.description.ok && /Basics/.test(by.description.text), 'search listing: a long title, the keywords, a description borrowed from Basics');
ok(!by.address.ok && /street address and postcode/.test(by.address.text) && !by.place.ok && /“Goa” is not in the place list/.test(by.place.text), 'the address missing, a city the place list does not have', JSON.stringify([by.address, by.place]));
ok(/not shown on the site: add a testimonials section/i.test(by.reviews.text) && by.offers.level === 'info' && items.some(function (i) { return /Event needs location/.test(i.text); }), 'testimonials not shown, passes not included, a validator problem listed');
var tbaItems = R({ seo: {}, head: {}, auto: { indexing: { on: false, text: 'Off' }, dates: { exact: false } }, schema: {}, event: {} });
ok(tbaItems.filter(function (i) { return i.id === 'basic'; })[0].text.indexOf('to be announced') !== -1, 'the date to be announced: no Event schema, and why');

console.log(failed ? 'seo-ai: ' + failed + ' of ' + (passed + failed) + ' checks FAILED' : 'seo-ai: all ' + passed + ' checks passed');
process.exit(failed ? 1 : 0);
