// node functions/lib/award-site.test.js — an ET award site's home order and its internal pages' words.
const as = require('./award-site');
var passed = 0, failed = 0;
function check(name, ok, detail) { if (ok) { passed++; return; } failed++; console.error('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); }

check('ET\'s home order', as.AWARD_SECTIONS.map(function (s) { return s.id; }).join() ===
  'award-band,overview,key-dates,why-enter,award-categories,how-it-works,award-jury,recognition,awards-night,who-should-enter,award-partners,past-edition-glimpses,faqs,contact-us,about-vertical');
check('ids a model may use find their section', as.awardSectionFor('Why Nominate').id === 'why-enter' && as.awardSectionFor('how-our-awards-work').id === 'how-it-works' &&
  as.awardSectionFor('grand-jury').id === 'award-jury' && as.awardSectionFor('awards-ceremony').id === 'awards-night' && as.awardSectionFor('who-can-enter').id === 'who-should-enter' &&
  as.awardSectionFor('frequently-asked-questions').id === 'faqs' && as.awardSectionFor('about-etcio').id === 'about-vertical' && as.awardSectionFor('random-thing') === null);
check('the sections built in ET\'s design by the server are marked', ['award-band', 'key-dates', 'award-categories', 'how-it-works', 'award-jury', 'recognition', 'awards-night', 'award-partners', 'faqs'].every(function (id) { return as.awardSectionFor(id).prebuilt; }));

var prev = { guidelines: { title: 'Entry Guidelines', blocks: [{ heading: 'How to submit your entry?', paragraphs: ['Create your account in 2026.'], bullets: ['Select your categories'] }] }, faq: [{ q: 'Who can enter?', a: 'Any brand.' }] };
var p = as.buildPagesPrompt({ event: { name: 'Shark Awards 2027', edition: '5th Edition', dates: { nominationClose: '2027-01-31 23:59:00' } }, previousPages: prev, needCategories: false });
check('the prompt carries this edition\'s dates, unknown ones as to be announced', /nominations close: 2027-01-31/.test(p) && /nominations open: to be announced/.test(p));
check('…the previous edition\'s pages, to be rewritten, never copied', /Previous edition: Entry Guidelines/.test(p) && /Create your account in 2026/.test(p) && /never copy its sentences/.test(p) && /Previous edition: FAQs/.test(p));
check('…categories asked for only when none are on record', /an empty array \(this edition/.test(p) && /propose 3 to 6 master categories/.test(as.buildPagesPrompt({ event: { name: 'X' }, needCategories: true })));
check('no previous edition: written from the brief', /There is no previous edition/.test(as.buildPagesPrompt({ event: { name: 'X' } })));

var s = as.sanitizePages({
  guidelines: { title: '', intro: 'x', blocks: [{ heading: 'Step 1', paragraphs: ['  a  ', ''], bullets: [] }, { heading: '', paragraphs: [], bullets: [] }] },
  judging: { title: 'Judging Criteria', intro: '', blocks: [] }, tnc: null,
  faq: [{ group: 'General Information', q: 'Q?', a: 'A.' }, { q: '', a: 'x' }],
  categories: [{ name: 'Brand Strategy', description: 'd', subcategories: [{ name: 'Integrated Campaign', description: 'e' }, { name: '' }] }]
}, true);
check('pages cleaned: empty blocks and pages dropped, the default title given', s.guidelines.title === 'Entry Guidelines' && s.guidelines.blocks.length === 1 && s.guidelines.blocks[0].paragraphs.join() === 'a' && s.judging === null && s.tnc === null, s);
check('faq cleaned', s.faq.length === 1 && s.faq[0].group === 'General Information');
check('proposed categories carry no fee (none is ever invented, not even "no fee")', s.categories.length === 1 && s.categories[0].slug === 'brand-strategy' && s.categories[0].fee === null && s.categories[0].subcategories[0].fee === null && s.categories[0].subcategories.length === 1);
check('categories ignored when on record', as.sanitizePages({ categories: [{ name: 'x', description: '', subcategories: [] }] }, false).categories.length === 0);

if (failed) { console.error('award-site: ' + failed + ' of ' + (passed + failed) + ' checks FAILED'); process.exit(1); }
console.log('award-site: all ' + passed + ' checks passed');
