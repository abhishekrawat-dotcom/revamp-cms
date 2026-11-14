// Settings › Search and sharing, the "Advanced" fold (edit-event-seo.js schemaHtml, richHtml, the code search engines
// read, the testimonial and previous-edition dialogs), redrawn neat and calm on 14 Nov 2026 (the owner: "too noisy, it
// should be neat and clean") and in its review round. The real file is run in a VM with a stub console and the server's
// answer shape: the panels say it in plain words, with no coloured pill, no numbering and nothing greyed out that can
// still be changed, and keep every id and data hook the save, the wiring and ETB2B AI read.
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');

let passed = 0, failed = 0;
function ok(cond, name, detail) {
  if (cond) { passed++; return; }
  failed++;
  console.error('FAIL ' + name + (detail !== undefined ? '\n     ' + String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 600) : ''));
}

const ROOT = path.join(__dirname, '..', '..');
const SRC = fs.readFileSync(path.join(ROOT, 'edit-event-seo.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'edit-event.css'), 'utf8');

/* the file's own functions, handed out for the test only (the source is not changed on disk) */
const EXPORT = 'global.EditEventSEO = {';
ok(SRC.indexOf(EXPORT) !== -1, 'the section still exports itself as window.EditEventSEO');
const run = SRC.replace(EXPORT, 'global.__t = { ST: ST, formOf: formOf, schemaHtml: schemaHtml, richHtml: richHtml, testimonialDialog: testimonialDialog, ' +
  'bringInDialog: bringInDialog, pickPrevious: pickPrevious }; ' + EXPORT);
const els = {};
function el(id) { return els[id] || (els[id] = { id: id, value: '', hidden: false, textContent: '', innerHTML: '', removeAttribute: function () {}, querySelectorAll: function () { return []; } }); }
/* RevampCore: the chooser's list of past events never answers here (only the dialog itself is checked) */
const win = { addEventListener: function () {}, RevampCore: { fetchEtEvents: function () { return new Promise(function () {}); } } };
vm.runInNewContext(run, { window: win, document: { addEventListener: function () {}, getElementById: el, querySelector: function () { return null; } }, Proxy: Proxy, setTimeout: setTimeout });
const T = win.__t;

const opened = [], toasts = [];
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
const ctx = {
  EV: { id: 'qa-adv', portal: 'hr', portalName: 'ETHRWorld', settings: {} }, esc: esc,
  svg: function () { return '<svg></svg>'; }, IC: new Proxy({}, { get: function () { return ''; } }),
  panel: function (t, s, b) { return '<div class="panel"><div class="panel-head"><h3>' + esc(t) + '</h3>' + (s ? '<span class="sub">' + esc(s) + '</span>' : '') + '</div><div class="panel-body">' + b + '</div></div>'; },
  seo: { imgTag: function (u) { return u ? '<img src="' + esc(u) + '" alt="">' : ''; }, closeBtn: function () { return '<button type="button" data-close>×</button>'; },
    openModal: function (h) { opened.push(h); return { close: function () {} }; } },
  toast: function (m) { toasts.push(m); }, toastError: function () {}, render: function () {}
};
function speaker(i, extra) { return Object.assign({ id: 's' + i, name: 'Speaker ' + i, role: 'CHRO', company: 'Acme', confirmed: true, counts: true, shown: true }, extra || {}); }
const DATA = {
  seo: { speakersOff: ['s2'], faqsOff: [], aiWritten: ['schemaTitle'], schemaTitle: 'QA Summit 2027, New Delhi', testimonials: [
    { id: 't1', name: 'Priya Sharma', role: 'CHRO', company: 'Acme', title: 'A truly pleasant experience', text: 'The sessions were sharp.', rating: 5, from: 'team' },
    { id: 't2', name: 'Anita Rao', company: 'Beta', text: 'Well run.', rating: 4, from: 'previous', prevId: 'p2' },
    { id: 't3', name: 'Meera Iyer', text: 'Not saved yet.', from: 'team' }] },
  auto: { title: 'QA Summit 2027', url: 'https://sites.example/e/qa-adv', attendanceAuto: 'offline', dates: { exact: true, label: '18–19 February 2027' }, venue: 'Taj Palace', city: 'New Delhi',
    place: { label: 'New Delhi, Delhi, India' }, organizer: { name: 'ETHRWorld.com', url: 'https://hr.economictimes.indiatimes.com/', portal: 'hr' }, logo: { url: 'https://x/lu.png', from: 'logo unit' } },
  speakers: [speaker(1), speaker(2, { shown: false }), speaker(3, { confirmed: false, shown: false }), speaker(4), speaker(5), speaker(6), speaker(7), speaker(8), speaker(9), speaker(10)],
  faqs: [{ id: 'f1', question: 'Who should attend?', answer: 'HR leaders who run people and technology.', counts: true, shown: true },
    { id: 'f2', question: 'Is it free?', answer: 'Yes, entry is free.', counts: true, shown: false }],
  testimonials: { t1: { shown: true }, t2: { shown: false } },
  schema: { event: { '@type': 'Event', name: 'QA Summit 2027' }, faq: null }
};
function setUp(data, prev) {
  const ST = T.ST;
  ST.ctx = ctx; ST.id = ctx.EV.id; ST.data = JSON.parse(JSON.stringify(data)); ST.F = T.formOf(ST.data.seo); ST.B = T.formOf(ST.data.seo);
  ST.prev = prev || null; ST.aiBusy = ''; ST.prevBusy = false; ST.more = {}; ST.dropped = [];
}
setUp(DATA);
const schema = T.schemaHtml(), rich = T.richHtml(), both = schema + rich;

/* ---------- plain words, no noise ---------- */
ok(/<h3>Event details for search engines<\/h3>/.test(schema) && /<h3>Speakers, FAQs and reviews in Google<\/h3>/.test(rich), 'the two panels have their plain titles');
ok(!/\d\s*·\s*(Event schema|Rich results)/.test(both) && !/Event schema|Rich results|Schema title|Schema description|Attendance mode|Keywords/.test(both), 'no numbering and none of the old jargon', both.match(/Event schema|Rich results|Schema title|Schema description|Attendance mode|Keywords/g));
ok(both.indexOf('class="badge') === -1 && both.indexOf('seo-src') === -1, 'no coloured pill anywhere in the two panels (sources and states are muted words)');
ok(!/<span class="sub">/.test(both), 'no subtitle under either title');
ok(/Filled in from Basics and the event’s portal\./.test(schema) && (schema.match(/Change them in Basics/g) || []).length === 1, 'what is filled in is said once, with one way to change it');
ok(/<dt>Dates<\/dt><dd>18–19 February 2027<\/dd>/.test(schema) && /<dt>City<\/dt><dd>New Delhi, Delhi, India<\/dd>/.test(schema) && /<dt>Logo<\/dt><dd class="seo2-logo-dd"><span class="seo2-logo"><img/.test(schema),
  'the dates, the place and the logo read as quiet facts');
ok(/<p class="seo2-hint" id="seo-schemaTitle-hint"><span>Suggested by ETB2B AI · <button class="seo2-link" type="button" data-seo-ai="schemaTitle"/.test(schema) &&
  /<p class="seo2-hint" id="seo-schemaDescription-hint"><span>Left empty, the description in Google is used\. <button class="seo2-link" type="button" data-seo-ai="schemaDescription"[^>]*>Suggest with ETB2B AI<\/button><\/span><\/p>/.test(schema),
  'a field says in one muted line who wrote it (with Suggest again), or what is used while it is empty (with Suggest with ETB2B AI for it alone) — as the Google result\'s fields do');
ok(/aria-label="Suggest again with ETB2B AI: Event name in event listings"/.test(schema) && /aria-label="Suggest with ETB2B AI: Event description in event listings">Suggest with ETB2B AI<\/button>/.test(schema) && !/btn-ghost/.test(schema),
  'per field, a small text button naming the field in plain words: Suggest again on what ETB2B AI wrote, else Suggest with ETB2B AI');
ok(/<label for="seo-schemaTitle">Event name in event listings<\/label>/.test(schema) && /<label for="seo-schemaDescription">Event description in event listings<\/label>/.test(schema),
  'the event\'s name and description say where they are used (event listings), so they are not mistaken for Basics\' or Google\'s');

/* ---------- the same ids and data hooks as before (save, wiring, live counts, ETB2B AI, the previous edition) ---------- */
['seo-basicSchema', 'seo-advancedSchema', 'seo-schemaTitle', 'seo-schemaDescription', 'seo-attendanceMode', 'seo-streetAddress', 'seo-postalCode', 'seo-latitude', 'seo-longitude',
  'seo-ctr-schemaTitle', 'seo-ctr-schemaDescription'].forEach(function (id) { ok(both.indexOf('id="' + id + '"') !== -1, 'kept: #' + id); });
['schemaTitle', 'schemaDescription', 'attendanceMode', 'streetAddress', 'postalCode', 'latitude', 'longitude'].forEach(function (k) {
  ok(both.indexOf('data-seo-field="' + k + '"') !== -1, 'kept: data-seo-field="' + k + '"');
});
ok(/data-seo-ai="schemaTitle"/.test(schema), 'kept: ETB2B AI per field (data-seo-ai) on what it wrote');
['seo-schemaTitle', 'seo-schemaDescription'].forEach(function (id) { ok(both.indexOf('aria-describedby="' + id + '-hint"') !== -1 && both.indexOf('id="' + id + '-hint"') !== -1, '#' + id + ' is described by its one line'); });
ok(/data-seo-sp="s1" checked/.test(rich) && /data-seo-sp="s2">/.test(rich) && /data-seo-sp="s3" disabled>/.test(rich), 'speakers: ticked, left out (speakersOff), and not confirmed (cannot be ticked)');
ok(/data-seo-fq="f1" checked/.test(rich) && /data-seo-tm-on="0" checked/.test(rich) && /data-seo-tm-edit="2"/.test(rich) && /data-seo-tm-x="1"/.test(rich), 'FAQs and testimonials: include, edit and remove hooks');
ok(/data-seo="tm-add"/.test(rich) && /data-seo="prev-tm"/.test(rich) && (rich.match(/class="seo2-acts"/g) || []).length === 1, 'testimonials: Add and Bring in, in one action area');

/* ---------- tidy rows ---------- */
ok(/Not on the site<\/span><\/li>/.test(rich) && /Not confirmed<\/span>/.test(rich), 'a row\'s state is muted words at its end');
ok((rich.match(/<li class="seo2-row"><input type="checkbox" id="seo-sp-/g) || []).length === 10 && /<details class="seo2-more" data-seo-more="sp"><summary><span class="seo2-more-show">Show 4 more speakers<\/span>/.test(rich),
  'ten speakers: six shown, the other four folded under "Show 4 more speakers"');
T.ST.more = { sp: true };
ok(/data-seo-more="sp" open>/.test(T.richHtml()), 'and it stays open after a redraw once opened');
ok(/1 FAQ is not on the site, so search engines are not given it\. Show it in the site’s FAQ section, in the <a class="seo2-link" href="#design\/editor" data-goto="design\/editor">site editor<\/a>\./.test(rich) &&
  /1 testimonial is not on the site, so search engines are not given it\. To give it, put the same words in the site’s testimonials section in the <a class="seo2-link" href="#design\/editor" data-goto="design\/editor">site editor<\/a>\./.test(rich),
  'what is left out is one muted line each, with the way to show it: the site already has FAQs and testimonials, so in its own section (a testimonial, by its very words)');
ok(rich.indexOf('speaker is not on the site') === -1 && rich.indexOf('speakers are not on the site') === -1, 'every speaker that counts is on the site here: no speakers line');
ok(/Ticked speakers, FAQs and testimonials go to search engines when the site shows them; untick one to leave it out\./.test(rich) && rich.indexOf('Only what the site itself shows is given') === -1,
  'what a tick does is said once, under the switch');
ok(/data-seo="prev-tm"[^>]*>Bring in testimonials from the previous edition<\/button>/.test(rich) && rich.indexOf('>Bring in from the previous edition<') === -1,
  'the testimonials\' Bring in says what it brings (the page has no other button with its words)');
ok(/The rating is the average of the star ratings of the testimonials the site shows\./.test(rich) && rich.indexOf('never typed') === -1, 'the rating says how it is worked out (the testimonial dialog asks for stars)');
ok(/data-seo="prev-addr"[^>]*>Bring in the previous edition’s address<\/button>/.test(schema), 'an empty street address offers the previous edition\'s');
ok(/<div class="seo2-pair" role="group" aria-labelledby="seo-geo-label">/.test(schema) && /placeholder="e\.g\. 28\.5022"/.test(schema) && /placeholder="e\.g\. 77\.0969"/.test(schema) &&
  /in Google Maps, right-click the venue and click the two numbers at the top to copy them, then paste them here\./.test(schema),
  'latitude and longitude: a named pair, examples that read as examples, and where to find the numbers');
ok(/aria-describedby="seo-adv-why"/.test(rich) && schema.indexOf('aria-describedby="seo-basic-why"') === -1 && schema.indexOf('Off: search engines') === -1, 'switched on: no off line, and no description pointing at one');
ok(/From the previous edition · Not on the site/.test(rich) && /Not saved yet/.test(rich) && /<b>A truly pleasant experience<\/b> The sessions were sharp\./.test(rich), 'a testimonial: its words, where it came from and whether the site shows it');
ok(/<dt>Rating<\/dt><dd><b>5<\/b> <span class="seo2-stars" role="img" aria-label="5 out of 5 stars">★★★★★<\/span> <span class="seo2-faint">from 1 rating<\/span>/.test(rich), 'the rating is one line, from the testimonials the site shows');
ok(/<details class="seo2-ld" id="seo2-ld"><summary>For developers: the code search engines read<\/summary><pre>/.test(rich) && rich.indexOf('&quot;@type&quot;: &quot;Event&quot;') !== -1 &&
  (rich.match(/For developers: the code search engines read/g) || []).length === 1 && SRC.indexOf('function ldHtml') === -1, 'the code search engines read follows, folded, drawn once, said to be for developers');
T.ST.ldOpen = true;
ok(/<details class="seo2-ld" id="seo2-ld" open>/.test(T.richHtml()), 'and it stays open after a redraw once opened');
T.ST.ldOpen = false;
/* what ETB2B AI left out of a field: the Google result's warning line, with Suggest again */
T.ST.dropped = [{ field: 'schemaDescription', why: 'left out: it said “2000+”, which the event’s details do not say' }];
ok(/id="seo-schemaDescription-hint"><span><span class="seo2-warn"><svg><\/svg> ETB2B AI left out: it said “2000\+”, which the event’s details do not say\.<\/span> <button class="seo2-link" type="button" data-seo-ai="schemaDescription"/.test(T.schemaHtml()),
  'what ETB2B AI left out: one muted warning line with a small icon, and Suggest again');
T.ST.dropped = [];

/* ---------- the empty and switched-off states ---------- */
const empty = JSON.parse(JSON.stringify(DATA));
empty.speakers = []; empty.faqs = []; empty.seo.testimonials = []; empty.schema = { event: null, faq: null }; empty.seo.advancedSchema = false;
empty.auto.dates = { exact: false, label: 'To be announced' }; empty.auto.logo = null; empty.auto.place = null; empty.auto.city = 'Gurgaon';
setUp(empty, { sameVenue: true, previous: { seo: { streetAddress: 'NH 8, Ambience Island', postalCode: '122010' } } });
const s2 = T.schemaHtml(), r2 = T.richHtml();
ok(/id="seo-basicSchema" aria-pressed="false" disabled aria-describedby="seo-basic-why"/.test(s2) && /Not while the date is to be announced/.test(s2) && /<div class="seo2-body">/.test(s2) && s2.indexOf('seo2-off') === -1,
  'dates to be announced: the switch is off and says why; the fields below stay as they are (they can still be filled in), never greyed out');
ok(/Gurgaon <span class="seo2-faint">· its state and country are not known<\/span>/.test(s2) && /data-seo="use-prev-address"/.test(s2), 'a city not in the place list, and the previous edition\'s address to use');
ok(/data-seo="faq-draft"/.test(r2) && /No FAQs in .*Content › FAQ.* yet\./.test(r2) && /No speakers in /.test(r2) && /None yet\. Add what people who were there said/.test(r2), 'nothing yet: one muted line each, and Draft FAQs with ETB2B AI');
ok(/Off: search engines are not given the speakers, FAQs or reviews\./.test(r2) && r2.indexOf('seo2-off') === -1 && /For developers: there is no code for search engines yet\./.test(r2),
  'speakers, FAQs and reviews switched off: said under the switch (nothing greyed out), and no code yet');
T.ST.F.basicSchema = false; T.ST.data.auto.dates = { exact: true, label: '18–19 February 2027' };
const s3 = T.schemaHtml();
ok(/id="seo-basicSchema" aria-pressed="false" aria-describedby="seo-basic-why"/.test(s3) && /<span>Off: search engines are not given these details\.<\/span>/.test(s3) && s3.indexOf('seo2-off') === -1,
  'the event details switched off by choice: one line says so');
ok(CSS.indexOf('.seo2-off') === -1, 'no rule greys out a panel that can still be changed');
/* the street address: the previous edition's at this venue, to use, rather than a way to bring it in */
T.ST.F.streetAddress = '';
ok(/The previous edition at this venue gave “NH 8, Ambience Island, 122010”\. <button class="seo2-link" type="button" data-seo="use-prev-address">Use it<\/button>/.test(s3) && s3.indexOf('data-seo="prev-addr"') === -1,
  'once the previous edition is known to be at this venue, its address is offered to use');

/* ---------- the dialogs ---------- */
setUp(DATA);
opened.length = 0; T.testimonialDialog(null);
const tm = opened[0] || '';
ok(/<h3>Add a testimonial<\/h3>/.test(tm) && tm.indexOf('pill-req') === -1 && (tm.match(/<span class="seo2-req">\(required\)<\/span>/g) || []).length === 2, 'Add a testimonial: two fields marked (required) in muted words, no red pills');
['tm-name', 'tm-role', 'tm-company', 'tm-rating', 'tm-text', 'tm-title', 'tm-photo-prev', 'tm-photo-state', 'tm-photo-btn', 'tm-photo-x', 'tm-err', 'tm-save'].forEach(function (id) { ok(tm.indexOf('id="' + id + '"') !== -1, 'the testimonial dialog keeps #' + id); });
ok((tm.match(/btn-primary/g) || []).length === 1 && />Add testimonial<\/button>/.test(tm) && /id="tm-photo-x" hidden>/.test(tm), 'one primary button; no photo: its Remove is hidden');
opened.length = 0;
T.bringInDialog({ sameVenue: true, previous: { name: 'QA Summit 2026', seo: { streetAddress: 'NH 8', postalCode: '122010', keywords: ['a', 'b'] }, testimonials: [{ prevId: 'p9', name: 'Ravi', text: 'Good', rating: 5 }] } }, '');
const bi = opened[0] || '';
ok(/<h3>Bring in from QA Summit 2026<\/h3>/.test(bi) && /id="seo-bi-addr" checked/.test(bi) && /id="seo-bi-tm" checked/.test(bi) && /id="seo-bi-go">Bring them in</.test(bi) && /Its 2 search words: kept as a reference/.test(bi),
  'Bring in: what can be ticked, what is kept as a reference, one primary button');
opened.length = 0;
T.bringInDialog({ sameVenue: false, venueThen: 'Hyatt', previous: { name: 'QA Summit 2026', seo: { streetAddress: 'NH 8' }, testimonials: [] } }, '');
ok(opened[0] && opened[0].indexOf('seo-bi-go') === -1 && />Close<\/button>/.test(opened[0]) && /not offered, as it was at Hyatt/.test(opened[0]), 'nothing to bring in: no primary button, only Close, and why');
opened.length = 0; T.pickPrevious('', true);
ok(/Pick another of ETHRWorld’s past events on ETB2B\./.test(opened[0] || '') && /id="seo-pick-list" class="seo2-pick"/.test(opened[0] || ''), 'Choose another previous edition says "another", not "none on record"');
opened.length = 0; T.pickPrevious('');
ok(/No previous edition is on record for this event\. Pick it from ETHRWorld’s past events on ETB2B; its testimonials and, at the same venue, its street address can then be brought in\./.test(opened[0] || ''),
  'none on record: the chooser says what picking one brings in');
/* Bring them in: what was brought in is in the Advanced fold, so it opens */
setUp(DATA);
T.ST.advOpen = false;
opened.length = 0;
T.bringInDialog({ sameVenue: true, previous: { name: 'QA Summit 2026', seo: { streetAddress: 'NH 8', postalCode: '122010' }, testimonials: [] } }, 'addr');
el('seo-bi-addr').checked = true;
el('seo-bi-go').onclick();
ok(T.ST.advOpen === true && T.ST.F.streetAddress === 'NH 8' && T.ST.F.postalCode === '122010' && toasts[toasts.length - 1] === 'Brought in. Save changes to keep them.',
  'Bring them in: the street address is in the form, and the Advanced fold is open so it is seen');

/* ---------- the styles: one block of their own, the console's tokens only ---------- */
const block = CSS.slice(CSS.indexOf('/* seo2: rich'));
/* one exception, the console's own rule: a logo always sits on white (.pt-logo, .lib-pic.logo), in both themes */
const logoRule = (/\.seo2-logo\{[^}]*\}/.exec(block) || [''])[0];
ok(CSS.indexOf('/* seo2: rich') !== -1 && !/#[0-9a-fA-F]{3,8}\b/.test(block.replace(/\/\*[\s\S]*?\*\//g, '').replace(logoRule, '')) && /background:#fff; border:1px solid var\(--border\)/.test(logoRule),
  'the part\'s CSS is one /* seo2: rich */ block with no hard-coded colour, but the logo\'s white ground (a logo always sits on white, as everywhere in the console)');
ok(/\.seo2-photo \[hidden\]\{ display:none; \}/.test(block), 'a hidden photo button stays hidden (a .btn would otherwise show)');
const selectors = [];
block.replace(/\/\*[\s\S]*?\*\//g, '').replace(/([^{}]+)\{/g, function (m, sel) { sel = sel.trim(); if (sel.indexOf('@media') !== 0) sel.split(',').forEach(function (s) { selectors.push(s.trim()); }); return m; });
ok(selectors.length > 40 && selectors.every(function (s) { return /^(details)?\.seo2-[a-z-]+/.test(s); }), 'every rule in the block is for a seo2- class', selectors.filter(function (s) { return !/^(details)?\.seo2-[a-z-]+/.test(s); }));

console.log('seo-advanced-ui: ' + (failed ? 'FAILED ' : 'all ') + passed + ' checks passed' + (failed ? ', ' + failed + ' failed' : ''));
process.exit(failed ? 1 : 0);
