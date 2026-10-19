// node functions/lib/et-nav.test.js — the top bar of an AI-designed site, as ET's own event sites draw it.
const nav = require('./et-nav');
const { scopeSectionCss, sectionRootInfo } = require('./gen-markup');
const genDesign = require('./gen-design');
var passed = 0, failed = 0;
function check(name, ok, detail) { if (ok) { passed++; return; } failed++; console.error('FAIL ' + name + (detail ? ' — ' + detail : '')); }

/* ---------- the portal ---------- */
check('portal from an ET microsite address', nav.portalOf(['https://brandequity.economictimes.indiatimes.com/brand-world-summit-south2025']) === 'brandequity');
check('portal from a slug, the first known one wins', nav.portalOf(['', 'nonsense', 'CIO', 'hr']) === 'cio');
check('no portal for an address elsewhere or an unknown portal', nav.portalOf(['https://example.com/x', 'https://zzz.economictimes.indiatimes.com/x', null]) === '');
check('the candidates: ET\'s record of the previous edition first, then the reference pages',
  JSON.stringify(nav.portalCandidates({ reference: { type: 'previousEdition', url: 'https://cio.economictimes.indiatimes.com/a' }, design: { logoUnitFrom: 'https://hr.economictimes.indiatimes.com/b' } },
    [{ type: 'competitor', url: 'https://retail.economictimes.indiatimes.com/c', previous: { portal: 'retail' } }, { type: 'previousEdition', url: 'https://auto.economictimes.indiatimes.com/d', previous: { portal: 'auto' } }])) ===
  JSON.stringify(['auto', 'https://cio.economictimes.indiatimes.com/a', 'https://hr.economictimes.indiatimes.com/b', 'https://auto.economictimes.indiatimes.com/d']));
check('a competitor\'s page never names the portal', nav.portalOf(nav.portalCandidates({}, [{ type: 'competitor', url: 'https://retail.economictimes.indiatimes.com/c' }])) === '');

/* ---------- the logo ---------- */
var be = nav.logoOf('brandequity', 'light'), beDark = nav.logoOf('brandequity', 'dark');
check('the portal\'s wordmark for a light ground', be.src === '/templates/_shared/img/portals/brandequity.png' && be.alt === 'ET BrandEquity' && be.href === 'https://brandequity.economictimes.indiatimes.com/', JSON.stringify(be));
check('its light-ink version for a dark ground', beDark.src === '/templates/_shared/img/portals/brandequity-light.png' && beDark.onLight === be.onLight && beDark.onDark === beDark.src);
check('a long one-line wordmark is 20px tall, as on ET\'s pages', be.px === 20 && be.width === 560 && be.height === 59, be.px + ' ' + be.width + 'x' + be.height);
check('a two-line wordmark is given more height so that it can be read', nav.logoOf('hr', 'light').px > 24 && nav.logoOf('hr', 'light').px <= 32);
var noLight = nav.logoOf('masterclass', 'dark');
/* every portal now has a light-ink wordmark (templates/_shared/img/portals/<slug>-light.png, added with the footer) */
check('a portal stands on a dark ground in its light-ink wordmark', /masterclass-light\.png$/.test(noLight.src) && /masterclass\.png$/.test(noLight.onLight), JSON.stringify(noLight));
var unknown = nav.logoOf('no-such-portal', 'dark');
check('an unknown portal stands on a dark ground as The Economic Times Business Verticals', /et-business-verticals-on-dark\.svg$/.test(unknown.src), JSON.stringify(unknown));
var bv = nav.logoOf('', 'light');
check('no portal: The Economic Times Business Verticals logo, linking to the top', /et-business-verticals-on-light\.svg$/.test(bv.src) && /on-dark\.svg$/.test(bv.onDark) && bv.href === '#hero' && /Business Verticals/.test(bv.alt));
check('an unknown portal is no portal', nav.logoOf('../../etc', 'light').src === bv.src);

/* ---------- the facts ---------- */
check('one day', nav.shortDate('2025-12-05T10:00', '2025-12-05T18:00') === '5 Dec 2025' && nav.shortDate('2025-12-05', '') === '5 Dec 2025');
check('days in one month', nav.shortDate('2026-12-05T10:41', '2026-12-07T23:41') === '5–7 Dec 2026');
check('across months and years', nav.shortDate('2026-11-30', '2026-12-02') === '30 Nov – 2 Dec 2026' && nav.shortDate('2026-12-31', '2027-01-01') === '31 Dec 2026 – 1 Jan 2027');
check('no date, or an end before the start', nav.shortDate('', '') === '' && nav.shortDate('soon', '') === '' && nav.shortDate('2026-12-07', '2026-12-05') === '7 Dec 2026');
check('the place: venue and city, the city not said twice', nav.placeOf({ venue: 'Taj Wellington Mews, Chennai', city: 'Chennai' }) === 'Taj Wellington Mews, Chennai' &&
  nav.placeOf({ venue: 'The Leela', city: 'Mumbai' }) === 'The Leela, Mumbai' && nav.placeOf({ location: 'Online' }) === 'Online' && nav.placeOf({}) === '');

/* ---------- the links ---------- */
var links = nav.linksOf([{ id: 'nav' }, { id: 'hero' }, { id: 'overview', name: 'Overview' }, { id: 'previous-speakers', name: 'Previous Edition Speakers' }, { id: 'overview', name: 'Again' },
  { id: 'faqs', name: '' }, { id: 'bad id"><script>', name: 'x' }, { id: 'footer', name: 'Footer' }]);
check('a link to every section in page order; nav, hero, footer, repeats and odd ids left out', JSON.stringify(links) === JSON.stringify([{ id: 'overview', label: 'Overview' }, { id: 'previous-speakers', label: 'Past Speakers' }, { id: 'faqs', label: 'Faqs' }]), JSON.stringify(links));

/* ---------- the bar ---------- */
var built = nav.build({ name: 'Brand World Summit 2026', sub: { date: '5–7 Dec 2026', place: 'Taj Wellington Mews, Chennai' }, portal: 'brandequity', mode: 'light', themeColor: '#ed1c24',
  links: [{ id: 'overview', label: 'Overview' }, { id: 'agenda', label: 'Agenda' }], cta: { label: 'Register Now', href: '#contact-us', register: true } });
var h = built.html;
check('one root element, the nav section\'s', /^<header class="rv-etnav" id="nav" data-rv-etnav>/.test(h) && /<\/header>$/.test(h) && sectionRootInfo(h).tag === 'header');
check('menu button, portal logo with both versions, name, date and place', /data-rv-etnav-burger/.test(h) && /data-rv-et-logo data-rv-on-light="\/templates\/_shared\/img\/portals\/brandequity\.png" data-rv-on-dark="\/templates\/_shared\/img\/portals\/brandequity-light\.png"/.test(h) &&
  />Brand World Summit 2026</.test(h) && /<span class="rv-etnav-date">5–7 Dec 2026<\/span><span class="rv-etnav-place">Taj Wellington Mews, Chennai<\/span>/.test(h));
check('the section links and the main action', /<li><a href="#overview">Overview<\/a><\/li><li><a href="#agenda">Agenda<\/a><\/li>/.test(h) && /<a class="rv-etnav-cta" data-register-cta href="#contact-us">Register Now<\/a>/.test(h));
check('no tabs unless the event has them', !/rv-etnav-tabs/.test(h));
var tabbed = nav.build({ name: 'X', tabs: [{ label: 'Conference', href: '#hero', active: true }, { label: 'Awards', href: 'https://brandequity.economictimes.indiatimes.com/awards' }] }).html;
check('tabs when given, the current one marked', /<ul class="rv-etnav-tabs"><li><a class="rv-etnav-tab is-current" href="#hero" aria-current="page">Conference<\/a><\/li><li><a class="rv-etnav-tab" href="https:\/\/brandequity/.test(tabbed));
check('a partnership action is not a registration button', !/data-register-cta/.test(nav.build({ name: 'X', cta: { label: 'Join as Partner', href: '#sponsors', register: false } }).html));
var evil = nav.build({ name: '<img src=x onerror=alert(1)>', sub: { date: '"><b>', place: '' }, links: [{ id: 'a', label: '<script>x</script>' }] }).html;
check('the event\'s words are escaped', !/<img src=x/.test(evil) && !/<script>/.test(evil) && !/"><b>/.test(evil));
var unsafe = nav.build({ name: 'X', tabs: [{ label: 'Bad', href: 'javascript:alert(1)' }, { label: 'Plain', href: 'http://example.com' }, { label: 'Ok', href: '#awards' }], cta: { label: 'Go', href: 'javascript:alert(1)' } }).html;
check('only a place on the page or an https page is linked: no javascript:, no http:', !/javascript:|http:/i.test(unsafe) && /href="#awards">Ok</.test(unsafe) && /rv-etnav-cta" data-register-cta href="#hero">Go</.test(unsafe), unsafe);
check('nothing in the bar runs: no script, no inline handler', !/<script|\son[a-z]+=/i.test(h));
check('a white CTA word on a dark brand colour, a dark one on a light brand colour', /rv-etnav-cta\{[^}]*color:#ffffff/.test(built.css) && /rv-etnav-cta\{[^}]*color:#14161b/.test(nav.build({ themeColor: '#f5d000' }).css));

var css = built.css;
check('every colour and font of the bar is one of the page\'s variables', !/#[0-9a-f]{3,8}\b/i.test(css.replace(/rv-etnav-cta\{[^}]*\}/, '').replace(/rgba\([^)]*\)/g, '')) && /var\(--rv-bg\)/.test(css) && /var\(--rv-text\)/.test(css) && /var\(--theme-color\)/.test(css) && /var\(--body-font-family\)/.test(css));
check('no text below the smallest readable size', genDesign.clampFontSizes(css) === css);
check('the floating state, the phone and the editor\'s view are in the stylesheet', /\.rv-etnav-bar\.rv-etnav--float\{position:fixed/.test(css) && /@media \(max-width:860px\)/.test(css) && /\.rv-etnav-bar\.rv-etnav--live \.rv-etnav-list\{flex-wrap:nowrap/.test(css) && /\.rv-etnav-list\{display:flex;flex-wrap:wrap/.test(css));
check('the bar in the page\'s flow at the top: never fixed over the banner', /\.rv-etnav\{position:relative/.test(css) && !/\.rv-etnav-bar\{[^}]*position:(fixed|sticky)/.test(css));
check('no motion for visitors who asked for none', /prefers-reduced-motion:reduce\)\{[^}]*animation:none/.test(css));

/* scoped as a stored section's: every state rule still reaches the bar */
var scoped = scopeSectionCss(css, 'nav', sectionRootInfo(h));
check('scoped, the root\'s own rule reaches the root', scoped.indexOf(',[data-rv-section="nav"].rv-etnav{position:relative') !== -1, scoped.slice(0, 300));
check('scoped, the floating state is a descendant rule that can match', /\[data-rv-section="nav"\] \.rv-etnav-bar\.rv-etnav--float\{position:fixed/.test(scoped));
check('scoped, the keyframes are the section\'s own and the animation names them', /@keyframes rv-nav-rv-etnav-in/.test(scoped) && /animation:rv-nav-rv-etnav-in /.test(scoped));
check('scoping twice changes nothing', scopeSectionCss(scoped, 'nav', sectionRootInfo(h)) === scoped);

/* ---------- the stored section, for an event ---------- */
var event = {
  name: 'Brand World Summit 2026', start: '2026-12-05T10:41', end: '2026-12-07T23:41', venue: 'Taj Wellington Mews, Chennai', city: '',
  designPlan: {
    design: { mode: 'dark', themeColor: '#ed1c24' }, owner: { action: { kind: 'register', label: 'Book a Seat' } },
    reference: { type: 'previousEdition', url: 'https://brandequity.economictimes.indiatimes.com/brand-world-summit-south2025' },
    sections: [{ id: 'overview', name: 'Overview', kind: 'custom' }, { id: 'sponsors', name: 'Sponsors', kind: 'partners' }, { id: 'contact-us', name: 'Contact Us', kind: 'contact' },
      { id: 'previous-glimpses', name: 'Previous Edition Glimpses', kind: 'custom', prebuilt: 'glimpses' }]
  }
};
var sec = nav.sectionFor(event, { order: ['nav', 'hero', 'overview', 'previous-glimpses', 'sponsors', 'contact-us', 'footer'] });
check('the stored section: id and kind', sec.id === 'nav' && sec.kind === 'nav');
check('links in the page\'s order, the server-built sections among them', /href="#overview">Overview<\/a><\/li><li><a href="#previous-glimpses">Past Glimpses<\/a><\/li><li><a href="#sponsors">Sponsors<\/a><\/li><li><a href="#contact-us">Contact Us/.test(sec.html), sec.html);
check('the portal read from the reference page, its version for the site\'s dark tone', /src="\/templates\/_shared\/img\/portals\/brandequity-light\.png"/.test(sec.html));
check('the owner\'s main action, to the contact section', /data-register-cta href="#contact-us">Book a Seat</.test(sec.html));
check('the date and place of the event', />5–7 Dec 2026</.test(sec.html) && />Taj Wellington Mews, Chennai</.test(sec.html));
check('its stylesheet is scoped to the section', /^\[data-rv-section="nav"\]\{position:relative;z-index:50;isolation:isolate\}/.test(sec.css) && scopeSectionCss(sec.css, 'nav', sectionRootInfo(sec.html)) === sec.css);
var plain = nav.sectionFor({ name: 'X', designPlan: { sections: [] } }, {});
check('an event with nothing known: the ET logo, the name, Register Now to the footer', /et-business-verticals-on-light\.svg/.test(plain.html) && />X</.test(plain.html) && /href="#footer">Register Now</.test(plain.html) && !/rv-etnav-links/.test(plain.html) && !/rv-etnav-sub/.test(plain.html));

if (failed) { console.error('et-nav: ' + failed + ' of ' + (passed + failed) + ' checks FAILED'); process.exit(1); }
console.log('et-nav: all ' + passed + ' checks passed');
