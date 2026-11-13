/* node functions/lib/invented-facts.test.js — exits 1 on the first failure it lists.
   BE-043: what ETB2B AI wrote on an AI-designed site that nothing the event supplied supports (lib/invented-facts.js),
   and how lib/api.js uses it (generation, a section made again, the console's site check). No network, no Firebase. */
'use strict';
var F = require('./invented-facts');
var api = require('./api');
var kit = api._testHooks.TOKEN_KIT;
var fs = require('fs'), path = require('path');

var failures = [], checks = 0;
function ok(cond, label, detail) { checks++; if (!cond) failures.push(label + (detail !== undefined ? '\n      ' + String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 700) : '')); }
function kinds(list) { return list.map(function (x) { return x.kind + ':' + x.text; }); }
function has(list, kind, text) { return list.some(function (x) { return x.kind === kind && x.text === text; }); }

/* what the event supplied: its record, its brief, its previous edition — and a competitor's page, which is never
   this event's */
var EVENT = { name: 'Agentic AI Summit 2027', venue: 'Taj Lands End', city: 'Mumbai',
  description: 'A gathering of 500+ CIOs. Write to events@etb2b.com or call +91 98765 43210. India\'s largest CIO gathering.' };
var BRIEF = { theme: 'Agentic AI in the enterprise', keyMessages: ['40% of enterprises pilot agents'], sponsorHints: ['Microsoft'] };
var PREVIOUS = [{ url: 'https://cio.economictimes.indiatimes.com/agentic-ai-summit', extractedSections: [{ heading: 'Partners', body: 'Powered by Microsoft. 1,200 delegates attended.' }] }];
var g = F.groundOf(EVENT, BRIEF, PREVIOUS, 'Expected scale: 2 days');

/* ---------- 1. what is supplied, and what is not ---------- */
var PAGE = '<section data-rv-section="overview" data-rv-key="overview"><h2>Join <strong>500+</strong> CIOs</h2>' +
  '<p>Over 1,200 delegates and 60+ speakers across 2 days. 3x faster decisions. 40% of enterprises. A ₹82 trillion market. Visit www.agenticsummit2027.com.</p>' +
  '<p>India\'s largest CIO gathering and the first-ever agentic summit. Powered by Microsoft and Google. In partnership with The Economic Times.</p>' +
  '<p>Write to partners@agenticsummit.in or events@etb2b.com, call +91 99999 88888 or +91 98765 43210. 12, MG Road, Bengaluru - 560001.</p>' +
  '<a class="btn" href="mailto:hello@agenticsummit.in">Mail us</a><a href="https://agenticsummit2027.com/register">Our site</a>' +
  '<a href="tel:+919999988888">Call</a><a href="https://cio.economictimes.indiatimes.com/agentic-ai-summit">Last year</a>' +
  '<div data-rv-repeat-template="contact"><span data-rv-field="email">name@example.com</span><span data-rv-field="phone">+00 00000 00000</span><span>sales@made-up.in</span></div>' +
  '<p>Since 2019, and on 14-03-2027 again. Top 10 trends. Day 1, Track 2, Q2 2027, B2B, COVID-19, 5G, Tech500 and 24/7.</p>' +
  '<p hidden>Hidden: 999+ ghosts, ghost@nowhere.in</p><script>var phone = "+91 11111 22222";</script></section>' +
  '<section data-rv-section="footer"><p>Call ETB2B on 1800 123 4567 or write to help@indiatimes.com</p></section>' +
  '<section data-rv-section="hero"><p>99,999 visitors</p></section>';

var r = F.check(PAGE, g, kit);
ok(r.html === PAGE && r.removed.length === 0, '1 without fix nothing on the page changes and nothing is removed', r.removed);
['partners@agenticsummit.in', 'hello@agenticsummit.in'].forEach(function (e) { ok(has(r.flagged, 'email', e), '1 an e-mail nobody supplied is found: ' + e, kinds(r.flagged)); });
ok(has(r.flagged, 'phone', '+91 99999 88888') && has(r.flagged, 'phone', '+919999988888'), '1 a phone number nobody supplied is found, written out or linked', kinds(r.flagged));
ok(!has(r.flagged, 'email', 'events@etb2b.com') && !has(r.flagged, 'phone', '+91 98765 43210'), '1 the event\'s own e-mail and phone are supplied', kinds(r.flagged));
ok(has(r.flagged, 'figure', '60+ speakers') && has(r.flagged, 'figure', '3x') && has(r.flagged, 'money', '₹82 trillion market'), '1 a figure and an amount nobody supplied are flagged', kinds(r.flagged));
ok(!r.flagged.some(function (x) { return /500\+|1,200|40%|2 days/.test(x.text); }), '1 figures the brief, the record or the previous edition give are supplied (500+, 1,200, 40%, 2 days)', kinds(r.flagged));
ok(has(r.flagged, 'web', 'www.agenticsummit2027.com') && has(r.flagged, 'web', 'https://agenticsummit2027.com/register'), '1 a web address nobody supplied, written out or linked', kinds(r.flagged));
ok(!r.flagged.some(function (x) { return /economictimes/.test(x.text); }), '1 the previous edition\'s own address and ET\'s are not claims', kinds(r.flagged));
ok(has(r.flagged, 'award', 'first-ever') && !r.flagged.some(function (x) { return /largest/.test(x.text); }), '1 a "first-ever" claim nobody made is flagged; "India\'s largest" from the record is not', kinds(r.flagged));
ok(has(r.flagged, 'partner', 'Microsoft and Google') && !r.flagged.some(function (x) { return /Economic Times/.test(x.text); }), '1 a partner nobody named is flagged (Google); ETB2B\'s own name is not', kinds(r.flagged));
ok(has(r.flagged, 'address', '12, MG Road') && has(r.flagged, 'address', '560001'), '1 a street address and a PIN code nobody supplied', kinds(r.flagged));
ok(r.flagged.filter(function (x) { return x.kind === 'figure'; }).map(function (x) { return x.text; }).join('|') === '60+ speakers|3x', '1 years, dates, list numbers and names with digits are not statistics: the only figures are the two nobody supplied', kinds(r.flagged));
ok(!r.flagged.some(function (x) { return /example\.com|\+00 00000|made-up|ghost|11111|999\+/.test(x.text); }), '1 placeholders, record templates, hidden text and scripts are never read', kinds(r.flagged));
ok(!r.flagged.some(function (x) { return /1800|indiatimes|99,999/.test(x.text); }), '1 the footer and the banner (the server\'s own) are not read', kinds(r.flagged));
ok(r.flagged.every(function (x) { return x.section === 'overview'; }), '1 each says the section it is in', r.flagged.map(function (x) { return x.section; }));

/* ---------- 2. the fix: contacts nobody supplied become the placeholders the check before publishing holds back ---------- */
var fixed = F.check(PAGE, g, kit, { fix: true });
ok(fixed.html.indexOf('partners@agenticsummit.in') === -1 && fixed.html.indexOf('hello@agenticsummit.in') === -1 && fixed.html.indexOf('+91 99999 88888') === -1 && fixed.html.indexOf('tel:+919999988888') === -1,
  '2 no invented e-mail or phone number is left, in the words or in a link', fixed.html.slice(0, 900));
ok(fixed.html.indexOf('Write to name@example.com or events@etb2b.com, call +00 00000 00000 or +91 98765 43210.') !== -1, '2 each became the unmistakable placeholder; the event\'s own stayed', fixed.html);
ok(fixed.html.indexOf('href="mailto:name@example.com"') !== -1 && fixed.html.indexOf('href="tel:+000000000000"') !== -1 && fixed.html.indexOf('class="btn"') !== -1, '2 a link keeps its tag and other attributes; only its address changes', fixed.html);
ok(kinds(fixed.removed).sort().join() === ['email:hello@agenticsummit.in', 'email:partners@agenticsummit.in', 'phone:+91 99999 88888', 'phone:+919999988888'].sort().join(), '2 the removals are listed', kinds(fixed.removed));
ok(fixed.html.indexOf('60+ speakers') !== -1 && fixed.html.indexOf('first-ever') !== -1 && has(fixed.flagged, 'figure', '60+ speakers'), '2 the rest is flagged, never cut out of a sentence', kinds(fixed.flagged));
ok(fixed.html.indexOf('sales@made-up.in') !== -1 && fixed.html.indexOf('+91 11111 22222') !== -1 && fixed.html.indexOf('1800 123 4567') !== -1, '2 a record template, a script and the footer are left as they are', fixed.html.slice(-500));
var again = F.check(fixed.html, g, kit, { fix: true });
ok(again.html === fixed.html && again.removed.length === 0, '2 running it again changes nothing (the placeholders are not claims)', again.removed);
var siteCheck = require('./site-checks');
ok(siteCheck.placeholderHits(fixed.html, kit).some(function (h) { return h.text.indexOf('name@example.com') !== -1; }), '2 the check before publishing finds the placeholder it holds back', siteCheck.placeholderHits(fixed.html, kit));

/* ---------- 3. sections, as generation keeps them ---------- */
var SECTIONS = [{ id: 'hero', html: '<section id="hero"><p>Call +91 70000 00001</p></section>', css: '' },
  { id: 'contact-us', kind: 'contact', html: '<section id="contact-us"><h2>Talk to us</h2><p>Partnerships: deals@agentic.in, +91 90000 12345</p></section>', css: '.x{}' },
  { id: 'overview', html: '<section id="overview"><p>Two days with 500+ CIOs.</p></section>', css: '' }];
var cs = F.checkSections(SECTIONS, g, kit, { fix: true });
ok(cs.sections[0] === SECTIONS[0] && cs.sections[2] === SECTIONS[2], '3 the banner (the server\'s) and a section with nothing to fix are the same objects', cs.sections);
ok(cs.sections[1] !== SECTIONS[1] && cs.sections[1].css === '.x{}' && cs.sections[1].kind === 'contact' &&
  cs.sections[1].html === '<section id="contact-us"><h2>Talk to us</h2><p>Partnerships: name@example.com, +00 00000 00000</p></section>', '3 a section with an invented contact is a new object with only its html changed', cs.sections[1]);
ok(SECTIONS[1].html.indexOf('deals@agentic.in') !== -1, '3 the sections given are not changed');
ok(cs.removed.every(function (x) { return x.section === 'contact-us'; }) && cs.removed.length === 2, '3 the removals name their section', cs.removed);
ok(F.summary(cs) === 'removed 1 e-mail address, 1 phone number', '3 the log line', F.summary(cs));
ok(F.summary({ removed: [], flagged: [{ kind: 'figure' }, { kind: 'figure' }, { kind: 'award' }] }) === 'flagged 2 figures, 1 claim', '3 the log line, plural', F.summary({ removed: [], flagged: [{ kind: 'figure' }, { kind: 'figure' }, { kind: 'award' }] }));

/* ---------- 4. findings, as the site check lists them ---------- */
var fd = F.findings(PAGE + PAGE.replace('data-rv-section="overview" data-rv-key="overview"', 'data-rv-section="why" data-rv-key="why"'), g, kit, {});
var phone = fd.filter(function (f) { return f.text === '+91 99999 88888'; })[0];
ok(phone && phone.count === 2 && phone.label === 'phone number' && phone.sections.join() === 'Overview,Why' && phone.places.length === 2 && phone.places[1].key === 'why', '4 grouped by what it says, with its count, its sections and a place in the editor for each', phone);
ok(F.findings('<section data-rv-section="overview"><p>Our own words, nothing else.</p></section>', g, kit, {}).length === 0, '4 a page that states nothing unsupplied has none');
ok(F.findings(PAGE, g, kit, { skipSections: ['overview', 'hero', 'footer'] }).length === 0, '4 the sections the server built are left out');

/* ---------- 5. a section made again: grounded in the section as it stood and the owner's words ---------- */
var before = '<section id="contact"><p>Write to priya@client.com</p></section>';
var g2 = F.groundOf(before, 'add our desk: desk@client.com', EVENT);
var re = F.check('<section id="contact"><p>Write to priya@client.com or desk@client.com, or rahul@client.com</p></section>', g2, kit, { fix: true, skipSections: [] });
ok(re.html === '<section id="contact"><p>Write to priya@client.com or desk@client.com, or name@example.com</p></section>', '5 what the section had and what the owner asked for stay; a new one the model made up does not', re.html);

/* ---------- 5b. the previous edition's records: their figures, written as the numbers band writes them ---------- */
function many(n, f) { var a = []; for (var i = 0; i < n; i++) a.push(f(i)); return a; }
var PREV = { speakers: many(64, function (i) { return { name: 'Speaker ' + i, company: i === 0 ? 'Infosys' : 'Co ' + i }; }),
  agenda: many(39, function (i) { return { title: 'S' + i, start: i < 20 ? '2026-02-10T09:00' : '2026-02-11T09:00' }; }),
  sponsors: many(32, function (i) { return { name: i === 0 ? 'Zoho' : 'Sponsor co ' + i }; }) };
var g3 = F.groundOf(EVENT, F.previousFacts(PREV));
var band = '<section data-rv-section="by-the-numbers"><p>60+ speakers</p><p>32+ partners</p><p>39 sessions</p><p>2 days</p><p>50+ speakers</p>' +
  '<p>100+ speakers</p><p>70 partners</p><p>Supported by Zoho and Infosys</p></section>';
var bandFlags = F.check(band, g3, kit).flagged;
ok(kinds(bandFlags).join() === 'figure:100+ speakers,figure:70 partners', '5b the previous edition\'s counts support "60+ speakers", "32+ partners", "39 sessions" and "2 days" (a "+" up to half again); larger ones are flagged; its sponsors and speakers\' companies are names it supplied', kinds(bandFlags));
ok(F.previousFacts(null).length === 0 && F.previousFacts({}).join('') !== undefined, '5b no records, nothing');
/* an award site's sections, built from ETB2B's award records, are never read */
var awardPage = '<section data-rv-section="award-category-list"><p>Turnover above ₹33,000 crore, 500k users, 5% growth</p></section><section data-rv-section="overview"><p>India\'s most influential awards</p></section>';
var aw = F.findings(awardPage, g, kit, { skipSections: ['hero', 'nav', 'footer', 'award-*'] });
ok(aw.length === 1 && aw[0].kind === 'award' && aw[0].sections.join() === 'Overview', '5b "award-*" leaves every award section out; the model\'s own overview is still read', aw);

/* ---------- 6. how lib/api.js uses it ---------- */
/* lib/api.js and the route modules moved out of it as they were (BE-017): the AI site generation, the editor's chat, the Lovable import */
var SRC = ['api.js', 'api-generate.js', 'api-chat.js', 'api-import.js'].map(function (f) { return fs.readFileSync(path.join(__dirname, f), 'utf8'); }).join('\n');
function fnBody(name) { var i = SRC.indexOf('function ' + name + '('); return i === -1 ? '' : SRC.slice(i, SRC.indexOf('\n}\n', i)); }
var gen = fnBody('runGenerateDesignedContent');
ok(/inventedFacts\.checkSections\(sections, inventedFacts\.groundOf\(eventMeta, stored\.description, brief,\s*sources\.filter\(function \(x\) \{ return x\.type !== 'competitor'; \}\)/.test(gen) && /\{ fix: true \}/.test(gen),
  '6 generation checks the model\'s sections against the event, its brief and its own sources (never a competitor\'s), and fixes contacts');
ok(gen.indexOf('inventedFacts.checkSections') < gen.indexOf('prevSections.build') && gen.indexOf('inventedFacts.checkSections') > gen.indexOf('genDesign.restorePictures'), '6 … once the pictures are addresses, before the server\'s own sections are put in');
ok(/console\.warn\('generate-content: ' \+ eventId \+ ' — facts nothing supplied: ' \+ inventedFacts\.summary\(facts\)/.test(gen), '6 … and logs what it removed and flagged');
var rd = fnBody('handleRedesignSection');
ok(/inventedFacts\.check\(newHtml, inventedFacts\.groundOf\(origHtml, payload\.instruction, eventFacts\(data, null\)/.test(rd) && rd.indexOf('inventedFacts.check(') < rd.indexOf('safeGeneratedSection('), '6 a section made again (and the chat\'s edits) is checked against the section as it stood and the owner\'s words, before the safety step');
var sc = fnBody('siteCheckOf');
ok(/ins\.generated \? Promise\.resolve\(\)\.then\(function \(\) \{ return factGroundOf\(fb, eventId, data\); \}\)/.test(sc) && /return \[\];\s*\}\) : Promise\.resolve\(\[\]\);/.test(sc) && /code: 'facts', level: 'warn'/.test(sc) && sc.indexOf("code: 'facts', level: 'block'") === -1, '6 the site check lists them for an AI-designed site, as a warning, never a block, and a check that fails says nothing');
ok(/var ids = \['hero', 'nav', 'footer', 'award-\*'\];/.test(fnBody('factSkips')) && /x\.prebuilt && x\.id/.test(fnBody('factSkips')), '6 … leaving out what the server built: banner, top bar, footer, the previous edition\'s sections, an award site\'s');
ok(/inventedFacts\.previousFacts\(v\.previous\)/.test(gen) && /inventedFacts\.previousFacts\(v\.previous\)/.test(fnBody('factGroundOf')), '6 generation and the site check both count the previous edition\'s records as supplied');
var fg = fnBody('factGroundOf');
ok(/type !== 'competitor'/.test(fg) && /briefs/.test(fg) && /FACT_RECORD_FIELDS/.test(fg) && /return null;/.test(fg), '6 … grounded in its record, brief, own sources and Content records; nothing said when they cannot be read');

if (failures.length) {
  console.error('invented-facts: ' + failures.length + ' of ' + checks + ' checks failed:\n  - ' + failures.join('\n  - '));
  process.exit(1);
}
console.log('invented-facts: all ' + checks + ' checks passed');
