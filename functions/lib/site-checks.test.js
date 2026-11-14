/* node functions/lib/site-checks.test.js — exits 1 on the first failure it lists.
   What would be wrong to put live and the repairs a live page gets (lib/site-checks.js), and how lib/api.js uses
   them: the publish transform, the site check with its gate and its wording, the sitemap's leaving-out, the
   one-click header and footer, the Lovable import, the console's panel. Pages modelled on the six sites live on 3 Nov 2026 (cio,
   test-event-5, cio-awards, agentic-summit-2027, brand-world-summit-2026, national-data-center-symposium) and
   the Digiplus Awards draft. No network, no Firebase: a small fake stands in for Storage and Firestore. */
'use strict';
const SC = require('./site-checks');
const api = require('./api');
const hooks = api._testHooks;
const kit = hooks.TOKEN_KIT;

var failures = [], checks = 0;
function ok(cond, label, detail) { checks++; if (!cond) failures.push(label + (detail !== undefined ? '\n      ' + String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 600) : '')); }
function count(text, needle) { return String(text).split(needle).length - 1; }
function page(body, bodyAttrs, head) {
  return '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>x</title>' + (head || '') + '</head><body ' + (bodyAttrs || '') + '>' + body + '</body></html>';
}
function tagOf(html, re) { var m = re.exec(html); return m ? m[0] : ''; }

/* ---------- 1. template text ---------- */
var CIO = page(
  '<header id="nav"><a href="#overview">Overview</a><a href="#faq">FAQ</a></header>' +
  '<section id="hero"><h1>Event name goes here</h1><p>A short line that sums up why this event matters.</p><span>City, Venue</span>' +
  '<a class="btn" href="#register" data-register-cta>Register now</a><a class="btn btn-ghost" href="#">Become a partner</a></section>' +
  '<section id="faq"><h2>Frequently Asked Questions</h2><div><h3>Question goes here?</h3><p>A short answer explaining the detail behind this question.</p></div>' +
  '<div><h3>Question goes here?</h3><p>A short answer explaining the detail behind this question.</p></div></section>' +
  '<template data-rv-pristine="faq"><div><h3>Speaker Name</h3></div></template>' +
  '<section id="hidden-one" data-rv-empty="speakers"><h3>Speaker Name</h3></section>' +
  '<script>var t = "Event name goes here";</script>' +
  '<footer id="footer"><p>© Event name. All rights reserved.</p></footer>',
  'id="gen" class="microsite product_microsite"');
var hits = SC.placeholderHits(CIO, kit);
var byText = {}; hits.forEach(function (h) { byText[h.text] = h; });
ok(byText['Event name goes here'] && byText['Event name goes here'].strong && byText['Event name goes here'].sections[0] === 'Banner', 'the unfilled hero is found, as the template itself, in the banner', hits);
ok(byText['Question goes here?'] && byText['Question goes here?'].count === 2 && !byText['Question goes here?'].strong, 'each FAQ question is counted', hits);
ok(byText['City, Venue'] && byText['© Event name. All rights reserved.'] && byText['© Event name. All rights reserved.'].sections[0] === 'Footer', 'the place and the footer line too');
ok(!byText['Speaker Name'], 'what a visitor never sees is not counted: a <template>, an empty (hidden) section, a script', hits.map(function (h) { return h.text; }));
ok(SC.placeholderHits(page('<section id="faq"><h2>Section heading and more words of a real sentence</h2><p>Our speaker name list</p></section>'), kit).length === 0, 'the words inside a real sentence are not template text');
var NDCS_PARTNERS = page('<section data-rv-section="convening-partners" id="convening-partners"><div class="cp-track">' +
  ['Sponsor 1', 'Sponsor 2', 'Sponsor 3', 'Sponsor 2'].map(function (n) { return '<div class="cp-partner-card" data-rv-repeat-template="partners"><a data-rv-field="url" href="#" class="cp-partner-link"><span data-rv-field="name">' + n + '</span></a></div>'; }).join('') +
  '</div></section>', 'id="gen" data-rv-template-id="gen-ndcs" class="microsite rv-generated"');
var nd = SC.placeholderHits(NDCS_PARTNERS, kit);
ok(nd.length === 3 && nd[1].count === 2 && nd[0].sections[0] === 'Convening partners', 'sample sponsors shown on a live page are template text (they show as saved: the page does not redraw records)', nd);
ok(SC.placeholderHits(page('<p>Lorem ipsum dolor</p><p>Write to name@example.com</p><p>+00 00000 00000</p><p>00:00 AM</p>'), kit).length === 4, 'lorem ipsum, the AI\'s sample address and phone, an empty time');

/* a real template's samples of its design: another event's quotes (cx-leaders-forum, data-rv-sample) */
var LEADERS = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'templates', 'cx-leaders-forum', 'sections', 'leaders', 'index.html'), 'utf8');
var samples = SC.samplesOf(LEADERS, kit);
ok(samples.texts.length === 10 && samples.texts.some(function (t) { return /bloodline of the company/.test(t); }) && samples.srcs.length === 10, 'the template\'s sample quotes and photos are read off its marks', { texts: samples.texts.length, srcs: samples.srcs.length });
ok(['Anjani Rathor', 'Chief Marketing Officer', 'Executive Director', 'Co-founder and CEO', 'Tata AIA Life Insurance', 'Global Head - CRM & CX', 'CEO, Apollo 24/7 & CDTO'].every(function (w) { return samples.texts.indexOf(w) === -1; }),
  'never a name, a role or a company: the owner\'s own cards can have the same', samples.texts.filter(function (t) { return t.length < 60; }));
var rewritten = LEADERS.replace('Customer experience should not be seen as an after-sales function. It is the bloodline of the company - it runs across the company, and everyone owns it.', 'Our own speaker said something new here.')
  .replace('Anjani Rathor', 'Asha Rao');
var sh = SC.sampleHits(page(rewritten), kit, samples);
ok(sh.length > 0 && sh.every(function (h) { return h.sections[0] === 'Leaders'; }) && !sh.some(function (h) { return /bloodline|Asha Rao|Anjani Rathor/.test(h.text); }), 'the cards still as the template had them are found; a card the owner rewrote is not', sh.slice(0, 3));
ok(SC.sampleHits(page('<p>Our own words that are long enough.</p>'), kit, samples).length === 0 && SC.sampleHits(page(LEADERS), kit, { texts: [], srcs: [] }).length === 0, 'a page without them, or a template without samples, has none');

/* sample entries in Content */
var rp = SC.recordPlaceholders({ partners: [{ name: 'Sponsor 1' }, { name: 'Sponsor 2' }, { name: 'Tata Motors' }], speakers: [{ name: 'Speaker Name' }, { name: 'Asha Rao' }], faqs: [{ q: 'Question goes here?' }], contacts: [{ name: 'Contact name', email: 'name@example.com' }] });
ok(rp.length === 4 && rp[0].label === 'Content › Sponsors' && rp[0].items.join() === 'Sponsor 1,Sponsor 2' && rp[1].items.join() === 'Speaker Name', 'sample entries in Content are named by their tab, the real ones left out', rp);
ok(SC.recordPlaceholders({ partners: [{ name: 'Sponsorship desk' }] }).length === 0 && SC.recordPlaceholders(null).length === 0, 'a real name with the word in it, and no data, are nothing');

/* ---------- 2. search engines ---------- */
ok(['test event 5', 'Test', 'QA run 3', 'demo site', 'Test-Event-12', 'Agentic Summit (test)', 'Brand World Summit test copy', 'CIO Awards - test'].every(function (n) { return SC.looksLikeTest({ name: n }); }), 'a name that is a test\'s label, or says it is one, is a test');
ok(['QA Summit 2027', 'Demo Day 2027', 'Testing Leaders Forum', 'Contest of Champions', 'Brand World Summit 2026', ''].every(function (n) { return !SC.looksLikeTest({ name: n }); }), 'a real event is not, even one that starts with such a word');
ok(SC.noindexReason({ name: 'Cio' }, CIO, kit) === 'template', 'cio: its page is still the template');
ok(SC.noindexReason({ name: 'test event 5' }, page('<h1>Awards</h1>'), kit) === 'test', 'test-event-5: its name says it is a test');
ok(SC.noindexReason({ name: 'Brand World Summit 2026', settings: { seo: { noindex: true } } }, page('<h1>x</h1>'), kit) === 'owner', 'the owner\'s own choice');
ok(SC.noindexReason({ name: 'National Data Center Symposium' }, NDCS_PARTNERS, kit) === '', 'a real site with a sample sponsor stays listed: that is for the owner to fix, not a reason to hide the site');
/* the owner's own option: settings.seo.noindex, true or false (PATCH /api/event settings) */
var cs = hooks.cleanSettings({ seo: { noindex: true } });
ok(cs.value && cs.value.seo.noindex === true && hooks.mergeSettings({ seo: { description: 'd' } }, cs.value).seo.description === 'd', 'an owner can keep a site out of search, and the rest of its search settings stay', cs);
ok(/must be true or false/.test((hooks.cleanSettings({ seo: { noindex: 'yes' } }) || {}).error || ''), 'only true or false');
var LIVE_HEAD = '<meta name="robots" content="index, follow, max-image-preview:large" data-rv-seo>';
var live = page('<h1>x</h1>', '', LIVE_HEAD);
var hidden = SC.robots(live, kit, true);
ok(/<meta name="robots" content="noindex, nofollow" data-rv-seo data-rv-noindex="">/.test(hidden) && SC.isNoindexPage(hidden) && !SC.isNoindexPage(live), 'noindex is written on the live page\'s robots meta', tagOf(hidden, /<meta name="robots"[^>]*>/));
ok(SC.robots(hidden, kit, true) === hidden, 'writing it again changes nothing');
ok(SC.robots(hidden, kit, false) === live.replace('data-rv-seo>', 'data-rv-seo>'), 'and back, when the reason is gone', tagOf(SC.robots(hidden, kit, false), /<meta name="robots"[^>]*>/));
ok(SC.robots(page('<h1>x</h1>', '', '<meta name="robots" content="noindex">'), kit, false).indexOf('content="noindex"') !== -1, 'a robots meta that is not ours is left alone');

/* ---------- 3. the live page's repairs: an older AI-designed site (agentic-summit-2027, brand-world-summit-2026) ---------- */
var AGENTIC = page(
  '<header data-rv-section="nav" id="nav" class="nav-root"><div class="nav-inner"><a href="#hero" class="nav-brand"><img data-rv-logo="" src="https://storage.googleapis.com/revamp-cms.firebasestorage.app/events/a/logo/group-4-3.svg" alt="Agentic Summit 2027" class="nav-logo"></a>' +
  '<nav class="nav-links"><a href="#overview" class="nav-link">Overview</a><a href="#speakers" class="nav-link" data-rv-nav-empty="">Speakers</a><a href="#gone" class="nav-link">Gone</a><a href="#about-vertical" class="nav-btn">Register Now</a></nav></div></header>' +
  '<section data-rv-section="hero" id="hero"><a class="hero-btn" href="#register" data-register-cta>Register Now</a><a class="hero-btn hero-btn-2" href="#contact-us">Join as Partner</a></section>' +
  '<section data-rv-section="overview" id="overview"><p>Words with <a href="#gone">a link</a>.</p><a class="overview-cta" href="#about-vertical">Register Now</a><a class="overview-cta" href="#rv-form-vip">Register Now</a></section>' +
  '<section data-rv-section="speakers" id="speakers" data-rv-empty="speakers"><h2>Speakers</h2></section>' +
  '<section data-rv-section="why-join-us" id="why-join-us"><a class="btn" href="#contact-us">Register Now</a><a class="btn" href="https://example.org/register">Register on ET</a><a class="btn" href="#sponsors-list">Our Partners</a></section>' +
  '<section data-rv-section="sponsors-list" id="sponsors-list"><h2>Sponsors</h2></section>' +
  '<section data-rv-section="registration" id="registration"><div class="rv-block-form" data-rv-form-embed="register"></div></section>' +
  '<section data-rv-section="who" id="who"><a class="btn" href="#registration">Register Now</a><form><button type="submit">Register</button></form></section>' +
  '<section data-rv-section="contact-us" id="contact-us" data-rv-empty="contact"><h2>Contact</h2></section>' +
  '<section data-rv-section="about-vertical" id="about-vertical"><h2>About</h2></section>' +
  '<footer data-rv-section="footer" id="footer" class="footer"><a class="footer-link" href="#overview">Overview</a><a class="footer-cta" href="#hero">Register Now</a></footer>',
  'id="gen" data-rv-template-id="gen-agentic-summit-2027" class="microsite rv-generated"');
var fixed = SC.repair(AGENTIC, kit, { eventId: 'agentic-summit-2027', homeHref: '/e/agentic-summit-2027' });
var F = fixed.html;
ok(/<a href="#register" class="nav-btn" data-register-cta="">Register Now<\/a>/.test(F), 'the header\'s Register Now (to the About section) opens the form', tagOf(F, /<a[^>]*nav-btn[^>]*>/));
ok(/<a class="overview-cta" href="#register" data-register-cta="">Register Now<\/a>/.test(F) && /<a class="btn" href="#register" data-register-cta="">Register Now<\/a>/.test(F) && /<a class="footer-cta" href="#register" data-register-cta="">Register Now<\/a>/.test(F),
  'every other Register Now — to the About section, to a hidden contact section, to the top — opens the form');
ok(/<a class="overview-cta" href="#rv-form-vip">Register Now<\/a>/.test(F), 'a button that opens a form of its own is left to open it');
ok(/<a class="btn" href="https:\/\/example\.org\/register">Register on ET<\/a>/.test(F), 'a Register link to a page elsewhere is the owner\'s: left as it is');
ok(/<a class="btn" href="#registration">Register Now<\/a>/.test(F), 'a Register button that leads to the form drawn in the page is right as it is');
ok(/<form><button type="submit">Register<\/button><\/form>/.test(F), 'a form\'s own submit button is that form\'s');
var partner = tagOf(F, /<a class="hero-btn hero-btn-2"[^>]*>/);
ok(/data-register-cta=""/.test(partner) && /data-rv-form-title="Partner with us"/.test(partner) && /data-rv-form-source="partner-enquiry"/.test(partner) && /data-rv-form-note="Tell us about your organisation/.test(partner) && /href="#register"/.test(partner),
  '"Join as Partner" to a hidden section opens a partner enquiry, said as such', partner);
ok(/<a class="btn" href="#sponsors-list">Our Partners<\/a>/.test(F), 'a way to the sponsors list is not an enquiry');
ok(/<a href="#gone" class="nav-link" data-rv-nav-empty="" data-rv-removed="leads-nowhere">Gone<\/a>/.test(F), 'a header link to a section that is not on the page is hidden', tagOf(F, /<a href="#gone" class="nav-link"[^>]*>/));
ok(/Words with <a>a link<\/a>\./.test(F), 'words linked inside a sentence keep their words, without the dead address');
ok(/<a href="#speakers" class="nav-link" data-rv-nav-empty="">Speakers<\/a>/.test(F), 'a link already hidden with its empty section is left alone');
var whats = fixed.changes.map(function (c) { return c.what; });
ok(count(whats.join(','), 'register') === 4 && whats.indexOf('partner') !== -1 && count(whats.join(','), 'dead') === 1 && count(whats.join(','), 'nav') === 1, 'each repair is listed for the owner (a menu link apart from a button)', fixed.changes);
ok(fixed.changes.filter(function (c) { return c.what === 'partner'; })[0].section === 'Banner' && /opens a “Partner with us” enquiry/.test(fixed.changes.filter(function (c) { return c.what === 'partner'; })[0].how), 'in words: where and what');
ok(SC.repair(F, kit, { eventId: 'agentic-summit-2027', homeHref: '/e/agentic-summit-2027' }).html === F && SC.repair(F, kit, {}).changes.length === 0, 'repairing again changes nothing');
ok(SC.repair(page('<p>x</p>'), kit, {}).html === page('<p>x</p>'), 'a page with nothing to put right comes out byte for byte');

/* ---------- 4. an imported (Lovable) page: test-event-5, cio-awards ---------- */
var LOVABLE = page(
  '<div id="container"><div id="content"><header class="sticky"><a href="/">Enterprise Tech Excellence Awards</a>' +
  '<nav class="hidden lg:flex"><a href="/categories">Categories</a><a href="/about#entry-guidelines">Entry Guidelines</a><a href="/about">About</a><a href="/faq">FAQ</a></nav>' +
  '<a href="/nominate" class="btn">Nominate→</a><button class="rounded-full border p-2.5 lg:hidden" aria-label="Menu"><div class="w-5"></div></button>' +
  '<button aria-label="Open menu" aria-controls="drawer">≡</button><div id="drawer" class="lg:hidden"><a href="/faq">FAQ</a></div></header>' +
  '<section id="award-categories"><h2>Categories</h2><a href="/nominate/organisation" class="btn">Nominate</a><a href="/nominate/organisation">Organisation</a></section>' +
  '<section id="route-organisation-excellence"><h3>Organisation Excellence</h3></section>' +
  '<section id="entry-guidelines"><h2>Guidelines</h2></section>' +
  '<section id="gallery"><div class="page-shell"><p class="eyebrow">Gallery</p><h2>One Evening</h2><div class="rv rv-zoom"><figure class="relative aspect-video">' +
  '<video class="h-full w-full" muted="" preload="none"><source type="video/mp4"></video>' +
  '<button type="button" aria-label="Play the awards film" class="absolute inset-0"><span><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"></path></svg></span></button></figure></div>' +
  '<figcaption class="mt-4">The awards film, now part of the gallery</figcaption></div></section>' +
  '<section id="highlights"><video src="https://cdn.example.org/film.mp4" controls></video><video><source src="https://cdn.example.org/b.mp4"></video></section>' +
  '<section id="moments"><h2>Moments</h2><img src="https://cdn.example.org/stage.jpg" alt="The stage"><div class="aspect-video"><video><source src="/__l5e/assets-v1/c/moment.mp4" type="video/mp4"></video></div></section>' +
  '<footer><a href="#">Privacy</a><a href="#">Terms of Entry</a><a href="#">Cookie Preferences</a><a href="#" aria-label="LinkedIn"><svg></svg></a><a href="#" aria-label="X"><svg></svg></a>' +
  '<a href="mailto:ashish.kumar3@timesinternet.in">ashish.kumar3@timesinternet.in</a></footer>' +
  '<div data-bot="NOVA"><button class="fixed bottom-6 right-6 z-50" aria-label="Open NOVA, the nomination assistant"><div>NOVA</div><div>Hi, I\'m NOVA. Need help?</div></button></div>' +
  '</div></div>', 'id="imported" data-rv-template-id="imported-imp-x" class="microsite imported-microsite"');
var lv = SC.repair(LOVABLE, kit, { eventId: 'test-event-5', homeHref: '/e/test-event-5', portal: '' });
var L = lv.html;
ok(/<a href="\/e\/test-event-5">Enterprise Tech Excellence Awards<\/a>/.test(L), 'the home link leads to the top of this site, not the CMS\'s sign-in');
ok(/<a href="#award-categories">Categories<\/a>/.test(L) && /<a href="#entry-guidelines">Entry Guidelines<\/a>/.test(L), '/categories and /about#entry-guidelines lead to their parts of the page');
ok(/<a href="#route-organisation-excellence">Organisation<\/a>/.test(L), 'a category\'s own address leads to its group');
ok(/<a href="\/about" data-rv-nav-empty="" data-rv-removed="leads-nowhere">About<\/a>/.test(L) && /<a href="\/faq" data-rv-nav-empty="" data-rv-removed="leads-nowhere">FAQ<\/a>/.test(L), 'a page this site does not have: the link is hidden', tagOf(L, /<a href="\/about"[^>]*>/));
var nom = tagOf(L, /<a href="#register" class="btn"[^>]*>Nominate→/);
ok(/data-register-cta=""/.test(nom) && /data-rv-form-title="Start a nomination"/.test(nom) && /data-rv-form-source="nomination-enquiry"/.test(nom), 'Nominate opens a nomination enquiry', nom || tagOf(L, /<a[^>]*>Nominate→/));
ok(count(L, 'data-rv-form-title="Start a nomination"') === 2, 'every Nominate does');
ok(/<a href="https:\/\/b2b\.economictimes\.indiatimes\.com\/privacy_policy\.php" target="_blank" rel="noopener">Privacy<\/a>/.test(L) && /href="https:\/\/b2b\.economictimes\.indiatimes\.com\/terms_conditions\.php"[^>]*>Terms of Entry/.test(L), 'Privacy and Terms lead to ET\'s own pages', tagOf(L, /<a[^>]*>Privacy/));
ok(/<a href="#" data-rv-nav-empty="" data-rv-removed="leads-nowhere">Cookie Preferences<\/a>/.test(L), 'Cookie Preferences, with nothing to open, is hidden');
ok(/<a href="https:\/\/www\.linkedin\.com\/company\/etb2b" aria-label="LinkedIn" target="_blank" rel="noopener">/.test(L) && /<a href="#" aria-label="X" data-rv-nav-empty=""/.test(L), 'a social link the portal has leads there; one it has not is hidden', tagOf(L, /<a[^>]*aria-label="LinkedIn"[^>]*>/));
ok(/mailto:ashish\.kumar3@timesinternet\.in/.test(L), 'a real e-mail link is left as it is');
ok(L.indexOf('aria-label="Menu"') === -1 && L.indexOf('aria-controls="drawer"') !== -1, 'a menu button with no menu is taken out; one whose menu was captured stays');
ok(L.indexOf('Play the awards film') === -1 && L.indexOf('<source type="video/mp4">') === -1 && L.indexOf('aspect-video') === -1 && L.indexOf('The awards film, now part of the gallery') === -1,
  'a film with nothing to play goes, with its play button, its grey box and its caption');
ok(L.indexOf('id="gallery"') === -1 && L.indexOf('One Evening') === -1, 'and its section, when the film was all it showed under its title (a heading over nothing)');
ok(L.indexOf('<h2>Moments</h2>') !== -1 && L.indexOf('stage.jpg') !== -1 && L.indexOf('moment.mp4') === -1, 'a section with more to show keeps it: only the film goes (its address one this host can never answer)');
ok(L.indexOf('https://cdn.example.org/film.mp4') !== -1 && L.indexOf('https://cdn.example.org/b.mp4') !== -1, 'a film with something to play stays');
ok(L.indexOf('NOVA') === -1 || L.indexOf('data-bot="NOVA"') !== -1 && L.indexOf('Need help') === -1, 'the chat launcher is taken out');
ok(SC.repair(L, kit, { eventId: 'test-event-5', homeHref: '/e/test-event-5' }).html === L, 'an imported page repaired again changes nothing');
var lvWhat = {}; lv.changes.forEach(function (c) { lvWhat[c.what] = (lvWhat[c.what] || 0) + 1; });
ok(lvWhat.widget === 5 && lvWhat.nominate === 2 && lvWhat.legal === 3 && lvWhat.social === 2 && lvWhat.home === 1, 'each repair is listed, the widgets among them', lvWhat);
/* the event's own nomination form, when it has one (an award site's forms, at publish) */
var withForm = SC.repair(LOVABLE, kit, { eventId: 'x', homeHref: '/e/x', forms: { forms: [{ id: 'register', name: 'Register now' }, { id: 'nominate', name: 'Nominations' }] } });
ok(/<a href="#rv-form-nominate" class="btn" data-rv-form="nominate">Nominate→<\/a>/.test(withForm.html), 'Nominate opens the event\'s nomination form when it has one', tagOf(withForm.html, /<a[^>]*>Nominate→/));
/* at import: the page's body alone, its home link left for the live page */
var body = LOVABLE.replace(/^[\s\S]*<body[^>]*>/, '').replace(/<\/body>[\s\S]*$/, '');
var atImport = SC.repair(body, kit, { imported: true, homeHref: false });
ok(/<a href="\/">Enterprise Tech Excellence Awards<\/a>/.test(atImport.html) && /data-rv-form-title="Start a nomination"/.test(atImport.html) && atImport.html.indexOf('aria-label="Menu"') === -1, 'at import: the same repairs on the body, the home link left for the live page');
ok(SC.repair(body, kit, { homeHref: false }).html.indexOf('aria-label="Menu"') !== -1, 'a body not said to be imported keeps its widgets');

/* The film as test-event-5 and cio-awards keep it (their saved page, 3 Nov 2026): its film and poster at the original
   builder's own paths (/__l5e/…), which the import did not bring over and the live page drops (lib/delivery.js step 6).
   Its play button played nothing, over an empty grey box (UX-142). */
var L5E_GALLERY = '<section id="gallery" class="reveal border-b border-border"><div class="page-shell section-space text-center"><p class="eyebrow">Gallery</p><h2 class="section-title mx-auto mt-2 max-w-3xl text-foreground">One Evening. India\'s Most Influential Tech Leaders, Under One Roof.</h2><div class="rv rv-zoom "><figure class="group relative mt-8 aspect-video overflow-hidden border border-border bg-card shadow-[0_24px_60px_-42px_var(--ink)]"><video class="h-full w-full object-cover" poster="/__l5e/assets-v1/a291419f-7493-4815-99b6-08457ead71fd/jury-film-poster.jpg" muted="" loop="" playsinline="" preload="auto"><source src="/__l5e/assets-v1/b5295ec1-c157-46fe-8e76-be297642a596/jury-film.mp4" type="video/mp4"></video><button type="button" aria-label="Play the awards film" class="absolute inset-0 grid place-items-center bg-[linear-gradient(180deg,transparent_0%,color-mix(in_oklab,var(--ink)_35%,transparent)_100%)]"><span class="grid h-16 w-16 place-items-center rounded-full border border-ivory/70 bg-background/90 text-et-red backdrop-blur-sm transition-transform duration-200 group-hover:scale-105"><svg viewBox="0 0 24 24" class="ml-1 h-7 w-7 fill-current" aria-hidden="true"><path d="M8 5v14l11-7z"></path></svg></span></button></figure></div><figcaption class="mt-4 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">The awards film, now part of the gallery</figcaption></div></section>';
var L5E = page('<div id="container"><header class="sticky"><nav><a href="#gallery">Gallery</a><a href="#entry-guidelines">Entry Guidelines</a></nav></header>' + L5E_GALLERY +
  '<section id="entry-guidelines"><h2>Guidelines</h2></section></div>', 'id="imported" data-rv-template-id="imported-imp-mv68wdfh-suv0ni" class="microsite imported-microsite"');
var l5 = SC.repair(L5E, kit, { eventId: 'test-event-5', homeHref: '/e/test-event-5', portal: '' });
ok(l5.html.indexOf('<video') === -1 && l5.html.indexOf('Play the awards film') === -1 && l5.html.indexOf('id="gallery"') === -1, 'the saved film of the imported award sites, at a builder path this host never answers, is taken out with its section', l5.changes);
ok(/<a href="#gallery" data-rv-nav-empty="" data-rv-removed="leads-nowhere">Gallery<\/a>/.test(l5.html) && /<a href="#entry-guidelines">Entry Guidelines<\/a>/.test(l5.html), 'and the menu\'s link to it is hidden; the others stay', tagOf(l5.html, /<a href="#gallery"[^>]*>/));
ok(l5.changes.map(function (c) { return c.label + ': ' + c.how; }).slice(0, 2).join(' | ') === 'Film: taken out: it had no film this site can play | Gallery: taken out: the film was all it showed', 'the owner is told what went, and why', l5.changes);
ok(SC.repair(l5.html, kit, { eventId: 'test-event-5', homeHref: '/e/test-event-5' }).html === l5.html, 'and again changes nothing');
var l5body = SC.repair(L5E_GALLERY, kit, { imported: true, homeHref: false });
ok(l5body.html === '' && l5body.changes.length === 2, 'at import too: a new import of such a page keeps no film it cannot play', l5body);
var ownFilm = page(L5E_GALLERY.replace('/__l5e/assets-v1/b5295ec1-c157-46fe-8e76-be297642a596/jury-film.mp4', 'https://storage.googleapis.com/revamp-cms.firebasestorage.app/events/x/jury-film.mp4'), 'id="imported" data-rv-template-id="imported-imp-x"');
ok(SC.repair(ownFilm, kit, {}).html === ownFilm, 'a film with an address that answers stays, its section and its play button with it');
var appFile = page(L5E_GALLERY.replace('/__l5e/assets-v1/b5295ec1-c157-46fe-8e76-be297642a596/jury-film.mp4', '/templates/_shared/rv-forms.js'), 'id="imported" data-rv-template-id="imported-imp-x"');
ok(SC.repair(appFile, kit, {}).html === appFile, 'a path this host does serve is a film all the same (the rule is lib/delivery.js\'s own)');

/* A footer column whose every link led to a page the site does not have: hidden with its heading ("Attend", cio-awards) */
var COLS = page('<footer><div class="grid grid-cols-2 md:grid-cols-4">' +
  '<div><h5 class="mb-4">The Awards</h5><ul><li><a href="/about">About the Awards</a></li><li><a href="#entry-guidelines">Entry Guidelines</a></li></ul></div>' +
  '<div><h5 class="mb-4">Attend</h5><ul><li><a href="/about">The Grand Finale</a></li><li><a href="/about">Venue &amp; Directions</a></li></ul></div>' +
  '<div><h5>Already gone</h5><ul><li><a href="/x" data-rv-nav-empty="">Old</a></li><li><a href="/faq">FAQ</a></li></ul></div>' +
  '<div><h5>Write to us</h5><ul><li>Call the desk</li><li><a href="/about">Contact</a></li></ul></div>' +
  '</div></footer><section id="entry-guidelines"><h2>Guidelines</h2></section>', 'id="imported" data-rv-template-id="imported-imp-x" class="microsite imported-microsite"');
var cl = SC.repair(COLS, kit, { eventId: 'cio-awards', homeHref: '/e/cio-awards', portal: '' });
ok(/<div data-rv-nav-empty="" data-rv-removed="leads-nowhere"><h5 class="mb-4">Attend<\/h5>/.test(cl.html) && /<div><h5 class="mb-4">The Awards<\/h5>/.test(cl.html), 'a column with no link left is hidden with its heading; one with a link left stays', cl.html);
ok(/<div data-rv-nav-empty="" data-rv-removed="leads-nowhere"><h5>Already gone<\/h5>/.test(cl.html), 'a link hidden before counts as gone too');
ok(/<div><h5>Write to us<\/h5><ul><li>Call the desk<\/li>/.test(cl.html), 'a list with words of its own besides its links stays');
ok(cl.changes.filter(function (c) { return c.how === 'is hidden: none of its links lead anywhere'; }).map(function (c) { return c.label + ' (' + c.section + ')'; }).join() === 'Attend (Footer),Already gone (Footer)', 'the owner is told which column went, as a menu change', cl.changes);
ok(SC.repair(cl.html, kit, { eventId: 'cio-awards', homeHref: '/e/cio-awards' }).html === cl.html, 'and again changes nothing');

/* ---------- 5. an award ceremony's "Get Tickets" (payment is not part of this release) ---------- */
var AWARD = page('<section data-rv-section="awards-night" id="awards-night"><h2>Join Us at the Grand Award Ceremony</h2><p class="aw-cer-cta"><a class="aw-cer-btn" href="#hero" data-register-cta>Get Tickets</a></p></section>' +
  '<section data-rv-section="agenda" id="agenda"><a class="btn" href="#register" data-register-cta>Buy passes</a></section>', 'id="gen" data-rv-template-id="gen-aw" class="microsite rv-generated"');
var aw = SC.repair(AWARD, kit, {});
var cer = tagOf(aw.html, /<a class="aw-cer-btn"[^>]*>[^<]*<\/a>/);
ok(/>Request an invitation<\/a>$/.test(cer) && /data-rv-form-note="Seats are confirmed by the ETB2B team; there is no online payment\."/.test(cer) && /data-rv-form-source="ceremony-invitation"/.test(cer), 'the ceremony\'s button asks for an invitation, and its form says seats are confirmed with no online payment', cer);
ok(SC.inspect(AWARD, kit).payment.length === 2 && SC.inspect(aw.html, kit).payment.map(function (p) { return p.label; }).join() === 'Buy passes', 'a button promising a sale is found; the ceremony\'s, put right, no longer is');
ok(SC.repair(aw.html, kit, {}).html === aw.html, 'and again changes nothing');

/* ---------- 6. pictures, years, names ---------- */
var refs = SC.storageRefs('<img src="https://storage.googleapis.com/revamp-cms.firebaneapp/events/n/generated/fiber.png"><div style="background:url(&quot;//storage.googleapis.com/revamp-cms.firebasestorage.app/events/n/a%20b.jpg&quot;)"></div><img src="https://storage.googleapis.com/revamp-cms.firebaneapp/events/n/generated/fiber.png">');
ok(refs.length === 2 && refs[0].bucket === 'revamp-cms.firebaneapp' && refs[0].path === 'events/n/generated/fiber.png' && refs[1].path === 'events/n/a b.jpg' && refs[1].url.indexOf('https://') === 0, 'every storage picture once, its bucket and its object', refs);
ok(SC.nearBucket('revamp-cms.firebaneapp', 'revamp-cms.firebasestorage.app') && SC.nearBucket('revamp-cms.firebasestorage.ap', 'revamp-cms.firebasestorage.app') && SC.nearBucket('revamp-cmz.firebasestorage.app', 'revamp-cms.firebasestorage.app'), 'a mistyped bucket reads as ours mistyped (UX-144)');
ok(!SC.nearBucket('another-product', 'revamp-cms.firebasestorage.app') && !SC.nearBucket('revamp-cms.firebasestorage.app', 'revamp-cms.firebasestorage.app'), 'another service\'s, or ours, does not');
ok(SC.yearsIn('SUMMIT 2026 logo-2027.png 1999 12026') .join() === '2026,2027,1999', 'years, not longer numbers');
ok(SC.sectionName('key-discussion-points') === 'Key discussion points' && SC.sectionName('nav') === 'Header' && SC.sectionName('hero') === 'Banner', 'section names in words');

/* ---------- 7. the publish transform: a live page gets the repairs and its robots ---------- */
var TEST5 = page('<section id="x"><a class="btn" href="#gone">Register Now</a></section>', 'id="gen" data-rv-template-id="gen-test-event-5" class="microsite rv-generated"');
var pub = hooks.publishTransform(TEST5, { eventId: 'test-event-5', event: { name: 'test event 5' }, mode: 'live', templateId: 'gen-test-event-5', publicBase: 'https://revamp-cms--revamp-cms.us-east4.hosted.app' });
ok(SC.isNoindexPage(pub) && /<meta name="robots" content="noindex, nofollow" data-rv-seo data-rv-noindex="">/.test(pub), 'a test event published: noindex', tagOf(pub, /<meta name="robots"[^>]*>/));
ok(/<a class="btn" href="#register" data-register-cta="">Register Now<\/a>/.test(pub), 'and its Register button opens the form');
ok(hooks.publishTransform(pub, { eventId: 'test-event-5', event: { name: 'test event 5' }, mode: 'live', templateId: 'gen-test-event-5', publicBase: 'https://revamp-cms--revamp-cms.us-east4.hosted.app' }) === pub, 'the transform run on its own output changes nothing');
var real = hooks.publishTransform(TEST5, { eventId: 'brand-world-summit-2026', event: { name: 'Brand World Summit 2026' }, mode: 'live', templateId: 'gen-x', publicBase: 'https://h.example' });
ok(/<meta name="robots" content="index, follow, max-image-preview:large" data-rv-seo>/.test(real) && !SC.isNoindexPage(real), 'a real event stays listed');
var prev = hooks.publishTransform(TEST5, { eventId: 'test-event-5', event: { name: 'test event 5' }, mode: 'preview', templateId: 'gen-test-event-5' });
ok(/data-register-cta/.test(prev) && count(prev, 'name="robots"') === 1 && /content="noindex, nofollow" data-rv-head/.test(prev), 'a preview gets the repairs, and keeps its own noindex once');
var cached = hooks.cachePage('t|1', pub);
ok(cached.noindex === true && hooks.cachePage('t|2', real).noindex === false, 'a cached live page knows it says noindex (the X-Robots-Tag header goes with it)');
ok(hooks.liveRepair('<p>not a page<', null, 'e', 'live', null) === '<p>not a page<', 'the live repairs never lose a page');

/* ---------- 8. the site check, its gate and its wording (a fake Storage / Firestore) ---------- */
function fakeFb(objects, opts) {
  opts = opts || {};
  var store = Object.assign({}, objects || {});
  var docs = opts.docs || {};
  function snapOf(path) {
    var d = docs[path];
    return { exists: !!d, id: path.split('/').pop(), data: function () { return d ? JSON.parse(JSON.stringify(d)) : undefined; }, ref: { path: path } };
  }
  function coll(path) {
    return {
      doc: function (id) { return docRef(path + '/' + (id || 'auto')); },
      get: function () {
        var list = Object.keys(docs).filter(function (k) { return k.indexOf(path + '/') === 0 && k.slice(path.length + 1).indexOf('/') === -1; }).map(snapOf);
        return Promise.resolve({ docs: list, empty: !list.length, size: list.length });
      },
      orderBy: function () { return this; }, limit: function () { return this; }, where: function () { return this; },
      add: function (v) { var id = 'c' + Object.keys(docs).length; docs[path + '/' + id] = v; return Promise.resolve({ id: id }); }
    };
  }
  function docRef(path) {
    return {
      path: path, id: path.split('/').pop(),
      get: function () { return Promise.resolve(snapOf(path)); },
      collection: function (name) { return coll(path + '/' + name); },
      update: function (v) { docs[path] = Object.assign({}, docs[path], v); return Promise.resolve(); },
      set: function (v) { docs[path] = v; return Promise.resolve(); },
      create: function (v) { if (docs[path]) return Promise.reject(Object.assign(new Error('6 ALREADY_EXISTS'), { code: 6 })); docs[path] = v; return Promise.resolve(); }
    };
  }
  return {
    store: store, docs: docs,
    bucket: {
      name: 'revamp-cms.firebasestorage.app',
      file: function (p) {
        return {
          exists: function () { return Promise.resolve([Object.prototype.hasOwnProperty.call(store, p)]); },
          download: function () { return Object.prototype.hasOwnProperty.call(store, p) ? Promise.resolve([Buffer.from(store[p], 'utf8')]) : Promise.reject(Object.assign(new Error('No such object'), { code: 404 })); },
          save: function (buf) { store[p] = Buffer.isBuffer(buf) ? buf.toString('utf8') : String(buf); return Promise.resolve(); },
          delete: function () { delete store[p]; return Promise.resolve(); },
          makePublic: function () { return Promise.resolve(); }
        };
      }
    },
    db: { collection: function (name) { return coll(name); } }
  };
}

var NDCS = page(
  '<header data-rv-section="nav" id="nav" class="nav-bar"><a href="#hero" class="nav-brand">ET</a><a href="#convening-partners" class="nav-cta">Convening Partners</a></header>' +
  '<section data-rv-section="hero" id="hero"><h1>National Data Center Symposium</h1><a class="hero-btn" href="#contact">Register Now</a></section>' +
  '<section data-rv-section="ecosystem-stakeholders" id="ecosystem-stakeholders"><img src="https://storage.googleapis.com/revamp-cms.firebaneapp/events/ndcs/generated/fiber.png" alt="Fiber frame">' +
  '<img src="https://storage.googleapis.com/revamp-cms.firebasestorage.app/events/ndcs/generated/ok.png" alt="ok"><img src="https://storage.googleapis.com/revamp-cms.firebasestorage.app/events/ndcs/generated/missing.png" alt="m">' +
  '<img src="https://storage.googleapis.com/other-public-bucket/pic.png" alt="other"></section>' +
  '<section data-rv-section="convening-partners" id="convening-partners"><div class="cp-partner-card" data-rv-repeat-template="partners"><span data-rv-field="name">Sponsor 1</span></div><a class="btn" href="#tickets" data-register-cta>Buy tickets</a></section>' +
  '<footer data-rv-section="footer" id="footer" class="ft-section"><p>Symposium sections</p></footer>',
  'id="gen" data-rv-template-id="gen-national-data-center-symposium" class="microsite rv-generated"');
var fb = fakeFb({ 'events/ndcs/generated/fiber.png': 'x', 'events/ndcs/generated/ok.png': 'x' });
/* storage answers for another bucket as it did on 3 Nov 2026: the mistyped one 404, a real one 206 */
var probed = [];
hooks.setPictureProbe(function (url) { probed.push(url); return Promise.resolve(/firebaneapp/.test(url) ? 404 : /down\.example/.test(url) ? 0 : 206); });
var DATA = { name: 'National Data Center Symposium', start: '2027-03-04T10:00', designPlan: { design: { logoUnitUrl: 'https://storage.googleapis.com/revamp-cms.firebasestorage.app/events/ndcs/logo-unit.svg' } } };
var pending = [];
pending.push(hooks.siteCheckOf(fb, 'national-data-center-symposium', DATA, NDCS, {}).then(function (r) {
  var codes = r.items.map(function (x) { return x.code + ':' + x.level; });
  ok(r.blocking && codes.join() === 'placeholders:block,pictures:block,et-chrome:warn,payment:warn,buttons:info', 'NDCS: its sample sponsor and its broken pictures hold it back; its old header and footer and the "Buy tickets" button are checks; what the live page puts right is said', codes);
  var pics = r.items.filter(function (x) { return x.code === 'pictures'; })[0];
  ok(pics.title === '2 pictures cannot be shown' && /“fiber\.png”: its address names “revamp-cms\.firebaneapp”, a typo of this product’s storage/.test(pics.lines.join('\n')) && /“missing\.png”: there is no such picture in storage/.test(pics.lines.join('\n')), 'each broken picture with why, in words (UX-144)', pics.lines);
  ok(pics.action && pics.action.kind === 'pictures' && /The right address of it is known/.test(pics.hint), 'the typo is one click to correct, since that picture is in our storage');
  ok(probed.length === 2 && probed.some(function (u) { return /other-public-bucket/.test(u); }) && !/other-public-bucket/.test(pics.lines.join()), 'another bucket\'s picture is asked about, and one that is there is fine; ours are looked up in storage, never fetched', probed);
  var ph = r.items[0];
  ok(ph.title === 'Template text is still on the page' && ph.lines[0] === '“Sponsor 1” — Convening partners', 'the template text with where it is', ph.lines);
  var chrome = r.items.filter(function (x) { return x.code === 'et-chrome'; })[0];
  ok(chrome.action && chrome.action.kind === 'et-chrome' && /no menu button on phones/.test(chrome.lines[0]) && /no privacy, terms or contact links/.test(chrome.lines[1]), 'an older AI site is offered ET\'s header and footer (UX-143)', chrome);
  var err = hooks.siteCheckError(r, 'owner'), errA = hooks.siteCheckError(r, 'approver');
  ok(err && err.status === 409 && err.body.code === 'site-check' && err.body.checks.length === r.items.length, 'the gate refuses with 409 site-check and the whole list');
  ok(/^This site cannot go live yet: template text is still on the page \(“Sponsor 1”\); 2 pictures cannot be shown \(“fiber\.png” …\)\. Put these right in the site editor, save, and send it again\.$/.test(err.message), 'said to the owner in a sentence', err.message);
  ok(/^These changes cannot go live yet: .*Reject this request with the reason/.test(errA.message), 'and to the approver, with what to do', errA.message);
}));
var CLEAN = page('<header data-rv-section="nav" id="nav" class="rv-etnav" data-rv-etnav=""><a href="#overview">Overview</a></header><section data-rv-section="overview" id="overview"><h2>The real words</h2><a class="btn" href="#register" data-register-cta>Register Now</a></section><footer data-rv-section="footer" id="footer" class="etf" data-rv-et-footer="brandequity"><a href="https://brandequity.economictimes.indiatimes.com/privacy_policy">Privacy Policy</a></footer>',
  'id="gen" data-rv-template-id="gen-bws" class="microsite rv-generated"');
pending.push(hooks.siteCheckOf(fakeFb({}), 'brand-world-summit-2026', { name: 'Brand World Summit 2026' }, CLEAN, { live: true }).then(function (r) {
  ok(r.items.length === 0 && !r.blocking && hooks.siteCheckError(r, 'owner') === null, 'a site with nothing wrong has nothing to say', r.items);
}));
pending.push(hooks.siteCheckOf(fakeFb({}), 'cio', { name: 'Cio' }, CIO, { live: true }).then(function (r) {
  var search = r.items.filter(function (x) { return x.code === 'search'; })[0];
  ok(search && search.level === 'info' && /still the template \(“Event name goes here”\)/.test(search.lines[0]) && /stays live for anyone with its address/.test(search.hint), 'the console says the live template is kept out of search, and stays live (owner decision 1)', search);
}));
/* a site made from that template, still showing them: held back */
pending.push(hooks.siteCheckOf(fakeFb({}), 'cx', { name: 'CX Forum', site: { templateId: 'cx-leaders-forum' } }, page(LEADERS), {}).then(function (r) {
  var it = r.items.filter(function (x) { return x.code === 'samples'; })[0];
  ok(it && it.level === 'block' && r.blocking && /another event/.test(it.hint) && it.lines[0].indexOf('“Customer experience should not be seen') === 0 && /^Their picture “custom_section_img_\d+_\d+\.png” — Quotes From CX Leaders$/.test(it.lines[1]), 'another event\'s quotes and photos from the template hold a page back (UX-140), named as the site editor names the section (its template.json name, NU-002)', it && it.lines.slice(0, 3));
}));
/* the owner's own cards (new quotes, names and pictures) whose people happen to hold the template's roles: nothing to
   hold back (the verifier's case of 3 Nov 2026: a real CMO's quote stopped a CX site going live) */
function ownCard(q, n, role, co) { return '<div class="quote-card"><p>' + q + '</p><div class="text-style speaker"><figure><img src="https://example.org/' + n.replace(/\s/g, '') + '.png" alt=""><figcaption><strong>' + n + '</strong><span><span class="role">' + role + '</span>, <span class="company">' + co + '</span></span></figcaption></figure></div></div>'; }
var OWN_CARDS = page('<section id="leaders" data-rv-section="leaders">' +
  ownCard('Our members told us the queue is the product; we rebuilt every branch around that.', 'Priya Nair', 'Chief Marketing Officer', 'Tata AIA Life Insurance') +
  ownCard('We now answer every complaint within the hour, and the churn numbers followed.', 'Anjani Rathor', 'Executive Director', 'Muthoot Microfin') +
  '</section><section id="speakers" data-rv-section="speakers"><article class="speaker-card"><div class="caption"><h5>Kavya Rao</h5><span>Co-founder and CEO</span></div></article></section>', 'data-rv-template-id="cx-leaders-forum"');
pending.push(hooks.siteCheckOf(fakeFb({}), 'qa-x', { name: 'CX Leaders Forum 2027', templateId: 'cx-leaders-forum', site: { templateId: 'cx-leaders-forum' } }, OWN_CARDS, {}).then(function (r) {
  ok(!r.blocking && !r.items.some(function (x) { return x.code === 'samples'; }), 'the owner\'s own quotes are never samples, whatever the roles, companies or names on the cards', r.items);
}));
/* one sample quote kept on an owner's card (their own name and picture on it) is still another event's words */
pending.push(hooks.siteCheckOf(fakeFb({}), 'qa-y', { name: 'CX Leaders Forum 2027', site: { templateId: 'cx-leaders-forum' } },
  page('<section id="leaders" data-rv-section="leaders">' + ownCard('The big advantage with new technology is that it listens very well and that has always been a problem with humans.', 'Priya Nair', 'Chief Marketing Officer', 'Kotak') + '</section>'), {}).then(function (r) {
  var it = r.items.filter(function (x) { return x.code === 'samples'; })[0];
  ok(r.blocking && it && it.lines.length === 1 && it.lines[0].indexOf('“The big advantage with new technology') === 0, 'a sample quote under the owner\'s own name still holds the page back', it);
}));
/* sample entries in Content, read with only their names (a sponsor's logo can be stored inline) */
pending.push(hooks.siteCheckOf(fakeFb({}, { docs: { 'events/n/partners/p1': { name: 'Sponsor 1', logoUrl: 'data:image/png;base64,AAAA' }, 'events/n/partners/p2': { name: 'Tata Motors' }, 'events/n/faqs/f1': { question: 'Question goes here?' } } }),
  'n', { name: 'N' }, CLEAN, { records: true }).then(function (r) {
  var rec = r.items.filter(function (x) { return x.code === 'records'; })[0];
  ok(rec && rec.level === 'warn' && rec.lines.join('|') === 'Content › Sponsors: “Sponsor 1”|Content › FAQ: “Question goes here?”', 'sample entries in Content are named by tab, a real sponsor left out', rec && rec.lines);
}));
/* the header or footer logo with another year */
var OLD_LOGO = page('<header data-rv-section="nav" id="nav"><a class="nav-brand"><img data-rv-logo="" src="https://storage.googleapis.com/revamp-cms.firebasestorage.app/events/a/logo/summit-2026.svg" alt="Agentic Summit 2027"></a></header>' +
  '<footer data-rv-section="footer" id="footer"><img data-rv-logo="" src="https://storage.googleapis.com/revamp-cms.firebasestorage.app/events/a/logo/plain.svg" alt="Agentic Summit 2027"></footer>', 'id="gen" data-rv-template-id="gen-a" class="microsite rv-generated"');
pending.push(hooks.siteCheckOf(fakeFb({ 'events/a/logo/summit-2026.svg': '<svg><path d="M2026 2027"/></svg>', 'events/a/logo/plain.svg': '<svg><text x="1">AGENTIC SUMMIT <tspan>2026</tspan></text><path d="M2027 1"/></svg>' }), 'agentic-summit-2027',
  { name: 'Agentic Summit 2027', start: '2027-02-10T09:00', designPlan: { design: { logoUnitUrl: 'https://storage.googleapis.com/revamp-cms.firebasestorage.app/events/a/unit-2027.svg' } } }, OLD_LOGO, {}).then(function (r) {
  var y = r.items.filter(function (x) { return x.code === 'logo-year'; })[0];
  ok(y && y.level === 'block' && y.lines.join('|') === 'Header: 2026 — this edition is 2027|Footer: 2026 — this edition is 2027', 'last year\'s logo in the header (its name) and the footer (its words) holds it back — an outline\'s coordinates are no year', y && y.lines);
  ok(y && y.action && y.action.kind === 'et-chrome', 'with ET\'s header and footer as the way to put it right');
  var chrome = r.items.filter(function (x) { return x.code === 'et-chrome'; })[0];
  ok(chrome && /shows the logo as it was uploaded, in a box, not this edition’s logo/.test(chrome.lines[0]), 'a header logo that is not this edition\'s logo unit is said', chrome && chrome.lines);
}));
/* an edition named for 2026 but held in January 2027: its 2026 logo is its own; a 2025 one is not */
var LATE_LOGO = OLD_LOGO.replace('summit-2026.svg', 'summit-2025.svg');
pending.push(hooks.siteCheckOf(fakeFb({ 'events/a/logo/summit-2025.svg': '<svg></svg>', 'events/a/logo/plain.svg': '<svg><text x="1">AGENTIC SUMMIT 2026</text></svg>' }), 'agentic-summit-2026',
  { name: 'Agentic Summit 2026', start: '2027-01-15T09:00' }, LATE_LOGO, {}).then(function (r) {
  var y = r.items.filter(function (x) { return x.code === 'logo-year'; })[0];
  ok(y && y.lines.join('|') === 'Header: 2025 — this edition is 2026 / 2027', 'the year in an edition\'s name and the year it is held in are both its own: only another year holds it back', y && y.lines);
}));

/* ---------- 8b. a newer version of a live site is held back only by what the live page does not show already (UX-144) ----------
   The NDCS repair (its picture's typo put right) was refused for the "Sponsor 1" the live page already showed, so
   the broken picture stayed live. */
var ndcsFirst = pending[0];   // the first NDCS check counts the pictures it asks about: these run after it
var NDCS_FIXED = NDCS.replace('revamp-cms.firebaneapp', 'revamp-cms.firebasestorage.app').replace(/<img src="[^"]*missing\.png" alt="m">/, '');
pending.push(ndcsFirst.then(function () { return hooks.siteCheckOf(fb, 'national-data-center-symposium', DATA, NDCS_FIXED, { livePage: NDCS }).then(function (r) {
  var codes = r.items.map(function (x) { return x.code + ':' + x.level; });
  ok(!r.blocking && hooks.siteCheckError(r, 'owner') === null && hooks.siteCheckError(r, 'approver') === null, 'the repaired NDCS can be sent for approval and approved: nothing it adds holds it back', codes);
  var ph = r.items.filter(function (x) { return x.code === 'placeholders'; })[0];
  ok(ph && ph.level === 'warn' && ph.alreadyLive === true && ph.lines[0] === '“Sponsor 1” — Convening partners' && /^The live site shows this already, so it does not hold the next version back\. Write the event’s own words/.test(ph.hint), 'the "Sponsor 1" the live page shows is still said, as a check, with why it holds nothing back', ph);
  ok(!r.items.some(function (x) { return x.code === 'pictures'; }), 'and the corrected picture is not said at all', codes);
}); }));
/* what the version would add is held back, and only that; a repair button is offered once */
var NDCS_WORSE = NDCS.replace('<p>Symposium sections</p>', '<p>Symposium sections</p><span>Speaker Name</span><img src="https://storage.googleapis.com/revamp-cms.firebasestorage.app/events/ndcs/generated/gone.png" alt="g">');
pending.push(ndcsFirst.then(function () { return hooks.siteCheckOf(fakeFb({ 'events/ndcs/generated/fiber.png': 'x', 'events/ndcs/generated/ok.png': 'x' }), 'national-data-center-symposium', DATA, NDCS_WORSE, { livePage: NDCS }).then(function (r) {
  var codes = r.items.map(function (x) { return x.code + ':' + x.level + (x.alreadyLive ? ':live' : ''); });
  ok(r.blocking && codes.join() === 'placeholders:block,pictures:block,placeholders:warn:live,pictures:warn:live,et-chrome:warn,payment:warn,buttons:info', 'new template text and a new broken picture hold it back; what is live already is a check', codes);
  var blockPh = r.items[0], blockPic = r.items[1], livePic = r.items[3];
  ok(blockPh.lines.length === 1 && /^“Speaker Name”/.test(blockPh.lines[0]), 'only the new template text holds it back', blockPh.lines);
  ok(blockPic.title === '1 picture cannot be shown' && /“gone\.png”/.test(blockPic.lines[0]) && !blockPic.action, 'only the new broken picture holds it back (no address to correct it to)', blockPic);
  ok(livePic.title === '2 pictures cannot be shown' && livePic.action && livePic.action.kind === 'pictures', 'the live ones keep their one-click repair, offered once', livePic);
  var err = hooks.siteCheckError(r, 'owner');
  ok(err && /template text is still on the page \(“Speaker Name”\); 1 picture cannot be shown \(“gone\.png”\)/.test(err.message), 'the refusal names only what the version adds', err && err.message);
}); }));
/* the console's check of the live page itself: what it shows holds no next version back, and its repairs stay */
pending.push(ndcsFirst.then(function () { return hooks.siteCheckOf(fb, 'national-data-center-symposium', DATA, NDCS, { live: true }).then(function (r) {
  var pics = r.items.filter(function (x) { return x.code === 'pictures'; })[0];
  ok(!r.blocking && pics && pics.level === 'warn' && pics.alreadyLive && pics.action && pics.action.kind === 'pictures', 'the live NDCS: its problems are checks to put right, the picture with its button, and none holds the next version back', r.items.map(function (x) { return x.code + ':' + x.level; }));
}); }));
/* the live page the gate compares against: the live version as it was saved, else the published page */
var LIVE_FB = fakeFb({ 'events/n2/site/versions/4/page.html': 'v4 as saved', 'events/n2/published/index.html': 'v4 as published', 'events/n3/published/index.html': 'n3 published' });
pending.push(ndcsFirst.then(function () { return Promise.all([
  hooks.livePageOf(LIVE_FB, 'n2', { published: true, publishedVersion: 4 }),
  hooks.livePageOf(LIVE_FB, 'n3', { published: true, publishedVersion: 2 }),
  hooks.livePageOf(LIVE_FB, 'n2', { published: false, publishedVersion: 4 }),
  hooks.livePageOf(LIVE_FB, 'n4', { published: true, publishedVersion: 1 })
]).then(function (r) {
  ok(r[0] === 'v4 as saved' && r[1] === 'n3 published' && r[2] === null && r[3] === null, 'the live version as saved, else the published page; nothing for a site that is not live or cannot be read', r);
}); }));
/* the gate itself: a first publication of the same page is held back as before; the repair of the live site is not */
var GATE_FB = fakeFb({ 'events/ndcs/generated/fiber.png': 'x', 'events/ndcs/generated/ok.png': 'x', 'events/ndcs2/site/versions/7/page.html': NDCS });
pending.push(ndcsFirst.then(function () { return hooks.siteCheckGate(GATE_FB, 'ndcs2', Object.assign({}, DATA, { published: true, publishedVersion: 7 }), NDCS_FIXED, 'owner', null).then(function (check) {
  ok(check && !check.blocking, 'the gate lets the live site\'s repair through');
}, function (err) { ok(false, 'the gate lets the live site\'s repair through', err && err.message); }); }));
pending.push(ndcsFirst.then(function () { return hooks.siteCheckGate(GATE_FB, 'ndcs3', Object.assign({}, DATA, { published: false }), NDCS_FIXED, 'owner', null).then(function () {
  ok(false, 'a site that is not live yet is still held back by its template text');
}, function (err) { ok(err && err.status === 409 && /“Sponsor 1”/.test(err.message), 'a site that is not live yet is still held back by its template text', err && err.message); }); }));

/* ---------- 8c. a heading two sections share (UX-155: Agentic's "Not more AI. Better AI." twice in a row) ---------- */
var AGENTIC_TWICE = page('<header data-rv-section="nav" id="nav"><h2>Agentic Summit</h2></header>' +
  '<section data-rv-section="hero" id="hero"><h1 class="hero-tagline">THE NEXT PHASE IS NOT MORE AI</h1></section>' +
  '<section data-rv-section="overview" id="overview"><h2 class="overview-h2">Not more AI. Better AI.</h2><p>Enterprises are moving AI from pilots into production.</p></section>' +
  '<section data-rv-section="key-discussion-points" id="key-discussion-points"><p class="key-discussion-points-label">Key Discussion Points</p>' +
  '<h2 class="key-discussion-points-h2">NOT MORE AI. <em>BETTER</em> AI.</h2><p>Three conversations that decide whether agents scale.</p><style>.x{}</style></section>' +
  '<section data-rv-section="speakers" id="speakers"><h2>Speakers</h2><div><h2>Not more AI. Better AI.</h2></div></section>' +
  '<footer data-rv-section="footer" id="footer"><h2>Not more AI. Better AI.</h2></footer>',
  'id="gen" data-rv-template-id="gen-agentic-summit-2027" class="microsite rv-generated"');
var twiceReps = hooks.repeatedPageHeadings(AGENTIC_TWICE);
ok(twiceReps.length === 1 && twiceReps[0].id === 'key-discussion-points' && twiceReps[0].firstId === 'overview' && twiceReps[0].text === 'NOT MORE AI. BETTER AI.',
  'the later of two sections with the same heading (case and markup aside) is found; a heading further inside a section, the header and the footer are not section headings', twiceReps);
ok(hooks.repeatedPageHeadings(AGENTIC_TWICE.replace('Not more AI. Better AI.</h2><p>Enterprises', 'Why enterprise AI is stuck in pilots</h2><p>Enterprises')).length === 0, 'headings of their own: nothing to say');
ok(hooks.repeatedPageHeadings(page('<section data-rv-section="hero"><h1>Better AI</h1></section><section data-rv-section="why"><h2>Better AI.</h2></section>'))[0].firstId === 'hero', 'a section that repeats the banner\'s line is found too');
ok(hooks.repeatedPageHeadings(page('<section data-rv-section="faq-home"><h2>FAQs</h2></section><section data-rv-section="faq" data-rv-page="faq"><h2>FAQs</h2></section>' +
  '<section data-rv-section="jury" data-rv-page="jury"><h2>FAQs</h2></section><section data-rv-section="more" data-rv-page="faq"><h2>FAQs</h2></section>')).map(function (r) { return r.id + '<' + r.firstId; }).join() === 'more<faq',
  'an award site\'s pages are each their own: only a heading repeated on the same page counts');
pending.push(hooks.siteCheckOf(fakeFb({}), 'agentic-summit-2027', { name: 'Agentic Summit 2027' }, AGENTIC_TWICE, { live: true }).then(function (r) {
  var h = r.items.filter(function (x) { return x.code === 'headings'; })[0];
  ok(h && h.level === 'warn' && h.title === 'Two sections have the same heading' && h.lines[0] === '“NOT MORE AI. BETTER AI.” — Key discussion points repeats Overview' &&
    h.action && h.action.kind === 'headings' && /ETB2B AI can write the later section a heading of its own/.test(h.hint), 'the console says so, with ETB2B AI\'s repair on an AI-designed site', h);
}));
pending.push(hooks.siteCheckOf(fakeFb({}), 'cx', { name: 'CX' }, AGENTIC_TWICE.replace('data-rv-template-id="gen-agentic-summit-2027" class="microsite rv-generated"', 'data-rv-template-id="cx-leaders-forum"'), {}).then(function (r) {
  var h = r.items.filter(function (x) { return x.code === 'headings'; })[0];
  ok(h && !h.action && /in the site editor/.test(h.hint), 'a template site is told to change it in the site editor', h);
}));
var renamed = hooks.withHeadingText(AGENTIC_TWICE, 'key-discussion-points', 'h2', 'Three conversations & what scales');
ok(renamed.indexOf('<h2 class="key-discussion-points-h2">Three conversations &amp; what scales</h2>') !== -1 && renamed.indexOf('<h2 class="overview-h2">Not more AI. Better AI.</h2>') !== -1 &&
  renamed.replace('<h2 class="key-discussion-points-h2">Three conversations &amp; what scales</h2>', '<h2 class="key-discussion-points-h2">NOT MORE AI. <em>BETTER</em> AI.</h2>') === AGENTIC_TWICE,
  'only that section\'s heading changes, its words escaped and its tag kept: every other byte as it was');
ok(hooks.withHeadingText(AGENTIC_TWICE, 'no-such', 'h2', 'x') === null && hooks.withHeadingText('<p>none</p>', null, 'h2', 'x') === null, 'no such section or heading: null, nothing written');
ok(hooks.withHeadingText('<section data-rv-section="k"><h2 class="a">old</h2></section>', null, 'h2', 'New') === '<section data-rv-section="k"><h2 class="a">New</h2></section>', 'and a stored section\'s own html');
/* ETB2B AI's answer, faked: the prompt carries the section's own words and the headings it may not take */
var llmMod = require('./llm'), realCall = llmMod.callJson, asked = [];
function fakeHeadings(answer) { llmMod.callJson = function (prompt, schema, opts) { asked.push({ prompt: prompt, schema: schema, opts: opts }); return Promise.resolve(answer); }; }
pending.push(Promise.resolve().then(function () {
  fakeHeadings({ parsed: { headings: [{ id: 'key-discussion-points', heading: '“Where agents earn their place”' }] } });
  return hooks.writeSectionHeadings(fakeFb({}), 'agentic-summit-2027', { name: 'Agentic Summit 2027' }, AGENTIC_TWICE, twiceReps);
}).then(function (got) {
  ok(got['key-discussion-points'] === 'Where agents earn their place' && asked.length === 1, 'the new heading, its quotation marks taken off, in one answer', got);
  var q = asked[0];
  ok(q && q.opts.route === 'site-heading' && /Three conversations that decide whether agents scale\./.test(q.prompt) && /"Not more AI\. Better AI\."/.test(q.prompt) && /"THE NEXT PHASE IS NOT MORE AI"/.test(q.prompt) &&
    !/<style|\.x\{\}/.test(q.prompt) && /never invent facts/.test(q.prompt) && /never copy a sentence/.test(q.prompt), 'asked on its own route, with the section\'s words (no markup or styles), the headings already on the page, and not to copy its words', q && q.prompt);
  /* the browser check of 5 Nov: the heading copied the sentence under it, so the section said it twice. Refused, and asked once more with why */
  asked.length = 0;
  var answers = [{ parsed: { headings: [{ id: 'key-discussion-points', heading: 'Three conversations that decide whether agents scale.' }] } }, { parsed: { headings: [{ id: 'key-discussion-points', heading: 'What it takes for agents to scale' }] } }];
  llmMod.callJson = function (prompt, schema, opts) { asked.push({ prompt: prompt }); return Promise.resolve(answers.shift()); };
  return hooks.writeSectionHeadings(fakeFb({}), 'agentic-summit-2027', { name: 'A' }, AGENTIC_TWICE, twiceReps).then(function (got) {
    ok(got['key-discussion-points'] === 'What it takes for agents to scale' && asked.length === 2 && /copies the section's own words/.test(asked[1].prompt), 'a heading that copies the sentence under it is asked for again, told why, and the second one is taken', [got, asked.length]);
  });
}).then(function () {
  asked.length = 0;
  fakeHeadings({ parsed: { headings: [{ id: 'key-discussion-points', heading: 'not more ai, better ai' }] } });
  return hooks.writeSectionHeadings(fakeFb({}), 'agentic-summit-2027', { name: 'A' }, AGENTIC_TWICE, twiceReps).then(function () { ok(false, 'a heading that repeats one on the page is refused'); },
    function (err) { ok(err.status === 502 && err.body.code === 'ai-heading' && /Nothing was changed/.test(err.message) && asked.length === 2, 'a heading that repeats one on the page twice over is refused, and nothing changes', err.message); });
}).then(function () {
  ok(hooks.writeSectionHeadings.length === 5, 'writeSectionHeadings(fb, eventId, data, page, reps)');
  fakeHeadings({ code: 'ai-timeout', error: 'slow' });
  return hooks.writeSectionHeadings(fakeFb({}), 'agentic-summit-2027', { name: 'A' }, AGENTIC_TWICE, twiceReps).then(function () { ok(false, 'no answer: refused'); },
    function (err) { ok(err.status === 502 && err.body.code === 'ai-heading', 'no answer from the model: refused the same way'); });
}).then(function () { llmMod.callJson = realCall; }, function (err) { llmMod.callJson = realCall; throw err; }));

/* ---------- 9. the one-click header and footer: the page and the editor's snapshot change together ---------- */
var SAVED = '<html><body id="gen" data-rv-template-id="gen-a" class="microsite rv-generated">' +
  '<style data-rv-style="nav">.old-nav{}</style><header data-rv-section="nav" id="nav" class="nav-root" data-rv-key="nav"><a class="nav-brand">old</a></header>' +
  '<style data-rv-style="hero">.h{}</style><section data-rv-section="hero" id="hero">hero</section>' +
  '<style data-rv-style="footer">.old-footer{}</style><footer data-rv-section="footer" id="footer" class="footer" data-rv-key="footer">old footer</footer></body></html>';
var NODES = ['<style data-rv-style="nav">.old-nav{}</style>', '<header data-rv-section="nav" id="nav" class="nav-root" data-rv-key="nav"><a class="nav-brand">old</a></header>',
  '<style data-rv-style="hero">.h{}</style>', '<section data-rv-section="hero" id="hero">hero</section>',
  '<style data-rv-style="footer">.old-footer{}</style>', '<footer data-rv-section="footer" id="footer" class="footer" data-rv-key="footer">old footer</footer>'];
var nav = hooks.replaceSiteSection(SAVED, NODES, 'nav', { html: '<header class="rv-etnav" id="nav" data-rv-etnav=""><a>new</a></header>', css: '[data-rv-section="nav"] .rv-etnav{}' });
ok(nav && nav.page.indexOf('<style data-rv-style="nav">[data-rv-section="nav"] .rv-etnav{}</style><header class="rv-etnav" id="nav" data-rv-etnav="" data-rv-section="nav" data-rv-key="nav"><a>new</a></header>') !== -1 && nav.page.indexOf('old-nav') === -1 && nav.page.indexOf('nav-brand') === -1,
  'the header and its stylesheet are replaced in the page, with the section\'s marks kept', nav && nav.page);
ok(nav && nav.nodes[0] === '<style data-rv-style="nav">[data-rv-section="nav"] .rv-etnav{}</style>' && nav.nodes[1].indexOf('data-rv-etnav') !== -1 && nav.nodes[3] === NODES[3] && nav.nodes.length === NODES.length, 'and among the editor\'s snapshot nodes, so the editor reopens it as saved', nav && nav.nodes);
var foot = hooks.replaceSiteSection(nav.page, nav.nodes, 'footer', { html: '<footer class="etf" id="footer" data-rv-et-footer="b2b">new footer</footer>', css: '.etf{}' });
ok(foot && foot.page.indexOf('old footer') === -1 && foot.page.indexOf('data-rv-et-footer="b2b" data-rv-section="footer" data-rv-key="footer">new footer</footer>') !== -1 && foot.nodes[5].indexOf('new footer') !== -1, 'and the footer the same way');
ok(hooks.replaceSiteSection('<html><body><section data-rv-section="hero"></section></body></html>', NODES.slice(2), 'nav', { html: '<header></header>', css: '' }) === null, 'a site with no header to replace is refused, never half-done');
var noSnap = hooks.replaceSiteSection(SAVED, [], 'nav', { html: '<header class="rv-etnav" id="nav" data-rv-etnav=""></header>', css: '.x{}' }, true);
ok(noSnap && noSnap.page.indexOf('data-rv-etnav') !== -1 && noSnap.nodes.length === 0, 'a site saved before the editor\'s snapshot was kept (NDCS): its page alone is put right');

/* ET's header and footer, built for an older site as generation builds them (et-nav.js, et-footer.js) */
var chromeFb = fakeFb({}, { docs: { 'events/agentic-summit-2027': {}, 'events/agentic-summit-2027/sources/s1': { type: 'previousEdition', url: 'https://brandequity.economictimes.indiatimes.com/agentic-summit-2026', previous: { portal: 'brandequity', url: 'https://brandequity.economictimes.indiatimes.com/agentic-summit-2026' } } } });
var CHROME_EVENT = { name: 'Agentic Summit 2027', start: '2027-02-10T09:00', city: 'Mumbai', category: 'ip', portal: 'brandequity',
  designPlan: { design: { mode: 'dark', themeColor: '#186bf9' }, sections: [{ id: 'overview', name: 'Overview', kind: 'custom' }, { id: 'contact-us', name: 'Contact', kind: 'contact' }] } };
pending.push(hooks.etChromeFor(chromeFb, 'agentic-summit-2027', CHROME_EVENT, AGENTIC,
  function (portal) { ok(portal === 'brandequity', 'the footer\'s events are asked of the event\'s own portal', portal); return Promise.resolve([]); }).then(function (built) {
  ok(/data-rv-etnav/.test(built.nav.html) && /Agentic Summit 2027/.test(built.nav.html) && /data-register-cta/.test(built.nav.html) && built.nav.css.length > 200, 'the header is ET\'s bar: the event\'s name, Register in it, its own stylesheet', built.nav.html.slice(0, 300));
  ok(/brandequity/.test(built.nav.html) && !/nav-brand/.test(built.nav.html) && built.nav.html.indexOf('group-4-3.svg') === -1, 'with the portal\'s logo, never the uploaded logo in a white box');
  ok(/data-rv-et-footer="brandequity"/.test(built.footer.html) && /privacy_policy/.test(built.footer.html) && /terms_conditions/.test(built.footer.html) && /contact_us/.test(built.footer.html), 'the footer is ET\'s: the portal\'s privacy, terms and contact links', built.footer.html.slice(0, 200));
  ok(/href="#overview"/.test(built.nav.html) && /href="#about-vertical"/.test(built.nav.html), 'the bar links the page\'s own sections, in page order');
}, function (err) { ok(false, 'the header and footer were built', err && err.stack); }));

/* the portal is the event's own (events/<id>.portal), as generation has it since portals were stored: never the
   one its sources point to */
pending.push(hooks.etChromeFor(chromeFb, 'agentic-summit-2027', Object.assign({}, CHROME_EVENT, { portal: 'hr' }), AGENTIC,
  function (portal) { ok(portal === 'hr', 'a portal set apart from the sources: the footer\'s events are that portal\'s', portal); return Promise.resolve([]); }).then(function (built) {
  ok(/portals\/hr-light\.png/.test(built.nav.html) && !/brandequity/.test(built.nav.html), 'the bar has the event\'s own portal\'s logo, not the sources\' ET BrandEquity', built.nav.html.slice(0, 400));
  ok(/data-rv-et-footer="hr"/.test(built.footer.html) && !/data-rv-et-footer="brandequity"/.test(built.footer.html), 'and so has the footer', built.footer.html.slice(0, 200));
}, function (err) { ok(false, 'the header and footer were built for a set portal', err && err.stack); }));
pending.push(hooks.etChromeFor(chromeFb, 'agentic-summit-2027', Object.assign({}, CHROME_EVENT, { portal: '' }), AGENTIC,
  function (portal) { ok(portal === '', 'no portal yet: none is worked out from the sources for the footer\'s events', portal); return Promise.resolve([]); }).then(function (built) {
  ok(/et-business-verticals-on-dark\.svg/.test(built.nav.html) && !/img\/portals\//.test(built.nav.html), 'no portal yet: the ET Business Verticals bar', built.nav.html.slice(0, 400));
  ok(!/data-rv-et-footer="brandequity"/.test(built.footer.html), 'and not the sources\' ET BrandEquity footer', built.footer.html.slice(0, 200));
}, function (err) { ok(false, 'the header and footer were built with no portal', err && err.stack); }));

/* ---------- 10. the sitemap leaves out a page that is still the template ---------- */
var sfb = fakeFb({ 'events/cio/published/index.html': CIO, 'events/bws/published/index.html': CLEAN });
function docSnap(id, d) { return { id: id, data: function () { return d; } }; }
pending.push(hooks.searchVerdicts(sfb, [docSnap('cio', { publishedVersion: 0, publishedAt: '2026-10-08T12:34:09Z' }), docSnap('bws', { publishedVersion: 9, publishedAt: '2026-10-21T08:52:01Z' }), docSnap('gone', { publishedVersion: 1 })]).then(function (hidden) {
  ok(hidden.cio === true && !hidden.bws && !hidden.gone, 'cio\'s live page is the template: left out; a real one and a page that cannot be read are not', hidden);
  delete sfb.store['events/cio/published/index.html'];
  return hooks.searchVerdicts(sfb, [docSnap('cio', { publishedVersion: 0, publishedAt: '2026-10-08T12:34:09Z' })]).then(function (again) {
    ok(again.cio === true, 'the verdict is kept for that publish: the page is read once');
  });
}));

/* ---------- 11. the import: the report the owner sees ---------- */
var importFb = fakeFb({});
pending.push(hooks.processLovableImport(importFb, 'imp-t1', '<html><head></head><body>' + body + '</body></html>', function () { return Promise.resolve(null); }, function () { return Promise.resolve(null); }, null, {}).then(function (r) {
  ok(r.templateId === 'imported-imp-t1' && r.repairs.length > 5 && r.repairs.some(function (c) { return c.what === 'widget'; }), 'an import answers with what it put right and took out', r.repairs && r.repairs.length);
  var saved = importFb.store['events/import-imp-t1/section.html'] || '';
  ok(saved.indexOf('data-rv-form-title="Start a nomination"') !== -1 && saved.indexOf('aria-label="Menu"') === -1, 'and the stored page carries the repairs');
  ok((importFb.docs['imports/imp-t1'] || {}).importRepairs.length === r.repairs.length, 'the list is kept with the import');
}, function (err) { ok(false, 'the import ran', err && err.stack); }));

/* ---------- 12. the console's panel: a repair saved and waiting for approval is not offered again ---------- */
var panel = require('../../edit-event-site-check.js');
var LIVE_CHECK = { of: 'live', published: true, publishedVersion: 9, savedVersion: 10, approvalVersion: 10, found: true, items: [
  { code: 'logo-year', level: 'block', title: 'The header logo shows another year', action: { kind: 'et-chrome', label: 'Update this site’s header and footer' } },
  { code: 'et-chrome', level: 'warn', title: 'This site was built before ET’s header and footer', hint: 'In the event console, one click puts them in.', action: { kind: 'et-chrome', label: 'Update this site’s header and footer' } },
  { code: 'pictures', level: 'block', title: '1 picture cannot be shown', action: { kind: 'pictures', label: 'Correct the picture’s address' } },
  { code: 'buttons', level: 'info', title: 'Put right on the live page as it is shown' }] };
var SAVED_CHECK = { of: 'saved', savedVersion: 10, found: true, items: [{ code: 'pictures', level: 'block', title: '1 picture cannot be shown', action: { kind: 'pictures', label: 'Correct the picture’s address' } }] };
var st = panel.settle(LIVE_CHECK, SAVED_CHECK);
ok(!st.items[0].action && !st.items[1].action && !st.items[1].hint && st.items[0].settled === 'Put right in version 10, which is waiting for approval.', 'what version 10 puts right loses its button and its how-to, and says it waits for approval', st.items.slice(0, 2));
ok(st.items[2].action && st.items[2].action.kind === 'pictures' && !st.items[2].settled, 'what it does not put right keeps its button');
ok(st.blocks === 1 && st.nextVersion === 10 && st.items.length === 4 && LIVE_CHECK.items[0].action && LIVE_CHECK.items[1].hint, 'what holds version 10 back is counted from version 10 itself; the live check is left as it was', st);
var notSent = panel.settle(Object.assign({}, LIVE_CHECK, { approvalVersion: 0 }), SAVED_CHECK);
ok(/saved and not live yet: send it for approval\.$/.test(notSent.items[1].settled), 'one saved but not sent for approval says so');
ok(panel.settle(LIVE_CHECK, { found: false, items: [] }).items[0].action, 'with no saved check to go by, nothing changes');
/* NU-014: one line with the count on every tab, open on its own only on the Dashboard when something holds it back */
var SAMPLE_BLOCK = { of: 'saved', items: [{ code: 'samples', level: 'block', title: 'Samples from the template are still on the page' }, { code: 'empty-sections', level: 'warn', title: 'A section has nothing in it' }, { code: 'x', level: 'info', title: 'Good to know' }] };
var sum = panel.summaryOf(SAMPLE_BLOCK);
ok(sum.title === 'Before this site goes live: 1 thing to put right, 1 to look at' && sum.lead === 'The site can’t go live until it is put right.' && sum.shown.length === 2,
  'NU-014 the panel\'s one line counts what to put right and what to look at, in plain words', sum);
ok(panel.opensOn('dashboard', SAMPLE_BLOCK) && panel.opensOn('', SAMPLE_BLOCK) && !panel.opensOn('content/speakers', SAMPLE_BLOCK) && !panel.opensOn('content/basics', SAMPLE_BLOCK) &&
  !panel.opensOn('content/agenda', SAMPLE_BLOCK), 'NU-014 it opens on its own on the Dashboard only, folded to its line on every other tab');
ok(!panel.opensOn('dashboard', { of: 'saved', items: [{ level: 'warn', title: 'A link leads nowhere' }] }), 'NU-014 … and not even there when there is only something to look at');
ok(panel.opensOn('dashboard', { of: 'live', items: [{ level: 'warn', title: 't', action: { kind: 'et-chrome', label: 'Update' } }] }), 'NU-014 … but it does when a one-click repair is waiting');
ok(panel.summaryOf(st).title === 'Your live site: 1 thing to put right, 1 to look at',
  'NU-014 a live site\'s line says it is the live site', panel.summaryOf(st));
ok(panel.summaryOf(st).lead === 'Version 10 can’t go live until it is put right.', 'NU-014 … and which version is held back', panel.summaryOf(st).lead);
var PANEL_SRC = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'edit-event-site-check.js'), 'utf8');
ok(/'Put it right:'/.test(PANEL_SRC) && /a\.href = f\.href/.test(PANEL_SRC) && /location\.hash = f\.route/.test(PANEL_SRC), 'NU-014 every item carries its links to the place to put it right, as the publish window does');

Promise.all(pending).then(function () {
  if (failures.length) {
    console.error('site-checks: ' + failures.length + ' of ' + checks + ' checks failed:\n  - ' + failures.join('\n  - '));
    process.exit(1);
  }
  console.log('site-checks: all ' + checks + ' checks passed');
}, function (err) { console.error('site-checks: crashed — ' + (err && err.stack || err)); process.exit(1); });
