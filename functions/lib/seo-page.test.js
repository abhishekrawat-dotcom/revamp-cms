// node functions/lib/seo-page.test.js — Settings › Search and sharing as ONE page (the four parts put together on 14 Nov
// 2026, owner: "too noisy, it should be neat and clean"; the review round after it): the heading's one helper (Suggest
// with ETB2B AI), each field's own Suggest with ETB2B AI (Suggest again on ETB2B AI's own), Bring in where what it brings
// lands, the checklist's one line under the preview, the shared link said once, the code search engines read drawn once
// and said to be for developers, and every name and value the page shows in plain words — a name for every setting the
// server reports, the What changed list (only what the site shows), the readiness list's technical lines. The real file
// runs in a VM with a stub console and the server's answer shape. No browser, no network.
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const seoFields = require('./seo-fields');

let passed = 0, failed = 0;
function ok(cond, name, detail) {
  if (cond) { passed++; return; }
  failed++;
  console.error('FAIL ' + name + (detail !== undefined ? '\n     ' + String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 700) : ''));
}

const ROOT = path.join(__dirname, '..', '..');
const SRC = fs.readFileSync(path.join(ROOT, 'edit-event-seo.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'edit-event.css'), 'utf8');
const EXPORT = 'global.EditEventSEO = {';
const run = SRC.replace(EXPORT, 'global.__t = { ST: ST, LABEL: LABEL, view: view, statusHtml: statusHtml, readyHtml: readyHtml, formOf: formOf, searchHtml: searchHtml, ' +
  'socialHtml: socialHtml, schemaHtml: schemaHtml, askThenWrite: askThenWrite, writeAi: writeAi, discard: discard, aiFields: aiFields }; ' + EXPORT);
/* RevampCore: ETB2B AI's answer is handed back by the test (writeSeo resolves what WRITE holds) */
let WRITE = null;
const win = { addEventListener: function () {}, RevampCore: { fetchSeo: function () { return new Promise(function () {}); }, writeSeo: function () { return Promise.resolve(WRITE); } } };
/* the dialogs' own buttons are found by id (seo-ask-…); nothing else is on screen (#seo-root is not), so nothing redraws */
const BTN = {};
vm.runInNewContext(run, { window: win, document: { addEventListener: function () {}, getElementById: function (id) { return /^seo-ask-/.test(id) ? (BTN[id] = BTN[id] || {}) : null; },
  querySelector: function () { return null; } }, setTimeout: function () {} });
const T = win.__t;

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
const ctx = {
  EV: { id: 'qa-page', description: 'Two days for security leaders.', settings: {} }, esc: esc,
  svg: function () { return '<svg></svg>'; }, IC: { star: 'star', info: 'info', image: 'image' },
  vhead: function (t, s, right) { return '<div class="vhead"><h2>' + esc(t) + '</h2><div class="sub">' + esc(s) + '</div>' + (right || '') + '</div>'; },
  panel: function (t, s, b, right) { return '<div class="panel"><div class="panel-head"><h3>' + esc(t) + '</h3>' + (s ? '<span class="sub">' + esc(s) + '</span>' : '') + (right || '') + '</div><div class="panel-body">' + b + '</div></div>'; },
  seo: { imgTag: function (u) { return u ? '<img src="' + esc(u) + '" alt="">' : ''; },
    sharePictureField: function (e, fallback) { SHARED.push(fallback); return '<div class="seo2-share">picture</div>'; },
    openModal: function (h) { MODALS.push(h); return { close: function () {} }; }, closeBtn: function () { return '<button type="button" data-close>×</button>'; } },
  render: function () { RENDERS++; }, toast: function () {}, toastError: function () {}
};
const SHARED = [], MODALS = [];
let RENDERS = 0;
const DATA = {
  seo: { title: 'QA Summit 2027 | Security leaders', description: 'Two days for security leaders in Delhi.', keywords: ['security summit'], noindex: true,
    shareImageUrl: 'https://storage.example/own.jpg', speakersOff: ['s2'], aiWritten: ['title', 'schemaTitle'], schemaTitle: 'QA Summit 2027, New Delhi', testimonials: [] },
  live: { published: true }, pending: null, approvalRequired: true,
  changes: [
    { field: 'title', label: 'SEO title', after: 'QA Summit 2027 | Security leaders' },
    { field: 'description', label: 'Meta description', after: new Array(30).join('Two days for security leaders ') },
    { field: 'noindex', label: 'Indexing', after: 'Kept out of search engines' },
    { field: 'shareImageUrl', label: 'Share picture', after: 'https://storage.example/own.jpg' },
    { field: 'canonicalUrl', label: 'Canonical address', after: '' },
    { field: 'speakersOff', label: 'Speakers taken out', after: '1 taken out' },
    { field: 'attendanceMode', label: 'Attendance mode', after: 'In person' },
    { field: 'faqs', label: 'FAQs in search results', after: '' }],
  head: { description: 'Two days for security leaders in Delhi.', ogImage: 'https://storage.example/own.jpg' },
  auto: { title: 'QA Summit 2027', url: 'https://sites.example/e/qa-page', indexing: { on: false, reason: 'owner', text: 'Off' }, h1: { own: '', used: '' }, attendanceAuto: 'offline',
    dates: { exact: true, label: '18–19 February 2027' }, venue: 'Taj Palace', city: 'New Delhi', place: { label: 'New Delhi, Delhi, India' },
    organizer: { name: 'ETCISO.in', url: 'https://ciso.economictimes.indiatimes.com/', portal: 'ciso' }, logo: null },
  speakers: [{ id: 's1', name: 'Priya Sharma', role: 'CISO', company: 'Acme', confirmed: true, counts: true, shown: true }],
  faqs: [], testimonials: {},
  schema: { event: { '@type': 'Event', name: 'QA Summit 2027' }, faq: null },
  ready: [
    { group: 'search', id: 'keywords', label: 'Keywords', ok: false, level: 'warn', text: '1 search word: 8 to 12 works best' },
    { group: 'schema', id: 'problem-0', label: 'Structured data', ok: false, level: 'warn', text: 'location.address must be PostalAddress' },
    { group: 'schema', id: 'problem-1', label: 'Structured data', ok: false, level: 'warn', text: 'startDate is not an ISO date' }]
};
function setUp(data) {
  const ST = T.ST;
  ST.ctx = ctx; ST.id = ctx.EV.id; ST.data = JSON.parse(JSON.stringify(data)); ST.F = T.formOf(ST.data.seo); ST.B = T.formOf(ST.data.seo);
  ST.loading = false; ST.error = ''; ST.aiBusy = ''; ST.prevBusy = false; ST.more = {}; ST.dropped = []; ST.undo = null; ST.prev = null; ST.chgOpen = true;
}
setUp(DATA);
const page = T.view(ctx);

/* ---------- the heading: one line saying what needs the team, one helper ---------- */
const vhead = page.slice(0, page.indexOf('<div id="seo-root"'));
ok(/<h2>Search and sharing<\/h2><div class="sub">How this event appears in Google and when its link is shared\. Only the title, description and search words need you; everything else is filled in\.<\/div>/.test(vhead),
  'the heading says what needs the team (the title, description and search words) in its one line');
ok((page.match(/data-seo="ai-all"/g) || []).length === 1 && /data-seo="ai-all"/.test(vhead) && (vhead.match(/<button/g) || []).length === 1,
  'Suggest with ETB2B AI for every field: once, the heading\'s only button');
ok(page.indexOf('data-seo="prev"') === -1 && vhead.indexOf('Bring in') === -1 && page.indexOf('>Bring in from the previous edition<') === -1,
  'no Bring in in the heading (it brought in only what is inside the closed Advanced fold), and no two buttons share its words');
ok((page.match(/data-seo="prev-tm"[^>]*>Bring in testimonials from the previous edition<\/button>/g) || []).length === 1 &&
  (page.match(/data-seo="prev-addr"[^>]*>Bring in the previous edition’s address<\/button>/g) || []).length === 1,
  'Bring in sits where what it brings lands, named for it: the testimonials, and the street address (empty here)');
ok((page.match(/<div class="panel-head"><h3>[^<]*<\/h3>(<span class="sub">[^<]*<\/span>)?<\/div>/g) || []).length === (page.match(/<div class="panel-head">/g) || []).length,
  'no panel carries actions in its head');

/* ---------- ETB2B AI, field by field (the heading's writes them all) ---------- */
const perField = (page.match(/<button class="seo2-link" type="button" data-seo-ai="[a-zA-Z0-9]+"[^>]*>[^<]*<\/button>/g) || []);
const aiOf = {};
perField.forEach(function (b) { aiOf[/data-seo-ai="([a-zA-Z0-9]+)"/.exec(b)[1] + ':' + />([^<]*)<\/button>$/.exec(b)[1]] = /aria-label="([^"]*)"/.exec(b)[1]; });
ok(perField.length === 6 && aiOf['title:Suggest again'] === 'Suggest again with ETB2B AI: Title in Google' && aiOf['schemaTitle:Suggest again'] === 'Suggest again with ETB2B AI: Event name in event listings' &&
  aiOf['description:Suggest with ETB2B AI'] === 'Suggest with ETB2B AI: Description in Google' && aiOf['keywords:Suggest with ETB2B AI'] === 'Suggest with ETB2B AI: Search words' &&
  aiOf['h1:Suggest with ETB2B AI'] === 'Suggest with ETB2B AI: Main heading' && aiOf['schemaDescription:Suggest with ETB2B AI'] === 'Suggest with ETB2B AI: Event description in event listings',
  'each of the six fields ETB2B AI writes has its own small action: Suggest again on the two it wrote, Suggest with ETB2B AI on the rest (team\'s or empty)', aiOf);
ok(page.indexOf('btn-ghost btn-sm" type="button" data-seo-ai') === -1, 'the per-field action is a small text button, not a button per field');

/* ---------- the page, top to bottom ---------- */
ok(page.indexOf('class="seo2-pv"') < page.indexOf('id="seo2-ready"') && page.indexOf('id="seo2-ready"') < page.indexOf('<h3>Google result</h3>') &&
  /<summary><b>Checklist: 0 of 3 done<\/b><span class="seo2-link seo2-show">Show<\/span>/.test(page), 'the checklist is one line just under the preview: "Checklist: N of M done · Show"');
ok((page.match(/For developers: the code search engines read/g) || []).length === 1 && (page.match(/class="seo2-ld"/g) || []).length === 1 && page.indexOf('structured data') === -1,
  'the code search engines read: drawn once, said to be for developers, with no jargon tag');
ok(/<details class="seo2-adv" id="seo2-adv">/.test(page) && (page.match(/btn-primary/g) || []).length === 1 && /class="btn btn-primary btn-sm" type="button" id="seo-save"/.test(page),
  'the Advanced fold closed, and Save changes the one primary button');
ok(/<span class="seo2-adv-s">Event details, speakers, FAQs and reviews for search engines\. Filled in for you; the extras inside are optional\.<\/span>/.test(page),
  'the Advanced fold says its extras are optional (it has fields to fill in, so not "filled in automatically")');
const adv = page.slice(page.indexOf('<div class="seo2-adv-body">'));
ok(/Short links are not available yet: share the site’s own address\./.test(adv) && page.indexOf('ethrworld') === -1 && page.indexOf('link shortener') === -1,
  'short links: said honestly, in Advanced, with no other portal\'s address');

/* ---------- when the link is shared: the picture once large (the preview), the title and description said once ---------- */
const social = T.socialHtml();
ok(social.indexOf('seo2-sh-title') === -1 && social.indexOf('seo2-sh-desc') === -1 && social.indexOf('Title and description') === -1 &&
  /<p class="seo2-sh-src">A shared link shows the title and description in Google\. <button class="seo2-link" type="button" data-seo2-sh="edit">Change them<\/button><\/p>/.test(social),
  'the shared link\'s title and description are not shown a third time: one line says they are Google\'s, with Change them');
ok(SHARED[SHARED.length - 1] === DATA.head.ogImage && /<div class="seo2-pv-h" id="seo2-pv-s">As a shared link<\/div>/.test(page) && (page.match(/When the link is shared/g) || []).length === 1,
  'the share picture field is handed the preview\'s picture (the two never disagree), and the preview\'s card is not named like the panel');
ok(/<div class="mock mock-serp" role="group" aria-labelledby="seo2-pv-g">/.test(page) && /<div class="mock mock-og seo-og" role="group" aria-labelledby="seo2-pv-s">/.test(page),
  'the preview cards are named groups');

/* ---------- plain words ---------- */
const JARGON = /\b(SEO title|Meta description|Keywords?|H1|Canonical|Indexing|[Ss]chema|Rich results|Structured data|Attendance mode|taken out)\b/;
Object.keys(seoFields.LABELS).forEach(function (k) {
  ok(T.LABEL[k] && !JARGON.test(T.LABEL[k]), 'the page has a plain name for "' + k + '" (the server says "' + seoFields.LABELS[k] + '")', T.LABEL[k]);
});
const status = T.statusHtml(), names = (status.match(/<li><b>[^<]*<\/b>: [^<]*<\/li>/g) || []);
ok(names.length === DATA.changes.length && names.every(function (l) { return !JARGON.test(l); }), 'What changed: every change named in plain words', names);
['<li><b>Title in Google</b>: QA Summit 2027 | Security leaders</li>', '<li><b>Show in Google</b>: Off</li>', '<li><b>Share picture</b>: Your own picture</li>',
  '<li><b>Main web address</b>: The site’s own</li>', '<li><b>Speakers left out</b>: 1</li>', '<li><b>How people attend</b>: In person</li>', '<li><b>FAQs in Google</b>: None</li>'].forEach(function (l) {
  ok(status.indexOf(l) !== -1, 'What changed says ' + l.replace(/<[^>]+>/g, ''), status);
});
const long = (/<li><b>Description in Google<\/b>: ([^<]*)<\/li>/.exec(status) || [])[1] || '';
ok(long.length <= 122 && / …$/.test(long) && !/https?:/.test(status), 'a long value is cut at a word with an ellipsis, and no picture address is shown', long);
const ready = T.readyHtml();
ok(/<b>Full address<span class="rv-sr"> — needs a look<\/span><\/b><span>Search engines get only the venue’s name as its address until the street address and postcode are added\.<\/span>/.test(ready) &&
  /<b>Event details<span class="rv-sr"> — needs a look<\/span><\/b><span>Search engines may not read all of it \(startDate is not an ISO date\)\.<\/span>/.test(ready) &&
  /<b>Search words<span/.test(ready) && ready.indexOf('PostalAddress') === -1 && ready.indexOf('— missing') === -1,
  'readiness: the technical lines said in plain words (the rest\'s technical words after them); what is there but needs a look is never read out as "missing"', ready);

/* ---------- What changed: only what the next publish really gives ---------- */
const recs = JSON.parse(JSON.stringify(DATA));
recs.auto.h1 = { own: 'Candid conversations shaping the CISO agenda', used: 'Candid conversations shaping the CISO agenda' };
recs.speakers = [{ id: 'a', name: 'Naven Singh', confirmed: true, counts: true, shown: false }, { id: 'b', name: 'Santosh K', confirmed: true, counts: true, shown: false }];
recs.faqs = [{ id: 'f1', question: 'Who should attend?', counts: true, shown: true }, { id: 'f2', question: 'Is it free?', counts: true, shown: false }];
recs.seo.testimonials = [{ id: 't1', name: 'Priya Nair', text: 'Sharp.', rating: 5 }];
recs.testimonials = { t1: { shown: false } };
recs.changes = [{ field: 'h1', label: 'H1 heading', after: 'QA CISO Secufest 2027' }, { field: 'speakers', label: 'Speakers', after: 'Naven Singh, Santosh K' },
  { field: 'faqs', label: 'FAQs', after: 'Who should attend?, Is it free?' }, { field: 'testimonials', label: 'Testimonials', after: 'Priya Nair (5★)' }];
setUp(recs);
const st2 = T.statusHtml();
['<li><b>Main heading</b>: Not used: the site has its own main heading</li>', '<li><b>Speakers in Google</b>: None on the site yet (2 picked)</li>',
  '<li><b>FAQs in Google</b>: Who should attend? (1 not on the site)</li>', '<li><b>Testimonials</b>: None on the site yet (1 added)</li>'].forEach(function (l) {
  ok(st2.indexOf(l) !== -1, 'What changed says only what the site shows: ' + l.replace(/<[^>]+>/g, ''), st2);
});
/* a request waiting with the same settings: said only of changes that are saved */
setUp(Object.assign({}, DATA, { changes: [], pending: { seoSame: true, reviewPath: '/review.html?event=qa-page&request=r1' } }));
T.ST.F.title = 'Being typed';
const typing = T.statusHtml();
ok(/Your changes go live with the next publish\.<\/span><span class="seo2-quiet">Save first\.<\/span>/.test(typing) && typing.indexOf('waiting for approval') === -1,
  'unsaved edits are never said to be waiting for approval', typing);
setUp(Object.assign({}, DATA, { pending: { seoSame: true, reviewPath: '/review.html?event=qa-page&request=r1' } }));
ok(/8 changes go live with the next publish, and they are waiting for approval\./.test(T.statusHtml()), 'saved changes in a waiting request: said so');
setUp(Object.assign({}, DATA, { live: { published: false } }));
ok(/Not live yet\. These settings go live when the site is first published\./.test(T.statusHtml()), 'not live yet: said plainly');

/* ---------- a site with a main heading of its own ---------- */
setUp(recs);
const ownSearch = T.searchHtml(), ownSchema = T.schemaHtml();
ok(ownSearch.indexOf('id="seo-h1"') === -1 && /<span class="seo2-label">Main heading<\/span><\/div><p class="seo2-note">The site’s own, “Candid conversations shaping the CISO agenda”\. Google reads it from the page, so there is nothing to write here\.<\/p>/.test(ownSearch),
  'the Google result shows the site\'s own heading in one line, with no field to type into', ownSearch.slice(ownSearch.indexOf('Main heading') - 60, ownSearch.indexOf('Main heading') + 260));
ok(/id="seo-h1" data-seo-field="h1"/.test(ownSchema) && /<p class="seo2-hint" id="seo-h1-hint"><span>Used only when the site has no main heading of its own\.<\/span><\/p>/.test(ownSchema) && ownSchema.indexOf('data-seo-ai="h1"') === -1,
  'its field waits in Advanced (kept, same id), said to be used only without the site\'s own, with no ETB2B AI offered for it');
ok(JSON.stringify(T.aiFields()) === '["title","description","keywords","schemaTitle","schemaDescription"]', 'the heading\'s Suggest with ETB2B AI leaves the unused heading alone', T.aiFields());
setUp(DATA);
ok(JSON.stringify(T.aiFields()) === '["title","description","keywords","h1","schemaTitle","schemaDescription"]', 'and writes it when the site has no heading of its own');

/* ---------- the replace dialog: words that fit whoever wrote it ---------- */
setUp(Object.assign({}, DATA, { seo: Object.assign({}, DATA.seo, { aiWritten: [] }) }));
MODALS.length = 0; T.askThenWrite(['title', 'description', 'keywords', 'h1'], true);
const ask = MODALS[0] || '';
ok(/<h3>Replace what is already filled in\?<\/h3>/.test(ask) && /Title in Google, Description in Google and Search words are already filled in\./.test(ask) &&
  /id="seo-ask-empty">Fill only the empty ones<\/button>/.test(ask) && /id="seo-ask-all">Replace them as well<\/button>/.test(ask) && ask.indexOf('the team') === -1,
  'replacing what is filled in: asked plainly, never "written by the team"', ask);
MODALS.length = 0; T.askThenWrite(['title'], false);
ok(/<h3>Replace the Title in Google\?<\/h3>/.test(MODALS[0] || '') && /id="seo-ask-all">Replace it<\/button>/.test(MODALS[0] || '') && (MODALS[0] || '').indexOf('seo-ask-empty') === -1,
  'one field: "Replace it", with nothing else to fill', MODALS[0]);

/* ---------- while ETB2B AI writes: the fields it writes wait; what it left out in the fold is shown ---------- */
setUp(DATA);
T.ST.aiBusy = 'ETB2B AI is writing…'; T.ST.aiFields = ['title', 'keywords', 'schemaDescription'];
const busySearch = T.searchHtml(), busySchema = T.schemaHtml();
ok(/id="seo-title"[^>]* readonly[ >]/.test(busySearch) && !/id="seo-description"[^>]* readonly/.test(busySearch) && /id="seo-kw-in"[^>]* readonly>/.test(busySearch) &&
  /data-seo="kw-add" disabled>/.test(busySearch) && /<textarea class="inp" rows="3" id="seo-schemaDescription"[^>]* readonly>/.test(busySchema),
  'the fields being written are read-only meanwhile (the others are not), so nothing typed is replaced unseen');
T.ST.aiBusy = ''; T.ST.aiFields = [];

/* ---------- the checklist the server works out (api-seo.js readiness): counted only what can be done here ---------- */
const { readiness } = require('./api-seo');
function readyOf(x) { return readiness(x).reduce(function (a, i) { a[i.id] = i; return a; }, {}); }
const LONG_DESC = new Array(14).join('Security leaders ').trim();   // over 200 characters, as the team wrote it
const base = { seo: { title: 'QA Summit 2027', description: LONG_DESC, keywords: ['a', 'b'], testimonials: [{ id: 't1', name: 'Priya Nair', text: 'Sharp.', rating: 5 }] },
  head: { description: LONG_DESC.slice(0, 157) + ' …', ogImage: 'https://x/hero.jpg' },
  auto: { h1: { own: '', used: '' }, indexing: { on: false, reason: 'not-live', text: 'On once the site is live (nothing is listed before).' }, dates: { exact: true, label: '18–19 February 2027' }, venue: 'Taj Palace', place: { label: 'New Delhi' }, organizer: { name: 'ETCISO.in', portal: 'ciso' } },
  schema: { event: { '@type': 'Event' }, report: {} }, speakers: [{ id: 's1', counts: true, shown: false }], faqs: [], event: { published: false } };
let R = readyOf(base);
ok(R.description.level === 'warn' && R.description.text === LONG_DESC.length + ' characters: a search result shows about 160', 'a description past 160 characters is said to be cut (measured as written, not as the page already cut it)', R.description);
ok(R.indexing.level === 'info' && R.h1.level === 'info' && R.address.level === 'info' && R.speakers.level === 'info' && R.faqs.level === 'info' && R.reviews.level === 'info' && R.rating.level === 'info',
  'not counted: Show in Google before the site is live, the main heading while the event\'s name stands in, and the optional extras', readiness(base).map(function (i) { return i.id + ':' + i.level; }));
ok(R.reviews.text === 'Not on the site: put the same words in a testimonials section in the site editor', 'a testimonial not on the site: its words are what to put there', R.reviews.text);
ok(R.title.level === 'ok' && R.keywords.level === 'warn' && R.image.level === 'ok' && R.image.text === 'Made when the site is published', 'counted: the title, description and search words, and the share picture (made when the site is published)', R.image);
R = readyOf(Object.assign({}, base, { event: { published: true } }));
ok(R.image.text === 'Being made', 'live, with no card made yet: "Being made"', R.image);
R = readyOf(Object.assign({}, base, { event: { published: true, shareCard: { state: 'ready', url: 'https://x/hero.jpg' } } }));
ok(R.image.text === 'Made automatically', 'the card made and on the page: "Made automatically"', R.image);
R = readyOf(Object.assign({}, base, { seo: Object.assign({}, base.seo, { shareImageUrl: 'https://x/hero.jpg' }), event: { published: true } }));
ok(R.image.text === 'Your own picture', 'the team\'s own picture: said so', R.image);
R = readyOf(Object.assign({}, base, { auto: Object.assign({}, base.auto, { indexing: { on: false, reason: 'test', text: 'Off: its name says it is a test' } }) }));
ok(R.indexing.level === 'warn', 'kept out of Google for a reason the team can change (a test name): counted');

/* ---------- Discard: back to what is saved, the main web address included ---------- */
setUp(DATA);
T.ST.canonOpen = true; T.ST.F.title = 'Changed';
T.discard();
ok(T.ST.canonOpen === false && T.ST.F.title === DATA.seo.title, 'Discard closes the box opened for another address');

/* ---------- one design: the parts' styles do not restyle each other ---------- */
/* each "seo2: <part>" block of edit-event.css: the bare classes it defines (".seo2-x { … }", media queries included) */
const marks = [], re = /\/\* seo2: ([a-z]+)/g;
let m;
while ((m = re.exec(CSS))) marks.push({ part: m[1], at: m.index });
ok(['shell', 'shared', 'search', 'sharing', 'rich'].every(function (p) { return marks.some(function (x) { return x.part === p; }); }), 'the page\'s styles: shell, shared, search, sharing and rich blocks', marks.map(function (x) { return x.part; }));
const owner = {}, clash = [];
marks.forEach(function (b, i) {
  const text = CSS.slice(b.at, i + 1 < marks.length ? marks[i + 1].at : CSS.length).replace(/\/\*[\s\S]*?\*\//g, '');
  const mine = {};
  text.replace(/([^{}]+)\{/g, function (all, sel) {
    sel.split(',').map(function (s) { return s.trim(); }).filter(function (s) { return /^\.seo2-[a-z-]+$/.test(s); }).forEach(function (s) { mine[s] = 1; });
    return all;
  });
  Object.keys(mine).forEach(function (c) { if (owner[c] && owner[c] !== b.part) clash.push(c + ' (' + owner[c] + ' and ' + b.part + ')'); owner[c] = owner[c] || b.part; });
});
ok(!clash.length, 'no bare .seo2- class is defined by two parts (a part-specific rule is scoped under its part\'s root)', clash);
['.seo2-link', '.seo2-lrow', '.seo2-note', '.seo2-hint', '.seo2-group'].forEach(function (c) { ok(owner[c] === 'shared', c + ' is defined once, in the shared block', owner[c]); });
/* both "How it works" (sharing) and "Show N more" (rich) are a <details class="seo2-more">: each is styled under its own
   part's root, never by a rule that reaches the other's */
const bareMore = [];
CSS.replace(/\/\*[\s\S]*?\*\//g, '').replace(/([^{}]+)\{/g, function (all, sel) {
  sel.split(',').map(function (x) { return x.trim(); }).filter(function (x) { return /^\.seo2-more(\[open\])?(\s|>|$|:)/.test(x) && !/\.seo2-more-(show|hide)$/.test(x); }).forEach(function (x) { bareMore.push(x); });
  return all;
});
ok(!bareMore.length && /\.seo2-rich \.seo2-more\{/.test(CSS) && /\.seo2-share \.seo2-more > summary/.test(CSS), 'the two parts\' .seo2-more folds are styled under their own roots (.seo2-rich, .seo2-share)', bareMore);

/* ---------- what ETB2B AI left out inside the closed Advanced fold opens it (async: last) ---------- */
setUp(DATA);
T.ST.advOpen = false;
WRITE = { values: { title: 'New title' }, before: {}, aiWritten: ['title'], dropped: [{ field: 'schemaDescription', why: 'left out: it said “2000+”' }] };
T.writeAi(['title', 'schemaDescription']);
setTimeout(function () {
  ok(T.ST.advOpen === true && T.ST.F.title === 'New title' && /1 field was left out \(see below\)/.test(T.ST.undo.said), 'what ETB2B AI left out inside the closed fold opens it ("see below" is on screen)', T.ST.undo);
  setUp(DATA); T.ST.advOpen = false;
  WRITE = { values: { title: 'New title' }, before: {}, aiWritten: ['title'], dropped: [{ field: 'description', why: 'left out' }] };
  T.writeAi(['title', 'description']);
  setTimeout(function () {
    ok(T.ST.advOpen === false, 'a field left out in the Google result leaves the fold as it was');
    finish();
  }, 0);
}, 0);

function finish() {
  console.log('seo-page: ' + (failed ? 'FAILED ' : 'all ') + passed + ' checks passed' + (failed ? ', ' + failed + ' failed' : ''));
  process.exit(failed ? 1 : 0);
}
