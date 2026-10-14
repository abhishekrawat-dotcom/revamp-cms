// node functions/lib/owner-brief.test.js — the owner's ten points, read from a description and a deck.
const ob = require('./owner-brief');

var passed = 0, failed = 0;
function check(name, ok, detail) { if (ok) { passed++; return; } failed++; console.error('FAIL ' + name + (detail ? ' — ' + detail : '')); }
function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

/* the template exactly as Create Event writes it, empty */
var TEMPLATE = [
  'Tagline / theme: ', 'Why attend (what sets it apart): ', 'Audience: ', 'Industry: ', 'Level (pan-India / global / regional): ',
  'Format and city (in-person / virtual / hybrid): ', 'Main action (register / request an invite / apply / nominate / become a sponsor): ',
  'Expected scale (delegates, speakers, partners): ', 'Look and tone (photos or graphics; boardroom / energetic / editorial): ', 'Must avoid: '
].join('\n');

check('an empty template says nothing', eq(ob.fromText(TEMPLATE), {}) && ob.normalise(ob.fromText(TEMPLATE)) === null);

var filled = TEMPLATE
  .replace('Tagline / theme: ', 'Tagline / theme: “Built for human decisions. Now run by agents.”')
  .replace('Why attend (what sets it apart): ', 'Why attend (what sets it apart): The only summit on rolling out AI agents at enterprise scale')
  .replace('Audience: ', 'Audience: CIOs, CTOs and heads of AI')
  .replace('Industry: ', 'Industry: BFSI, manufacturing')
  .replace('Level (pan-India / global / regional): ', 'Level (pan-India / global / regional): Pan-India')
  .replace('Format and city (in-person / virtual / hybrid): ', 'Format and city (in-person / virtual / hybrid): In-person, Mumbai')
  .replace('Main action (register / request an invite / apply / nominate / become a sponsor): ', 'Main action (register / request an invite / apply / nominate / become a sponsor): Request an invite')
  .replace('Expected scale (delegates, speakers, partners): ', 'Expected scale (delegates, speakers, partners): 300 delegates, 40 speakers')
  .replace('Look and tone (photos or graphics; boardroom / energetic / editorial): ', 'Look and tone (photos or graphics; boardroom / energetic / editorial): Photos, boardroom')
  .replace('Must avoid: ', 'Must avoid: competitor names; "largest in India"') + '\n\nA closed-door summit for 300 leaders.';
var raw = ob.fromText(filled);
check('every filled heading is read, the options in brackets never', raw.level === 'Pan-India' && raw.mainAction === 'Request an invite' && !/register \//.test(JSON.stringify(raw)));
check('free text after the headings is not taken into the last heading', raw.mustAvoid === 'competitor names; "largest in India"', raw.mustAvoid);
var o = ob.normalise(raw);
check('tagline word for word, quotes taken off', o.tagline === 'Built for human decisions. Now run by agents.', o.tagline);
check('level read', o.level === 'india');
check('format read, with the owner\'s words kept', o.format === 'in-person' && o.formatText === 'In-person, Mumbai');
check('main action read', eq(o.action, { kind: 'request-invite', label: 'Request an Invite' }), JSON.stringify(o.action));
check('look: photos and boardroom', o.pictures === 'photos' && o.tone === 'boardroom');

/* the ways people really write them */
check('heading without its brackets, value on the next line', eq(ob.fromText('Main action:\nApply now\n\nOther text'), { mainAction: 'Apply now' }));
check('a bullet before the heading', ob.fromText('- Audience: CFOs').audience === 'CFOs');
check('"TBD" and "-" are not answers', eq(ob.fromText('Tagline: TBD\nScale: -\nAudience: n/a'), {}));
check('a heading that is not one of the ten is not read', eq(ob.fromText('Venue: Taj\nTheme: Growth'), { tagline: 'Growth' }));
check('first answer wins over a repeated heading', ob.fromText('Audience: CXOs\nAudience: interns').audience === 'CXOs');

function n(k, v) { var r = {}; r[k] = v; return ob.normalise(r) || {}; }
check('level: global', n('level', 'Global, with an India focus').level === 'global');
check('level: regional', n('level', 'Regional (South)').level === 'regional');
check('level: the option list itself is no choice', !n('level', 'pan-India / global / regional').level);
check('format: hybrid from both', n('format', 'In person in Delhi, also online').format === 'hybrid');
check('format: virtual', n('format', 'Online webinar').format === 'virtual');
check('format: a place only is in person', n('format', 'Bengaluru').format === 'in-person');
check('action: nominate', n('mainAction', 'Nominations').action.kind === 'nominate');
check('action: two in order -> primary and second', (function () { var x = n('mainAction', 'Register; also become a sponsor'); return x.action.kind === 'register' && x.secondAction.kind === 'sponsor'; })());
check('action: the option list copied is no choice', !n('mainAction', 'register / request an invite / apply / nominate / become a sponsor').action);
check('action: the owner\'s own words become the button', eq(n('mainAction', 'book a 1:1 meeting').action, { kind: 'custom', label: 'Book a 1:1 meeting' }));
check('look: "no photos" is graphics', n('look', 'No photos, minimal').pictures === 'graphics' && n('look', 'No photos, minimal').tone === 'editorial');
check('look: the example copied ("photos or graphics") decides nothing about pictures', !n('look', 'Event photos or graphics').pictures);

/* merge: the owner's lines first, the deck's for the rest */
var m = ob.merge({ mainAction: 'Apply' }, { mainAction: 'Register', audience: 'Founders', tagline: 'Deck line' });
check('merge: the description wins a point both give', m.action.kind === 'apply' && m.from.mainAction === 'description');
check('merge: the deck fills the rest', m.audience === 'Founders' && m.tagline === 'Deck line' && m.from.audience === 'document');
check('merge: nothing from either is null', ob.merge({}, {}) === null && ob.merge(null, null) === null);

/* buttons */
var t = { register: 'contact-us', partner: 'sponsors' };
check('buttons: nothing said -> as before', eq(ob.buttons(null, t), { primary: { label: 'Register Now', href: '#contact-us', register: true }, secondary: { label: 'Join as Partner', href: '#sponsors' } }));
check('buttons: request an invite', ob.buttons(o, t).primary.label === 'Request an Invite' && ob.buttons(o, t).primary.register === true);
var sp = ob.buttons(ob.normalise({ mainAction: 'Become a sponsor' }), t);
check('buttons: sponsor first leads to partners, register second', sp.primary.href === '#sponsors' && sp.primary.register === false && sp.secondary.label === 'Register Now');
check('buttons: no partners section -> the register target', ob.buttons(ob.normalise({ mainAction: 'Sponsor' }), { register: 'footer' }).primary.href === '#footer');

/* prompt lines */
var pl = ob.planLines(o).join('\n'), cl = ob.copyLines(o).join('\n');
check('plan lines carry each point', /exactly this, word for word/.test(pl) && /pan-India/.test(pl) && /Request an Invite/.test(pl) && /300 delegates/.test(pl) && /MUST AVOID/.test(pl) && /boardroom/.test(pl));
check('copy lines: an invitation event never says Register', /never "Register"/.test(cl));
check('graphics turns pictures off in the plan', /sections\[\]\.image empty/.test(ob.planLines(ob.normalise({ look: 'graphics only' })).join('\n')));
check('nothing given -> no lines', ob.planLines(null).length === 0 && ob.copyLines(null).length === 0);

/* directions, not content */
check('a scale without a number is no scale', !n('scale', 'delegates').scale && n('scale', '500 delegates').scale === '500 delegates');
check('withoutHeadings keeps only the free text', ob.withoutHeadings(filled) === 'A closed-door summit for 300 leaders.', JSON.stringify(ob.withoutHeadings(filled)));
check('withoutHeadings of only headings is empty', ob.withoutHeadings(TEMPLATE) === '' && ob.withoutHeadings('') === '' && ob.withoutHeadings(null) === '');
check('withoutHeadings drops a heading\'s next lines too', ob.withoutHeadings('Audience:\nCIOs\nCTOs\n\nA forum.') === 'A forum.', JSON.stringify(ob.withoutHeadings('Audience:\nCIOs\nCTOs\n\nA forum.')));
check('plan and copy lines say the points are never shown', /DIRECTIONS that steer your work, not content/.test(pl) && /DIRECTIONS that steer your work, not content/.test(cl) && /no "Reach", "Level", "Pan-India"/.test(pl));
check('no rule asks for a band of the points', !/include a band/i.test(pl + cl));

if (failed) { console.error('owner-brief: ' + failed + ' of ' + (passed + failed) + ' checks FAILED'); process.exit(1); }
console.log('owner-brief: all ' + passed + ' checks passed');
