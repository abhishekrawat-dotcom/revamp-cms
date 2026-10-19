// node functions/lib/et-footer.test.js — ET's common footer for AI-designed sites.
const ef = require('./et-footer');
const ee = require('./et-events');
const fs = require('fs'), path = require('path');
var passed = 0, failed = 0;
function check(name, ok, detail) { if (ok) { passed++; return; } failed++; console.error('FAIL ' + name + (detail ? ' — ' + detail : '')); }

/* ---------- the table ---------- */
var ROOT = path.join(__dirname, '..', '..');
var missing = [];
Object.keys(ee.PORTALS).forEach(function (slug) {
  var p = ef.info(slug);
  [p.logo.onLight, p.logo.onDark].forEach(function (f) { if (!fs.existsSync(path.join(ROOT, f))) missing.push(slug + ' ' + f); });
});
check('every portal\'s logo files exist (both inks), the unknown ones\' fallback too', missing.length === 0, missing.join(', '));
var notInRoster = Object.keys(ef.DATA).filter(function (k) { return !ee.isPortal(k); });
check('every portal in the table is on the roster', notInRoster.length === 0, notInRoster.join(','));
var absent = Object.keys(ee.PORTALS).filter(function (k) { return !ef.isKnown(k); });
check('the roster\'s portals are all in the table but ET Shipping (no site)', absent.join(',') === 'shipping', absent.join(','));

var be = ef.info('brandequity');
check('brandequity: site, home', be.site === 'ETBrandEquity.com' && be.home === 'https://brandequity.economictimes.indiatimes.com');
check('brandequity: ET\'s links, .php kind', be.links[0].map(function (l) { return l[0]; }).join('|') === 'About Us|Contact Us|Advertise with us|Newsletter|RSS Feeds|Invite Friends' &&
  be.links[1].map(function (l) { return l[1].replace(be.home, ''); }).join('|') === '/privacy_policy.php|/terms_conditions.php|/guest-post-guidelines|/sitemap', JSON.stringify(be.links));
check('brandequity: X, Facebook, LinkedIn in that order', be.social.map(function (s) { return s.kind; }).join(',') === 'x,facebook,linkedin' && be.social[2].href === 'https://www.linkedin.com/company/etbrandequity/');
check('brandequity: escalation to Md. Shahbaz Khan', be.escalation.email === 'shahbaz.khan@timesinternet.in' && /Director - Special Initiatives & Business Strategy, The Economic Times Business Verticals\.$/.test(be.escalation.who));
check('brandequity: wordmark in both inks', be.logo.onLight === '/templates/_shared/img/portals/brandequity.png' && be.logo.onDark === '/templates/_shared/img/portals/brandequity-light.png');
var dc = ef.info('datacenters');
check('a newer portal: privacy and terms without .php', /\/privacy_policy$/.test(dc.links[1][0][1]) && /\/terms_conditions$/.test(dc.links[1][1][1]));
check('infra: escalation to Keshav Kumar', ef.info('infra').escalation.email === 'keshav.kumar@timesinternet.in');
check('techmonk: its own host', ef.info('techmonk').home === 'https://techgig.com');
check('startup: ET Entrepreneur\'s site', ef.info('startup').home === 'https://entrepreneur.economictimes.indiatimes.com' && ef.info('startup').logo.onLight === '/templates/_shared/img/portals/startup.png');
check('manufacturing: no X (ET\'s own link is not ET\'s account)', ef.info('manufacturing').social.every(function (s) { return s.kind !== 'x'; }));
['', 'nope', '__proto__', 'constructor', null, undefined, 'shipping'].forEach(function (slug) {
  var u = ef.info(slug);
  check('unknown portal "' + slug + '": ET Business Verticals logo, ET B2B links, no events', u.slug === '' && /et-business-verticals-on-light\.svg$/.test(u.logo.onLight) && /et-business-verticals-on-dark\.svg$/.test(u.logo.onDark) &&
    u.home === 'https://b2b.economictimes.indiatimes.com' && u.events === '' && u.site === 'EconomictimesB2B.com', JSON.stringify(u).slice(0, 200));
});

/* ---------- What's Happening ---------- */
function ev(id, title, start, extra) {
  return Object.assign({ id: String(id), title: title, start: start, end: start, link: 'https://brandequity.economictimes.indiatimes.com/e' + id, logo: 'https://img.etb2bimg.com/l' + id + '.jpg', past: false, upcoming: true }, extra || {});
}
var list = [
  ev(1, 'CX Annual Symposium 2026', '2026-12-04 08:00:00'),
  ev(2, 'Brand World Summit South 2026', '2026-11-26 09:00:00', { link: 'https://brandequity.economictimes.indiatimes.com/brand-world-summit-south' }),
  ev(3, 'India Communication Summit 2027', ''),                                   // no date: ET's footer leaves it out
  ev(4, 'Over Already', '2026-10-01 09:00:00'),
  ev(5, 'Past One', '2026-11-01 09:00:00', { past: true }),
  ev(6, 'Shark Awards 2026', '2026-11-20 09:00:00'),
  ev(7, 'No Link', '2026-11-21 09:00:00', { link: 'javascript:alert(1)' }),
  ev(8, 'Brand World Summit 2026', '2026-12-10 09:00:00'),
  ev(9, 'A', '2026-12-11 09:00:00'), ev(10, 'B', '2026-12-12 09:00:00'), ev(11, 'C', '2026-12-13 09:00:00'),
  ev(12, 'On Now', '2026-10-14 09:00:00', { end: '2026-10-16 18:00:00' })
];
var h = ef.happening(list, { today: '2026-10-15', name: 'Brand World Summit 2026', series: 'brand-world-summit-south' });
check('happening: on now or coming, dated, linked, soonest first, at most 4, never this event', h.map(function (e) { return e.id; }).join(',') === '12,6,1,9', h.map(function (e) { return e.id; }).join(','));
check('happening: max', ef.happening(list, { today: '2026-10-15', max: 2 }).length === 2);
check('happening: nothing given, nothing shown', ef.happening(null).length === 0 && ef.happening('x').length === 0);
check('short date as ET writes it', ef.shortDate('2026-11-26 09:00:00') === '26 Nov \'26' && ef.shortDate('2026-01-05') === '05 Jan \'26' && ef.shortDate('') === '' && ef.shortDate('2026-13-01') === '');

/* ---------- the markup ---------- */
var built = ef.build({
  portal: 'brandequity', mode: 'light', year: 2026, events: h,
  event: { name: 'Brand World Summit 2026', date: '5 Dec 2026 – 7 Dec 2026', place: 'Taj Wellington Mews, Chennai', button: { label: 'Register Now', href: '#contact-us', register: true } }
});
var H = built.html, C = built.css;
check('one footer root, id footer (the hero\'s "#footer" lands on it)', /^<footer id="footer" class="etf" data-rv-et-footer="brandequity">/.test(H) && /<\/footer>$/.test(H) && (H.match(/<footer\b/g) || []).length === 1);
check('the event band: name, date · place, the register button', /<p class="etf-event-name">Brand World Summit 2026<\/p>/.test(H) && /5 Dec 2026 – 7 Dec 2026 <span aria-hidden="true">·<\/span> Taj Wellington Mews, Chennai/.test(H) &&
  /<a class="etf-event-btn" data-register-cta href="#contact-us">Register Now<\/a>/.test(H));
check('the portal logo, both inks named for the page and the editor', /<img class="etf-logo" data-rv-portal-logo data-rv-on-light="\/templates\/_shared\/img\/portals\/brandequity\.png" data-rv-on-dark="\/templates\/_shared\/img\/portals\/brandequity-light\.png" src="\/templates\/_shared\/img\/portals\/brandequity\.png" alt="ETBrandEquity\.com">/.test(H));
check('social links open outside, named', /<a href="https:\/\/twitter\.com\/ETBrandEquity" target="_blank" rel="noopener nofollow" aria-label="ETBrandEquity\.com on X"><svg/.test(H) && (H.match(/aria-label="ETBrandEquity\.com on /g) || []).length === 3);
check('the escalation line', H.indexOf('For any issues requiring immediate escalation, please write to <a href="mailto:shahbaz.khan@timesinternet.in">shahbaz.khan@timesinternet.in</a> - Md. Shahbaz Khan, Director - Special Initiatives &amp; Business Strategy, The Economic Times Business Verticals.') !== -1);
check('the two link columns', (H.match(/<ul class="etf-links">/g) || []).length === 2 && H.indexOf('<a href="https://brandequity.economictimes.indiatimes.com/guest-post-guidelines" target="_blank" rel="noopener">Guest-Post Guidelines</a>') !== -1 &&
  H.indexOf('>Terms &amp; Conditions</a>') !== -1);
check('What\'s Happening: heading to ET\'s events page, a card an event', H.indexOf('<h2 class="etf-h"><a href="https://brandequity.economictimes.indiatimes.com/events" target="_blank" rel="noopener">What\'s Happening in ETBrandEquity.com</a></h2>') !== -1 &&
  (H.match(/<li class="etf-card">/g) || []).length === 4 && H.indexOf('<span class="etf-cap">CX Annual Symposium 2026 | 04 Dec &#39;26</span>') !== -1 && /<img src="https:\/\/img\.etb2bimg\.com\/l1\.jpg" alt="" loading="lazy">/.test(H));
check('copyright, this year', H.indexOf('<p class="etf-copy">Copyright © <span data-rv-year>2026</span> ETBrandEquity.com. All Rights Reserved.</p>') !== -1);
check('no script, no handler, no javascript:', !/<script|\son[a-z]+=|javascript:/i.test(H));

var dark = ef.build({ portal: 'brandequity', mode: 'dark', year: 2026 });
check('dark site: the light-ink logo', /src="\/templates\/_shared\/img\/portals\/brandequity-light\.png"/.test(dark.html));
check('no events: no What\'s Happening (the column is left out)', dark.html.indexOf('etf-happening') === -1 && dark.html.indexOf('What') === -1);
check('no event: no band', dark.html.indexOf('etf-event') === -1);
var unknown = ef.build({ portal: 'nope', events: h, year: 2026 });
check('unknown portal: the ET Business Verticals logo, no events even when given', /data-rv-on-dark="\/templates\/_shared\/img\/et-business-verticals-on-dark\.svg"/.test(unknown.html) && unknown.html.indexOf('etf-card') === -1 && /data-rv-et-footer="et"/.test(unknown.html));
var hostile = ef.build({ portal: 'cio', year: 2026, events: [ev(1, '<img src=x onerror=alert(1)>', '2026-12-01', { link: 'https://x.com/"><script>', logo: 'javascript:alert(1)' })],
  event: { name: '<b>x</b>', date: '"q"', button: { label: 'Go', href: 'javascript:alert(1)' } } });
check('hostile text is escaped, a bad address is dropped', !/<script|<b>|onerror=|javascript:/i.test(hostile.html) && hostile.html.indexOf('etf-event-btn') === -1, hostile.html.slice(0, 400));
check('a button that is not registration carries no register mark', ef.build({ portal: 'cio', event: { name: 'X', button: { label: 'Partner', href: '#partners', register: false } } }).html.indexOf('data-register-cta') === -1);
check('year defaults to this year', ef.build({ portal: 'cio' }).html.indexOf('Copyright © <span data-rv-year>' + new Date().getFullYear() + '</span> ETCIO.com.') !== -1);

/* the CSS: the page's own colours (one tone), nothing fixed but the button's ink, which is kept */
var fixed = C.replace(/\.etf-event-btn\{--rv-keep:1;[^}]*\}/, '').replace(/rgba\(0,0,0,\.5\)/g, '').match(/#[0-9a-f]{3,8}\b|rgba?\(/gi);
check('the CSS uses the page\'s variables, no fixed colours (but the kept button ink, a shadow)', !fixed, fixed && fixed.join(','));
check('the ground is the page\'s own with a tint of its text', /\.etf\{background-color:var\(--rv-bg\);background-image:linear-gradient\(color-mix\(in srgb,var\(--rv-text\) 4%,transparent\)/.test(C));
check('the button rule is kept in every theme', /\.etf-event-btn\{--rv-keep:1;/.test(C));
check('columns stack on a phone', /@media \(max-width:820px\)\{\.etf-grid\{grid-template-columns:1fr 1fr\}\.etf-happening\{grid-column:1\/-1\}\}/.test(C));
check('a light button ink when the theme colour is light (the fallback to the page\'s --rv-on-theme)', /color:var\(--rv-on-theme,#14161b\)/.test(ef.build({ portal: 'cio', buttonInk: '#14161b' }).css));
check('the button\'s ground is the page\'s readable button ground', /\.etf-event-btn\{[^}]*background:var\(--rv-theme-fill,var\(--theme-color\)\)/.test(ef.build({ portal: 'cio' }).css));

/* it scopes and passes the site's own rules unchanged in meaning */
var scope = require('./gen-markup');
var scoped = scope.scopeSectionCss(C, 'footer', scope.sectionRootInfo(H));
check('scoped to the footer section', /\[data-rv-section="footer"\]\.etf\{background-color:var\(--rv-bg\)/.test(scoped), scoped.slice(0, 300));
var theme = require('../../templates/_shared/rv-theme.js');
var themed = theme.themableCss(C, { themeColor: '#ed1c24', accentColor: '#f5a300', backgroundColor: '#ffffff', textColor: '#1a1414', mutedColor: '#574e4e', surfaceColor: '#fff3ea' });
check('a theme leaves the button ink alone', /\.etf-event-btn\{--rv-keep:1;[^}]*color:var\(--rv-on-theme,#ffffff\)/.test(themed), themed.slice(0, 200));

/* the portals checked one by one */
check('hospitality: privacy and terms without .php (ET\'s own .php links there are 404s)', /\/privacy_policy$/.test(ef.info('hospitality').links[1][0][1]));
check('a single-topic portal: no events page to link, its events still shown', ef.info('agriculture').events === '' && ef.info('agriculture').showEvents === true &&
  /<h2 class="etf-h">What's Happening in ETAgriculture\.com<\/h2>/.test(ef.build({ portal: 'agriculture', events: [ev(1, 'X', '2026-12-01')] }).html));
check('a link a portal does not have is left out', ef.info('energymea').links[1].map(function (l) { return l[0]; }).join('|') === 'Privacy Policy|Terms & Conditions|Guest-Post Guidelines' &&
  ef.info('safety').links[0].length === 5 && ef.info('safety').links[1].length === 3);
check('masterclass: its privacy policy and terms only, one column', ef.info('masterclass').links.length === 1 && ef.info('masterclass').links[0].map(function (l) { return l[0]; }).join('|') === 'Privacy Policy|Terms & Conditions');

/* ---------- in the site's generation (api.js) ---------- */
var api = require('./api')._testHooks;
check('the site\'s portal: the one its previous edition\'s records came from, and that address\'s series',
  JSON.stringify(api.sitePortal([{ type: 'competitor', url: 'https://cio.economictimes.indiatimes.com/x' }, { type: 'previousEdition', url: 'https://brandequity.economictimes.indiatimes.com/brand-world-summit-south2025', previous: { portal: 'brandequity', url: 'https://brandequity.economictimes.indiatimes.com/brand-world-summit-south2025' } }])) ===
  JSON.stringify({ portal: 'brandequity', series: 'brand-world-summit-south' }));
check('the site\'s portal from the address when no records were read', api.sitePortal([{ type: 'currentEdition', url: 'https://hr.economictimes.indiatimes.com/future-forward-2026' }]).portal === 'hr');
check('a competitor\'s portal is not the site\'s; none known gives none', api.sitePortal([{ type: 'competitor', url: 'https://cio.economictimes.indiatimes.com/x' }]).portal === '' && api.sitePortal(null).portal === '' &&
  api.sitePortal([{ type: 'previousEdition', url: 'https://example.com/x' }]).portal === '');
var ids = api.sectionCodeBatches({ sections: [{ id: 'overview', kind: 'custom' }, { id: 'agenda', kind: 'custom' }] }).reduce(function (a, b) { return a.concat(b); }, []);
check('the model is no longer asked for the footer (nor the nav: et-nav.js builds it)', ids.indexOf('footer') === -1 && ids.indexOf('nav') === -1 && ids.indexOf('overview') !== -1, ids.join(','));
var prompt = api.buildSectionCodePrompt({ designPlan: { design: { mode: 'light' }, sections: [{ id: 'overview', kind: 'custom', purpose: 'p', layout: 'l' }] }, eventMeta: { name: 'X' } });
check('nor is the footer in the list the model writes', !/"id":\s*"footer"|\bid: footer\b|- footer\b/.test(prompt), (prompt.match(/[^\n]*footer[^\n]*/g) || []).slice(0, 3).join(' / '));
var sec = api.siteFooter({ portal: 'brandequity', series: 'brand-world-summit-south', design: { mode: 'light', themeColor: '#ed1c24' }, year: 2026,
  events: list, eventName: 'Brand World Summit 2026', date: '5 Dec 2026 – 7 Dec 2026', place: 'Taj Wellington Mews, Chennai', button: { label: 'Register Now', href: '#contact-us', register: true } });
check('siteFooter: the footer section, scoped', sec.id === 'footer' && sec.kind === 'footer' && /^<footer id="footer" class="etf"/.test(sec.html) && /^\[data-rv-section="footer"\]\{position:relative/.test(sec.css));
check('siteFooter: never this event in What\'s Happening', sec.html.indexOf('Brand World Summit South 2026') === -1 && sec.html.indexOf('>Brand World Summit 2026 |') === -1 && sec.html.indexOf('CX Annual Symposium 2026 |') !== -1);
check('siteFooter: the button\'s words read (4.5:1) on its own colour: white on a deep red, black on ET red, dark on a light one',
  /color:var\(--rv-on-theme,#ffffff\)/.test(api.siteFooter({ portal: 'cio', design: { themeColor: '#a3001b' }, eventName: 'X', button: { label: 'Go', href: '#x' } }).css) &&
  /color:var\(--rv-on-theme,#000000\)/.test(sec.css) &&
  /color:var\(--rv-on-theme,#14161b\)/.test(api.siteFooter({ portal: 'cio', design: { themeColor: '#ffd200' }, eventName: 'X', button: { label: 'Go', href: '#x' } }).css));
var self = api.siteFooter({ portal: 'cio', design: {}, eventName: 'X Summit', date: 'd', place: 'p', button: { label: 'Register Now', href: '#footer', register: true } });
check('siteFooter: a button that would lead to the footer itself is left out, the event band stays', self.html.indexOf('etf-event-btn') === -1 && self.html.indexOf('<p class="etf-event-name">X Summit</p>') !== -1);
check('siteFooter: a dark site gets the light-ink wordmark', /src="\/templates\/_shared\/img\/portals\/cio-light\.png"/.test(api.siteFooter({ portal: 'cio', design: { mode: 'dark' } }).html));

function later(ms, v, fail) { return new Promise(function (ok, no) { setTimeout(function () { fail ? no(new Error('socket hang up')) : ok(v); }, ms); }); }
ee.clearCache();
api.footerEvents('', function () { throw new Error('asked'); }).then(function (l) {
  check('footerEvents: no portal, nothing asked, nothing shown', Array.isArray(l) && l.length === 0);
  return api.footerEvents('cio', function () { return later(1, null, true); });
}).then(function (l) {
  check('footerEvents: ET down -> none (generation goes on)', Array.isArray(l) && l.length === 0);
  return api.footerEvents('cio', function () { return later(1, { status: true, data: { upcoming: [{ entity_id: 5, title: 'Y', ownership_type: 1, event_start_date: '2027-01-01 09:00:00', link: 'https://cio.economictimes.indiatimes.com/y' }] } }); });
}).then(function (l) {
  check('footerEvents: ET\'s events coming up', l.length === 1 && l[0].title === 'Y');
}).then(function () {
  if (failed) { console.error('et-footer: ' + failed + ' of ' + (passed + failed) + ' checks FAILED'); process.exit(1); }
  console.log('et-footer: all ' + passed + ' checks passed');
}, function (err) { console.error('et-footer: crashed — ' + (err && err.stack)); process.exit(1); });
