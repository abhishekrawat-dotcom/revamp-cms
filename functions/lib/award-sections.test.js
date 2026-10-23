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

/* ---------- home ---------- */
var home = aw.homeSections(award, o);
check('home: the four sections, in order', home.map(function (s) { return s.id; }).join() === 'key-dates,award-categories,award-jury,award-partners', home.map(function (s) { return s.id; }).join());
check('home: prebuilt kinds', home.map(function (s) { return s.prebuilt; }).join() === 'award-key-dates,award-categories,award-jury,award-partners');
check('home: plan fields', home.every(function (s) { return s.kind === 'custom' && s.image === '' && s.name && s.purpose && s.layout && s.html && s.css; }));
home.forEach(function (s) {
  var r = rootOf(s.html);
  check('home ' + s.id + ': root is <section id data-rv-section-id>', r.name === 'section' && r.attribs.id === s.id && r.attribs['data-rv-section-id'] === s.id, JSON.stringify(r.attribs));
  check('home ' + s.id + ': no data-rv-page', !('data-rv-page' in r.attribs) && s.html.indexOf('data-rv-page=') === -1);
  check('home ' + s.id + ': labelled by its heading', r.attribs['aria-labelledby'] === s.id + '-title' && s.html.indexOf('id="' + s.id + '-title"') !== -1);
  check('home ' + s.id + ': no literal colour or font', literals(s.css).length === 0, literals(s.css).join(' '));
  check('home ' + s.id + ': headings h2 then h3', inOrder(headingLevels(s.html), 2) && headingLevels(s.html)[0] === 2, headingLevels(s.html).join());
  check('home ' + s.id + ': uses the page variables', /var\(--rv-text\)/.test(s.css) && /var\(--heading-font-family\)/.test(s.css) && /var\(--body-font-family\)/.test(s.css));
  check('home ' + s.id + ': eyebrow with the edition', s.html.indexOf('>ETCIO Awards 2027</p>') !== -1);
  check('home ' + s.id + ': heading size from rv-type', s.css.indexOf('font-size:clamp(1.75rem,3vw,2.375rem)') !== -1);
  var sc = scopeSectionCss(s.css, s.id, sectionRootInfo(s.html));
  check('home ' + s.id + ': scoped like any other section', /\[data-rv-section="/.test(sc) && sc.length > s.css.length / 2);
  check('home ' + s.id + ': no text in an attribute value besides alt / labels', !/\b(?:title|data-label|placeholder)="/.test(s.html));
  check('home ' + s.id + ': CSS content is never text', (s.css.match(/(?:^|[;{])content:([^;}]*)/g) || []).every(function (x) { return /content:(""|counter\()/.test(x); }), (s.css.match(/(?:^|[;{])content:([^;}]*)/g) || []).join(' '));
});

/* key dates */
var kd = home[0].html;
check('dates: five steps when the early bird is known', (kd.match(/class="aw-kd-step/g) || []).length === 5);
check('dates: Indian English, time dropped', kd.indexOf('>1 September 2026<') !== -1 && kd.indexOf('>15 October 2026<') !== -1 && kd.indexOf('>30 November 2026<') !== -1 && !/\d{2}:\d{2}/.test(kd));
check('dates: a month label kept', kd.indexOf('>February 2027<') !== -1);
check('dates: the step names', ['Nominations open', 'Early bird deadline', 'Nomination deadline', 'Jury evaluation', 'Awards night'].every(function (n) { return kd.indexOf('>' + n + '</h3>') !== -1; }));
check('dates: an unknown date is "To be announced"', /Jury evaluation<\/h3><p class="aw-kd-date">To be announced<\/p>/.test(kd));
check('dates: past ones done', (kd.match(/aw-kd-step is-done/g) || []).length === 2, (kd.match(/aw-kd-step[^"]*/g) || []).join(' | '));
check('dates: the next one marked current', /aw-kd-step is-next" aria-current="step"[^]*?Nomination deadline/.test(kd) && (kd.match(/aria-current/g) || []).length === 1);
check('dates: done steps carry a check', (kd.match(/<svg/g) || []).length === 2);
check('dates: an ordered list', /<ol class="aw-kd-list">/.test(kd));
var later = aw.homeSections({ dates: { nominationOpen: '2026-09-01 00:00:00', nominationClose: '2026-10-01', ceremony: '2026-10-20 18:30:00' } }, o)[0].html;
check('dates: a step with no date before a done one is done too', (later.match(/is-done/g) || []).length === 4 && /Jury evaluation<\/h3><p class="aw-kd-date">Completed/.test(later) && later.indexOf('aria-current') === -1);
check('dates: the early bird left out when not given', (later.match(/class="aw-kd-step/g) || []).length === 4 && later.indexOf('Early bird') === -1);
var deadlineDay = aw.homeSections({ dates: { nominationClose: '2026-10-23 00:00:00' } }, o)[0].html;
check('dates: a deadline of today is not over until the day ends (IST)', deadlineDay.indexOf('is-done') === -1 && aw.dateOf('2026-10-23 00:00:00').at > NOW && aw.dateOf('2026-10-22').at < NOW && aw.dateOf('2026-10-23 10:00:00').at < NOW && aw.dateOf('2026-10-23 12:00:00').at > NOW);
check('dates: only TBA where unknown', (deadlineDay.match(/To be announced/g) || []).length === 3);
check('dates: a dateLabel of the caller wins', aw.homeSections({ dates: { ceremony: '2027-02-12 18:00:00' } }, { now: NOW, dateLabel: function () { return '12 Feb 2027, Mumbai'; } })[0].html.indexOf('>12 Feb 2027, Mumbai<') !== -1);
check('dates: a dateLabel that fails falls back', aw.homeSections({ dates: { ceremony: '2027-02-12' } }, { now: NOW, dateLabel: function () { throw new Error('x'); } })[0].html.indexOf('>12 February 2027<') !== -1);
check('dates: other spellings', aw.dateOf('5th Jan 2027').label === '5 January 2027' && aw.dateOf('sept 2027').label === 'September 2027' && aw.dateOf('Third week of January').label === 'Third week of January' && isNaN(aw.dateOf('Third week of January').at));
check('dates: none known -> no section', aw.homeSections({ dates: { nominationOpen: '', ceremony: '0000-00-00 00:00:00' } }, o).length === 0 && aw.homeSections({ dates: {} }, o).length === 0);
check('dates: a hostile label is text', aw.homeSections({ dates: { ceremony: '<b onmouseover=x>soon</b>' } }, o)[0].html.indexOf('&lt;b onmouseover=x&gt;soon&lt;/b&gt;') !== -1);

/* categories summary */
var cs = home[1].html;
check('categories: one card per master', (cs.match(/class="aw-cat-card"/g) || []).length === 3);
check('categories: the lead counts masters and subs', cs.indexOf('>3 master categories · 4 sub-categories</p>') !== -1);
check('categories: sub-category counts', cs.indexOf('>3 sub-categories</p>') !== -1 && cs.indexOf('>1 sub-category</p>') !== -1);
check('categories: a master with none shows no count', /CIO of the Year<\/h3><p class="aw-cat-desc">Leaders\.<\/p><\/article>/.test(cs));
check('categories: New badge on a new master only', (cs.match(/class="aw-cat-new">New</g) || []).length === 1);
check('categories: the link to the full list', cs.indexOf('<a class="aw-cat-btn" data-rv-page-link="award-category" href="award-category">View all categories</a>') !== -1);
check('categories: a master named <script> stays text', aw.homeSections({ categories: [{ name: '<script>alert(1)</script>' }] }, o)[0].html.indexOf('&lt;script&gt;alert(1)&lt;/script&gt;') !== -1);
check('categories: nameless ones out, none -> no section', aw.homeSections({ categories: [{ name: '' }, null] }, o).length === 0);

/* jury */
var jh = home[2].html;
check('jury: the Grand Jury, wherever it stands', jh.indexOf('>Grand Jury</h2>') !== -1 && jh.indexOf('Meera Iyer') === -1);
check('jury: nameless jurors out', (jh.match(/class="aw-jury-card"/g) || []).length === 5);
check('jury: a carousel when many', /data-rv-carousel="auto"><div class="aw-jury-track" data-rv-carousel-track>/.test(jh));
var onePage = aw.homeSections(award, { edition: 'ETCIO Awards 2027', now: NOW });
check('a one-page site (no internal pages): no link to a page', onePage.every(function (x) { return x.html.indexOf('data-rv-page-link') === -1; }));
check('jury: Meet the jury link', jh.indexOf('<a class="aw-jury-btn" data-rv-page-link="award-jury" href="award-jury">Meet the jury</a>') !== -1);
check('jury: profile template with bio and LinkedIn', jh.indexOf('<template data-rv-profile><span data-rv-profile-for hidden>Anita Rao</span><p data-rv-profile-bio>Thirty years in banking.</p><a data-rv-profile-li href="https://www.linkedin.com/in/anita"') !== -1);
check('jury: no template without bio or a safe link', (jh.match(/<template/g) || []).length === 1);
check('jury: a hostile name stays text, an http photo and a javascript: link dropped', jh.indexOf('<img src=x') === -1 && jh.indexOf('Vikram &lt;img src=x onerror=alert(1)&gt;') !== -1 && jh.indexOf('http://insecure') === -1 && jh.indexOf('javascript:') === -1);
check('jury: initials where there is no photo', jh.indexOf('<span aria-hidden="true">PN</span>') !== -1);
check('jury: popup hooks', /data-rv-profile-name>Anita Rao<\/h3><p class="aw-jury-role" data-rv-profile-role>CIO<\/p><p class="aw-jury-co" data-rv-profile-co>Bank<\/p>/.test(jh));
var fewJury = aw.homeSections({ jury: [{ group: '', people: [{ name: 'One' }, { name: 'Two' }] }] }, o)[0];
check('jury: a grid when few, "Jury" when unnamed', fewJury.html.indexOf('data-rv-carousel') === -1 && fewJury.html.indexOf('class="aw-jury-grid"') !== -1 && fewJury.html.indexOf('>Jury</h2>') !== -1);
check('jury: none -> no section', aw.homeSections({ jury: [{ group: 'Grand Jury', people: [{ name: '' }] }] }, o).length === 0);

/* partners */
var pt = home[3].html;
check('partners: groups with headings, empty groups out', pt.indexOf('>Knowledge Partner</h3>') !== -1 && pt.indexOf('>Supporting Partners</h3>') !== -1 && pt.indexOf('Empty') === -1);
check('partners: logo linked on https', pt.indexOf('<a href="https://advisory.example" target="_blank" rel="noopener"><img src="https://img.etb2bimg.com/p1.png" alt="Advisory Co"') !== -1);
check('partners: a name where there is no logo, a bad logo is a name', pt.indexOf('<span>No Logo Co</span>') !== -1 && pt.indexOf('<span>Bad</span>') !== -1 && pt.indexOf('javascript:') === -1);
check('partners: nothing named and no logo is left out', (pt.match(/class="aw-prt-logo"/g) || []).length === 3);
check('partners: the logo plate is white whatever the theme, and kept', /\.aw-prt-logo\{--rv-keep:1;[^}]*background:#ffffff/.test(home[3].css));
check('partners: none -> no section', aw.homeSections({ partners: [{ group: 'X', items: [] }] }, o).length === 0);

/* empty */
check('home: nothing -> nothing', aw.homeSections(null).length === 0 && aw.homeSections({}, {}).length === 0 && aw.homeSections({ categories: 'x', jury: {}, partners: null }).length === 0);
check('home: no edition -> no eyebrow', aw.homeSections({ categories: [{ name: 'A' }] }, {})[0].html.indexOf('-eyebrow') === -1);

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
  check(k + ': empty -> no page', aw.pageSections(k, null, o).length === 0 && aw.pageSections(k, [], o).length === 0 && aw.pageSections(k, {}, o).length === 0 && aw.pageSections(k, { blocks: [] }, o).length === 0);
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

/* faq */
var fq = pages['award-faq'][1].html;
check('faq: groups in first-seen order, ungrouped under General', /Nominations<\/h2>[^]*Fees<\/h2>[^]*General<\/h2>/.test(fq));
check('faq: same-group questions together', /Who can nominate\?[^]*Can I nominate twice\?[^]*Fees<\/h2>/.test(fq));
check('faq: details / summary accordion', (fq.match(/<details class="aw-faq-item"><summary class="aw-faq-q">/g) || []).length === 4);
check('faq: a question with no answer left out', fq.indexOf('No answer') === -1);
check('faq: answers split into paragraphs', fq.indexOf('<p>Any organisation.</p><p>Self-nominations are welcome.</p>') !== -1);
check('faq: a hostile question is text', fq.indexOf('Ungrouped &lt;b&gt;q&lt;/b&gt;') !== -1);
check('faq: the marker icon is hidden from readers', /<svg class="aw-faq-icon"[^>]*aria-hidden="true"/.test(fq));
var flat = aw.pageSections('award-faq', [{ q: 'A?', a: 'B.' }], o)[1].html;
check('faq: ungrouped -> no group headings, a hidden one labels the list', flat.indexOf('aw-faq-gname') === -1 && flat.indexOf('<h2 class="aw-faq-sr" id="award-faq-list-title">') !== -1);
check('faq: answers closed until asked for (no rule that opens them on the live page)', !/details-content|\[open\]\s*\{?display/.test(pages['award-faq'][1].css) && fq.indexOf('<details class="aw-faq-item" open') === -1);

console.log((failed ? 'FAILED ' : 'ok ') + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
