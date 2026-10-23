// node functions/lib/et-awards.test.js — an ET award's content (API + the previous site's internal pages), with a fake ET.
const aw = require('./et-awards');
var passed = 0, failed = 0;
function check(name, ok, detail) { if (ok) { passed++; return; } failed++; console.error('FAIL ' + name + (detail ? ' — ' + detail : '')); }
function j(v) { return JSON.stringify(v); }

/* ---------- plain text ---------- */
check('entities: named, decimal, hex, in one pass', aw.decodeEntities('India&#039;s &amp; &rsquo;x&#x27; &amp;lt;b&amp;gt;') === 'India\'s & ’x\' &lt;b&gt;', aw.decodeEntities('India&#039;s &amp; &rsquo;x&#x27; &amp;lt;b&amp;gt;'));
check('entities: an unknown name is left, a control character or a surrogate is a space', aw.decodeEntities('&bogus; &#0; &#xD800; &#7;') === '&bogus;      ', j(aw.decodeEntities('&bogus; &#0; &#xD800; &#7;')));
check('cleanText: tags, scripts, comments and styles go; whitespace collapses',
  aw.cleanText('<p>Hello <b>there</b></p><script>alert(1)</script><!-- hidden --><style>p{}</style>\n\t world&nbsp;!') === 'Hello there world !');
check('cleanText: a tag spelled with entities is not let through', aw.cleanText('a &lt;script&gt;x&lt;/script&gt; b') === 'a x b', aw.cleanText('a &lt;script&gt;x&lt;/script&gt; b'));
check('cleanText: cut at a word with an ellipsis', aw.cleanText('alpha beta gamma delta epsilon', 20) === 'alpha beta gamma…', aw.cleanText('alpha beta gamma delta epsilon', 20));
check('cleanText: objects and null are empty', aw.cleanText({ a: 1 }) === '' && aw.cleanText(null) === '' && aw.cleanText(undefined) === '');
check('listOf: ET\'s JSON text of a list, "NA" none, once each',
  j(aw.listOf('["CIO","CTO","cio","PR\\u00a0Agencies"," "]')) === j(['CIO', 'CTO', 'PR Agencies']), j(aw.listOf('["CIO","CTO","cio","PR\\u00a0Agencies"," "]')));
check('listOf: ["NA"], bad JSON, a non-list', aw.listOf('["NA"]').length === 0 && aw.listOf('[oops').length === 0 && aw.listOf('{"a":1}').length === 0 && aw.listOf(null).length === 0);
check('editionOf: from template_settings text or object; bad JSON is none',
  aw.editionOf('{"edition_txt":"4th Edition","font_family":"Inter"}') === '4th Edition' && aw.editionOf({ edition_txt: ' 3rd <b>Edition</b> ' }) === '3rd Edition' && aw.editionOf('{bad') === '' && aw.editionOf('') === '');

/* ---------- fees and categories ---------- */
check('fee: paid INR', j(aw.feeOf({ price_type: 1, price_type_label: 'Paid', baseprice: '2000', currency: 'INR' })) === j({ paid: true, amount: 2000, currency: 'INR', label: 'Paid' }));
check('fee: no charges', j(aw.feeOf({ price_type: 0, price_type_label: 'No Charges', baseprice: '0', currency: '' })) === j({ paid: false, amount: 0, currency: '', label: 'No Charges' }));
check('fee: "Derivative" (price_type 0) is not paid whatever its price', aw.feeOf({ price_type: 0, price_type_label: 'Derivative', baseprice: '500', currency: 'INR' }).paid === false);
check('fee: "27,000", a bad currency', j(aw.feeOf({ price_type: '1', baseprice: '27,000', currency: 'rupees' })) === j({ paid: true, amount: 27000, currency: '', label: '' }));
check('fee: paid with a zero price is not paid', aw.feeOf({ price_type: 1, baseprice: '0', currency: 'INR' }).paid === false);

function sub(id, name, extra) {
  return Object.assign({ id: id, name: name, seoname: name.toLowerCase().replace(/\W+/g, '-'), award_id: '407', portal: 'cio', status: 1,
    description: 'About ' + name, weightage: 0, is_new: 0, price_type: 1, price_type_label: 'Paid', baseprice: '2000', currency: 'INR' }, extra || {});
}
var RAW_CATS = { awardCategories: {
  'leadership-category': { name: 'Leadership Category', subcategory: {
    'cto-of-the-year': sub(2, 'CTO of the Year', { weightage: 1, is_new: 1 }),
    'cio-of-the-year': sub(1, 'CIO of the Year', { weightage: 0, is_new: 1, description: '<p>Recognises <b>visionary</b> IT leadership. Write to a.b@timesinternet.in or call +91 98713 63743.</p>' }),
    'hidden': sub(3, 'Hidden one', { status: 0 }),
    'other-award': sub(4, 'From another award', { award_id: '233' }),
    'other-portal': sub(5, 'From another portal', { portal: 'hr' })
  } },
  'influencer-marketing-industry-awards': { name: 'Influencer Marketing(Industry Awards)', subcategory: {
    auto: sub(6, 'Auto', { baseprice: '27000' }),
    brand: sub(7, 'Brand of the Year', { price_type: 0, price_type_label: 'Derivative', baseprice: '0', currency: '' })
  } },
  'empty-category': { name: 'Nothing left', subcategory: { x: sub(8, 'Elsewhere', { award_id: '1' }) } },
  'junk': 'not an object'
} };
var before = j(RAW_CATS);
var cats = aw.compactCategories(RAW_CATS, '407', 'cio');
check('categories: input not changed', j(RAW_CATS) === before);
check('categories: a category with nothing left, and junk, are left out', cats.length === 2, cats.length);
var lead = cats[0];
check('categories: name and slug', lead.name === 'Leadership Category' && lead.slug === 'leadership-category');
check('categories: hidden, another award\'s and another portal\'s subcategories left out; weightage order',
  j(lead.subcategories.map(function (s) { return s.name; })) === j(['CIO of the Year', 'CTO of the Year']), j(lead.subcategories.map(function (s) { return s.name; })));
check('categories: a subcategory\'s description is plain text, contacts taken out',
  lead.subcategories[0].description === 'Recognises visionary IT leadership. Write to [email] or call [phone].', lead.subcategories[0].description);
check('categories: subcategory slug from seoname; isNew', lead.subcategories[0].slug === 'cio-of-the-year' && lead.subcategories[0].isNew === true);
check('categories: a category whose subcategories share a fee has it; all new is new',
  j(lead.fee) === j({ paid: true, amount: 2000, currency: 'INR', label: 'Paid' }) && lead.isNew === true && lead.description === '');
check('categories: ET\'s "Name(Kind)" spaced', cats[1].name === 'Influencer Marketing (Industry Awards)', cats[1].name);
check('categories: fees that differ are "Varies"', j(cats[1].fee) === j({ paid: true, amount: 0, currency: '', label: 'Varies' }) && cats[1].isNew === false, j(cats[1].fee));
check('categories: a free subcategory', cats[1].subcategories[1].fee.paid === false && cats[1].subcategories[1].fee.label === 'Derivative');
check('categories: the API\'s "Data Not Found" (an empty list), null, junk', aw.compactCategories([], '1').length === 0 && aw.compactCategories(null).length === 0 && aw.compactCategories('x').length === 0);
var many = { awardCategories: { big: { name: 'Big', subcategory: {} } } };
for (var i = 0; i < 120; i++) many.awardCategories.big.subcategory['s' + i] = sub(100 + i, 'Sub ' + i, { award_id: '9', portal: '' });
check('categories: bounded', aw.compactCategories(many, '9', 'cio')[0].subcategories.length === aw.MAX.subcategories);
check('categories: an array of categories (and of subcategories) is read too',
  aw.compactCategories([{ name: 'A', subcategory: [sub(1, 'One', { award_id: '' })] }], '407', 'cio')[0].subcategories[0].name === 'One');

/* ---------- jury, guests, partners ---------- */
function person(name, group, w, extra) {
  return Object.assign({ id: w, speaker_name: name, speaker_desig: 'Chief Information Officer', speaker_company: 'Acme', speaker_info: '',
    speaker_picture: 'cp/data_file_' + w + '.jpg', speaker_picture_large: 'cp/speaker_social_post_' + w + '.png', status: 1,
    speaker_weightage: w, weightage: 1, linkedin_url: '', speaker_email: 'private@x.com', speaker_phone: '9999999999', group: { group_name: group } }, extra || {});
}
var people = aw.groupPeople([
  person('Assessor One', 'Assessment Jury', 13),
  person('Sh. Anurag Singh Thakur', 'Guest of Honour', 1, { linkedin_url: 'https://www.linkedin.com/in/anurag?lipi=urn%3Ali%3Apage' }),
  person('Rajeev Chandrasekhar', 'Guest of Honour', 2),
  person('Rajeev Chandrasekhar', 'Grand Jury', 3, { speaker_info: '<p>Former minister.</p><p>Mail him at r@c.in</p>' }),
  person('Hidden Juror', 'Grand Jury', 4, { status: 0 }),
  person('Ananya Birla', 'Grand Jury', 5, { linkedin_url: 'javascript:alert(1)', speaker_picture: '', speaker_picture_large: 'cp/portrait.jpg' }),
  person('No Picture', 'Jury Members', 6, { speaker_picture: '' }),
  person('', 'Grand Jury', 7),
  person('Ungrouped', '', 8, { group: null }),
  null, 'junk'
]);
check('people: jury groups in the order they first come (by weightage)', j(people.jury.map(function (g) { return g.group; })) === j(['Grand Jury', 'Jury Members', 'Assessment Jury']), j(people.jury.map(function (g) { return g.group; })));
check('people: other groups are guests; a speaker without a group is "Speakers"', j(people.guests.map(function (g) { return g.group; })) === j(['Guest of Honour', 'Speakers']), j(people.guests.map(function (g) { return g.group; })));
var gj = people.jury[0].people;
check('people: hidden and nameless left out; the same person may sit in two groups', j(gj.map(function (p) { return p.name; })) === j(['Rajeev Chandrasekhar', 'Ananya Birla']), j(gj.map(function (p) { return p.name; })));
check('people: a person\'s fields, and nothing private', j(Object.keys(gj[0]).sort()) === j(['bio', 'company', 'linkedin', 'name', 'photo', 'title']) && gj[0].title === 'Chief Information Officer' && gj[0].company === 'Acme');
check('people: the picture on ET\'s image host', gj[0].photo === 'https://img.etb2bimg.com/files/cp/data_file_3.jpg', gj[0].photo);
check('people: a biography keeps its paragraphs, contacts taken out', gj[0].bio === 'Former minister.\nMail him at [email]', j(gj[0].bio));
check('people: the large picture only when it is not the social post', gj[1].photo === 'https://img.etb2bimg.com/files/cp/portrait.jpg' && people.jury[1].people[0].photo === '', gj[1].photo + ' ' + people.jury[1].people[0].photo);
check('people: LinkedIn without its tracking query; a script is no address', people.guests[0].people[0].linkedin === 'https://www.linkedin.com/in/anurag' && gj[1].linkedin === '', people.guests[0].people[0].linkedin);
check('people: none is none', j(aw.groupPeople(null)) === j({ jury: [], guests: [] }));

var partners = aw.groupPartners([
  { sponsor_title: 'MeitY', sponsor_logo: 'file_2.png', url: 'https://www.meity.gov.in/', weightage: 2, status: 1, group: { group_name: 'Supporting Partners' } },
  { sponsor_title: 'Grant Thornton', sponsor_logo: 'file_1737532132_GT_Primary_Logo_1_.png', url: 'http://www.grantthornton.in/', weightage: 1, status: 1, group: { group_name: 'Knowledge Partner' } },
  { sponsor_title: 'Hidden', sponsor_logo: 'file_3.png', weightage: 0, status: 0, group: { group_name: 'Knowledge Partner' } },
  { sponsor_title: 'Evil', sponsor_logo: '../../etc/passwd', url: 'javascript:alert(1)', weightage: 3, status: 1, group: { group_name: 'Supporting Partners' } },
  { sponsor_title: 'EY', sponsor_log_png: 'file_ey.jpg', weightage: 4, status: 1 },
  { sponsor_title: '', sponsor_logo: '', weightage: 5, status: 1 }
]);
check('partners: groups in weightage order', j(partners.map(function (g) { return g.group + ':' + g.items.map(function (x) { return x.name; }).join(','); })) === j(['Knowledge Partner:Grant Thornton', 'Supporting Partners:MeitY,Evil', 'Partners:EY']), j(partners.map(function (g) { return g.group + ':' + g.items.map(function (x) { return x.name; }).join(','); })));
check('partners: a logo under retail_files; http upgraded', j(partners[0].items[0]) === j({ name: 'Grant Thornton', logo: 'https://img.etb2bimg.com/files/retail_files/file_1737532132_GT_Primary_Logo_1_.png', url: 'https://www.grantthornton.in/' }), j(partners[0].items[0]));
check('partners: a path out of the files folder, and a script address, are none', partners[1].items[1].logo === '' && partners[1].items[1].url === '');
check('partners: the png logo when there is no other', partners[2].items[0].logo === 'https://img.etb2bimg.com/files/retail_files/file_ey.jpg');

/* ---------- internal pages ---------- */
var CHROME = '<html><head><script>var siteId = 1;</script></head><body><nav><a>Home</a><h2>Menu heading</h2></nav>'
  + '<header class="top"><h2>ETCIO header</h2></header>';
function page(title, content, index) {
  return CHROME + '<script>var microsite_page_index = \'' + (index || 'award-tnc') + '\';</script>'
    + '<section id="page-hdr" class="mb-medium"><div class="container"><div class="row"><div class="col-md-12"><h2><strong>' + title.split(' ')[0] + '</strong> ' + title.split(' ').slice(1).join(' ') + '</h2></div></div></div></section>'
    + '<style>.x{color:red}</style><!--submenu lavel 2 html start--><!--submenu lavel 2 html end-->'
    + content
    + '<div class="floating-point-section-scrollTop"><a>Back to Top</a></div>'
    + '<script>$(".x").html(\'<h2 class="ms-formheading">Fill in your information</h2>\');</script>'
    + '<form><h2>Please take a moment</h2><input name="email"></form>'
    + '<div class="footer"><h2>What&#039;s Happening</h2><p>ET Retail Awards 2026 — news</p></div></body></html>';
}
var TNC = page('Award T&amp;C', '<section id="tmc"><div class="container"><ul>'
  + '<li><i class="fa fa-check"></i> Entries can be submitted by any organisation.</li>'
  + '<li>All the submitted entries will become a property of Times Internet Ltd.</li></ul>'
  + '<!--<li>An old rule taken out</li>--></div></section>');
var tnc = aw.textPageFrom(TNC, /t\s*&\s*c|terms/i);
check('page: the header\'s <h2> is the title', tnc && tnc.title === 'Award T&C', tnc && tnc.title);
check('page: list items are bullets; what is commented out is not read',
  tnc && j(tnc.blocks) === j([{ heading: '', paragraphs: [], bullets: ['Entries can be submitted by any organisation.', 'All the submitted entries will become a property of Times Internet Ltd.'] }]), tnc && j(tnc.blocks));
check('page: nothing of the menu, the forms, the scripts or the footer\'s news', tnc && !/Menu heading|ETCIO header|Fill in|Please take|Happening|news|siteId/.test(j(tnc)), j(tnc));
check('page: a header that is not the page asked for', aw.textPageFrom(TNC, /faq/i) === null);
check('page: no heading regex — any header', aw.textPageFrom(TNC) !== null);
check('page: a page the site does not have (no header section)', aw.textPageFrom(CHROME + '<script>var microsite_page_index = \'faqs\';</script><h2>FAQ</h2><p>x</p><div class="floating-point-section-scrollTop"></div>', /faq/i) === null);
check('page: the home page is never an internal page', aw.textPageFrom(TNC.replace('award-tnc', 'home'), /t\s*&\s*c/i) === null);
check('page: ET\'s block page (419 bytes), empty, junk', aw.textPageFrom('<html><body>Access blocked. Reference #18.1</body></html>', /x/) === null && aw.textPageFrom('', /x/) === null && aw.textPageFrom(null) === null && aw.textPageFrom({}, /x/) === null);
check('page: a header with nothing under it', aw.textPageFrom(page('Award T&amp;C', '<section></section>'), /t\s*&\s*c/i) === null);

var JUDGING = page('Judging Criteria', '<section id="judging-process"><div class="container"><!-- <h2>COMING SOON</h2> -->'
  + '<p class="">The competition is open to campaigns created between 1st December 2024 and 31st December 2025</p>'
  + '<table><tbody><tr><th colspan="2"><strong>Digital Enterprise of India</strong></th></tr>'
  + '<tr><td><strong>Evaluation Parameter</strong></td><td><strong>Weightage </strong></td></tr>'
  + '<!--<tr><td colspan="2">Hidden row</td></tr>-->'
  + '<tr><td>Contextual Connect (Market, Competitiveness, Customers)</td><td>15%</td></tr>'
  + '<tr><td\n style="x">Business Goals</td><td>25%</td><td>How well the goals were met.</td></tr></tbody></table>'
  + '<div class="text-style"><span>1.</span><div class="faq-dec"><h2>Stage I</h2><p>Organizations register\n online.<br>Applicants fill the <a\n href="/x">form</a>.</p></div>'
  + '<span>Q2.</span><h3>Stage II</h3><p>EY screens the entries &ndash; carefully.</p></div></div></section>', 'judging-criteria');
var judging = aw.textPageFrom(JUDGING, /judg/i);
check('page: text before the first heading, table rows (a one-cell row is a heading), headings, numbering dropped',
  judging && j(judging.blocks) === j([
    { heading: '', paragraphs: ['The competition is open to campaigns created between 1st December 2024 and 31st December 2025'], bullets: [] },
    { heading: 'Digital Enterprise of India', paragraphs: ['Evaluation Parameter | Weightage', 'Contextual Connect (Market, Competitiveness, Customers) | 15%', 'Business Goals | 25% | How well the goals were met.'], bullets: [] },
    { heading: 'Stage I', paragraphs: ['Organizations register online.', 'Applicants fill the form.'], bullets: [] },
    { heading: 'Stage II', paragraphs: ['EY screens the entries – carefully.'], bullets: [] }
  ]), judging && j(judging.blocks));

var lots = '';
for (var b = 0; b < 60; b++) lots += '<h3>Heading ' + b + '</h3><p>' + 'word '.repeat(600) + '</p><ul>' + '<li>item</li>'.repeat(80) + '</ul>';
var big = aw.textPageFrom(page('Entry Guidelines', '<section>' + lots + '</section>', 'award-guidelines'), /guideline/i);
check('page: bounded — blocks, bullets, a paragraph\'s length, the whole', big && big.blocks.length <= aw.MAX.blocks && big.blocks.every(function (x) { return x.bullets.length <= aw.MAX.bullets && x.paragraphs.every(function (p) { return p.length <= 2001; }); }) && j(big).length < aw.MAX.pageChars + 20000,
  big && big.blocks.length + ' blocks, ' + j(big).length + ' chars');
var unclosed = aw.textPageFrom(page('Award T&amp;C', '<section><p>Rule one.</p><div class="x" data-y="</section>'), /t\s*&\s*c/i);
check('page: an unclosed tag at the end is not text', unclosed && j(unclosed.blocks) === j([{ heading: '', paragraphs: ['Rule one.'], bullets: [] }]), unclosed && j(unclosed.blocks));

var FAQ = page('Award FAQs', '<section id="award-faq"><div class="container"><div class="accordion-wrapper">'
  + '<h3 class="accordion">General Information</h3><div class="panel"><span>Q1.</span><div class="faq-dec"><h2>What are the Trendies Awards?</h2>'
  + '<p>They honour exceptional work. <br><br> Organisations are invited.</p></div>'
  + '<span>Q2.</span><div class="faq-dec"><h2>Q. Why enter?</h2><ul><li>Recognition</li><li>Networking</li></ul></div>'
  + '<div class="faq-dec"><h2>What are the Trendies Awards?</h2><p>A repeat.</p></div>'
  + '<h3>Payment</h3><div class="faq-dec"><h2>How do I pay?</h2><p>A. Write to awards@timesinternet.in.</p></div></div></div></div></section>', 'award-faq');
var faq = aw.faqFromPage(aw.textPageFrom(FAQ, /faq/i));
check('faq page: questions with answers; group labels and repeats left out; "Q."/"A." taken off', j(faq) === j([
  { q: 'What are the Trendies Awards?', a: 'They honour exceptional work.\nOrganisations are invited.' },
  { q: 'Why enter?', a: '• Recognition\n• Networking' },
  { q: 'How do I pay?', a: 'Write to [email].' }
]), j(faq));
check('faq page: none is null', aw.faqFromPage(null) === null && aw.faqFromPage({ title: 'x', blocks: [{ heading: '', paragraphs: ['x'], bullets: [] }] }) === null);
check('faqOf: the microsite\'s own FAQ, shown ones with answers, HTML made text',
  j(aw.faqOf([{ question: 'What is it?', answer: 'An award.\r\n\r\nFor <b>CIOs</b>.', status: 1 }, { question: 'Hidden?', answer: 'x', status: 0 }, { question: 'No answer?', answer: '' }, null]))
  === j([{ q: 'What is it?', a: 'An award.\nFor CIOs.' }]), j(aw.faqOf([{ question: 'What is it?', answer: 'An award.\r\n\r\nFor <b>CIOs</b>.' }])));

check('siteBase: an ET microsite', aw.siteBase('https://cio.economictimes.indiatimes.com/enterprise-tech-award2025') === 'https://cio.economictimes.indiatimes.com/enterprise-tech-award2025');
check('siteBase: http upgraded, a trailing slash or query dropped', aw.siteBase('http://brandequity.economictimes.indiatimes.com/trendies-awards2026/?x=1') === 'https://brandequity.economictimes.indiatimes.com/trendies-awards2026', aw.siteBase('http://brandequity.economictimes.indiatimes.com/trendies-awards2026/?x=1'));
check('siteBase: never another host, ET\'s own www/api/img, a deeper path, odd characters, a script',
  ['https://evil.com/x', 'https://cio.economictimes.indiatimes.com.evil.com/x', 'https://www.economictimes.indiatimes.com/x', 'https://api.economictimes.indiatimes.com/v1',
   'https://cio.economictimes.indiatimes.com/a/b', 'https://cio.economictimes.indiatimes.com/../x', 'https://cio.economictimes.indiatimes.com/a%2F..', 'https://cio.economictimes.indiatimes.com/',
   'javascript:alert(1)', '', null].every(function (u) { return aw.siteBase(u) === ''; }));

/* ---------- readAward, with a fake ET ---------- */
var ET = {}, PAGES_HTML = {}, calls = [], textCalls = [];
function resetEt() {
  calls = []; textCalls = [];
  ET = {
    'microsite/details?digital_month_id=4648': { status: true, data: {
      company_id: 4648, portal: 'cio', award_id: 407, company_name: 'ET Awards for Enterprise Tech Excellence 2026', url_text: 'enterprise-tech-award',
      branding_url: 'https://cio.economictimes.indiatimes.com/enterprise-tech-award', event_start_date: '2026-11-27 08:00:00', event_venue: 'Grand Hyatt, Mumbai',
      company_description: 'Recognising <b>visionary</b> CIOs.', template_settings: '{"edition_txt":"3rd Edition","font_family":"Inter"}',
      who_should_attend: '["CIO","CTO","NA"]', why_join_us: '["NA"]', key_discussion_points: '["NA"]',
      faq: [{ question: 'What are the awards?', answer: 'They recognise CIOs.', status: 1 }],
      about_us: { title: 'About ETCIO', description: 'ETCIO is India&#039;s IT platform.\r\n\r\nSince 2013.' },
      seo: { title: 'CIO Awards 2026', description: 'CIO Awards: nominate now.' } } },
    'award-listing?page=1': { status: true, data: { active: [], upcoming: [{ entity_id: 407, event_id: 4648, title: 'ET Awards for Enterprise Tech Excellence 2026',
      complete_date: '2026-11-27 23:59:00', nomination_start_date: '2026-09-30 08:00:49', nomination_end_date: '2026-10-31 23:00:59',
      link: 'https://cio.economictimes.indiatimes.com/enterprise-tech-award', is_upcoming: 1 }],
      past: { items: [{ entity_id: 233, event_id: 3056, title: 'ET CIO Awards 2025', link: 'https://cio.economictimes.indiatimes.com/enterprise-tech-award2025' }], total_pages: 3, is_last_page: false } } },
    'award-listing?page=2': { status: true, data: { past: { items: [{ entity_id: 157, event_id: 2109, title: 'Enterprise IT Excellence Awards 2024' }], total_pages: 3, is_last_page: false } } },
    'award-listing?page=3': { status: true, data: { past: { items: [{ entity_id: 99, event_id: 1500, title: 'Old Awards 2022', nomination_start_date: '0000-00-00 00:00:00', complete_date: '2022-03-01 20:00:00',
      link: 'https://evil.example.com/old' }], total_pages: 3, is_last_page: true } } },
    /* award/details ignores award_id: it always answers with the portal's one award (233) */
    'award/details': { status: true, data: { id: 233, name: 'ET CIO Awards for Enterprise IT Excellence', start_date: '2025-02-27 09:00:00', nomination_date: '2024-11-07 09:00:19',
      nomination_end_date: '2025-01-24 23:59:43', url: 'https://cio.economictimes.indiatimes.com/enterprise-tech-award2025' } },
    'award/categories?award_id=407': { status: true, data: RAW_CATS },
    'activity/speaker/list?entity_id=4648': { status: true, data: { items: [person('Mohit Joshi', 'Grand Jury', 0), person('Guest', 'Guest of Honour', 1)], total_pages: 1, is_last_page: true } },
    'activity/sponsor/list?entity_id=4648': { status: true, data: { items: [{ sponsor_title: 'Digital India', sponsor_logo: 'file_di.webp', url: 'https://www.digitalindia.gov.in/', status: 1, group: { group_name: 'Supporting Partners' } }], total_pages: 1, is_last_page: true } }
  };
  PAGES_HTML = {
    'https://cio.economictimes.indiatimes.com/enterprise-tech-award/award-guidelines': '<html>Access blocked</html>',
    'https://cio.economictimes.indiatimes.com/enterprise-tech-award/entry-guidelines': page('Entry Guidelines', '<section><h2>How to enter</h2><p>Create an account.</p></section>', 'entry-guidelines'),
    'https://cio.economictimes.indiatimes.com/enterprise-tech-award/judging-criteria': JUDGING,
    'https://cio.economictimes.indiatimes.com/enterprise-tech-award/award-tnc': CHROME + '<script>var microsite_page_index = \'award-tnc\';</script><p>nothing here</p>',
    'https://cio.economictimes.indiatimes.com/enterprise-tech-award/award-faq': 'REJECT',
    'https://cio.economictimes.indiatimes.com/enterprise-tech-award/faqs': FAQ,
    'https://cio.economictimes.indiatimes.com/enterprise-tech-award/award-category': page('Award Categories', '<section><h3>Leadership</h3><p>₹ 2000 (exclusive of GST)</p></section>', 'award-category')
  };
}
function keyOf(url) {
  var path = url.slice(aw.API.length + 4);
  if (/^award\/details/.test(path)) return 'award/details';
  if (/^activity\//.test(path)) return path.replace(/&activity=.*$/, '');
  return path;
}
function fakeJson(url, headers) {
  calls.push({ url: url, headers: headers });
  return new Promise(function (resolve, reject) {
    setTimeout(function () {
      var hit = ET[keyOf(url)];
      if (hit === 'REJECT') return reject(new Error('socket hang up'));
      resolve(hit === undefined ? { status: false, message: 'Data Not Found', data: [] } : hit);
    }, 1);
  });
}
function fakeText(url, headers) {
  textCalls.push({ url: url, headers: headers });
  var h = PAGES_HTML[url];
  if (h === 'REJECT') return Promise.reject(new Error('timeout'));
  return Promise.resolve(h === undefined ? CHROME + '<p>Not found page</p>' : h);
}

function safeCalls() {
  return calls.every(function (c) { return c.url.indexOf(aw.API + '/v1/') === 0 && /^[\x21-\x7e]+$/.test(c.url) && c.headers.portal === 'cio' && Object.keys(c.headers).sort().join() === 'accept,portal'; })
    && textCalls.every(function (c) { return c.url.indexOf('https://cio.economictimes.indiatimes.com/enterprise-tech-award/') === 0 && /Chrome\//.test(c.headers['user-agent']); });
}

resetEt();
aw.readAward({ portal: 'cio', micrositeId: '4648' }, { fetchJson: fakeJson, fetchText: fakeText }).then(function (a) {
  check('read: an award, its id found from the microsite', a && a.awardId === '407' && a.micrositeId === '4648' && a.portal === 'cio', a && j([a.awardId, a.micrositeId]));
  check('read: every part of AWARD', a && j(Object.keys(a).sort()) === j(['about', 'aboutVertical', 'awardId', 'categories', 'dates', 'edition', 'faq', 'guests', 'jury', 'link', 'micrositeId', 'name', 'pages', 'partners', 'portal', 'seo', 'venue', 'whoShouldEnter', 'whyEnter']), a && j(Object.keys(a).sort()));
  check('read: name, link, edition, venue, about', a.name === 'ET Awards for Enterprise Tech Excellence 2026' && a.link === 'https://cio.economictimes.indiatimes.com/enterprise-tech-award'
    && a.edition === '3rd Edition' && a.venue === 'Grand Hyatt, Mumbai' && a.about === 'Recognising visionary CIOs.', j([a.name, a.link, a.edition, a.venue, a.about]));
  check('read: dates from the listing row and the microsite — never from award/details answering for another award',
    j(a.dates) === j({ nominationOpen: '2026-09-30 08:00:49', nominationClose: '2026-10-31 23:00:59', ceremony: '2026-11-27 08:00:00' }), j(a.dates));
  check('read: categories of this award only', a.categories.length === 2 && a.categories[0].subcategories.length === 2);
  check('read: jury, guests, partners', a.jury.length === 1 && a.jury[0].people[0].name === 'Mohit Joshi' && a.guests[0].group === 'Guest of Honour' && a.partners[0].items[0].logo === 'https://img.etb2bimg.com/files/retail_files/file_di.webp');
  check('read: faq, who should enter, why enter, about the vertical, seo',
    j(a.faq) === j([{ q: 'What are the awards?', a: 'They recognise CIOs.' }]) && j(a.whoShouldEnter) === j(['CIO', 'CTO']) && a.whyEnter.length === 0
    && j(a.aboutVertical) === j({ title: 'About ETCIO', text: 'ETCIO is India\'s IT platform.\nSince 2013.' }) && j(a.seo) === j({ title: 'CIO Awards 2026', description: 'CIO Awards: nominate now.' }), j([a.faq, a.whoShouldEnter, a.aboutVertical, a.seo]));
  check('read: a page blocked under one name is read under the other (entry-guidelines)', a.pages.guidelines && a.pages.guidelines.title === 'Entry Guidelines' && a.pages.guidelines.blocks[0].heading === 'How to enter', j(a.pages.guidelines));
  check('read: judging page', a.pages.judging && a.pages.judging.blocks.length === 4);
  check('read: a page the site does not have is null', a.pages.tnc === null);
  check('read: an FAQ page failing under one name is read under the other (faqs)', Array.isArray(a.pages.faq) && a.pages.faq.length === 3);
  check('read: the categories page', a.pages.categoriesNote && a.pages.categoriesNote.blocks[0].paragraphs[0] === '₹ 2000 (exclusive of GST)', j(a.pages.categoriesNote));
  check('read: the listing stops at the page that has the microsite', calls.filter(function (c) { return /award-listing/.test(c.url); }).length === 1);
  check('read: every request to ET\'s API with the roster\'s portal; every page on the award\'s own site, as Chrome', safeCalls(), j(calls.map(function (c) { return c.url; })) + j(textCalls.map(function (c) { return c.url; })));
  check('read: each internal page variant asked at most once', textCalls.length === 7, textCalls.length);

  /* the microsite does not name its award: the listing does (on a later page) */
  resetEt();
  delete ET['microsite/details?digital_month_id=4648'].data.award_id;
  ET['award-listing?page=1'].data.upcoming = [];
  ET['award-listing?page=3'].data.past.items.push({ entity_id: 407, event_id: 4648, title: 'Listed later', nomination_end_date: '2026-10-31' });
  return aw.readAward({ portal: 'cio', micrositeId: 4648 }, { fetchJson: fakeJson });
}).then(function (a) {
  check('read: the award found in the listing\'s past pages', a && a.awardId === '407' && a.name === 'Listed later' && a.dates.nominationClose === '2026-10-31 00:00:00', a && j([a.awardId, a.name, a.dates]));
  check('read: without fetchText, every page is null', a && j(a.pages) === j({ guidelines: null, judging: null, tnc: null, faq: null, categoriesNote: null }));
  check('read: the link falls back to the microsite\'s branding_url', a && a.link === 'https://cio.economictimes.indiatimes.com/enterprise-tech-award');

  /* the caller's awardId disagrees with the microsite's */
  resetEt();
  return aw.readAward({ portal: 'cio', awardId: '233', micrositeId: '4648' }, { fetchJson: fakeJson, fetchText: fakeText });
}).then(function (a) {
  check('read: an awardId the microsite does not name is refused', a === null);
  check('read: … before anything is read by it', !calls.some(function (c) { return /award\/categories|activity\//.test(c.url); }) && textCalls.length === 0);

  /* the listing disagrees with the microsite */
  resetEt();
  ET['award-listing?page=1'].data.upcoming[0].entity_id = 999;
  return aw.readAward({ portal: 'cio', micrositeId: '4648' }, { fetchJson: fakeJson });
}).then(function (a) {
  check('read: the listing and the microsite disagreeing is refused', a === null);

  /* the microsite is another portal's */
  resetEt();
  ET['microsite/details?digital_month_id=4648'].data.portal = 'hr';
  return aw.readAward({ portal: 'cio', micrositeId: '4648' }, { fetchJson: fakeJson });
}).then(function (a) {
  check('read: another portal\'s microsite is refused', a === null);

  /* ET down entirely */
  resetEt();
  ET = { 'microsite/details?digital_month_id=4648': 'REJECT', 'award-listing?page=1': 'REJECT' };
  return aw.readAward({ portal: 'cio', awardId: '407', micrositeId: '4648' }, { fetchJson: fakeJson, fetchText: fakeText });
}).then(function (a) {
  check('read: nothing can say which award it is: null (even with an awardId given)', a === null);

  /* the microsite cannot be read, the listing can; categories and lists fail */
  resetEt();
  ET['microsite/details?digital_month_id=4648'] = 'REJECT';
  ET['award/categories?award_id=407'] = 'REJECT';
  ET['activity/speaker/list?entity_id=4648'] = 'REJECT';
  ET['activity/sponsor/list?entity_id=4648'] = { status: true, data: { items: 'junk' } };
  return aw.readAward({ portal: 'cio', micrositeId: '4648' }, { fetchJson: fakeJson, fetchText: function () { throw new Error('boom'); } });
}).then(function (a) {
  check('read: what fails is empty, the rest is read', a && a.awardId === '407' && a.categories.length === 0 && a.jury.length === 0 && a.partners.length === 0
    && a.edition === '' && a.faq.length === 0 && a.dates.nominationOpen === '2026-09-30 08:00:49' && a.dates.ceremony === '2026-11-27 23:59:00', a && j([a.categories, a.dates]));
  check('read: a fetchText that throws leaves every page null', a && j(a.pages) === j({ guidelines: null, judging: null, tnc: null, faq: null, categoriesNote: null }));

  /* award/details used when it IS the award's own; a link off ET is never read */
  resetEt();
  ET['microsite/details?digital_month_id=3056'] = { status: true, data: { company_id: 3056, portal: 'cio', award_id: 233, branding_url: 'https://evil.example.com/x' } };
  ET['award-listing?page=1'].data.past.items[0].link = 'https://evil.example.com/x';
  return aw.readAward({ portal: 'cio', micrositeId: '3056' }, { fetchJson: fakeJson, fetchText: fakeText });
}).then(function (a) {
  check('read: award/details\' answer used for its own award', a && a.awardId === '233' && a.dates.ceremony === '2025-02-27 09:00:00', a && j(a.dates));
  check('read: a site off ET is never read; the link is the listing\'s (shown only)', a && textCalls.length === 0 && a.link === 'https://evil.example.com/x', a && a.link);

  /* bad input never reaches ET */
  resetEt();
  return Promise.all([
    aw.readAward({ portal: 'cio\r\nX-Evil: 1', micrositeId: '4648' }, { fetchJson: fakeJson }),
    aw.readAward({ portal: '__proto__', micrositeId: '4648' }, { fetchJson: fakeJson }),
    aw.readAward({ portal: 'cio', micrositeId: '4648&x=1' }, { fetchJson: fakeJson }),
    aw.readAward({ portal: 'cio', micrositeId: '0' }, { fetchJson: fakeJson }),
    aw.readAward({ portal: 'cio', micrositeId: '4648', awardId: '407 OR 1' }, { fetchJson: fakeJson }),
    aw.readAward({ portal: 'cio', micrositeId: '4648', awardId: {} }, { fetchJson: fakeJson }),
    aw.readAward({ portal: 'cio', micrositeId: '4648' }, {}),
    aw.readAward(null, null)
  ]);
}).then(function (all) {
  check('read: a bad portal, id or awardId, or no fetchJson: null, and ET is never asked', all.every(function (a) { return a === null; }) && calls.length === 0, j(all) + ' ' + calls.length);
  return aw.findListingRow('cio', function () { throw new Error('sync throw'); }, '4648');
}).then(function (r) {
  check('findListingRow: a fetchJson that throws is no row', r === null);
}).then(function () {
  if (failed) { console.error('et-awards: ' + failed + ' of ' + (passed + failed) + ' checks FAILED'); process.exit(1); }
  console.log('et-awards: all ' + passed + ' checks passed');
}, function (err) { console.error('et-awards: crashed — ' + (err && err.stack)); process.exit(1); });
