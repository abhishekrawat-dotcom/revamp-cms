/* node functions/lib/gen-design.test.js — exits 1 on the first failure it lists. No network, no Firebase. */
const g = require('./gen-design');

var failures = [], checks = 0;
function ok(cond, label, detail) { checks++; if (!cond) failures.push(label + (detail ? '\n      ' + detail : '')); }

/* ---- markupSkeleton ---- */
var page = '<html><head><style>.a{color:red}</style></head><body class="home"><script>var x = "<div>";</script>' +
  '<header class="site-header"><img alt="Logo" src="l.png"><nav><a href="#a">Speakers</a></nav></header>' +
  '<section class="hero full" style="background-image:url(h.jpg)"><h1>A very long headline that goes on and on for quite a while indeed</h1></section>' +
  '<section id="speakers" class="grid cols-4"><div class="card"><svg><path d="M0 0"/></svg><p>Jane</p></div></section></body></html>';
var sk = g.markupSkeleton(page);
ok(sk.indexOf('var x') === -1 && sk.indexOf('color:red') === -1, 'skeleton drops scripts and styles', sk);
ok(sk.indexOf('<section class="hero full" has-background-image>') !== -1, 'skeleton keeps classes and notes a background picture', sk);
ok(sk.indexOf('<section id="speakers" class="grid cols-4">') !== -1, 'skeleton keeps ids', sk);
ok(sk.indexOf('quite a while') === -1 && sk.indexOf('A very long headline') !== -1, 'skeleton cuts long text', sk);
ok(sk.indexOf('src=') === -1 && sk.indexOf('href=') === -1 && sk.indexOf('path') === -1, 'skeleton carries no addresses or svg paths', sk);
ok(g.markupSkeleton('<body>' + new Array(5000).join('<p class="x">text</p>') + '</body>', 2000).length <= 2000, 'skeleton is bounded');
ok(g.markupSkeleton('') === '', 'skeleton of nothing is nothing');

/* ---- fontFamilies ---- */
var fam = g.fontFamilies(['var(--font-display)', 'Inter', 'inter', 'sans-serif', '"Playfair Display"', 'Font Awesome 6 Free', '-apple-system', 'Montserrat']);
ok(fam.join('|') === 'Inter|Playfair Display|Montserrat', 'only real families, once each', fam.join('|'));

/* ---- pageTone ---- */
ok(g.pageTone('body{margin:0;background:#0b1020;color:#fff}', '') === 'dark', 'dark body background');
ok(g.pageTone('html,body{background-color:#fff}', '') === 'light', 'light body background');
ok(g.pageTone('.x{background:#000}', '<body style="background:#fafafa">') === 'light', 'background from the body tag');
ok(g.pageTone('.x{background:#000}', '<body>') === '', 'no declared page background -> unknown');
ok(g.pageTone('body{background:rgb(10, 12, 20)}', '') === 'dark', 'rgb() background');

/* ---- artDirectionFor ---- */
ok(g.artDirectionFor('etcio-awards-2027').id === g.artDirectionFor('etcio-awards-2027').id, 'art direction is fixed per event');
var seen = {};
['a-summit', 'b-awards', 'c-forum', 'd-conclave', 'e-expo', 'f-meet', 'g-week', 'h-day', 'i-live', 'j-con', 'k-fest', 'l-talks'].forEach(function (id) { seen[g.artDirectionFor(id).id] = 1; });
ok(Object.keys(seen).length >= 4, 'different events get different art directions', Object.keys(seen).join(','));

/* ---- palette ---- */
var dark = g.palette({ mode: 'light', backgroundColor: '#ffffff', textColor: '#111111' }, 'dark');
ok(dark.mode === 'dark' && g.luminance(dark.backgroundColor) < 0.2, 'asked for dark: the background is dark whatever the model said', JSON.stringify(dark));
ok(g.contrast(dark.textColor, dark.backgroundColor) >= 7, 'asked for dark: text is readable', JSON.stringify(dark));
var light = g.palette({ mode: 'dark', backgroundColor: '#0b1329', textColor: '#f0f0f0' }, 'light');
ok(light.mode === 'light' && g.luminance(light.backgroundColor) > 0.5, 'asked for light: the background is light', JSON.stringify(light));
ok(g.contrast(light.textColor, light.backgroundColor) >= 7, 'asked for light: text is readable');
var auto = g.palette({ mode: 'dark', backgroundColor: '#0b1329', surfaceColor: '#141d3a', textColor: '#f4f4f6', mutedColor: '#b7bdcc' }, 'auto');
ok(auto.mode === 'dark' && auto.backgroundColor === '#0b1329' && auto.surfaceColor === '#141d3a', 'auto keeps a sound design as designed', JSON.stringify(auto));
var weak = g.palette({ mode: 'light', backgroundColor: '#ffffff', textColor: '#bbbbbb', mutedColor: '#eeeeee' }, 'auto');
ok(g.contrast(weak.textColor, weak.backgroundColor) >= 7 && g.contrast(weak.mutedColor, weak.backgroundColor) >= 4.5, 'unreadable text colours are replaced', JSON.stringify(weak));
var old = g.palette({ themeColor: '#0b2239' }, 'auto');
ok(old.mode === 'light' && old.backgroundColor === '#ffffff', 'a design with no page colours is a light page', JSON.stringify(old));
ok(g.normaliseMode('DARK') === 'dark' && g.normaliseMode('x') === 'auto' && g.normaliseMode() === 'auto', 'normaliseMode');

/* ---- clampFontSizes ---- */
var css = '.a{font-size:11px}.b{font-size: 0.75rem;color:red}.c{font-size:18px}.d{font-size:clamp(0.7rem, 2vw, 1rem)}.e{font-size:.8em}.f{font-size:12px!important}.g{font-size:clamp(2rem,4vw,3rem)}';
var out = g.clampFontSizes(css);
ok(out.indexOf('.a{font-size:14px}') !== -1, '11px -> 14px', out);
ok(out.indexOf('.b{font-size: 0.875rem;color:red}') !== -1, '0.75rem -> 0.875rem', out);
ok(out.indexOf('.c{font-size:18px}') !== -1, '18px untouched', out);
ok(out.indexOf('.d{font-size:clamp(0.875rem, 2vw, 1rem)}') !== -1, 'the minimum of a clamp is raised', out);
ok(out.indexOf('.e{font-size:.8em}') !== -1, 'em left alone', out);
ok(out.indexOf('.f{font-size:14px!important}') !== -1, '!important kept', out);
ok(out.indexOf('.g{font-size:clamp(2rem,4vw,3rem)}') !== -1, 'a large clamp untouched', out);
ok(g.clampFontSizes('') === '' && g.clampFontSizes(null) === '', 'empty css');

/* ---- capHeadingSizes: section headings held to the site's type scale ---- */
var S = '[data-rv-section="overview"] ';
var loud = S + '.overview-title{font-family:var(--heading-font-family);font-size:clamp(2rem,4.2vw,3.25rem);line-height:1.1}' +
  S + '.overview-h2{font-size:56px}' + S + 'h2{font-size: 3rem !important;color:red}' +
  S + '.overview-sub{font-size:clamp(1.6rem, 3vw, 2.25rem)}' + S + '.overview-card-title{font-size:1.75rem}' +
  S + '.overview-num{font-size:clamp(2.6rem,5vw,4rem)}' + S + '.overview-stat-value{font-size:4rem}' + S + '.overview-big-figure{font-size:72px}' +
  S + 'h2.overview-count{font-size:4rem}' + S + '.overview-kicker{font-size:0.875rem}' + S + '.overview-lede{font-size:1.125rem}' + S + '.overview-quote{font-size:3rem}' +
  S + '.overview-title::before{font-size:6rem}' + S + '.overview-title span{font-size:3rem}' +
  '@media (max-width:820px){' + S + '.overview-title{font-size:2.75rem}}' + S + '.overview-title{font-size:2rem}';
var html = '<section id="overview"><h2 class="overview-title">About</h2><h3 class="overview-sub">Why</h3><p class="overview-lede">x</p></section>';
var calm = g.capHeadingSizes(loud, html);
ok(calm.indexOf('.overview-title{font-family:var(--heading-font-family);font-size:clamp(1.75rem, 3.069vw, 2.375rem);line-height:1.1}') !== -1, 'a clamp is scaled down as a whole: 38px at most, a 28px floor on a phone', calm);
ok(calm.indexOf('.overview-h2{font-size:38px}') !== -1, 'px: 56px -> 38px', calm);
ok(calm.indexOf('h2{font-size: 2.375rem !important;color:red}') !== -1, 'rem, by tag: 3rem -> 2.375rem, !important kept', calm);
ok(calm.indexOf('.overview-sub{font-size:clamp(1.25rem, 2.167vw, 1.625rem)}') !== -1, 'a class used on an h3 is a sub-heading: 26px at most', calm);
ok(calm.indexOf('.overview-card-title{font-size:1.625rem}') !== -1, 'a card title is a sub-heading by its name', calm);
ok(calm.indexOf('@media (max-width:820px){' + S + '.overview-title{font-size:2.375rem}}') !== -1, 'rules inside @media too', calm);
ok(calm.indexOf(S + '.overview-title{font-size:2rem}') !== -1, 'a heading within the scale is left as it is', calm);
['.overview-num{font-size:clamp(2.6rem,5vw,4rem)}', '.overview-stat-value{font-size:4rem}', '.overview-big-figure{font-size:72px}', 'h2.overview-count{font-size:4rem}']
  .forEach(function (r) { ok(calm.indexOf(r) !== -1, 'big numerals in a stats band are left alone: ' + r, calm); });
['.overview-kicker{font-size:0.875rem}', '.overview-lede{font-size:1.125rem}', '.overview-quote{font-size:3rem}', '.overview-title::before{font-size:6rem}', '.overview-title span{font-size:3rem}']
  .forEach(function (r) { ok(calm.indexOf(r) !== -1, 'not a heading, left alone: ' + r, calm); });
ok(g.capHeadingSizes(calm, html) === calm, 'idempotent: capping again changes nothing');
var bare = g.capHeadingSizes(loud);
ok(bare === g.capHeadingSizes(loud, {}) && bare.indexOf('.overview-title{font-family:var(--heading-font-family);font-size:clamp(1.75rem, 3.069vw, 2.375rem)') !== -1 && bare.indexOf('.overview-sub{font-size:clamp(1.6rem, 3vw, 2.25rem)}') !== -1,
  'without the markup, tags and heading-like names are what count (a plain "-sub" class is then not a heading)', bare);
ok(g.capHeadingSizes('.a-title{font-size:clamp(2rem,calc(1rem + 3vw),64px)}') === '.a-title{font-size:clamp(1.75rem, calc(0.594rem + 1.781vw), 38px)}', 'a calc() preferred value is scaled with it', g.capHeadingSizes('.a-title{font-size:clamp(2rem,calc(1rem + 3vw),64px)}'));
ok(g.capHeadingSizes('.a-title{font-size:5vw}.b-title{font-size:2.4em}.c-title{font-size:var(--x)}.d-title{font-size:min(4rem,6vw)}') === '.a-title{font-size:5vw}.b-title{font-size:2.4em}.c-title{font-size:var(--x)}.d-title{font-size:min(4rem,6vw)}', 'sizes that cannot be read are left as they are');
ok(g.capHeadingSizes('.a-title, .a-num{font-size:4rem}') === '.a-title, .a-num{font-size:4rem}', 'a rule shared with a numeral is left alone');
ok(g.capHeadingSizes('.key-metrics-heading{font-size:3.25rem}.key-metrics-num{font-size:4rem}') === '.key-metrics-heading{font-size:2.375rem}.key-metrics-num{font-size:4rem}', 'the heading of a metrics section is a heading; its numerals are not');
ok(g.capHeadingSizes('') === '' && g.capHeadingSizes(null) === '', 'empty css');
ok(/clamp\(1\.75rem, 3vw, 2\.375rem\)/.test(g.HEADING_SCALE.section) && g.HEADING_SCALE.sectionMaxPx === 38, 'the scale the prompts ask for tops out at 38px');
ok(g.capHeadingSizes('.x-title{font-size:' + g.HEADING_SCALE.section + '}') === '.x-title{font-size:' + g.HEADING_SCALE.section + '}', 'the scale the prompts ask for passes the cap untouched');

/* ---- ensureLogo ---- */
var URL_ = 'https://storage.googleapis.com/b/events/x/logo/l.png';
var nav = '<nav id="nav" class="nav"><div class="nav-inner"><span class="brand">My Event</span><a href="#a">A</a></div></nav>';
var withLogo = g.ensureLogo(nav, URL_, 'My "Event"');
ok(withLogo.indexOf('<div class="nav-inner"><a href="#top" data-rv-logo-link><img data-rv-logo') !== -1, 'a missing logo goes first inside the bar', withLogo);
ok(withLogo.indexOf('alt="My &quot;Event&quot;"') !== -1, 'the name is escaped', withLogo);
var has = '<nav><a href="#hero"><img class="l" src="' + URL_ + '" alt=""></a></nav>';
var kept = g.ensureLogo(has, URL_, 'E');
ok((kept.match(/<img/g) || []).length === 1 && kept.indexOf('<img data-rv-logo class="l"') !== -1, 'a logo already there is kept, and marked', kept);
ok(g.ensureLogo(nav, '', 'E') === nav, 'no logo, no change');

/* ---- imagePrompt ---- */
var ip = g.imagePrompt('server halls', { mode: 'dark', themeColor: '#123456', accentColor: '#abcdef', imageStyle: 'long exposure' }, { hero: true, keyVisual: false });
/* the banner by default: a designed key visual as on ET's own sites — no people, no words, the centre calm */
var kv = g.imagePrompt('battery packs and ADAS sensors', { mode: 'dark', themeColor: '#123456', accentColor: '#abcdef', imageStyle: 'long exposure', place: { city: 'Bengaluru' } }, { hero: true });
ok(/KEY VISUAL/.test(kv) && /not a photograph of an event/.test(kv) && /no people and no faces/.test(kv) && !/Indian \(South Asian\)/.test(kv) && /centre is calm/.test(kv) && /work its landmarks/.test(kv) && !/long exposure/.test(kv), 'the banner is a key visual of the field and the city: no people, no words, calm centre', kv);
ok(/never a real, famous or named person/.test(ip) && /No readable text/.test(ip) && /16:9/.test(ip) && /Scene: server halls/.test(ip) && /long exposure/.test(ip), 'image prompt carries the scene, the style and the rules', ip);
ok(!/no people/i.test(ip) && /Indian \(South Asian\) professionals/.test(ip) && /Women and men in about equal numbers/.test(ip) && /women clearly present in leading roles/.test(ip), 'people are Indian, women as much as men, never anyone real', ip);
var ipGlobal = g.imagePrompt('a panel on stage', {}, { level: 'global' });
ok(/GLOBAL event: the people are an international mix/.test(ipGlobal) && !/Indian \(South Asian\)/.test(ipGlobal) && /Women and men in about equal numbers/.test(ipGlobal), 'an owner\'s global event shows an international mix, women included', ipGlobal);
var ipGraphic = g.imagePrompt('nodes and lines', { mode: 'light' }, { hero: true, graphic: true });
ok(/graphic composition \(not a photograph\)/.test(ipGraphic) && /no people, no faces/.test(ipGraphic) && !/PEOPLE:/.test(ipGraphic), 'graphics, not photographs: no people in the picture', ipGraphic);
var heroSponsor = g.heroHtml({ unit: '', tagline: 't', primary: { label: 'Become a Partner', href: '#sponsors', register: false }, secondary: { label: 'Register Now', href: '#contact' } });
ok(!/data-register-cta[^>]*>Become a Partner/.test(heroSponsor) && /Become a Partner/.test(heroSponsor), 'a partner button is not marked as registration', heroSponsor.slice(0, 300));
var heroDefault = g.heroHtml({ unit: '', tagline: 't', primary: { label: 'Register Now', href: '#contact' } });
ok(/data-register-cta/.test(heroDefault), 'a register button is marked as registration');
var navEt = g.ensureEtLogo('<nav class="n"><div class="w"><ul><li>Overview</li></ul></div></nav>', 'dark', 'nav');
ok(/<div class="w"><a href="#hero" data-rv-et-logo-link[^>]*><img data-rv-et-logo src="\/templates\/_shared\/img\/et-business-verticals-on-dark\.svg"/.test(navEt), 'the ET logo opens the nav bar, the dark-background version on a dark site', navEt);
ok(g.ensureEtLogo(navEt, 'light', 'nav') === navEt, 'the ET logo is never added twice');
ok(/on-light\.svg/.test(g.ensureEtLogo('<footer><p>x</p></footer>', 'light', 'footer')) && /margin:0 0 18px/.test(g.ensureEtLogo('<footer><p>x</p></footer>', 'light', 'footer')), 'the footer opens with the light-background version on a light site');
ok(!/data-rv-logo[^-]/.test(navEt), 'it is not taken for the event\'s own logo (data-rv-logo)');
var swapped = g.ensureEtLogo('<nav><div><a href="#hero"><img data-rv-logo src="https://x/logo.png" alt="Event"></a><ul></ul></div></nav>', 'dark', 'nav');
ok(!/data-rv-logo[^-]/.test(swapped) && (swapped.match(/data-rv-et-logo\b/g) || []).length === 1 && /on-dark\.svg/.test(swapped) && !/logo\.png/.test(swapped), 'an event logo the model put in the nav becomes the ET logo, in its place', swapped);
var navMany = '<nav><a href="#hero"><img data-rv-et-logo src="x"></a><a href="#overview">Overview</a><a href="#key-discussion-points">Themes</a><a href="#speakers">Speakers</a><a href="#why-join-us">Why Attend</a><a href="#who-should-attend">Who Attends</a><a href="#past-edition-glimpses">Glimpses</a><a href="#contact-us">Contact</a><a href="#about-vertical" class="nav-btn">Register Now</a></nav>';
var capped = g.capNavLinks(navMany);
ok(/Overview/.test(capped) && /Themes/.test(capped) && /Speakers/.test(capped) && /Why Attend/.test(capped) && /Contact/.test(capped) && !/Glimpses/.test(capped) && !/Who Attends/.test(capped) && /Register Now/.test(capped) && /data-rv-et-logo/.test(capped), 'the nav keeps five links (gallery and who-should-attend go first), the button and the logo', capped);
ok(g.capNavLinks(capped) === capped, 'a nav of five is left as it is');
var mv = [{ id: 'hero', html: '' }, { id: 'key-topics', html: '<div data-rv-carousel="auto"></div>' }, { id: 'previous-speakers', html: '<div data-rv-carousel="auto"></div>' },
  { id: 'previous-sponsors', html: '<div data-rv-carousel="auto"></div><div data-rv-carousel="auto"></div>' }, { id: 'previous-glimpses', html: "<div data-rv-carousel='auto'></div>" }, { id: 'faq', html: '' }];
var keptMv = g.motionBudget(mv);
ok(JSON.stringify(keptMv) === '["previous-sponsors","key-topics"]', 'two moving rows at most, the logos first, never neighbours', JSON.stringify(keptMv));
ok(/data-rv-carousel="auto"/.test(mv[3].html) && (mv[3].html.match(/="auto"/g) || []).length === 1, 'one moving row in a section');
ok(!/auto/.test(mv[2].html) && /data-rv-carousel>/.test(mv[2].html) && !/auto/.test(mv[4].html), 'the others stay carousels the visitor moves');
var ipAbout = g.imagePrompt('a panel on stage', {}, { about: 'MarTech Summit 2027, marketing technology, Gurugram' });
ok(/The event: MarTech Summit 2027, marketing technology, Gurugram\./.test(ipAbout) && /4:3/.test(ipAbout), 'a picture is told which event it belongs to', ipAbout);

/* ---- the logo unit as one picture ---- */
var lu = g.logoUnitImageHtml({ url: 'https://storage.googleapis.com/b/events/e/generated/1-logo-unit.svg', alt: 'A & B "Summit" 2027', width: 404.4, height: 308, mode: 'dark' });
ok(/^<div class="rv-lu rv-lu-pic rv-lu-on-dark" data-rv-logo-unit><img class="rv-lu-img" src="https:\/\/storage[^"]+\.svg" alt="A &amp; B &quot;Summit&quot; 2027" width="404" height="308" decoding="async"><\/div>$/.test(lu), 'the unit is one picture, sized, with the name as its alt text', lu);
ok(g.logoUnitImageHtml({ url: '' }) === '' && g.logoUnitImageHtml({}) === '' && g.logoUnitImageHtml() === '', 'no picture, no unit: the caller sets it in type');
ok(g.logoUnitImageHtml({ url: 'javascript:alert(1)' }) === '' && g.logoUnitImageHtml({ url: 'http://x.example/a.png' }) === '' && g.logoUnitImageHtml({ url: '/templates/x.svg' }) === '', 'only an https address is a picture');
var noted = g.logoUnitImageHtml({ url: 'https://x.example/u.png', mode: 'light', plate: 'dark', note: 'It still shows 2026 "as drawn" <b>' });
ok(noted.indexOf('data-rv-logo-note="It still shows 2026 &quot;as drawn&quot; &lt;b&gt;"') !== -1 && noted.indexOf('<span class="rv-lu-plate rv-lu-plate-dark"><img') !== -1 && noted.indexOf('rv-lu-on-light') !== -1 && !/width=/.test(noted), 'the note travels on the unit, escaped; a plate when asked; no size when none is known', noted);
ok(g.logoUnitImageHtml({ url: 'https://x.example/u.png', plate: 'purple' }).indexOf('rv-lu-plate') === -1, 'an unknown plate is no plate');

/* the phone rules the prompts carry: what gen-base.css's "Phones" floor relies on (buttons named -btn, one column) */
ok(typeof g.MOBILE_RULES === 'string' && /360px/.test(g.MOBILE_RULES) && /-btn/.test(g.MOBILE_RULES) && /ONE column/.test(g.MOBILE_RULES) && /min-width:0/.test(g.MOBILE_RULES), 'the phone rules name the checked width, the button class, one column and shrinkable cells');

if (failures.length) {
  console.log(failures.length + ' of ' + checks + ' checks FAILED:\n\n  - ' + failures.join('\n  - '));
  process.exit(1);
}
console.log('gen-design: all ' + checks + ' checks passed');
