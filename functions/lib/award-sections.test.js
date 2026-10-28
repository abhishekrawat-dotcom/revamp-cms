// node functions/lib/award-sections.test.js — an award microsite's server-built sections (award-sections.js).
const aw = require('./award-sections');
const { scopeSectionCss, sectionRootInfo } = require('./gen-markup');
const { parseDocument } = require('htmlparser2');
var passed = 0, failed = 0;
function check(name, ok, detail) { if (ok) { passed++; return; } failed++; console.error('FAIL ' + name + (detail ? ' — ' + detail : '')); }

/* ---------- helpers ---------- */
function rootOf(html) { return parseDocument(html).children.filter(function (n) { return n.type === 'tag'; })[0]; }
function all(node, fn, out) {
  out = out || [];
  (node.children || []).forEach(function (n) { if (n.type === 'tag') { if (fn(n)) out.push(n); all(n, fn, out); } });
  return out;
}
function textOf(node) { return (node.children || []).map(function (n) { return n.type === 'text' ? n.data : textOf(n); }).join(''); }
/* every literal colour or font a stylesheet names, outside the partner logo plate (drawn for white, on purpose) */
function literals(css) {
  var outside = css.replace(/\.aw-prt-logo(?: span)?\{[^}]*\}/g, '');
  return (outside.match(/#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(|:\s*(?:white|black)\b|font-family:(?!var\()/gi) || []);
}
function headingLevels(html) { return (html.match(/<h([1-6])\b/g) || []).map(function (h) { return +h.charAt(2); }); }
function inOrder(levels, start) {
  var prev = start - 1;
  return levels.every(function (l) { var ok = l <= prev + 1; prev = l; return ok; });
}
var NOW = Date.UTC(2026, 9, 23, 6, 0);   // 23 October 2026, 11:30 IST

var award = {
  dates: { nominationOpen: '2026-09-01 00:00:00', earlyBird: '2026-10-15 23:59:00', nominationClose: '2026-11-30 00:00:00', ceremony: 'February 2027' },
  categories: [
    { name: 'Digital Transformation', slug: 'digital-transformation', description: 'Organisations that rebuilt how they work.', isNew: false,
      fee: { paid: true, amount: 25000, currency: 'INR' },
      subcategories: [
        { name: 'AI in Operations', slug: 'ai-ops', description: 'AI that runs in production.', isNew: true, fee: { paid: true, amount: 2000, currency: 'INR' } },
        { name: 'Cloud <script>alert(1)</script>', slug: 'cloud', description: 'Moving to the cloud & back', isNew: false, fee: { paid: false } },
        { name: 'Data Platforms', slug: 'data', description: '', fee: null }
      ] },
    { name: 'CIO of the Year', slug: 'cio-of-the-year', description: 'Leaders.', isNew: true, fee: { paid: true, amount: 150000, currency: 'INR' }, subcategories: [] },
    { name: 'Digital Transformation', slug: 'digital-transformation', description: 'Same slug again', subcategories: [{ name: 'Global', fee: { paid: true, amount: 500, currency: 'USD' } }] }
  ],
  jury: [
    { group: 'Assessment Jury', people: [{ name: 'Meera Iyer', title: 'Partner', company: 'Firm', photo: 'https://img.etb2bimg.com/m.jpg' }] },
    { group: 'Grand Jury', people: [
      { name: 'Anita Rao', title: 'CIO', company: 'Bank', photo: 'https://img.etb2bimg.com/a.jpg', bio: 'Thirty years in banking.', linkedin: 'https://www.linkedin.com/in/anita' },
      { name: 'Vikram <img src=x onerror=alert(1)>', title: 'CTO', company: 'Telco', photo: 'http://insecure/x.jpg', linkedin: 'javascript:alert(1)' },
      { name: 'Priya Nair', title: 'CDO', company: 'Retail' }, { name: 'Kavita Shah', title: 'MD', company: 'Pharma' }, { name: 'Ritu Singh', title: 'CEO', company: 'Auto' }, { name: '' }
    ] }
  ],
  partners: [
    { group: 'Knowledge Partner', items: [{ name: 'Advisory Co', logo: 'https://img.etb2bimg.com/p1.png', url: 'https://advisory.example' }] },
    { group: 'Supporting Partners', items: [{ name: 'No Logo Co', logo: '', url: '' }, { name: 'Bad', logo: 'javascript:alert(1)' }, { name: '', logo: '' }] },
    { group: 'Empty', items: [] }
  ]
};
var o = { edition: 'ETCIO Awards 2027', now: NOW, pages: true };

/* ---------- home: ET's award design (seven of ET's own award sites, 28 Oct 2026) ---------- */
var home = aw.homeSections(award, o);
function byId(list, id) { return list.filter(function (x) { return x.id === id; })[0] || null; }
var ORDER = 'award-band,key-dates,award-categories,how-it-works,award-jury,recognition,awards-night,award-partners,faqs';
check('home: ET\'s sections, in order', home.map(function (s) { return s.id; }).join() === ORDER, home.map(function (s) { return s.id; }).join());
check('home: prebuilt kinds', home.map(function (s) { return s.prebuilt; }).join() === 'award-band,award-key-dates,award-categories,award-process,award-jury,award-recognition,award-ceremony,award-partners,award-faqs');
check('home: plan fields', home.every(function (s) { return s.kind === 'custom' && s.image === '' && s.name && s.purpose && s.layout && s.html && s.css; }));
/* over a photograph, white words under a dark veil are right in every theme (as a partner's white plate is) */
var ON_PHOTO = { 'how-it-works': 1, 'awards-night': 1 };
home.forEach(function (s) {
  var r = rootOf(s.html), band = s.id === 'award-band';
  check('home ' + s.id + ': root is <section id data-rv-section-id>', r.name === 'section' && r.attribs.id === s.id && r.attribs['data-rv-section-id'] === s.id, JSON.stringify(r.attribs));
  check('home ' + s.id + ': no data-rv-page', !('data-rv-page' in r.attribs) && s.html.indexOf('data-rv-page=') === -1);
  if (band) check('home award-band: named for readers', r.attribs['aria-label'] === 'Award categories');
  else check('home ' + s.id + ': labelled by its heading', r.attribs['aria-labelledby'] === s.id + '-title' && s.html.indexOf('id="' + s.id + '-title"') !== -1);
  var lit = literals(s.css).filter(function (x) { return !(ON_PHOTO[s.id] && /^(#ffffff|rgba\()/.test(x)); });
  check('home ' + s.id + ': no literal colour or font (but white on a photograph)', lit.length === 0, lit.join(' '));
  if (!band) {
    check('home ' + s.id + ': headings h2 then h3', inOrder(headingLevels(s.html), 2) && headingLevels(s.html)[0] === 2, headingLevels(s.html).join());
    check('home ' + s.id + ': uses the page variables', /var\(--rv-text\)/.test(s.css) && /var\(--heading-font-family\)/.test(s.css) && /var\(--body-font-family\)/.test(s.css));
  }
  if (!band && s.id !== 'awards-night') check('home ' + s.id + ': eyebrow with the edition', s.html.indexOf('>ETCIO Awards 2027') !== -1);
  if (!band && s.id !== 'award-categories') check('home ' + s.id + ': heading size from rv-type', s.css.indexOf('font-size:clamp(1.75rem,3vw,2.375rem)') !== -1);
  var sc = scopeSectionCss(s.css, s.id, sectionRootInfo(s.html));
  check('home ' + s.id + ': scoped like any other section', /\[data-rv-section="/.test(sc) && sc.length > s.css.length / 2);
  check('home ' + s.id + ': no text in an attribute value besides alt / labels', !/\b(?:title|data-label|placeholder)="/.test(s.html));
  check('home ' + s.id + ': CSS content is never text', (s.css.match(/(?:^|[;{])content:([^;}]*)/g) || []).every(function (x) { return /content:(""|counter\()/.test(x); }), (s.css.match(/(?:^|[;{])content:([^;}]*)/g) || []).join(' '));
});

/* the band of category names */
var bd = byId(home, 'award-band');
check('band: master and sub-category names, twice for the loop (the copy hidden from readers)', (bd.html.match(/<ul class="aw-band-run"/g) || []).length === 2 && bd.html.indexOf('aria-hidden="true"') !== -1 && bd.html.indexOf('CIO of the Year') !== -1);
check('band: still for those who ask for less motion', /prefers-reduced-motion:reduce\)\{\.aw-band-track\{animation:none/.test(bd.css));
check('band: fewer than three names -> no band', !byId(aw.homeSections({ categories: [{ name: 'A' }, { name: 'B' }] }, o), 'award-band'));

/* key dates: numbered date cards, the current stage lit, "Coming soon" until a date is set */
var kd = byId(home, 'key-dates').html;
check('dates: five steps when the early bird is known', (kd.match(/class="aw-kd-step/g) || []).length === 5);
check('dates: the day large, the month and year under it', /<p class="aw-kd-day">1<\/p><p class="aw-kd-when">September 2026<\/p>/.test(kd) && /<p class="aw-kd-day">15<\/p><p class="aw-kd-when">October 2026<\/p>/.test(kd) && !/\d{2}:\d{2}/.test(kd));
check('dates: a month label kept whole', kd.indexOf('>February 2027<') !== -1);
check('dates: the step names', ['Nominations Open', 'Early Bird Deadline', 'Nomination Deadline', 'Jury Meet', 'Awards Night'].every(function (n) { return kd.indexOf('>' + n + '</h3>') !== -1; }));
check('dates: an unknown date is "Coming soon"', /Coming soon<\/p><h3 class="aw-kd-name">Jury Meet<\/h3>/.test(kd));
check('dates: past ones done', (kd.match(/aw-kd-step is-done/g) || []).length === 2, (kd.match(/aw-kd-step[^"]*/g) || []).join(' | '));
check('dates: the next one marked current', /aw-kd-step is-next" aria-current="step"[^]*?Nomination Deadline/.test(kd) && (kd.match(/aria-current/g) || []).length === 1);
check('dates: numbered', kd.indexOf('<p class="aw-kd-no">01</p>') !== -1 && kd.indexOf('<p class="aw-kd-no">05</p>') !== -1);
check('dates: an ordered list', /<ol class="aw-kd-list">/.test(kd));
var later = byId(aw.homeSections({ dates: { nominationOpen: '2026-09-01 00:00:00', nominationClose: '2026-10-01', ceremony: '2026-10-20 18:30:00' } }, o), 'key-dates').html;
check('dates: a step with no date before a done one is done too', (later.match(/is-done/g) || []).length === 4 && later.indexOf('aria-current') === -1);
check('dates: the early bird left out when not given', (later.match(/class="aw-kd-step/g) || []).length === 4 && later.indexOf('Early Bird') === -1);
var deadlineDay = byId(aw.homeSections({ dates: { nominationClose: '2026-10-23 00:00:00' } }, o), 'key-dates').html;
check('dates: a deadline of today is not over until the day ends (IST)', deadlineDay.indexOf('is-done') === -1 && aw.dateOf('2026-10-23 00:00:00').at > NOW && aw.dateOf('2026-10-22').at < NOW && aw.dateOf('2026-10-23 10:00:00').at < NOW && aw.dateOf('2026-10-23 12:00:00').at > NOW);
check('dates: "Coming soon" only where unknown', (deadlineDay.match(/Coming soon/g) || []).length === 3);
check('dates: a dateLabel of the caller wins', byId(aw.homeSections({ dates: { ceremony: '2027-02-12 18:00:00' } }, { now: NOW, dateLabel: function () { return '12 Feb 2027, Mumbai'; } }), 'key-dates').html.indexOf('>Feb 2027, Mumbai<') !== -1);
check('dates: a dateLabel that fails falls back', byId(aw.homeSections({ dates: { ceremony: '2027-02-12' } }, { now: NOW, dateLabel: function () { throw new Error('x'); } }), 'key-dates').html.indexOf('>February 2027<') !== -1);
check('dates: other spellings', aw.dateOf('5th Jan 2027').label === '5 January 2027' && aw.dateOf('sept 2027').label === 'September 2027' && aw.dateOf('Third week of January').label === 'Third week of January' && isNaN(aw.dateOf('Third week of January').at));
var noDates = byId(aw.homeSections({ dates: {} }, o), 'key-dates').html;
check('dates: none known -> the steps, each "Coming soon" (as ET shows them)', (noDates.match(/Coming soon/g) || []).length === 4 && noDates.indexOf('aria-current="step"') !== -1);
check('dates: a hostile label is text', byId(aw.homeSections({ dates: { ceremony: '<b onmouseover=x>soon</b>' } }, o), 'key-dates').html.indexOf('&lt;b onmouseover=x&gt;soon&lt;/b&gt;') !== -1);

/* categories: ET's count over icon cards */
var cs = byId(home, 'award-categories').html;
check('categories: one card per master, each with an icon', (cs.match(/class="aw-cat-card"/g) || []).length === 3 && (cs.match(/class="aw-cat-ic"><svg/g) || []).length === 3);
check('categories: the big count, the sub-categories under it', cs.indexOf('<span class="aw-cat-n">3</span> Master Categories</h2>') !== -1 && cs.indexOf('>4+ Sub-Categories</p>') !== -1);
check('categories: each card\'s own count', cs.indexOf('>3 categories</p>') !== -1 && cs.indexOf('>1 category</p>') !== -1);
check('categories: New badge on a new master only', (cs.match(/class="aw-cat-new">New</g) || []).length === 1);
check('categories: the link to the full list', cs.indexOf('<a class="aw-cat-btn" data-rv-page-link="award-category" href="award-category">View all categories</a>') !== -1);
check('categories: a master named <script> stays text', byId(aw.homeSections({ categories: [{ name: '<script>alert(1)</script>' }] }, o), 'award-categories').html.indexOf('&lt;script&gt;alert(1)&lt;/script&gt;') !== -1);
check('categories: nameless ones out, none -> no section', !byId(aw.homeSections({ categories: [{ name: '' }, null] }, o), 'award-categories'));

/* how our awards work */
var hw = byId(home, 'how-it-works');
check('how: ET\'s three principles and three stages', ['Judging Criteria', 'Persistent Fairness &amp; Integrity', 'Confidentiality', 'Scrutiny by Expert Tabulator', 'Thorough Review Process', 'Grand Jury'].every(function (n) { return hw.html.indexOf('>' + n + '</h3>') !== -1; }));
var hwPhotos = byId(aw.homeSections({}, { edition: 'E', photos: ['https://img.etb2bimg.com/1.jpg', 'http://x/2.jpg', 'https://img.etb2bimg.com/3.jpg'] }), 'how-it-works').html;
check('how: the stages on the edition\'s photos, an http one never', (hwPhotos.match(/class="aw-how-ph"/g) || []).length === 2 && hwPhotos.indexOf('http://x') === -1 && (hw.html.match(/aw-how-stage-plain/g) || []).length === 3);

/* jury: ET's portraits, five to a row */
var jh = byId(home, 'award-jury').html;
check('jury: the Grand Jury, wherever it stands', jh.indexOf('>Grand Jury</h2>') !== -1 && jh.indexOf('Meera Iyer') === -1);
check('jury: nameless jurors out', (jh.match(/class="aw-jury-card"/g) || []).length === 5);
check('jury: a grid, never a moving row', jh.indexOf('data-rv-carousel') === -1 && jh.indexOf('class="aw-jury-grid"') !== -1 && /\.aw-jury-grid\{display:grid;grid-template-columns:repeat\(5/.test(byId(home, 'award-jury').css));
var onePage = aw.homeSections(award, { edition: 'ETCIO Awards 2027', now: NOW });
check('a one-page site (no internal pages): no link to a page', onePage.every(function (x) { return x.html.indexOf('data-rv-page-link') === -1; }));
check('jury: Meet the jury link', jh.indexOf('<a class="aw-jury-btn" data-rv-page-link="award-jury" href="award-jury">Meet the jury</a>') !== -1);
var manyJury = { jury: [{ group: 'Grand Jury', people: Array.apply(null, Array(14)).map(function (_, i) { return { name: 'J' + i }; }) }] };
var mj = byId(aw.homeSections(manyJury, o), 'award-jury').html;
check('jury: ten on the home page, the rest on the Jury page', (mj.match(/class="aw-jury-card"/g) || []).length === 10 && mj.indexOf('>Meet the full jury</a>') !== -1);
check('jury: a one-page site shows them all', (byId(aw.homeSections(manyJury, { edition: 'E' }), 'award-jury').html.match(/class="aw-jury-card"/g) || []).length === 14);
check('jury: profile template with bio and LinkedIn', jh.indexOf('<template data-rv-profile><span data-rv-profile-for hidden>Anita Rao</span><p data-rv-profile-bio>Thirty years in banking.</p><a data-rv-profile-li href="https://www.linkedin.com/in/anita"') !== -1);
check('jury: no template without bio or a safe link', (jh.match(/<template/g) || []).length === 1);
check('jury: a hostile name stays text, an http photo and a javascript: link dropped', jh.indexOf('<img src=x') === -1 && jh.indexOf('Vikram &lt;img src=x onerror=alert(1)&gt;') !== -1 && jh.indexOf('http://insecure') === -1 && jh.indexOf('javascript:') === -1);
check('jury: initials where there is no photo', jh.indexOf('<span aria-hidden="true">PN</span>') !== -1);
check('jury: popup hooks', /data-rv-profile-name>Anita Rao<\/h3><p class="aw-jury-role" data-rv-profile-role>CIO<\/p><p class="aw-jury-co" data-rv-profile-co>Bank<\/p>/.test(jh));
check('jury: "Jury" when unnamed', byId(aw.homeSections({ jury: [{ group: '', people: [{ name: 'One' }] }] }, o), 'award-jury').html.indexOf('>Jury</h2>') !== -1);
check('jury: none -> no section', !byId(aw.homeSections({ jury: [{ group: 'Grand Jury', people: [{ name: '' }] }] }, o), 'award-jury'));

/* the two calls to act */
var rc = byId(home, 'recognition').html, cer = byId(aw.homeSections({}, { edition: 'E', dateLabel: '20 January 2027', place: 'Mumbai' }), 'awards-night').html;
check('calls: enter (the award\'s main button) and the night (a seat)', /<a class="aw-rec-btn" href="#hero" data-register-cta>Nominate Now<\/a>/.test(rc) && /<a class="aw-cer-btn" href="#hero" data-register-cta>Get Tickets<\/a>/.test(cer));
check('calls: the night\'s date and venue', cer.indexOf('<span>20 January 2027</span><span>Mumbai</span>') !== -1);

/* partners */
var pt = byId(home, 'award-partners').html;
check('partners: groups with headings, empty groups out', pt.indexOf('>Knowledge Partner</h3>') !== -1 && pt.indexOf('>Supporting Partners</h3>') !== -1 && pt.indexOf('Empty') === -1);
check('partners: logo linked on https', pt.indexOf('<a href="https://advisory.example" target="_blank" rel="noopener"><img src="https://img.etb2bimg.com/p1.png" alt="Advisory Co"') !== -1);
check('partners: a name where there is no logo, a bad logo is a name', pt.indexOf('<span>No Logo Co</span>') !== -1 && pt.indexOf('<span>Bad</span>') !== -1 && pt.indexOf('javascript:') === -1);
check('partners: nothing named and no logo is left out', (pt.match(/class="aw-prt-logo"/g) || []).length === 3);
check('partners: the logo plate is white whatever the theme, and kept', /\.aw-prt-logo\{--rv-keep:1;[^}]*background:#ffffff/.test(byId(home, 'award-partners').css));
check('partners: none -> no section', !byId(aw.homeSections({ partners: [{ group: 'X', items: [] }] }, o), 'award-partners'));

/* the home page's questions: the FAQ records, five shown, the rest on their page */
var fh = byId(home, 'faqs');
check('faqs: bound to the FAQ records (question t, answer d)', /<details class="aw-fq-item" data-rv-repeat-template="faq"><summary class="aw-fq-q"><span class="aw-fq-qtext" data-rv-field="t">/.test(fh.html) && fh.html.indexOf('data-rv-field="d"') !== -1);
check('faqs: only the first five shown', fh.css.indexOf('.aw-fq-items > .aw-fq-item:nth-child(n+6 of .aw-fq-item){display:none}') !== -1);
check('faqs: "View all FAQs" only when there are more than five', fh.html.indexOf('data-rv-page-link="award-faq" href="award-faq">View all FAQs</a>') !== -1 && fh.css.indexOf('.aw-fq-more{display:none}') !== -1 && fh.css.indexOf('.aw-fq:has(.aw-fq-items > .aw-fq-item:nth-child(6 of .aw-fq-item)) .aw-fq-more{display:block}') !== -1);

/* always there */
check('home: with no records, ET\'s standing sections only', aw.homeSections(null).map(function (s) { return s.id; }).join() === 'key-dates,how-it-works,recognition,awards-night,faqs' && aw.homeSections({ categories: 'x', jury: {}, partners: null }).length === 5);
check('home: no edition -> no edition in the eyebrows', aw.homeSections({ categories: [{ name: 'A' }] }, {}).every(function (s) { return s.html.indexOf('undefined') === -1; }) && byId(aw.homeSections({ categories: [{ name: 'A' }] }, {}), 'award-categories').html.indexOf('-eyebrow') === -1);

/* ---------- fees ---------- */
check('fee: INR in Indian grouping', aw.feeText({ paid: true, amount: 2000, currency: 'INR' }) === 'Nomination fee: ₹2,000' && aw.feeText({ paid: true, amount: 150000, currency: 'INR' }) === 'Nomination fee: ₹1,50,000' && aw.feeText({ paid: true, amount: '1,00,000', currency: '' }) === 'Nomination fee: ₹1,00,000');
check('fee: free', aw.feeText({ paid: false }) === 'No nomination fee' && aw.feeText({ paid: false, amount: 2000 }) === 'No nomination fee' && aw.feeText({ amount: 0 }) === 'No nomination fee');
check('fee: other currencies', aw.feeText({ paid: true, amount: 500, currency: 'USD' }) === 'Nomination fee: $500' && aw.feeText({ paid: true, amount: 1250.5, currency: 'aed' }) === 'Nomination fee: AED 1,250.50');
check('fee: unknown', aw.feeText(null) === '' && aw.feeText({}) === '' && aw.feeText('2000') === '' && aw.feeText({ paid: true }) === 'Nomination fee applies');

/* ---------- internal pages ---------- */
check('PAGE_KINDS: the six pages in order, slug and title', JSON.stringify(aw.PAGE_KINDS.map(function (p) { return [p.kind, p.slug, p.title]; })) === JSON.stringify([
  ['award-category', 'award-category', 'Award Categories'], ['award-guidelines', 'award-guidelines', 'Entry Guidelines'],
  ['award-judging-criteria', 'award-judging-criteria', 'Judging Criteria'], ['award-jury', 'award-jury', 'Jury'],
  ['award-faq', 'award-faq', 'FAQs'], ['award-tnc', 'award-tnc', 'Terms & Conditions']]));

var TEXT = {
  title: 'Entry Guidelines', intro: 'Read these before you nominate.',
  blocks: [
    { heading: 'How to nominate', paragraphs: ['Four steps.'], bullets: ['1. Register on the site', '2) Pick a category', 'Step 3: Fill the form', '4 - Pay the fee'] },
    { heading: 'Eligibility', paragraphs: ['Indian organisations only.', 'Second paragraph.'], bullets: ['Operating in India', 'Projects live by 30 June <2026>'] },
    { heading: '', paragraphs: [], bullets: [] }
  ]
};
var FAQ = [
  { q: 'Who can nominate?', a: 'Any organisation.\n\nSelf-nominations are welcome.', group: 'Nominations' },
  { q: 'Is there a fee?', a: 'Yes, per category.', group: 'Fees' },
  { q: 'Can I nominate twice?', a: 'Yes.', group: 'Nominations' },
  { q: 'Ungrouped <b>q</b>', a: 'An answer.' },
  { q: 'No answer', a: '' }
];
var pages = {
  'award-category': aw.pageSections('award-category', award.categories, o),
  'award-jury': aw.pageSections('award-jury', award.jury, o),
  'award-guidelines': aw.pageSections('award-guidelines', TEXT, o),
  'award-judging-criteria': aw.pageSections('award-judging-criteria', { title: 'How the jury judges', blocks: [{ heading: 'Criteria', bullets: ['Impact', 'Innovation'] }] }, o),
  'award-tnc': aw.pageSections('award-tnc', { blocks: [{ paragraphs: ['The organiser’s decision is final.'] }] }, o),
  'award-faq': aw.pageSections('award-faq', FAQ, o)
};
Object.keys(pages).forEach(function (kind) {
  var secs = pages[kind];
  check(kind + ': a header and a body', secs.length === 2, secs.map(function (s) { return s.id; }).join());
  check(kind + ': the header first', secs[0].id === kind + '-header');
  check(kind + ': header has the title (h1) and the event name only', /<h1 class="aw-ph-title" id="[^"]+">[^<]+<\/h1>/.test(secs[0].html) && secs[0].html.indexOf('>ETCIO Awards 2027</p>') !== -1 && (secs[0].html.match(/<(?:a|img|button)\b/g) || []).length === 0);
  secs.forEach(function (s) {
    var r = rootOf(s.html);
    check(kind + ' ' + s.id + ': root section with id, data-rv-section-id and data-rv-page', r.name === 'section' && r.attribs.id === s.id && r.attribs['data-rv-section-id'] === s.id && r.attribs['data-rv-page'] === kind, JSON.stringify(r.attribs));
    check(kind + ' ' + s.id + ': labelled by a heading inside', s.html.indexOf('id="' + s.id + '-title"') !== -1 && r.attribs['aria-labelledby'] === s.id + '-title');
    check(kind + ' ' + s.id + ': no literal colour or font', literals(s.css).length === 0, literals(s.css).join(' '));
    check(kind + ' ' + s.id + ': name, html, css', s.name && s.html && s.css);
    var sc = scopeSectionCss(s.css, s.id, sectionRootInfo(s.html));
    check(kind + ' ' + s.id + ': scoped like any other section', /\[data-rv-section="/.test(sc));
    check(kind + ' ' + s.id + ': CSS content is never text', (s.css.match(/(?:^|[;{])content:([^;}]*)/g) || []).every(function (x) { return /content:(""|counter\(|visible)/.test(x); }), (s.css.match(/(?:^|[;{])content:([^;}]*)/g) || []).join(' '));
  });
  var levels = headingLevels(secs.map(function (s) { return s.html; }).join(''));
  check(kind + ': headings in order from h1', levels[0] === 1 && inOrder(levels, 1), levels.join());
  var ids = secs.map(function (s) { return s.html; }).join('').match(/\sid="[^"]+"/g) || [];
  check(kind + ': ids unique on the page', ids.length === new Set(ids).size, ids.join(' '));
});
check('pages: a hostile edition is text', aw.pageSections('award-faq', FAQ, { edition: '<script>x</script>' })[0].html.indexOf('&lt;script&gt;x&lt;/script&gt;') !== -1);
check('pages: the title can be given', aw.pageSections('award-jury', award.jury, { title: 'Our Jury' })[0].html.indexOf('>Our Jury</h1>') !== -1);
check('pages: a text page takes its own title', pages['award-judging-criteria'][0].html.indexOf('>How the jury judges</h1>') !== -1 && pages['award-tnc'][0].html.indexOf('>Terms &amp; Conditions</h1>') !== -1);
check('pages: unknown kind -> nothing', aw.pageSections('award-gallery', [1], o).length === 0);
['award-category', 'award-jury', 'award-faq', 'award-guidelines', 'award-judging-criteria', 'award-tnc'].forEach(function (k) {
  /* the FAQ page is the event's FAQ records, so it stands whatever was written for it (the records may come later) */
  if (k === 'award-faq') check(k + ': always a page, bound to the records', aw.pageSections(k, null, o).length === 2 && aw.pageSections(k, [], o)[1].html.indexOf('data-rv-repeat-template="faq"') !== -1);
  else check(k + ': empty -> no page', aw.pageSections(k, null, o).length === 0 && aw.pageSections(k, [], o).length === 0 && aw.pageSections(k, {}, o).length === 0 && aw.pageSections(k, { blocks: [] }, o).length === 0);
});

/* categories page */
var cl = pages['award-category'][1].html;
check('category page: every master, h2 each', (cl.match(/<h2 class="aw-cl-mname">/g) || []).length === 3);
check('category page: every sub with its description, h3 each', (cl.match(/<h3 class="aw-cl-sname">/g) || []).length === 4 && cl.indexOf('>AI that runs in production.</p>') !== -1);
check('category page: New badges', (cl.match(/class="aw-cl-new">New</g) || []).length === 2);
check('category page: fee lines', cl.indexOf('>Nomination fee: ₹2,000</p>') !== -1 && cl.indexOf('>No nomination fee</p>') !== -1 && cl.indexOf('>Nomination fee: ₹1,50,000</p>') !== -1 && cl.indexOf('>Nomination fee: $500</p>') !== -1);
check('category page: a sub without its own fee takes the master\'s', /Data Platforms<\/h3><\/div><p class="aw-cl-fee">Nomination fee: ₹25,000<\/p>/.test(cl));
check('category page: the index links to each master, ids unique', cl.indexOf('<a href="#award-cat-digital-transformation">') !== -1 && cl.indexOf('<a href="#award-cat-digital-transformation-2">') !== -1 && cl.indexOf('id="award-cat-digital-transformation-2"') !== -1 && /<nav class="aw-cl-index" aria-label="Master categories">/.test(cl));
check('category page: index sticks', /\.aw-cl-index\{position:sticky/.test(pages['award-category'][1].css));
check('category page: a hostile sub-category name is text', cl.indexOf('Cloud &lt;script&gt;alert(1)&lt;/script&gt;') !== -1 && cl.indexOf('<script>') === -1 && cl.indexOf('cloud &amp; back') !== -1);
check('category page: one master -> no index', aw.pageSections('award-category', [{ name: 'Only' }], o)[1].html.indexOf('aw-cl-index') === -1);

/* jury page */
var jp = pages['award-jury'][1].html;
check('jury page: groups as h2, in their order', /Assessment Jury<\/h2>[^]*Grand Jury<\/h2>/.test(jp));
check('jury page: every named juror, a card each', (jp.match(/class="aw-jp-card"/g) || []).length === 6);
check('jury page: profile pop-ups', jp.indexOf('<template data-rv-profile>') !== -1 && /data-rv-profiles/.test(jp));

/* text pages */
var gl = pages['award-guidelines'][1].html;
check('text page: the intro, then blocks with headings', gl.indexOf('<p class="aw-tx-lead" data-rv-reveal>Read these before you nominate.</p>') !== -1 && (gl.match(/<h2 class="aw-tx-h"/g) || []).length === 2);
check('text page: steps numbered, their own numbers taken off', /<ol class="aw-tx-steps"><li>Register on the site<\/li><li>Pick a category<\/li><li>Fill the form<\/li><li>Pay the fee<\/li><\/ol>/.test(gl), gl);
check('text page: plain points as bullets, escaped', /<ul class="aw-tx-bullets"><li>Operating in India<\/li><li>Projects live by 30 June &lt;2026&gt;<\/li><\/ul>/.test(gl));
check('text page: paragraphs', gl.indexOf('<p class="aw-tx-p">Second paragraph.</p>') !== -1);
check('text page: an empty block left out', (gl.match(/class="aw-tx-block"/g) || []).length === 2);
check('text page: column at most ~760px of text', /\.aw-tx-in\{max-width:808px[^}]*padding:0 24px/.test(pages['award-guidelines'][1].css));
check('text page: a "steps" heading numbers plain points', aw.pageSections('award-guidelines', { blocks: [{ heading: 'Process', bullets: ['A', 'B'] }] }, o)[1].html.indexOf('<ol class="aw-tx-steps">') !== -1);
check('text page: no heading -> a hidden one labels it', pages['award-tnc'][1].html.indexOf('<h2 class="aw-tx-sr" id="award-tnc-body-title">Terms &amp; Conditions</h2>') !== -1);

/* faq: every FAQ record of the event, as the home page's first five */
var fq = pages['award-faq'][1].html;
check('faq: bound to the FAQ records (question t, answer d), every one shown', /<details class="aw-faq-item" data-rv-repeat-template="faq"><summary class="aw-faq-q"><span class="aw-faq-qtext" data-rv-field="t">/.test(fq) && fq.indexOf('data-rv-field="d"') !== -1 && pages['award-faq'][1].css.indexOf('nth-child') === -1);
check('faq: the written questions are not frozen into the page (the records carry them)', fq.indexOf('Who can nominate?') === -1);
check('faq: the marker icon is hidden from readers', /<svg class="aw-faq-icon"[^>]*aria-hidden="true"/.test(fq));
check('faq: a hidden heading labels the list', fq.indexOf('<h2 class="aw-faq-sr" id="award-faq-list-title">') !== -1);
check('faq: answers keep their line breaks', /\.aw-faq-a p\{[^}]*white-space:pre-line/.test(pages['award-faq'][1].css));
check('faq: answers closed until asked for (no rule that opens them on the live page)', !/details-content|\[open\]\s*\{?display/.test(pages['award-faq'][1].css) && fq.indexOf('<details class="aw-faq-item" open') === -1);

console.log((failed ? 'FAILED ' : 'ok ') + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
