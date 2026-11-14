// node functions/lib/seo-page.test.js — Settings › URL & SEO as ONE page (the four parts put together on 14 Nov 2026,
// owner: "too noisy, it should be neat and clean"): each action once (the heading's Suggest with ETB2B AI and Bring in
// from the previous edition), what search engines read drawn once, one per-field AI action (Suggest again), and every
// name and value the page shows in plain words — a name for every setting the server reports, the What changed list,
// the readiness list's technical lines. The real file runs in a VM with a stub console and the server's answer shape.
// No browser, no network.
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
const run = SRC.replace(EXPORT, 'global.__t = { ST: ST, LABEL: LABEL, view: view, statusHtml: statusHtml, readyHtml: readyHtml, formOf: formOf }; ' + EXPORT);
const win = { addEventListener: function () {}, RevampCore: {} };
vm.runInNewContext(run, { window: win, document: { addEventListener: function () {}, getElementById: function () { return null; } }, setTimeout: function () {} });
const T = win.__t;

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
const ctx = {
  EV: { id: 'qa-page', description: 'Two days for security leaders.', settings: {} }, esc: esc,
  svg: function () { return '<svg></svg>'; }, IC: { star: 'star', info: 'info', image: 'image' },
  vhead: function (t, s, right) { return '<div class="vhead"><h2>' + esc(t) + '</h2><div class="sub">' + esc(s) + '</div>' + (right || '') + '</div>'; },
  panel: function (t, s, b, right) { return '<div class="panel"><div class="panel-head"><h3>' + esc(t) + '</h3>' + (s ? '<span class="sub">' + esc(s) + '</span>' : '') + (right || '') + '</div><div class="panel-body">' + b + '</div></div>'; },
  seo: { imgTag: function (u) { return u ? '<img src="' + esc(u) + '" alt="">' : ''; }, sharePictureField: function () { return '<div class="seo2-share">picture</div>'; } }
};
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

/* ---------- each action once ---------- */
ok((page.match(/data-seo="ai-all"/g) || []).length === 1 && (page.match(/Suggest with ETB2B AI/g) || []).length === 1 && /<div class="vhead">[\s\S]*data-seo="ai-all"/.test(page),
  'Suggest with ETB2B AI: once, in the page\'s heading');
ok((page.match(/data-seo="prev"/g) || []).length === 1 && /<div class="vhead">[\s\S]*data-seo="prev"/.test(page) && page.indexOf('data-seo2-ai') === -1,
  'Bring in from the previous edition: once, in the heading (the testimonials\' own Bring in is data-seo="prev-tm")');
ok((page.match(/<div class="panel-head"><h3>[^<]*<\/h3>(<span class="sub">[^<]*<\/span>)?<\/div>/g) || []).length === (page.match(/<div class="panel-head">/g) || []).length,
  'no panel carries actions in its head');
ok((page.match(/data-seo-ai="/g) || []).length === 2 && (page.match(/>Suggest again<\/button>/g) || []).length === 2 && page.indexOf('btn-ghost btn-sm" type="button" data-seo-ai') === -1,
  'per field, only Suggest again, on the two fields ETB2B AI wrote (title, event name)');
ok((page.match(/What search engines read/g) || []).length === 1 && (page.match(/class="seo2-ld"/g) || []).length === 1, 'what search engines read: drawn once');
ok(/<details class="seo2-adv" id="seo2-adv">/.test(page) && (page.match(/btn-primary/g) || []).length === 1 && /class="btn btn-primary btn-sm" type="button" id="seo-save"/.test(page),
  'the Advanced fold closed, and Save changes the one primary button');

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
ok(/<b>Full address<span class="rv-sr"> — missing<\/span><\/b><span>Search engines get only the venue’s name as its address until the street address and postcode are added\.<\/span>/.test(ready) &&
  /<b>Event details<span class="rv-sr"> — missing<\/span><\/b><span>Search engines may not read all of it \(startDate is not an ISO date\)\.<\/span>/.test(ready) &&
  /<b>Search words<span/.test(ready) && ready.indexOf('PostalAddress') === -1, 'readiness: the technical lines said in plain words (the rest\'s technical words after them)', ready);

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

console.log('seo-page: ' + (failed ? 'FAILED ' : 'all ') + passed + ' checks passed' + (failed ? ', ' + failed + ' failed' : ''));
process.exit(failed ? 1 : 0);
