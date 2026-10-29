/* node functions/lib/promo.test.js — exits 1 on the first failure it lists. No network, no Firebase: the pure
   parts of lib/promo.js (the brand of a generated, a ported and an unknown site; the event's hashtag, edition
   and numbers; the brief's audience; which picture addresses the image route may fetch; the AI copy's
   prompts and how what comes back is cut). Then the AI copy route itself (handleWrite): its limit per person and
   its refusal of example content, with the model and lib/promo-examples.js as in-memory stand-ins. Last, which
   answers the font and logo-unit checks keep, with lib/safe-fetch.js as a stand-in. */
const path = require('path');
const Module = require('module');

/* lib/promo-examples.js stands in with the markers the plan names (§5h): the example library's picture folder in
   any address, the "ex-p…" / "ex-l…" / "ex-s…" ids, and the preview's meta tag. Resolved here before the file
   system is asked, so this runs whether or not that file exists yet. */
var EXAMPLES = { asked: 0 };
var exampleStub = {
  EXAMPLE_PATH: '/assets/promo-examples/',
  isExample: function (x) {
    EXAMPLES.asked++;
    var s = typeof x === 'string' ? x : JSON.stringify(x);
    return typeof s === 'string' && (s.indexOf('/assets/promo-examples/') !== -1 || /"ex-[pls]\d/.test(s) || s.indexOf('<meta name="oneworld-example"') !== -1);
  }
};
var EX_STUB = path.join(__dirname, '__stub-promo-examples.js'), realResolve = Module._resolveFilename;
Module._resolveFilename = function (request) {
  if (request === './promo-examples') return EX_STUB;
  return realResolve.apply(this, arguments);
};
require.cache[EX_STUB] = { id: EX_STUB, filename: EX_STUB, loaded: true, children: [], paths: [], exports: exampleStub };
/* lib/llm.js: never a real model call here — four headlines, every time, and each call counted */
var LLM = { calls: [] };
var LLM_PATH = require.resolve('./llm');
require.cache[LLM_PATH] = { id: LLM_PATH, filename: LLM_PATH, loaded: true, children: [], paths: [], exports: {
  callJson: function (prompt, schema, opts) { LLM.calls.push({ prompt: prompt, opts: opts }); return Promise.resolve({ parsed: { options: ['One clear line', 'Two', 'Three', 'Four'] } }); }
} };
/* lib/safe-fetch.js: never the network here. safeFetch answers from FETCH.answer(url) — { status, body }, or an
   Error for a fetch that failed — and counts each address it is asked for; with no answer set it fails, as an
   unreachable site would. The rest of the module is the real one. */
var FETCH = { asked: [], answer: null };
var SAFE_FETCH_PATH = require.resolve('./safe-fetch');
require.cache[SAFE_FETCH_PATH] = { id: SAFE_FETCH_PATH, filename: SAFE_FETCH_PATH, loaded: true, children: [], paths: [], exports: Object.assign({}, require('./safe-fetch'), {
  safeFetch: function (url) {
    FETCH.asked.push(url);
    var a = FETCH.answer ? FETCH.answer(url) : new Error('stand-in: no network here');
    return a instanceof Error ? Promise.reject(a) : Promise.resolve({ status: a.status, headers: {}, body: Buffer.from(a.body || ''), finalUrl: url });
  }
}) };

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
/* a page with a register button, a button that opens a form or a form placed in it: the forms runtime opens
   the event's default form for #register (templates/_shared/rv-forms.js) */
ok(P.registerAnchor(P.readSavedPage(genPage)) === '#register', 'a page with a register button: #register opens the form');
ok(P.registerAnchor(P.readSavedPage(genPage.replace('id="the-close"', ''))) === '#register', 'a register button pointing at nothing: still #register');
ok(P.registerAnchor(P.readSavedPage('<body><a href="#rv-form-vip" data-rv-form="vip">VIP</a></body>')) === '#register', 'a button that opens a form: #register');
ok(P.registerAnchor(P.readSavedPage('<body><div class="rv-block-form" data-rv-form-embed="interest"></div></body>')) === '#register', 'a form placed in the page: #register');
ok(P.registerAnchor(P.readSavedPage('<body><a href="#about">About</a></body>')) === '', 'no form and no #register element: no anchor');
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

/* ---------- what each kind of post is for ---------- */
ok(P.kindNote('audience') === 'tells the reader who the event is for', 'kind: audience (the Site-look audience post, the social posts\' Who should attend)', P.kindNote('audience'));
ok(P.kindNote('testimonial') === 'shares a quote from someone who attended or spoke, exactly as the post quotes it', 'kind: testimonial', P.kindNote('testimonial'));
ok(P.kindNote('outlook') === 'sets last edition\'s signals against what this edition will act on', 'kind: outlook (Prediction → outcome)', P.kindNote('outlook'));
ok(P.kindNote('nope') === 'promotes the event' && P.kindNote('constructor') === 'promotes the event' && P.kindNote(undefined) === 'promotes the event', 'kind: anything else gets the general note');
ok(/The post tells the reader who the event is for\./.test(P.writeRequest({ task: 'caption', network: 'linkedin', post: { type: 'audience' } }, kit).prompt), 'kind: an audience post\'s caption prompt says what it is for');
ok(/The post sets last edition's signals/.test(P.writeRequest({ task: 'headline', post: { type: 'outlook' } }, kit).prompt), 'kind: an outlook post\'s headline prompt says what it is for');

/* ---------- exported for the social posts (lib/promo-social.js) ---------- */
var promoMod = require('./promo');
ok(promoMod.imageUrlProblem === P.imageUrlProblem && promoMod.importIdOf === P.importIdOf, 'imageUrlProblem and importIdOf are exported, the same rule the image route uses');
ok(promoMod.imageUrlProblem(OWN + 'promo-art/picture-x.png', BUCKET, 'qa-gen') === '' && promoMod.imageUrlProblem('https://evil.example/x.png', BUCKET, 'qa-gen') !== '', 'imageUrlProblem: this event\'s files yes, anything else no');

/* ---------- the logo unit's copy for a dark ground (the mail banner draws it on a dark picture) ---------- */
var UNIT = OWN + 'generated/1-logo-unit.svg', UNIT_DARK = OWN + 'generated/1-logo-unit-dark.svg';
function unitPage(inner, onTone) {
  return genPage.replace(/<div class="rv-lu rv-lu-pic rv-lu-on-dark" data-rv-logo-unit>[\s\S]*?<\/div>/,
    '<div class="rv-lu rv-lu-pic rv-lu-on-' + (onTone || 'light') + '" data-rv-logo-unit>' + inner + '</div>');
}
function unitOf(html) { return P.brandFromSources({ eventId: 'qa-gen', bucket: BUCKET, event: genEvent, plan: genPlan, pageHtml: html, template: null, gallery: [], googleFontUrl: gf }).logoUnit; }
var withDark = unitOf(unitPage('<img class="rv-lu-img" src="' + UNIT + '" alt="" width="422" height="340"><img class="rv-lu-img rv-lu-dark" src="' + UNIT_DARK + '" alt="" aria-hidden="true" width="422" height="340">'));
ok(withDark && withDark.url === UNIT && withDark.darkUrl === UNIT_DARK && withDark.tone === 'light' && withDark.width === 422,
  'dark copy: a unit with its rv-lu-dark picture after its own: the first is the unit, the second its copy for a dark ground', JSON.stringify(withDark));
var noDark = unitOf(unitPage('<img class="rv-lu-img" src="' + UNIT + '" alt="" width="422" height="340">'));
ok(noDark && noDark.url === UNIT && noDark.darkUrl === '', 'dark copy: a unit without one has darkUrl \'\'', JSON.stringify(noDark));
ok(b.logoUnit && b.logoUnit.darkUrl === '', 'dark copy: a plated unit has none (its plate is its ground)', JSON.stringify(b.logoUnit));
var platedDark = unitOf(unitPage('<span class="rv-lu-plate rv-lu-plate-dark"><img class="rv-lu-img" src="' + UNIT + '" width="422" height="340"></span><img class="rv-lu-img rv-lu-dark" src="' + UNIT_DARK + '">'));
ok(platedDark && platedDark.url === UNIT && platedDark.tone === 'dark' && platedDark.darkUrl === '', 'dark copy: a plated unit ignores a stray dark copy', JSON.stringify(platedDark));
var farDark = unitOf(unitPage('<img class="rv-lu-img" src="' + UNIT + '"><img class="rv-lu-img rv-lu-dark" src="https://cdn.example.com/unit-dark.svg">'));
ok(farDark && farDark.url === UNIT && farDark.darkUrl === '', 'dark copy: only one the browser can draw (the image route\'s hosts)', JSON.stringify(farDark));
var etDark = unitOf(unitPage('<img class="rv-lu-et" src="' + OWN + 'et.svg"><img class="rv-lu-et rv-lu-dark" src="' + OWN + 'et-dark.svg"><img class="rv-lu-img" src="' + UNIT + '">'));
ok(etDark && etDark.url === UNIT && etDark.darkUrl === '', 'dark copy: the ET logo\'s own dark copy (rv-lu-et) is not the unit\'s', JSON.stringify(etDark));
ok(u.logoUnit && u.logoUnit.darkUrl === '', 'dark copy: an unsaved plan with none has darkUrl \'\'', JSON.stringify(u.logoUnit));
function planUnit(extra) {
  return P.brandFromSources({ eventId: 'qa-gen', bucket: BUCKET, event: genEvent, pageHtml: null, template: null, gallery: [], googleFontUrl: gf,
    plan: Object.assign({}, genPlan, { design: Object.assign({}, genPlan.design, { logoUnitHeroMode: 'light' }, extra) }) }).logoUnit;
}
var planDark = planUnit({ logoUnitDarkUrl: OWN + 'generated/old-logo-unit-dark.svg', logoUnitDarkOf: genPlan.design.logoUnitUrl });
ok(planDark && planDark.darkUrl === OWN + 'generated/old-logo-unit-dark.svg' && planDark.tone === 'light', 'dark copy: an unsaved plan\'s copy for a dark ground, made of this very unit', JSON.stringify(planDark));
ok(planUnit({ logoUnitDarkUrl: OWN + 'generated/x-dark.svg', logoUnitDarkOf: OWN + 'generated/another-unit.svg' }).darkUrl === '' &&
  planUnit({ logoUnitDarkUrl: OWN + 'generated/x-dark.svg' }).darkUrl === '' &&
  planUnit({ logoUnitDarkUrl: OWN + 'generated/x-dark.svg', logoUnitDarkOf: genPlan.design.logoUnitUrl, logoUnitPlate: 'dark' }).darkUrl === '',
  'dark copy: an unsaved plan\'s copy of another unit, of an unknown one, or on a plate: none');
/* a design written before logoUnitDarkOf existed: the copy is known by its file, made in the same run as the unit */
var GEN = 'events/qa-gen/generated/';
var oldRun = planUnit({ logoUnitDarkUrl: OWN + 'generated/1700000000000-logo-unit-on-dark.png',
  logoUnitStoragePath: GEN + '1700000000000-logo-unit.svg', logoUnitDarkStoragePath: GEN + '1700000000000-logo-unit-on-dark.png' });
ok(oldRun && oldRun.darkUrl === OWN + 'generated/1700000000000-logo-unit-on-dark.png', 'dark copy: an older plan with no logoUnitDarkOf: its copy made in the same run as its unit (the site\'s hero shows it)', JSON.stringify(oldRun));
ok(planUnit({ logoUnitDarkUrl: OWN + 'generated/1700000000001-logo-unit-on-dark.png',
    logoUnitStoragePath: GEN + '1700000000000-logo-unit.svg', logoUnitDarkStoragePath: GEN + '1700000000001-logo-unit-on-dark.png' }).darkUrl === '' &&
  planUnit({ logoUnitDarkUrl: OWN + 'generated/1700000000000-logo-unit-on-dark.png',
    logoUnitStoragePath: 'events/qa-gen/uploads/owner-logo.png', logoUnitDarkStoragePath: GEN + '1700000000000-logo-unit-on-dark.png' }).darkUrl === '',
  'dark copy: an older plan\'s copy from another run, or beside an owner\'s uploaded logo: none (not trusted)');
/* the same test as the one the site's hero is built with (api.js darkCopyOfUnit), so the Kit never disagrees with it */
var apiDarkCopyOfUnit = require('./api')._testHooks.darkCopyOfUnit;
var unitCases = [null, {}, { logoUnitDarkUrl: 'd' }, { logoUnitDarkUrl: 'd', logoUnitUrl: 'u', logoUnitDarkOf: 'u' }, { logoUnitDarkUrl: 'd', logoUnitUrl: 'u', logoUnitDarkOf: 'v' },
  { logoUnitDarkOf: 'u', logoUnitUrl: 'u' }, { logoUnitDarkUrl: 'd', logoUnitStoragePath: GEN + '12-logo-unit.svg', logoUnitDarkStoragePath: GEN + '12-logo-unit-on-dark.png' },
  { logoUnitDarkUrl: 'd', logoUnitStoragePath: GEN + '12-logo-unit.svg', logoUnitDarkStoragePath: GEN + '13-logo-unit-on-dark.png' },
  { logoUnitDarkUrl: 'd', logoUnitStoragePath: GEN + '12-logo-unit-x.svg', logoUnitDarkStoragePath: GEN + '12-logo-unit-on-dark.png' },
  { logoUnitDarkUrl: 'd', logoUnitStoragePath: 'events/x/uploads/logo.png', logoUnitDarkStoragePath: 'events/x/uploads/logo-dark.png' },
  { logoUnitDarkUrl: 'd', logoUnitDarkOf: 'u', logoUnitUrl: 'u2', logoUnitStoragePath: GEN + '12-logo-unit.svg', logoUnitDarkStoragePath: GEN + '12-logo-unit-on-dark.png' }];
var unitAnswers = unitCases.map(function (d) { return [P.darkCopyOfUnit(d), apiDarkCopyOfUnit(d)]; });
ok(typeof apiDarkCopyOfUnit === 'function' && unitAnswers.every(function (a) { return a[0] === a[1]; }) && unitAnswers.some(function (a) { return a[0]; }) && unitAnswers.some(function (a) { return !a[0]; }),
  'dark copy: darkCopyOfUnit answers as api.js\'s does, case for case', JSON.stringify(unitAnswers));
ok(p.logoUnit && p.logoUnit.darkUrl === '', 'dark copy: an ET banner\'s logo has none', JSON.stringify(p.logoUnit));

/* ---------- the AI copy route: a limit per person, and never from example content ---------- */
const { sendJson } = require('./http');
var FAILS = [], LIVE = { calls: 0 };
var noFirestore = { error: 'stand-in: no Firestore here', db: { collection: function () { return { doc: function () { return { collection: function () {
  return { orderBy: function () { return { limit: function () { return { get: function () { return Promise.resolve({ empty: true, docs: [] }); } }; } }; } };
} }; } }; } } };
promoMod.wire({
  BODY_LIMITS: { small: 1 << 14 },
  withAdminBody: function (req, res, limit, cb) {
    try { cb(noFirestore, { email: req.who }, req.body); } catch (err) { FAILS.push('threw: ' + (err && err.stack || err)); sendJson(res, 500, { error: 'threw' }); }
  },
  eventIdOr400: function (res, v) { if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(String(v || ''))) { sendJson(res, 400, { error: 'eventId required' }); return null; } return v; },
  loadLiveEvent: function () { LIVE.calls++; return Promise.resolve({ name: 'ET Making AI Work 2026', start: '2026-11-20T09:00', category: 'ip', published: true }); },
  readObject: function () { return Promise.resolve(null); },
  sitePath: function (id, f) { return 'events/' + id + '/site/' + f; },
  siteVersionOf: function () { return 0; },
  publicBaseFor: function () { return 'https://cms.example'; },
  googleFontUrl: gf,
  aiUsageRecorder: function () { return function () {}; },
  sendAiFailure: function (res) { sendJson(res, 503, { error: 'ai failed' }); },
  sendFailure: function (res, what, err, msg) {
    if (err && err.status && err.body) return sendJson(res, err.status, err.body);
    FAILS.push(what + ': ' + (err && err.stack || err)); sendJson(res, 500, { error: msg });
  }
});
function write(who, body) {
  return new Promise(function (resolve) {
    var res = { headersSent: false, writeHead: function (s) { res.status = s; res.headersSent = true; },
      end: function (b) { var j = null; try { j = JSON.parse(b); } catch (e) { /* not JSON */ } resolve({ status: res.status, json: j }); } };
    promoMod.handleWrite({ method: 'POST', url: '/api/promo/write', headers: {}, who: who, body: Object.assign({ eventId: 'qa-x' }, body) }, res);
  });
}
var HEADLINE = { task: 'headline', post: { type: 'speaker', headline: 'Meet Asha' }, current: 'Meet Asha' };
function times(n, who, body) {
  var out = [];
  return Array.apply(null, new Array(n)).reduce(function (p) {
    return p.then(function () { return write(who, body).then(function (r) { out.push(r); }); });
  }, Promise.resolve()).then(function () { return out; });
}
var BUSY = 'The AI has been used a lot in the last few minutes. Try again in a little while.';
var routeChecks = times(30, 'one@timesinternet.in', HEADLINE).then(function (thirty) {
  ok(thirty.every(function (r) { return r.status === 200 && r.json && r.json.options && r.json.options.length === 4; }), 'write: 30 calls in 10 minutes for one person all answer', JSON.stringify(thirty.map(function (r) { return r.status; })));
  ok(LLM.calls.length === 30 && LLM.calls.every(function (c) { return c.opts && c.opts.route === 'promo-write'; }), 'write: each one asked the model once', LLM.calls.length);
  var before = { llm: LLM.calls.length, live: LIVE.calls };
  return write('one@timesinternet.in', HEADLINE).then(function (r) {
    ok(r.status === 429 && r.json && r.json.error === BUSY, 'write: the 31st call in 10 minutes for that person is 429, in plain words', JSON.stringify(r));
    ok(LLM.calls.length === before.llm && LIVE.calls === before.live, 'write: a refused call reads nothing and asks no model');
    return write('ONE@TimesInternet.in', HEADLINE);
  }).then(function (r) {
    ok(r.status === 429, 'write: the same person in other capitals is still that person', r.status);
    return write('two@timesinternet.in', HEADLINE);
  }).then(function (r) {
    ok(r.status === 200 && r.json && r.json.options.length === 4, 'write: another person is not held back', JSON.stringify(r));
  });
}).then(function () {
  var llm = LLM.calls.length, live = LIVE.calls;
  var examples = [
    { task: 'caption', network: 'linkedin', post: { type: 'speaker', photo: 'https://cms.example/assets/promo-examples/people/p01.jpg' } },
    { task: 'subjects', mailer: { type: 'invitation', ids: ['ex-l01'] } },
    { task: 'intro', mailer: { type: 'invitation' }, current: 'Hello <meta name="oneworld-example" content="speakers">' },
    { task: 'headline', post: { type: 'speaker' }, current: 'x', mailer: { speakers: [{ id: 'ex-p03', name: 'Meera Kulkarni' }] } }
  ];
  return examples.reduce(function (p, body, i) {
    return p.then(function () {
      return write('three@timesinternet.in', body).then(function (r) {
        ok(r.status === 422 && r.json && r.json.code === 'example' && /^Example content cannot be saved, downloaded or sent\./.test(r.json.error), 'write: example content in ' + body.task + ' (#' + (i + 1) + ') is 422', JSON.stringify(r));
      });
    });
  }, Promise.resolve()).then(function () {
    ok(LLM.calls.length === llm && LIVE.calls === live, 'write: example content reads nothing and asks no model');
    /* the four refusals did not count: thirty real calls still go through for that person */
    return times(30, 'three@timesinternet.in', HEADLINE);
  }).then(function (thirty) {
    ok(thirty.every(function (r) { return r.status === 200; }), 'write: refused example calls do not count against the limit', JSON.stringify(thirty.map(function (r) { return r.status; })));
    return write('four@timesinternet.in', { task: 'caption', network: 'x', post: { type: 'testimonial', quote: 'It changed how we buy.' } });
  }).then(function (r) {
    ok(r.status !== 422 && r.status !== 429, 'write: a real post is not mistaken for an example', r.status);
    ok(/shares a quote from someone who attended or spoke/.test(LLM.calls[LLM.calls.length - 1].prompt), 'write: a testimonial caption is told what the post is for');
    ok(!FAILS.length, 'write: nothing failed unexpectedly', FAILS.join('\n'));
  });
});

/* ---------- the network checks keep only real answers ----------
   A failed logo-unit measurement, and a font check that got no answer, a 429 or a 5xx, are asked again by the
   next kit; a measurement and a real 200/400 are kept. Kept failures would let two App Hosting instances give
   one event two banner fingerprints for up to 6 h. */
var UNIT_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="100" viewBox="0 0 400 100"><path d="M0 0h400v100H0z" fill="#ffffff"/></svg>';
function askedFor(url) { return FETCH.asked.filter(function (u) { return u === url; }).length; }
function networkChecks() {
  var unitUrl = OWN + 'ported/logo-unit.svg', unit = { url: unitUrl, width: 0, height: 0, tone: '' };
  var font = gf('Bebas Neue'), bare = 'https://fonts.googleapis.com/css2?family=Bebas+Neue&display=swap';
  var answers = {};
  FETCH.answer = function (url) { var a = answers[url]; return typeof a === 'function' ? a() : a || new Error('stand-in: unreachable'); };
  answers[unitUrl] = { status: 503, body: '' };
  return P.measureUnit(unit).then(function (u) {
    ok(u === unit && !u.tone && !u.width, 'network: a logo unit whose fetch answered 503 is left as the page said', JSON.stringify(u));
    answers[unitUrl] = new Error('stand-in: timed out');
    return P.measureUnit(unit);
  }).then(function (u) {
    ok(askedFor(unitUrl) === 2 && u === unit, 'network: a failed measurement is not kept — the next kit asks again', askedFor(unitUrl));
    answers[unitUrl] = { status: 200, body: UNIT_SVG };
    return P.measureUnit(unit);
  }).then(function (u) {
    ok(askedFor(unitUrl) === 3 && u.tone === 'dark' && u.width === 400 && u.height === 100, 'network: once the unit answers, its size and its SVG\'s tone are measured', JSON.stringify(u));
    answers[unitUrl] = { status: 503, body: '' };
    return Promise.all([P.measureUnit(unit), P.measureUnit(Object.assign({}, unit))]);
  }).then(function (both) {
    ok(askedFor(unitUrl) === 3 && both.every(function (u) { return u.tone === 'dark' && u.width === 400; }), 'network: a measurement is kept for the next kits', askedFor(unitUrl));
    var other = OWN + 'ported/other-unit.svg';
    answers[other] = { status: 200, body: UNIT_SVG };
    return Promise.all([P.measureUnit({ url: other }), P.measureUnit({ url: other })]).then(function (two) {
      ok(askedFor(other) === 1 && two[0].tone === 'dark' && two[1].tone === 'dark', 'network: two kits at once wait on the one measurement', askedFor(other));
    });
  }).then(function () {
    answers[font] = { status: 503 };
    return P.checkFontCss(font);
  }).then(function (u) {
    ok(u === font && askedFor(font) === 1, 'network: a font address that answered 503 is kept for this kit', u);
    answers[font] = { status: 429 };
    return P.checkFontCss(font);
  }).then(function (u) {
    ok(u === font && askedFor(font) === 2 && askedFor(bare) === 0, 'network: a 503 is not kept — the next kit asks again; a 429 keeps the address too', askedFor(font));
    answers[font] = new Error('stand-in: unreachable');
    return P.checkFontCss(font);
  }).then(function (u) {
    ok(u === font && askedFor(font) === 3, 'network: a font check that got no answer was asked again, and keeps the address', askedFor(font));
    answers[font] = { status: 400 }; answers[bare] = { status: 502 };
    return P.checkFontCss(font);
  }).then(function (u) {
    ok(u === bare && askedFor(font) === 4 && askedFor(bare) === 1, 'network: weights refused (400) but the bare family\'s check got a 502: the bare family, for this kit', u);
    answers[bare] = { status: 200 };
    return P.checkFontCss(font);
  }).then(function (u) {
    ok(u === bare && askedFor(font) === 5 && askedFor(bare) === 2, 'network: that 502 was not kept — asked again, and the bare family loads', u);
    answers[font] = { status: 503 }; answers[bare] = { status: 503 };
    return P.checkFontCss(font);
  }).then(function (u) {
    ok(u === bare && askedFor(font) === 5 && askedFor(bare) === 2, 'network: a real answer (400, then 200 without weights) is kept for the next kits', askedFor(font) + '/' + askedFor(bare));
    var gone = gf('Not A Family');
    answers[gone] = { status: 400 }; answers[gone.replace(/:wght@[^&]*/, '')] = { status: 400 };
    return P.checkFontCss(gone).then(function (first) {
      return P.checkFontCss(gone).then(function (second) {
        ok(first === '' && second === '' && askedFor(gone) === 1, 'network: a family Google Fonts refuses outright is kept as refused', askedFor(gone));
      });
    });
  }).then(function () {
    var ok200 = gf('Inter');
    answers[ok200] = { status: 200 };
    return P.checkFontCss(ok200).then(function () { return P.checkFontCss(ok200); }).then(function (u) {
      ok(u === ok200 && askedFor(ok200) === 1, 'network: a font address that loads is kept', askedFor(ok200));
    });
  });
}

routeChecks.then(networkChecks).then(null, function (err) { ok(false, 'the route and network checks ran without throwing', String(err && err.stack || err)); }).then(function () {
  Module._resolveFilename = realResolve;
  delete require.cache[EX_STUB];
  delete require.cache[SAFE_FETCH_PATH];
  if (failures.length) {
    console.error('promo.test: ' + failures.length + ' of ' + checks + ' checks failed:\n  - ' + failures.join('\n  - '));
    process.exit(1);
  }
  console.log('promo.test: all ' + checks + ' checks passed');
});
