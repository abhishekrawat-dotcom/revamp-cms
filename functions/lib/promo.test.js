/* node functions/lib/promo.test.js — exits 1 on the first failure it lists. No network, no Firebase: the pure
   parts of lib/promo.js (the brand of a generated, a ported and an unknown site; the event's hashtag, edition
   and numbers; the brief's audience; which picture addresses the image route may fetch; the AI copy's
   prompts and how what comes back is cut). */
const P = require('./promo')._test;

var failures = [], checks = 0;
function ok(cond, label, detail) { checks++; if (!cond) failures.push(label + (detail ? '\n      ' + detail : '')); }
function gf(f) { return 'https://fonts.googleapis.com/css2?family=' + encodeURIComponent(f).replace(/%20/g, '+') + ':wght@300;400;500;600;700;800&display=swap'; }
var BUCKET = 'revamp-cms.firebasestorage.app';
var OWN = 'https://storage.googleapis.com/' + BUCKET + '/events/qa-gen/';

/* ---------- a generated site, saved ---------- */
var genPage = '<html style="--theme-color-hex:#aa0000"><head>' +
  '<link rel="stylesheet" href="/templates/_shared/gen-base.css">' +
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700;800&amp;display=swap">' +
  '<style data-rv-design data-rv-state=\'{"radius":"20px","headingColor":"#fafafa","headingFont":"\\"Space Grotesk\\", Arial, sans-serif"}\'></style></head>' +
  '<body id="gen" class="microsite rv-generated" style="--theme-color:#ed1c24;--accent-color:#c9a45c;--heading-font-family:&quot;Montserrat&quot;, Arial, sans-serif;' +
  '--body-font-family:&quot;Lora&quot;, Arial, sans-serif;--rv-bg:#0b0b0d;--rv-surface:#17171b;--rv-text:#f4f2ee;--rv-muted:#a9a6a0;background-color:#0b0b0d">' +
  '<header data-rv-section="nav"><img data-rv-logo src="' + OWN + 'logo/nav.svg"></header>' +
  '<section data-rv-section="hero" id="hero" data-rv-key="hero"><div class="rv-lu rv-lu-pic rv-lu-on-dark" data-rv-logo-unit>' +
  '<span class="rv-lu-plate rv-lu-plate-light"><img class="rv-lu-img" src="' + OWN + 'generated/1-logo-unit.svg" width="422" height="340"></span></div>' +
  '<a class="hero-btn" data-register-cta href="#the-close">Register</a><a href="#nowhere" data-register-cta>x</a></section>' +
  '<style data-rv-style="hero">[data-rv-section="hero"]{background-image:url("' + OWN + 'generated/hero-bg.png?v=2")}</style>' +
  '<section data-rv-section="floor" data-rv-key="floor"><img src="' + OWN + 'generated/1-floor.png"><img src="https://storage.googleapis.com/' + BUCKET + '/events/other/generated/x.png"></section>' +
  '<section data-rv-section="the-close" id="the-close"><h2>Join</h2></section></body></html>';
var genPlan = { design: { mode: 'light', themeColor: '#123456', accentColor: '#654321', headingFont: 'Inter', bodyFont: 'Inter', cornerRadius: '6',
  logoUnit: { before: '', keyword: 'GCC', after: 'Annual Conclave' }, logoUnitUrl: OWN + 'generated/old-logo-unit.svg', heroImageUrl: OWN + 'generated/plan-hero.png' },
  sections: [{ id: 'a', imageUrl: OWN + 'generated/1-floor.png' }, { id: 'b', imageUrl: OWN + 'generated/1-tracks.png' }, { id: 'c', imageUrl: '' }] };
var genEvent = { name: 'GCC Annual Conclave', templateId: 'gen-qa-gen', logoUrl: '' };
var b = P.brandFromSources({ eventId: 'qa-gen', bucket: BUCKET, event: genEvent, plan: genPlan, pageHtml: genPage, template: null, gallery: [OWN + 'gallery/g1.jpg'], googleFontUrl: gf });
ok(b.kind === 'generated' && b.mode === 'dark', 'generated: kind, and the mode follows the saved page, not the plan', b.kind + ' ' + b.mode);
ok(b.colours.theme === '#ed1c24' && b.colours.accent === '#c9a45c' && b.colours.background === '#0b0b0d' && b.colours.surface === '#17171b' &&
  b.colours.text === '#f4f2ee' && b.colours.muted === '#a9a6a0' && b.colours.heading === '#fafafa', 'generated: every colour from the saved page', JSON.stringify(b.colours));
ok(b.colours.onTheme === '#ffffff', 'generated: text on the brand colour', b.colours.onTheme);
ok(Object.keys(b.colours).every(function (k) { return /^#[0-9a-f]{6}$/.test(b.colours[k]); }), 'generated: colours are #rrggbb');
ok(b.fonts.heading.family === 'Space Grotesk' && b.fonts.heading.cssUrl === 'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700;800&display=swap',
  'generated: the editor\'s heading font wins, with the stylesheet the page links', JSON.stringify(b.fonts.heading));
ok(b.fonts.body.family === 'Lora' && b.fonts.body.cssUrl === gf('Lora') && b.fonts.body.stack === "'Lora', Arial, sans-serif", 'generated: body font from the page, a Google Fonts address made for it', JSON.stringify(b.fonts.body));
ok([b.fonts.heading.stack, b.fonts.body.stack].every(function (s) { return s.indexOf('"') === -1; }), 'font stacks carry no double quote (they go into style="" attributes)', b.fonts.heading.stack);
ok(b.radius === '20px','generated: the editor\'s corner radius', b.radius);
ok(b.logoUnit && b.logoUnit.url === OWN + 'generated/1-logo-unit.svg' && b.logoUnit.width === 422 && b.logoUnit.height === 340 && b.logoUnit.tone === 'light',
  'generated: the page\'s logo unit, its tone the plate it stands on', JSON.stringify(b.logoUnit));
ok(b.eventLogoUrl === OWN + 'logo/nav.svg', 'generated: the nav logo when the event has no logoUrl', b.eventLogoUrl);
ok(b.heroImageUrl === OWN + 'generated/hero-bg.png?v=2', 'generated: the hero picture from the hero\'s own style', b.heroImageUrl);
ok(b.pictures.join() === [OWN + 'generated/1-floor.png', OWN + 'generated/1-tracks.png', OWN + 'gallery/g1.jpg'].join(),
  'generated: the page\'s own pictures, then the plan\'s, then the gallery; never another event\'s, the logo unit or the hero', JSON.stringify(b.pictures));
ok(b.logoUnitParts.keyword === 'GCC' && b.logoUnitParts.after === 'Annual Conclave', 'generated: the name split for a unit set in type', JSON.stringify(b.logoUnitParts));
ok(P.registerAnchor(P.readSavedPage(genPage)) === '#the-close', 'the register button\'s target, when it is on the page');
ok(P.registerAnchor(P.readSavedPage(genPage.replace('id="the-close"', ''))) === '', 'a register button pointing at nothing: no anchor');
ok(P.registerAnchor(P.readSavedPage('<body><div id="register"></div></body>')) === '#register', 'an element with id="register"');

/* ---------- a generated site, never saved ---------- */
var u = P.brandFromSources({ eventId: 'qa-gen', bucket: BUCKET, event: genEvent, plan: Object.assign({}, genPlan, { design: Object.assign({}, genPlan.design, { logoUnitHeroMode: 'dark', logoUnitWidth: 500, logoUnitHeight: 200 }) }), pageHtml: null, template: null, gallery: [], googleFontUrl: gf });
ok(u.mode === 'light' && u.colours.theme === '#123456' && u.colours.accent === '#654321' && u.colours.background === '#ffffff', 'unsaved generated: the plan\'s colours, its page colours from its mode', JSON.stringify(u.colours));
ok(u.radius === '6px' && u.fonts.heading.family === 'Inter' && u.fonts.heading.cssUrl === gf('Inter'), 'unsaved generated: the plan\'s radius and fonts', u.radius + ' ' + JSON.stringify(u.fonts.heading));
ok(u.logoUnit && u.logoUnit.url === OWN + 'generated/old-logo-unit.svg' && u.logoUnit.tone === 'dark' && u.logoUnit.width === 500, 'unsaved generated: the plan\'s logo unit, drawn for the previous edition\'s tone', JSON.stringify(u.logoUnit));
ok(u.heroImageUrl === OWN + 'generated/plan-hero.png', 'unsaved generated: the plan\'s hero picture', u.heroImageUrl);
var typed = P.brandFromSources({ eventId: 'qa-gen', bucket: BUCKET, event: genEvent, plan: genPlan, pageHtml: genPage.replace(/<span class="rv-lu-plate[\s\S]*?<\/span>/, '<div class="rv-lu-name">GCC</div>'), template: null, gallery: [], googleFontUrl: gf });
ok(typed.logoUnit === null, 'a saved page whose unit is set in type: no logo unit picture (not the plan\'s old one)');

/* ---------- a ported template ---------- */
var tech = P.templateFiles('tech500');
ok(tech && tech.json && /Fraunces/.test(tech.themeCss), 'the tech500 template is read from disk');
ok(P.templateFiles('gen-x') === null && P.templateFiles('../etc') === null && P.templateFiles('no-such-template') === null, 'only a real template folder is read');
var sample = 'https://img.etb2bimg.com/files/data_file_17842719648277_96645.jpg';
var portedPage = '<html><head></head><body id="cio" style="--theme-color:rgba(216, 21, 30, 1);--bg-color:rgba(255, 255, 255, 1);--body-color:rgba(0, 0, 0, 1);background-color:#ffffff">' +
  '<section data-rv-section="banner"><img class="banner-bg-image" src="' + sample + '"><img class="logo" data-rv-bind="event.logo" src="https://storage.googleapis.com/' + BUCKET + '/events/qa-p/logo/l.png"></section>' +
  '<section data-rv-section="partners"><img class="logo" src="https://img.etb2bimg.com/partner.png"></section></body></html>';
var p = P.brandFromSources({ eventId: 'qa-p', bucket: BUCKET, event: { name: 'Tech500 2026', templateId: 'tech500', start: '2026-11-20' }, plan: null, pageHtml: portedPage, template: tech, gallery: ['https://storage.googleapis.com/' + BUCKET + '/events/qa-p/gallery/g.jpg'], googleFontUrl: gf });
ok(p.kind === 'ported' && p.mode === 'light' && p.colours.theme === '#d8151e' && p.colours.text === '#000000' && p.colours.background === '#ffffff', 'ported: colours from the page, rgba() made hex', JSON.stringify(p.colours));
ok(p.colours.heading === '#0d0d0f', 'ported: the template\'s heading colour', p.colours.heading);
ok(p.colours.accent === '#000000', 'ported: the navigation bar\'s colour as the accent', p.colours.accent);
ok(p.fonts.heading.family === 'Fraunces' && /family=Fraunces/.test(p.fonts.heading.cssUrl) && p.fonts.heading.stack === "'Fraunces', serif", 'ported: the -v2 heading font from theme.css, with its @import', JSON.stringify(p.fonts.heading));
ok(p.fonts.body.family === 'Inter' && /family=Inter:/.test(p.fonts.body.cssUrl), 'ported: the body font with the template\'s own font address', JSON.stringify(p.fonts.body));
ok(p.radius === '0px', 'ported: ET\'s square button', p.radius);
ok(p.heroImageUrl === 'https://storage.googleapis.com/' + BUCKET + '/events/qa-p/gallery/g.jpg', 'ported: the template\'s sample banner is never the hero; the gallery is', p.heroImageUrl);
ok(p.logoUnit && /\/qa-p\/logo\/l\.png$/.test(p.logoUnit.url), 'ported: the banner\'s logo is the lock-up, not a partner logo', JSON.stringify(p.logoUnit));
var own = P.brandFromSources({ eventId: 'qa-p', bucket: BUCKET, event: { name: 'T', templateId: 'tech500' }, plan: null, pageHtml: portedPage.replace(sample, 'https://storage.googleapis.com/' + BUCKET + '/events/qa-p/banner/b.jpg'), template: tech, gallery: [], googleFontUrl: gf });
ok(own.heroImageUrl === 'https://storage.googleapis.com/' + BUCKET + '/events/qa-p/banner/b.jpg', 'ported: the event\'s own banner is the hero', own.heroImageUrl);
var bare = P.brandFromSources({ eventId: 'qa-p', bucket: BUCKET, event: { name: 'T', templateId: 'tech500', bannerUrl: sample }, plan: null, pageHtml: null, template: tech, gallery: [], googleFontUrl: gf });
ok(bare.heroImageUrl === '' && bare.logoUnit === null && bare.colours.theme === '#d8151e', 'ported, never saved: template values, a sample bannerUrl is not a hero', JSON.stringify([bare.heroImageUrl, bare.logoUnit, bare.colours.theme]));
var cx = P.brandFromSources({ eventId: 'qa-p', bucket: BUCKET, event: { name: 'CX', templateId: 'cx-leaders-forum' }, plan: null, pageHtml: null, template: P.templateFiles('cx-leaders-forum'), gallery: [], googleFontUrl: gf });
ok(cx.fonts.heading.family === 'SangBleuVersailles-Bold-WebS' && /^data:text\/css/.test(cx.fonts.heading.cssUrl) && /st\.etb2bimg\.com/.test(decodeURIComponent(cx.fonts.heading.cssUrl)),
  'ported: a self-hosted ET font comes as its own @font-face stylesheet', JSON.stringify(cx.fonts.heading).slice(0, 200));
ok(cx.colours.accent !== cx.colours.theme && cx.colours.background === '#fff0e6', 'ported: a near-black brand colour still gets an accent that differs', JSON.stringify(cx.colours));
var retail = P.brandFromSources({ eventId: 'qa-p', bucket: BUCKET, event: { name: 'R', templateId: 'retail-leadership-summit' }, plan: null, pageHtml: null, template: P.templateFiles('retail-leadership-summit'), gallery: [], googleFontUrl: gf });
ok(retail.mode === 'dark' && retail.colours.text === '#ffffff' && retail.colours.onTheme === '#14161b' && retail.radius === '6px', 'ported dark: white text (not --default-color), dark type on a pale brand colour, its button radius', JSON.stringify([retail.mode, retail.colours, retail.radius]));
ok(P.templateRadius(P.templateFiles('making-ai-work')) === '80px', 'ported: a pill button from theme.css');

/* ---------- a site this product did not design, or none at all ---------- */
var none = P.brandFromSources({ eventId: 'qa-n', bucket: BUCKET, event: { name: 'Some Event' }, plan: null, pageHtml: null, template: null, gallery: ['data:image/png;base64,xx', 'https://storage.googleapis.com/' + BUCKET + '/events/qa-n/gallery/1.jpg'], googleFontUrl: gf });
ok(none.kind === 'unknown' && none.mode === 'light' && none.colours.theme === '#186bf9' && none.fonts.heading.family === 'Plus Jakarta Sans' && none.fonts.body.family === 'Inter' && none.radius === '12px',
  'unknown, unsaved: the fallbacks', JSON.stringify(none).slice(0, 300));
ok(none.logoUnit === null && none.eventLogoUrl === '' && /gallery\/1\.jpg$/.test(none.heroImageUrl) && none.pictures.length === 0, 'unknown: no unit, the gallery picture as the hero, no data: pictures', JSON.stringify([none.heroImageUrl, none.pictures]));
var elsewhere = P.brandFromSources({ eventId: 'qa-n', bucket: BUCKET, event: { name: 'E', logoUrl: 'https://example.com/logo.png', templateId: 'gen-qa-n' }, template: null, pageHtml: null, googleFontUrl: gf,
  plan: { design: { heroImageUrl: 'https://storage.googleapis.com/' + BUCKET + '/events/someone-else/generated/h.png', logoUnitUrl: 'https://cdn.example.com/unit.svg' }, sections: [{ imageUrl: 'https://storage.googleapis.com/' + BUCKET + '/events/qa-n/generated/s.png' }] }, gallery: [] });
ok(elsewhere.eventLogoUrl === '' && elsewhere.logoUnit === null && /events\/qa-n\/generated\/s\.png$/.test(elsewhere.heroImageUrl),
  'only pictures the browser can draw (the image route\'s hosts): the next one in line instead', JSON.stringify([elsewhere.eventLogoUrl, elsewhere.logoUnit, elsewhere.heroImageUrl]));
var imported = P.brandFromSources({ eventId: 'qa-n', bucket: BUCKET, event: { name: 'Imp', templateId: 'imported-imp-x' }, plan: null, template: null, gallery: [], googleFontUrl: gf,
  pageHtml: '<html><head><style>:root{--background:#fafaf7;--foreground:#14140f;--card:#fff;--muted-foreground:#56564e;--accent-red:#b8112b;--accent-red-dark:#8a0c20;--et-red:#b8112b;--gold:#a97813;--state-error:#b8112b;--radius:.5rem;' +
    '--font-display:"Playfair Display", Georgia, serif;--font-sans:"Inter", system-ui, sans-serif}</style></head><body id="imported" style=""></body></html>' });
ok(imported.kind === 'unknown' && imported.colours.background === '#fafaf7' && imported.colours.text === '#14140f' && imported.colours.theme === '#b8112b' && imported.colours.accent === '#a97813',
  'imported: its own tokens, the most-named brand colour as the theme and one of another hue as the accent', JSON.stringify(imported.colours));
ok(imported.fonts.heading.family === 'Playfair Display' && imported.fonts.body.family === 'Inter' && imported.radius === '.5rem', 'imported: its own font and radius tokens', JSON.stringify([imported.fonts, imported.radius]));
var shad = P.brandFromSources({ eventId: 'qa-n', event: { name: 'S' }, pageHtml: '<style>:root{--background:0 0% 100%;--foreground:222.2 84% 4.9%;--primary:221.2 83.2% 53.3%}</style><body></body>', template: null, gallery: [] });
ok(shad.colours.theme === '#2563eb' && shad.colours.text === '#020817', 'imported: shadcn\'s bare HSL tokens', JSON.stringify(shad.colours));

/* ---------- fonts ---------- */
ok(P.familiesInFontUrl('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400&family=Inter&display=swap').join() === 'playfair display,inter', 'the families a css2 address asks for');
ok(P.familiesInFontUrl('https://fonts.googleapis.com/css?family=Roboto|Open+Sans:400,700').join() === 'roboto,open sans', 'the families a css address asks for');
ok(P.fontCssUrl('Arial', [], '', gf) === '' && P.fontCssUrl('serif', [], '', gf) === '', 'a system font needs no stylesheet');

/* ---------- the event ---------- */
ok(P.hashtagOf('GCC ANNUAL CONCLAVE', null) === '#GCCAnnualConclave', 'hashtag: initialisms kept, words capitalised', P.hashtagOf('GCC ANNUAL CONCLAVE'));
ok(P.hashtagOf('ET Making AI Work 2026', '2026-11-20T09:00') === '#ETMakingAIWork26', 'hashtag: the year leaves the name and comes back in two digits', P.hashtagOf('ET Making AI Work 2026', '2026-11-20T09:00'));
ok(P.hashtagOf('Retail Leadership Summit 2025', '2027-02-18') === '#RetailLeadershipSummit27', 'hashtag: the start date\'s year wins', P.hashtagOf('Retail Leadership Summit 2025', '2027-02-18'));
ok(P.hashtagOf('Tech500 2026', '') === '#Tech50026', 'hashtag: a year in the name when there is no date', P.hashtagOf('Tech500 2026', ''));
var long = P.hashtagOf('The National Data Center and Cloud Infrastructure Symposium of India', '2027-01-10');
ok(long.length <= 30 && /^#NationalDataCenter/.test(long) && /27$/.test(long), 'hashtag: at most 30 characters, filler words first, the year kept', long);
ok(P.hashtagOf('ET CIO’s “Annual” Awards!', '2026-01-01') === '#ETCIOSAnnualAwards26' || P.hashtagOf('ET CIO’s “Annual” Awards!', '2026-01-01') === '#ETCIOSAwards26', 'hashtag: letters and digits only', P.hashtagOf('ET CIO’s “Annual” Awards!', '2026-01-01'));
var one = P.hashtagOf('Supercalifragilisticexpialidocious Summit', '2027-01-01');
ok(one.length <= 30 && /^#Supercalifragilisticexpiali/.test(one) && /27$/.test(one), 'hashtag: one word too long is shortened, the year kept', one);
ok(P.hashtagOf('Supercalifragilisticexpialidocious', '').length <= 30, 'hashtag: one word too long, no year', P.hashtagOf('Supercalifragilisticexpialidocious', ''));
ok(P.hashtagOf('', '2026-01-01') === '' && P.hashtagOf('2026', '') === '', 'hashtag: nothing to make one of');
ok(P.editionOf('ETCIO Annual Conclave', 'In its 3rd edition, the conclave…') === '3rd Edition', 'edition from the description');
ok(P.editionOf('The 12th Edition of Tech500', '') === '12th Edition' && P.editionOf('Fifth edition summit', '') === '5th Edition', 'edition from the name, in figures or words');
ok(P.editionOf('Tech500 2026', 'The best event of the year') === '', 'no edition said: none');
ok(P.placeOf('Jio World Centre, Mumbai', 'Mumbai') === 'Jio World Centre, Mumbai' && P.placeOf('Taj Palace', 'New Delhi') === 'Taj Palace, New Delhi' && P.placeOf('', 'Pune') === 'Pune', 'place, without the city twice');
ok(P.daysOf('2027-02-18T09:00', '2027-02-19T18:00') === 2 && P.daysOf('2027-02-18', '') === 1 && P.daysOf(null, null) === 0 && P.daysOf('2027-02-18', '2026-01-01') === 0, 'days from the dates');
var ev = P.eventFrom('qa-x', { name: 'ET Making AI Work 2026', start: '2026-11-20T09:00', end: '2026-11-21T18:00', venue: 'Taj', city: 'Mumbai', published: true, description: 'Its 2nd edition.' }, 'https://cms.example/e/qa-x', '#register');
ok(ev.dateLabel === '20–21 November 2026' && ev.place === 'Taj, Mumbai' && ev.registerUrl === 'https://cms.example/e/qa-x#register' && ev.siteUrl === 'https://cms.example/e/qa-x' &&
  ev.published === true && ev.hashtag === '#ETMakingAIWork26' && ev.edition === '2nd Edition', 'the kit\'s event', JSON.stringify(ev));
ok(P.eventFrom('qa-x', { name: 'X', dateLabel: 'Date to be announced' }, 'https://h/e/qa-x', '').dateLabel === 'Date to be announced', 'no dates: the stored date label');

/* ---------- numbers: real counts only ---------- */
var st = P.statsOf({ speakers: new Array(12), sessions: new Array(3), partners: [], start: '2027-02-18', end: '2027-02-19' });
ok(JSON.stringify(st) === JSON.stringify([{ value: '12+', label: 'Speakers' }, { value: '3', label: 'Sessions' }, { value: '2', label: 'Days' }]), 'stats: N+ from ten, zeros left out', JSON.stringify(st));
ok(JSON.stringify(P.statsOf({ speakers: [1], start: '' })) === JSON.stringify([{ value: '1', label: 'Speaker' }]), 'stats: one speaker, no dates', JSON.stringify(P.statsOf({ speakers: [1] })));
ok(P.statsOf({}).length === 0, 'stats: nothing to count, nothing shown');

/* ---------- the brief ---------- */
ok(JSON.stringify(P.audienceOf('CIOs; CTOs; heads of digital transformation')) === '["CIOs","CTOs","heads of digital transformation"]', 'audience: a list on semicolons', JSON.stringify(P.audienceOf('CIOs; CTOs; heads of digital transformation')));
ok(JSON.stringify(P.audienceOf('CIOs, CTOs, CISOs and heads of IT')) === '["CIOs","CTOs","CISOs and heads of IT"]', 'audience: a list on commas', JSON.stringify(P.audienceOf('CIOs, CTOs, CISOs and heads of IT')));
ok(JSON.stringify(P.audienceOf('CIOs/CTOs\nFounders')) === '["CIOs","CTOs","Founders"]', 'audience: lines, and a slash between words', JSON.stringify(P.audienceOf('CIOs/CTOs\nFounders')));
var sentence = 'Senior technology leaders who are responsible for AI adoption, governance and scale in large Indian enterprises.';
ok(P.audienceOf(sentence).length === 1 && P.audienceOf(sentence)[0] === sentence.replace(/\.$/, ''), 'audience: a sentence stays one item', JSON.stringify(P.audienceOf(sentence)));
ok(JSON.stringify(P.audienceOf('Senior leaders from banking, insurance and fintech')) === '["Senior leaders from banking, insurance and fintech"]',
  'audience: commas listing what "from" names stay one audience', JSON.stringify(P.audienceOf('Senior leaders from banking, insurance and fintech')));
ok(P.audienceOf('Heads of HR, finance and operations').length === 1 && P.audienceOf('CXOs across retail, FMCG and e-commerce').length === 1 && P.audienceOf('Decision makers in BFSI, healthcare, manufacturing').length === 1,
  'audience: of / across / in phrases listed on commas stay one audience', JSON.stringify([P.audienceOf('Heads of HR, finance and operations'), P.audienceOf('CXOs across retail, FMCG and e-commerce')]));
ok(JSON.stringify(P.audienceOf('CIOs of large banks, CTOs, CISOs')) === '["CIOs of large banks","CTOs","CISOs"]', 'audience: a list whose first item has a phrase is still a list', JSON.stringify(P.audienceOf('CIOs of large banks, CTOs, CISOs')));
ok(P.audienceOf('AI/ML leaders').length === 1 && P.audienceOf('').length === 0 && P.audienceOf(null).length === 0, 'audience: AI/ML is not a list; nothing is nothing');
ok(JSON.stringify(P.audienceOf([' CIOs ', '', 'CIOs', 'CTOs'])) === '["CIOs","CTOs"]', 'audience: a list given as a list');
ok(JSON.stringify(P.topicsOf({ tracks: ['AI at scale', ''], keyMessages: ['x'] })) === '["AI at scale"]' && JSON.stringify(P.topicsOf({ keyMessages: ['Build trust'] })) === '["Build trust"]' && P.topicsOf(null).length === 0, 'topics: tracks, else key messages');

/* ---------- content ---------- */
var site = {
  speakers: [{ id: 's1', name: 'Asha Rao', desig: 'CIO', comp: 'Acme', photoUrl: 'https://img.etb2bimg.com/a.jpg', groupId: 'g1' }, { id: 's2', name: 'Ben', desig: '', comp: '', photoUrl: '', groupId: '' }],
  speakerGroups: [{ id: 'g1', name: 'Keynote' }],
  partners: [{ id: 'p1', name: 'Globex', logoUrl: 'https://img.etb2bimg.com/g.png', tierId: 't1', url: 'https://globex.com' }],
  partnerTiers: [{ id: 't1', name: 'Gold Partner' }],
  sessions: [{ id: 'x1', title: 'Opening', start: '09:00', end: '09:30', groupId: 'd1', speakerIds: ['s1', 's2', 'gone'] }],
  agendaGroups: [{ id: 'd1', name: 'Day 1', date: '2027-02-18' }],
  contacts: [{ label: 'Partnerships', name: 'Ravi', email: 'r@x.com', phone: '' }], social: [{ kind: 'linkedin', url: 'https://linkedin.com/x' }], gallery: []
};
var content = P.contentFrom(site, { audience: 'CIOs; CTOs', tracks: ['AI'], theme: 'The brief theme' }, { description: '', start: '2027-02-18' });
ok(JSON.stringify(content.speakers[0]) === JSON.stringify({ id: 's1', name: 'Asha Rao', designation: 'CIO', company: 'Acme', photoUrl: 'https://img.etb2bimg.com/a.jpg', group: 'Keynote' }), 'content: a speaker in the kit\'s names', JSON.stringify(content.speakers[0]));
ok(content.partners[0].tier === 'Gold Partner' && content.sessions[0].day === 'Day 1' && content.sessions[0].speakers.join() === 'Asha Rao,Ben', 'content: tier names, the day, speaker names (a missing speaker left out)', JSON.stringify([content.partners[0], content.sessions[0]]));
ok(content.overview === 'The brief theme' && content.audience.join() === 'CIOs,CTOs' && content.topics.join() === 'AI', 'content: overview from the brief when the event has no description');
ok(JSON.stringify(content.stats) === JSON.stringify([{ value: '2', label: 'Speakers' }, { value: '1', label: 'Session' }, { value: '1', label: 'Partner' }, { value: '1', label: 'Day' }]), 'content: the stats', JSON.stringify(content.stats));
ok(content.contacts[0].label === 'Partnerships' && content.social[0].kind === 'linkedin', 'content: contacts and social');
var empty = P.contentFrom(null, null, {});
ok(empty.speakers.length === 0 && empty.audience.length === 0 && empty.topics.length === 0 && empty.stats.length === 0 && empty.overview === '', 'content: an event with nothing has empty lists, never samples');

/* ---------- the image route's addresses ---------- */
function allowed(url, ev) { return P.imageUrlProblem(url, BUCKET, ev || 'qa-gen') === ''; }
ok(allowed(OWN + 'generated/hero-bg.png?v=2'), 'image: this event\'s own file');
ok(allowed('https://img.etb2bimg.com/files/x.jpg') && allowed('https://st.etb2bimg.com/Themes/a.png') && allowed('https://img.b2bstatic.com/a.png'), 'image: ET\'s image hosts');
ok(!allowed('https://storage.googleapis.com/' + BUCKET + '/events/other/x.png'), 'image: not another event\'s file');
ok(!allowed('https://storage.googleapis.com/' + BUCKET + '/events/qa-gen-2/x.png'), 'image: not an event whose id starts the same');
ok(!allowed('https://storage.googleapis.com/' + BUCKET + '/events/qa-gen/../other/x.png'), 'image: not out of the folder with ..');
ok(!allowed('https://storage.googleapis.com/' + BUCKET + '/events/qa-gen/%2e%2e/other/x.png') && !allowed('https://storage.googleapis.com/' + BUCKET + '/events/qa-gen/a%2Fb.png'), 'image: not with encoded dots or slashes');
ok(!allowed('https://storage.googleapis.com/other-bucket/events/qa-gen/x.png'), 'image: not another bucket');
ok(!allowed('http://img.etb2bimg.com/x.jpg') && !allowed('https://img.etb2bimg.com:8443/x.jpg') && !allowed('https://user:pw@img.etb2bimg.com/x.jpg'), 'image: https on the standard port, no credentials');
var IMP = 'https://storage.googleapis.com/' + BUCKET + '/events/import-imp-x/images/';
ok(P.importIdOf({ templateId: 'imported-imp-x' }) === 'imp-x' && P.importIdOf({ site: { templateId: 'imported-imp-x' } }) === 'imp-x' &&
  P.importIdOf({ templateId: 'tech500' }) === '' && P.importIdOf({ templateId: 'imported-../x' }) === '' && P.importIdOf(null) === '', 'the import an event was made from, off its own template id');
ok(P.imageUrlProblem(IMP + 'hero.png', BUCKET, 'qa-n', 'imp-x') === '', 'image: an imported site\'s pictures, from its own import');
ok(P.imageUrlProblem(IMP + 'hero.png', BUCKET, 'qa-n') !== '' && P.imageUrlProblem(IMP + 'hero.png', BUCKET, 'qa-n', 'imp-y') !== '' &&
  P.imageUrlProblem('https://storage.googleapis.com/' + BUCKET + '/events/import-imp-x/index.html', BUCKET, 'qa-n', 'imp-x') !== '' &&
  P.imageUrlProblem('https://storage.googleapis.com/' + BUCKET + '/events/import-imp-xy/images/a.png', BUCKET, 'qa-n', 'imp-x') !== '' &&
  P.imageUrlProblem(IMP + '%2e%2e/%2e%2e/other/x.png', BUCKET, 'qa-n', 'imp-x') !== '', 'image: not another import\'s, not outside its pictures folder, not without the event saying so');
ok(P.inSomeImport(IMP + 'a.png', BUCKET) && !P.inSomeImport(OWN + 'a.png', BUCKET) && !P.inSomeImport('https://evil.com/' + BUCKET + '/events/import-x', BUCKET), 'image: which addresses wait for the event to name its import');
var impBrand = P.brandFromSources({ eventId: 'qa-n', bucket: BUCKET, event: { name: 'Imp', templateId: 'imported-imp-x' }, plan: null, template: null, gallery: [], googleFontUrl: gf,
  pageHtml: '<html><body id="imported"><section data-rv-section="hero" data-rv-key="hero"><img src="' + IMP + 'hero.png"></section><section data-rv-section="venue" data-rv-key="venue"><img src="' + IMP + 'room.jpg"><img src="' + IMP + 'mark.svg"></section></body></html>' });
var notImp = P.brandFromSources({ eventId: 'qa-n', bucket: BUCKET, event: { name: 'Imp', templateId: 'tech500x' }, plan: null, template: null, gallery: [], googleFontUrl: gf,
  pageHtml: '<html><body id="imported"><section data-rv-section="hero" data-rv-key="hero"><img src="' + IMP + 'hero.png"></section><section data-rv-section="venue" data-rv-key="venue"><img src="' + IMP + 'room.jpg"></section></body></html>' });
ok(impBrand.heroImageUrl === IMP + 'hero.png' && impBrand.pictures.join() === IMP + 'room.jpg' &&
  ![notImp.heroImageUrl].concat(notImp.pictures).some(function (x) { return /import-/.test(x); }), 'imported: its pictures are kept; another event cannot borrow them', JSON.stringify([impBrand.heroImageUrl, impBrand.pictures, notImp.heroImageUrl, notImp.pictures]));
ok(!allowed('https://img.etb2bimg.com.evil.com/x.jpg') && !allowed('https://evil.com/?u=https://img.etb2bimg.com/x.jpg') && !allowed('https://169.254.169.254/latest') && !allowed('file:///etc/passwd') && !allowed('not a url'), 'image: anything else is refused');

/* ---------- the AI copy ---------- */
var kit = { event: { name: 'ET Making AI Work 2026', edition: '', category: 'ip', dateLabel: '20 November 2026', place: 'Taj, Mumbai', siteUrl: 'https://h/e/x', registerUrl: 'https://h/e/x#register', hashtag: '#ETMakingAIWork26' },
  content: content };
var sheet = P.factSheet(kit);
ok(/Event: ET Making AI Work 2026/.test(sheet) && /- Asha Rao, CIO, Acme/.test(sheet) && /Globex \(Gold Partner\)/.test(sheet) && /Opening \[Day 1\] 09:00 — Asha Rao, Ben/.test(sheet) && !/Edition:/.test(sheet), 'fact sheet: the event\'s facts, nothing empty', sheet);
var cap = P.writeRequest({ task: 'caption', network: 'x', post: { type: 'speaker', headline: 'Meet Asha', name: 'Asha Rao', bogus: { a: 1 } } }, kit);
ok(cap.prompt && /Invent nothing/.test(cap.prompt) && /FACT SHEET/.test(cap.prompt) && /headline: Meet Asha/.test(cap.prompt) && /introduces one speaker/.test(cap.prompt) && /#ETMakingAIWork26/.test(cap.prompt), 'caption prompt: the facts, the rule, the post\'s own text', cap.prompt && cap.prompt.slice(0, 300));
ok(P.writeRequest({ task: 'caption', network: 'myspace', post: {} }, kit).error && P.writeRequest({ task: 'poem' }, kit).error, 'a network or a task we do not know: 400');
['caption', 'subjects', 'intro', 'headline'].forEach(function (t) {
  var r = P.writeRequest({ task: t, network: 'linkedin', post: { type: 'announcement' }, mailer: { type: 'invitation' }, current: 'Old text' }, kit);
  ok(r.prompt && r.schema && !/reasoning/i.test(JSON.stringify(r.schema)), t + ': a prompt and a schema without a "reasoning" field');
});
var longText = 'Join us '.repeat(60) + 'now';
var x = P.cleanWrite({ task: 'caption' }, { text: '**' + longText + '**' }, kit, { network: 'x' });
ok(x.text.length <= 280 && !/\*/.test(x.text) && !/\s$/.test(x.text), 'caption: X is cut to 280 at a word, markdown taken out', x.text.length + ' ' + x.text.slice(-20));
var li = P.cleanWrite({ task: 'caption' }, { text: 'Meet our speakers.\n\n\n\nRegister now.' }, kit, { network: 'linkedin' });
ok(li.text === 'Meet our speakers.\n\nRegister now.\n\n#ETMakingAIWork26', 'caption: the hashtag added when the model left it out', JSON.stringify(li.text));
ok(P.cleanWrite({ task: 'caption' }, { text: '' }, kit, { network: 'linkedin' }) === null, 'caption: nothing back is not an answer');
var intro = P.cleanWrite({ task: 'intro' }, { text: 'word '.repeat(150) }, kit, {});
ok(intro.text.split(/\s+/).length <= 90, 'intro: at most 90 words', intro.text.split(/\s+/).length);
var heads = P.cleanWrite({ task: 'headline' }, { options: ['"One two three four five six seven eight nine ten eleven."', 'Short one.', 'Short one', '', 'Four', 'Five'] }, kit, {});
ok(heads.options.length === 4 && heads.options[0].split(' ').length === 8 && heads.options[1] === 'Short one' && heads.options.indexOf('') === -1, 'headline: four, at most eight words (as the prompt asks), no quotes or full stop, no repeats', JSON.stringify(heads));
var subj = P.cleanWrite({ task: 'subjects' }, { options: [{ subject: 'A', preheader: 'p' }, { subject: 'a', preheader: 'q' }, { subject: 'B', preheader: 'word '.repeat(60) }, { subject: 'C' }, { subject: 'D' }, { subject: 'Ten words '.repeat(12) }, { subject: 'F' }] }, kit, {});
ok(subj.options.length === 5 && subj.options[1].subject === 'B' && subj.options[1].preheader.length <= 110 && subj.options[4].subject.length <= 70 && subj.options[2].preheader === '',
  'subjects: five, no repeats, subjects cut at 70 and preheaders at 110 (as the prompt asks)', JSON.stringify(subj).slice(0, 300));
ok(P.cleanWrite({ task: 'subjects' }, { options: [{ subject: 'A' }, { subject: 'a' }, { subject: 'B' }, { subject: 'C' }, { subject: 'D' }] }, kit, {}) === null, 'subjects: fewer than five different ones is not an answer (502, try again)');
var sp = P.writeRequest({ task: 'subjects', mailer: {} }, kit).prompt;
ok(/at most 70 characters/.test(sp) && /at most 110 characters/.test(sp) && /at most 8 words/.test(P.writeRequest({ task: 'headline', post: {} }, kit).prompt), 'the prompts state the limits the answers are cut to');

/* a network or a type that is a property of every object is still unknown */
['constructor', '__proto__', 'toString', 'hasOwnProperty'].forEach(function (n) {
  ok(P.writeRequest({ task: 'caption', network: n, post: {} }, kit).error, 'caption: network "' + n + '" is refused');
  ok(P.cleanWrite({ task: 'caption' }, { text: 'Hi' }, kit, { network: n }) === null, 'caption: no answer cut for network "' + n + '"');
});
['constructor', 'toString', 'valueOf'].forEach(function (k) {
  var pr = P.writeRequest({ task: 'caption', network: 'x', post: { type: k } }, kit).prompt;
  ok(/The post promotes the event\./.test(pr) && !/native code|function /.test(pr), 'caption: post type "' + k + '" gets the general note', pr.slice(0, 160));
});

/* the hashtag survives cutting */
var tail = ' https://cms.example.com/e/etcio-annual-conclave #ETMakingAIWork26';
var tooLong = 'Join India\'s CIOs at the conclave this November. '.repeat(6).slice(0, 300 - tail.length) + tail;
var xc = P.cleanWrite({ task: 'caption' }, { text: tooLong }, kit, { network: 'x' });
ok(xc.text.length <= 280 && /\s#ETMakingAIWork26$/.test(xc.text) && (xc.text.match(/#ETMakingAIWork26/g) || []).length === 1, 'caption: an X caption too long keeps its hashtag, once, at the end', xc.text.length + ' ' + xc.text.slice(-60));
var xn = P.cleanWrite({ task: 'caption' }, { text: 'Join us '.repeat(60) }, kit, { network: 'x' });
ok(xn.text.length <= 280 && /\s#ETMakingAIWork26$/.test(xn.text), 'caption: too long and without the hashtag, the hashtag is added after cutting', xn.text.length + ' ' + xn.text.slice(-40));
var mid = 'Register now #ETMakingAIWork26 #AI #CIO';
ok(P.cleanWrite({ task: 'caption' }, { text: mid }, kit, { network: 'linkedin' }).text === mid, 'caption: a caption that fits and has the hashtag is left as written');
var noTag = P.cleanWrite({ task: 'caption' }, { text: 'Hello' }, { event: { hashtag: '' } }, { network: 'x' });
ok(noTag.text === 'Hello', 'caption: an event without a hashtag');
/* the category as its label; a link to a site not live yet */
var live = P.eventFrom('qa-x', { name: 'ET Making AI Work 2026', category: 'ip', published: true }, 'https://h/e/qa-x', '#register');
var draft = P.eventFrom('qa-x', { name: 'ET Making AI Work 2026', category: 'ip', published: false }, 'https://h/e/qa-x', '#register');
ok(live.categoryLabel === 'IP Event' && live.category === 'ip', 'the kit\'s event: the category\'s label beside its code', JSON.stringify(live));
ok(P.eventFrom('qa-x', { category: 'roundtable', categoryLabel: 'Leaders\' Round Table' }, 'h', '').categoryLabel === 'Leaders\' Round Table' &&
  P.eventFrom('qa-x', { category: 'constructor' }, 'h', '').categoryLabel === '' && P.eventFrom('qa-x', { category: 'zz' }, 'h', '').categoryLabel === '', 'category: a stored label wins; an unknown code has no label');
var liveSheet = P.factSheet({ event: live, content: content }), draftSheet = P.factSheet({ event: draft, content: content });
ok(/Category: IP Event/.test(liveSheet) && !/Category: ip/.test(liveSheet) && !/not published/.test(liveSheet), 'fact sheet: the category\'s label, no note for a published site', liveSheet.slice(0, 300));
ok(/Registration link: https:\/\/h\/e\/qa-x#register\n\(The site is not published yet/.test(draftSheet), 'fact sheet: a site not published yet is said to be', draftSheet.slice(0, 400));
ok(/not published yet/.test(P.writeWarning({ task: 'caption' }, { text: 'Register https://h/e/qa-x#register' }, { event: draft })) &&
  P.writeWarning({ task: 'caption' }, { text: 'Register https://h/e/qa-x#register' }, { event: live }) === '' &&
  P.writeWarning({ task: 'subjects' }, { options: [{ subject: 'A', preheader: 'b' }] }, { event: draft }) === '', 'write: a warning only when the copy links to a site not live yet');

ok(P.cutChars('abc def ghi', 7) === 'abc def' && P.cutWords('one two. three four', 3) === 'one two.', 'cutting at a word and at a sentence');

if (failures.length) {
  console.error('promo.test: ' + failures.length + ' of ' + checks + ' checks failed:\n  - ' + failures.join('\n  - '));
  process.exit(1);
}
console.log('promo.test: all ' + checks + ' checks passed');
