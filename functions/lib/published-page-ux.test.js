/* node functions/lib/published-page-ux.test.js — exits 1 on the first failure it lists. No network, no Firebase.
   What a visitor of a published site meets (the UX checklist's published-site batch, B19):
     - the "Skip to main content" link, the main landmark it goes to, the hidden h1 of a page that has none (UX-154)
     - a picture for every shared link, a description that ends at a word (UX-148)
     - "About Vertical" saying whose, on a page built before the bar did (UX-152)
     - the schema.org Event with no made-up time, and the calendar file (UX-157, UX-150)
     - the 404 of a wrong page address on a live site, with the way home (UX-153)
     - a section heading written twice is written again (UX-155)
     - the registration form's thank-you and its repeat message (UX-150)
     - a contact's e-mail and phone as links, the e-mail breaking after its "@" (UX-156, UX-155)
     - the runtime's "Read less", the menu's page groups and its duplicates left out (UX-155, UX-151) */
'use strict';
/* a Firestore and Storage in memory, just enough to serve /e/<id> and the calendar file (the routes below run
   through the real router) */
var FB = (function () {
  var docs = {}, files = {};
  function snap(p) { var d = docs[p]; return { id: p.split('/').pop(), exists: !!d, data: function () { return d ? JSON.parse(JSON.stringify(d)) : undefined; }, get: function (k) { return d ? d[k] : undefined; } }; }
  function col(p) { return { doc: function (id) { return { get: function () { return Promise.resolve(snap(p + '/' + id)); }, collection: function (n) { return col(p + '/' + id + '/' + n); } }; } }; }
  return {
    docs: docs, files: files,
    db: { collection: function (n) { return col(n); } },
    bucket: { name: 'test-bucket', file: function (p) { return {
      download: function () { return files[p] ? Promise.resolve([Buffer.from(files[p])]) : Promise.reject(Object.assign(new Error('No such object'), { code: 404 })); },
      getMetadata: function () { return Promise.reject(Object.assign(new Error('No such object'), { code: 404 })); }
    }; }, getFiles: function () { return Promise.resolve([[]]); } }
  };
})();
require.cache[require.resolve('./firebase')] = { id: require.resolve('./firebase'), filename: require.resolve('./firebase'), loaded: true, exports: { getFirebase: function () { return FB; } } };
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const S = require('./site-seo');
const hooks = require('./api')._testHooks;
const audience = require('./api-audience');

var failures = [], checks = 0;
function ok(cond, label, detail) { checks++; if (!cond) failures.push(label + (detail ? '\n      ' + detail : '')); }
function count(text, needle) { return text.split(needle).length - 1; }
function pass(html, event) { return hooks.sitePagePass(html, { mode: 'live', event: event || { name: 'AutoTech Summit 2027' }, templateId: 'gen-qa-x' }); }

/* ---------- an AI-designed page whose hero is a video and whose event name is only in its logo picture ---------- */
var STYLE = '--theme-color:#0a3d91;--accent-color:#f5a623;--rv-bg:#ffffff;--rv-surface:#f4f5f7;--rv-text:#14161b;--rv-muted:#545b66';
var LONG = 'AutoTech Summit 2027 brings together the leaders of India\'s automotive industry in Pune for two days on electric vehicles, software-defined cars, supply chains and the policy that shapes them, with governed data.';
var PAGE = [
  '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>AutoTech</title>',
  '<meta name="description" content="' + LONG + '" data-rv-head>',
  '<link rel="canonical" href="https://sites.example/e/qa-x" data-rv-head>',
  '<meta property="og:title" content="AutoTech Summit 2027" data-rv-head>',
  '<meta property="og:description" content="' + LONG + '" data-rv-head>',
  '<meta name="twitter:card" content="summary" data-rv-head>',
  '</head>',
  '<body id="gen" data-rv-template-id="gen-qa-x" class="microsite rv-generated" style="' + STYLE + '">',
  '<div id="content"><div class="col-md-12 no-padding">',
  '<header data-rv-section="nav" class="rv-etnav" id="nav" data-rv-etnav><div class="rv-etnav-bar"><a class="rv-etnav-logo" href="https://auto.economictimes.indiatimes.com/">',
  '<img data-rv-et-logo data-rv-on-light="/templates/_shared/img/portals/auto.png" data-rv-on-dark="/templates/_shared/img/portals/auto-light.png" src="/templates/_shared/img/portals/auto.png" alt="ETAuto"></a>',
  '<nav class="rv-etnav-links"><ul class="rv-etnav-list"><li><a href="#overview">Overview</a></li><li><a href="#about-vertical">About Vertical</a></li></ul></nav></div></header>',
  '<section data-rv-section="hero" id="hero" class="hero-root"><div class="hero-veil"></div><video class="hero-video" muted loop playsinline data-rv-bg-video data-rv-src="https://et/v.mp4"></video>',
  '<div class="hero-inner"><img class="rv-lu-img" src="https://x/generated/logo-unit.png" alt="AutoTech Summit 2027"></div></section>',
  '<section data-rv-section="sponsors" id="sponsors"><h2>Partners</h2><img src="https://x/samsung.webp" alt="Samsung"></section>',
  '<section data-rv-section="overview" id="overview"><h3>Why Pune</h3><img src="https://x/icons/arrow.svg" alt=""><img src="https://x/generated/overview.png" alt="Assembly line in Pune"></section>',
  '<section data-rv-section="about-vertical" id="about-vertical"><h2>About ETAuto.com</h2></section>',
  '<footer data-rv-section="footer" id="footer" data-rv-et-footer="auto"><h2>What\'s Happening</h2></footer>',
  '</div></div></body></html>'
].join('\n');

var live = pass(PAGE);
ok(pass(live) === live, 'the pass on its own output changes nothing (as /e/ serves a page already published with it)');

/* UX-154: skip link and main landmark */
ok(/<body[^>]*><a class="rv-skip" href="#rv-main" data-rv-a11y>Skip to main content<\/a>\n/.test(live) && count(live, 'class="rv-skip"') === 1, 'the first thing in <body> is "Skip to main content"', (live.match(/<body[^>]*>.{0,120}/) || [''])[0]);
ok(/<main data-rv-main id="rv-main" tabindex="-1"><section data-rv-section="hero"/.test(live), 'it goes to the main landmark, which can take the focus');
ok(/<style data-rv-a11y>\.rv-skip\{position:fixed;left:12px;top:-200px;[^<]*\.rv-skip:focus\{top:12px;[^<]*\.rv-sr-only\{/.test(live) && count(live, '<style data-rv-a11y>') === 1, 'it is hidden until a keyboard reaches it, by rules the page carries itself');
var ownMain = PAGE.replace('<section data-rv-section="hero"', '<main class="flex-1"><section data-rv-section="hero"').replace('<footer data-rv-section', '</main><footer data-rv-section');
var withOwn = pass(ownMain);
ok(/<main class="flex-1" id="rv-main" tabindex="-1">/.test(withOwn) && count(withOwn, '<main') === 1 && /href="#rv-main"/.test(withOwn), 'a page with its own main: that one is the target, given an id');
var named = pass(ownMain.replace('<main class="flex-1">', '<main id="content-main">'));
ok(/<a class="rv-skip" href="#content-main"/.test(named) && /<main id="content-main">/.test(named), 'a main with an id of its own keeps it');
var importedNoMain = PAGE.replace('data-rv-template-id="gen-qa-x"', 'data-rv-template-id="imported-imp-x"').replace('id="gen"', 'id="imported"').replace(' class="microsite rv-generated"', '');
var imp = hooks.sitePagePass(importedNoMain, { mode: 'live', event: { name: 'X' }, templateId: 'imported-imp-x' });
ok(imp.indexOf('rv-skip') === -1 && imp.indexOf('<main') === -1 && imp.indexOf('rv-sr-only') === -1, 'an imported page without a main: nothing to skip to, and no h1 added to its own structure');
var importedMain = ownMain.replace('data-rv-template-id="gen-qa-x"', 'data-rv-template-id="imported-imp-x"').replace('id="gen"', 'id="imported"').replace(' class="microsite rv-generated"', '');
var impMain = hooks.sitePagePass(importedMain, { mode: 'live', event: { name: 'X' }, templateId: 'imported-imp-x' });
ok(/<a class="rv-skip" href="#rv-main" data-rv-a11y>/.test(impMain) && /<span class="rv-skip-to" id="rv-main" tabindex="-1" data-rv-a11y><\/span><main class="flex-1"><section/.test(impMain) && count(impMain, 'id="rv-main"') === 1,
  'an imported page\'s own main without an id: its tag is left as it came (no id, no tabindex); the skip link goes to a place just before it', (impMain.match(/.{0,90}<main[^>]*>/) || [''])[0]);
ok(/\.rv-skip-to\{position:absolute;width:1px;height:1px;overflow:hidden\}/.test(impMain) && hooks.sitePagePass(impMain, { mode: 'live', event: { name: 'X' }, templateId: 'imported-imp-x' }) === impMain,
  'out of the page\'s flow, and written the same on every run');
var impNamed = hooks.sitePagePass(importedMain.replace('<main class="flex-1">', '<main class="flex-1" id="app-main">'), { mode: 'live', event: { name: 'X' }, templateId: 'imported-imp-x' });
ok(/<a class="rv-skip" href="#app-main" data-rv-a11y>/.test(impNamed) && /<main class="flex-1" id="app-main"><section/.test(impNamed), 'one whose main has an id: the skip link goes to it, the tag unchanged');

/* UX-154: exactly one h1 */
ok(/<section data-rv-section="hero" id="hero" class="hero-root"><h1 class="rv-sr-only" data-rv-a11y>AutoTech Summit 2027<\/h1>\n/.test(live) && count(live, '<h1') === 1, 'a page whose name is only in its logo picture gets one h1, visually hidden, at the top of its hero');
ok(/<h3>Why Pune<\/h3>/.test(live) && /<h3 aria-level="2" data-rv-level="">Why Pune<\/h3>/.test(pass(PAGE.replace(/<section data-rv-section="sponsors"[\s\S]*?<\/section>\n/, ''))),
  'the outline starts at that h1: an h3 straight after it is announced at level 2 (after an h2 it stays 3)');
var hasH1 = pass(PAGE.replace('<div class="hero-inner">', '<div class="hero-inner"><h1 class="hero-tagline">Drive</h1>'));
ok(hasH1.indexOf('rv-sr-only" data-rv-a11y>') === -1 && count(hasH1, '<h1') === 1, 'a page with its own h1 gets no second one');
ok(pass(PAGE, { name: 'A </h1><script>x</script>' }).indexOf('<script>x') === -1, 'the event name is written as text');

/* UX-148: a picture for the shared link, a description that ends at a word */
ok(/<meta property="og:image" content="https:\/\/x\/generated\/overview\.png" data-rv-seo>/.test(live) && /<meta name="twitter:image" content="https:\/\/x\/generated\/overview\.png"/.test(live),
  'a hero that is only a video: the page\'s first own picture (not a partner\'s logo, not an SVG icon, not the logo unit)', (live.match(/<meta property="og:image"[^>]*>/) || [''])[0]);
ok(/<meta name="twitter:card" content="summary_large_image"/.test(live), 'a picture fills the large card');
var poster = pass(PAGE, { name: 'X', heroVideo: { enabled: true, url: 'https://x/v.mp4', contentType: 'video/mp4', posterUrl: 'https://x/still.jpg' } });
ok(/og:image" content="https:\/\/x\/still\.jpg"/.test(poster), 'the event\'s own banner video: its still picture first');
var logoOnly = pass(PAGE.replace('<img src="https://x/generated/overview.png" alt="Assembly line in Pune">', ''));
ok(/og:image" content="https:\/\/x\/generated\/logo-unit\.png"/.test(logoOnly) && /twitter:card" content="summary"/.test(logoOnly), 'no picture of its own: the logo unit, shown small (summary card)');
var portalOnly = pass(PAGE.replace('<img src="https://x/generated/overview.png" alt="Assembly line in Pune">', '').replace('https://x/generated/logo-unit.png', 'https://x/generated/logo-unit.svg'));
ok(/og:image" content="https:\/\/sites\.example\/templates\/_shared\/img\/portals\/auto\.png"/.test(portalOnly), 'nothing else: the portal\'s wordmark, at the site\'s own address', (portalOnly.match(/<meta property="og:image"[^>]*>/) || [''])[0]);
var owners = pass(PAGE.replace('<meta name="twitter:card"', '<meta property="og:image" content="https://x/owner.jpg" data-rv-head>\n<meta name="twitter:card"'));
ok(count(owners, 'property="og:image"') === 1 && /og:image" content="https:\/\/x\/owner\.jpg"/.test(owners), 'the owner\'s own share picture still wins');
var desc = (/<meta name="description" content="([^"]*)"/.exec(live) || ['', ''])[1];
ok(desc.length <= S.DESCRIPTION_MAX && /…$/.test(desc) && /\bdays on…$|electric…$|vehicles,?…$|\w…$/.test(desc) && LONG.indexOf(desc.slice(0, -1)) === 0 && /\s/.test(LONG.charAt(desc.length - 1)),
  'a description published before is cut at a word with "…"', desc);
ok((/<meta property="og:description" content="([^"]*)"/.exec(live) || ['', ''])[1] === desc, 'the shared description is cut the same way');
ok(S.shareDescription('Short and sweet.') === 'Short and sweet.' && S.shareDescription(S.shareDescription(LONG)) === S.shareDescription(LONG), 'a short one is left alone; cutting again changes nothing');
ok(/…$/.test(S.shareDescription(new Array(40).join('x') + ' ' + new Array(200).join('y'))) && S.shareDescription(new Array(300).join('z')).length === 160, 'one very long word is cut where it must be');
var fresh = hooks.publishTransform(PAGE.replace(/<meta name="description"[^>]*>\n/, '').replace(/<meta property="og:description"[^>]*>\n/, ''), { eventId: 'qa-x', event: { name: 'X', description: LONG }, mode: 'live', templateId: 'gen-qa-x', publicBase: 'https://sites.example' });
ok(((/<meta name="description" content="([^"]*)"/.exec(fresh) || ['', ''])[1]).length <= 160 && /…" data-rv-head>/.test(fresh), 'a new publish cuts it at a word too');

/* UX-148: the owner's own share picture, chosen in Content › Basics next to the banner video */
(function () {
  var html = fs.readFileSync(path.join(__dirname, '../../edit-event.html'), 'utf8');
  ok(/form \+= panel\('Share picture', [^\n]*sharePictureField\(e\)\);/.test(html) && html.indexOf("panel('Banner video'") < html.indexOf("panel('Share picture'"), 'Basics has a Share picture field, after the banner video');
  ok(/C\.uploadImage\(EV\.id, 'media', file\)/.test(html) && /C\.updateEvent\(EV\.id, \{ settings: \{ seo: \{ shareImageUrl: url \} \} \}\)/.test(html), 'it uploads the picture and saves it as the event\'s share picture');
  ok(/inp\.accept = 'image\/jpeg,image\/png'/.test(html) && /save\(''\)/.test(html), 'JPG or PNG only (what every preview shows), and "Use automatic" clears it');
  ok(/after the next publish/.test(html), 'it says honestly when it reaches the live site');
  var settings = hooks.cleanSettings({ seo: { shareImageUrl: 'https://storage.googleapis.com/b/events/x/media/share.jpg' } });
  ok(settings.value && settings.value.seo.shareImageUrl === 'https://storage.googleapis.com/b/events/x/media/share.jpg' && hooks.cleanSettings({ seo: { shareImageUrl: '' } }).value.seo.shareImageUrl === '', 'the server keeps it, and an empty one (automatic)');
})();

/* UX-152: "About Vertical" names the portal */
ok(/<a href="#about-vertical">About ETAuto<\/a>/.test(live) && live.indexOf('About Vertical') === -1, '"About Vertical" in the bar says whose (ETAuto, from the page\'s own footer)');
ok(/<a href="#about-vertical">About ETAuto<\/a>/.test(pass(PAGE.replace(' data-rv-et-footer="auto"', ''))), 'no ET footer: the portal of the bar\'s wordmark');
ok(/>About the team</.test(pass(PAGE.replace('>About Vertical<', '>About the team<'))), 'a label the owner wrote is theirs');

/* UX-157: dates as the owner set them */
var made = S.eventJsonLd({ name: 'BWS', start: '2026-12-05T10:41', end: '2026-12-07T23:41' }, {});
ok(made.startDate === '2026-12-05' && made.endDate === '2026-12-07', 'a time the date field made up (10:41, 23:41) is not published: the dates alone', JSON.stringify(made));
var midnight = S.eventJsonLd({ name: 'T', start: '2026-12-05T00:06', end: '2026-12-05T11:06' }, {});
ok(midnight.startDate === '2026-12-05' && midnight.endDate === '2026-12-05', 'nor 00:06 / 11:06');
var chosen = S.eventJsonLd({ name: 'T', start: '2026-12-05T09:30', end: '2026-12-05T18:00' }, {});
ok(chosen.startDate === '2026-12-05T09:30:00+05:30' && chosen.endDate === '2026-12-05T18:00:00+05:30', 'a chosen time (on the quarter hour) is kept, India time');
var halfChosen = S.eventJsonLd({ name: 'T', start: '2026-12-05T09:30', end: '2026-12-06T23:41' }, {});
ok(halfChosen.startDate === '2026-12-05T09:30:00+05:30' && halfChosen.endDate === '2026-12-06', 'a chosen start with a made-up end: the end\'s date alone');
ok(S.eventJsonLd({ name: 'T', start: '2026-12-07T10:41', end: '2026-12-05T10:41' }, {}).endDate === undefined, 'an end before the start is still left out');
ok(/"startDate":"2026-12-05","endDate":"2026-12-07"/.test(pass(PAGE, { name: 'X', start: '2026-12-05T10:41', end: '2026-12-07T23:41', dateMode: 'exact' })), 'the page\'s Event carries the dates alone');

/* UX-150: the calendar file */
var ics = S.calendarIcs({ name: 'Brand World Summit 2026; South', start: '2026-12-05T10:41', end: '2026-12-07T23:41', venue: 'Taj Wellington Mews, Chennai', city: 'Chennai' },
  { id: 'brand-world-summit-2026', url: 'https://sites.example/e/brand-world-summit-2026', stamp: new Date('2026-11-03T10:00:00Z') });
ok(/^BEGIN:VCALENDAR\r\nVERSION:2\.0\r\nPRODID:-\/\/ET B2B\/\/ETB2B EventSphere\/\/EN\r\n/.test(ics) && /\r\nEND:VCALENDAR\r\n$/.test(ics), 'an RFC 5545 calendar, CRLF lines');
ok(/\r\nDTSTART;VALUE=DATE:20261205\r\nDTEND;VALUE=DATE:20261208\r\n/.test(ics), 'all day, 5 to 7 December (the end is the day after, as calendars count)');
ok(/\r\nSUMMARY:Brand World Summit 2026\\; South\r\n/.test(ics) && /\r\nLOCATION:Taj Wellington Mews\\, Chennai\r\n/.test(ics) && /\r\nURL:https:\/\/sites\.example\/e\/brand-world-summit-2026\r\n/.test(ics) && /\r\nUID:brand-world-summit-2026@oneworld\.etb2b\r\n/.test(ics), 'its name, place (the city not twice) and site, escaped');
var timed = S.calendarIcs({ name: 'T', start: '2026-12-05T09:30', end: '2026-12-05T18:00' }, { id: 't', stamp: new Date('2026-11-03T10:00:00Z') });
ok(/\r\nDTSTART:20261205T040000Z\r\nDTEND:20261205T123000Z\r\n/.test(timed), 'a chosen time: India time written in UTC');
ok(/\r\nDTEND:20261205T050000Z\r\n/.test(S.calendarIcs({ name: 'T', start: '2026-12-05T09:30' }, { id: 't' })), 'a start with no end: an hour');
ok(S.calendarIcs({ name: 'T', dateMode: 'tbd' }, {}) === '' && S.calendarIcs({ name: 'T', start: 'soon' }, {}) === '' && S.calendarIcs({ start: '2026-12-05' }, {}) === '', 'no exact date, or no name: no file');
var longIcs = S.calendarIcs({ name: new Array(40).join('Summit '), start: '2026-12-05' }, { id: 'x' });
ok(longIcs.split('\r\n').every(function (l) { return Buffer.byteLength(l, 'utf8') <= 75; }) && /\r\n Summit|\r\n [A-Za-z ]/.test(longIcs), 'long lines are folded at 75 octets');
ok(hooks.calendarHeaders('bws', ics)['Content-Type'] === 'text/calendar; charset=utf-8' && /filename="bws\.ics"/.test(hooks.calendarHeaders('bws', ics)['Content-Disposition']), 'served as a calendar file');
ok(/eventId=brand-world-summit-2026$/.test(audience.eventFacts({ name: 'B', start: '2026-12-05T10:41' }, 'brand-world-summit-2026').calendar) &&
  audience.eventFacts({ name: 'B', dateMode: 'month', dateLabel: 'December 2026' }, 'b').calendar === '', 'the form is offered the calendar only for an exact date');
var facts = audience.eventFacts({ name: 'Brand World Summit 2026', start: '2026-12-05T10:41', end: '2026-12-07T23:41', venue: 'Taj Wellington Mews, Chennai', city: 'Chennai' }, 'bws');
ok(facts.name === 'Brand World Summit 2026' && facts.when === '5th – 7th December, 2026' && facts.where === 'Taj Wellington Mews, Chennai', 'the thank-you is told the event\'s name, date and place as the site prints them', JSON.stringify(facts));

/* UX-150: a repeat registration */
ok(audience.duplicateMessage({ countsAsRegistration: true }, { name: 'Brand World Summit 2026' }) === 'You’re already registered for Brand World Summit 2026 with this email.', 'a repeat registration says what it means');
ok(audience.duplicateMessage({ countsAsRegistration: false }, { name: 'B' }) === 'This email has already been used for this form.', 'any other form keeps its plain words');

/* UX-150: the thank-you of the forms runtime */
(function () {
  var win = { RV_FORMS_NO_AUTO: true };
  win.document = {};
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../templates/_shared/rv-forms.js'), 'utf8'), vm.createContext({ window: win, console: console }), { filename: 'rv-forms.js' });
  var RF = win.RevampForms, reg = { counts: true }, result = { status: 'confirmed', event: { name: 'Brand World Summit 2026', when: '5th – 7th December, 2026', where: 'Taj Wellington Mews, Chennai', calendar: '/api/public/calendar?eventId=brand-world-summit-2026' } };
  ok(RF.doneHeading(reg, result) === 'You’re registered for Brand World Summit 2026', 'the thank-you\'s heading replaces the form\'s title: registered, for which event');
  ok(RF.doneHeading(reg, { status: 'waitlist', event: result.event }) === 'You’re on the waitlist for Brand World Summit 2026' && RF.doneHeading(reg, { status: 'pending', event: result.event }) === 'Registration received for Brand World Summit 2026', 'the waitlist and an approval form say so');
  ok(RF.doneHeading({ counts: false }, result) === 'Thank you' && RF.doneHeading(reg, { status: 'confirmed' }) === 'You’re registered', 'any other form says thank you; an older answer with no event still reads');
  var f = RF.doneFacts(result);
  ok(f.line === '5th – 7th December, 2026 · Taj Wellington Mews, Chennai' && f.calendar === result.event.calendar, 'date · place under it, and the calendar file');
  ok(RF.doneFacts({ event: { calendar: 'https://evil.example/x.ics' } }).calendar === '' && RF.doneFacts({ event: { calendar: 'javascript:alert(1)' } }).calendar === '', 'only this server\'s calendar route is linked');
  var src = fs.readFileSync(path.join(__dirname, '../../templates/_shared/rv-forms.js'), 'utf8');
  ok(src.indexOf("again: 'Register someone else'") !== -1 && src.indexOf("'Fill in again'") === -1, '"Fill in again" is "Register someone else"');
  ok(/m\.title\.textContent = doneHeading\(form, result\)/.test(src) && /onAgain: function \(\) \{ m\.title\.textContent = ask\.title \|\| formTitle\(form\); \}/.test(src), 'in a pop-up, its title becomes the thank-you\'s heading, and again for the next person the button\'s own title ("Partner with us") or the form\'s');
  /* UX-145 with UX-150: a request sent on the counting form (a partner enquiry, a nomination, a ceremony
     invitation) is no registration, so its thank-you never says registered and offers no calendar */
  ['partner', 'nominate', 'ceremony'].forEach(function (kind) {
    ok(RF.doneHeading(reg, { status: 'pending', enquiry: kind, event: result.event }) === 'Thank you', 'a ' + kind + ' request says thank you, not registered');
  });
  ok(RF.doneHeading(reg, { status: 'confirmed', enquiry: '', event: result.event }) === 'You’re registered for Brand World Summit 2026', 'an empty enquiry is a registration');
  ok(/var counted = form\.counts === true && !isEnquiry\(result\)/.test(src), 'a request\'s thank-you has no date line, no calendar and "Send another response"');
  ok(/mode === 'live' && str\(result && result\.status\) === 'confirmed' && facts\.calendar/.test(src), '"Add to calendar" only for a confirmed place on the live page');
})();

/* UX-153: a wrong page address on a live site */
var nope = hooks.noSuchPageHtml('digiplus-awards-2027', { name: 'Digiplus Awards 2027' });
ok(/<h1>This page does not exist<\/h1>/.test(nope) && /<a href="\/e\/digiplus-awards-2027">Go to Digiplus Awards 2027<\/a>/.test(nope) && /noindex/.test(nope), 'it says so, and leads to the event\'s home page', nope);
ok(/Go to the event’s home page/.test(hooks.noSuchPageHtml('x', {})) && hooks.noSuchPageHtml('x', { name: '<b>' }).indexOf('<b>') === -1, 'with no name, still a way home; the name is text');
ok(hooks.messagePage('T', 'M', { href: 'https://evil.example', label: 'Go' }).indexOf('evil') === -1, 'only a link on this site');
/* the routes, end to end: a live award site, a draft, a wrong page address, the calendar file */
var pending = [];
/* the sites' address is the one setting (lib/public-base.js, UX-001), not the host a request names */
process.env.PUBLIC_BASE_URL = 'https://sites.example';
function route(url, method) {
  return new Promise(function (resolve) {
    var got = { status: 0, headers: {}, body: '' };
    var res = { headersSent: false, setHeader: function () {},
      writeHead: function (st, h) { got.status = st; got.headers = h || {}; this.headersSent = true; },
      end: function (b) { got.body = b == null ? '' : Buffer.isBuffer(b) ? b.toString('utf8') : String(b); resolve(got); } };
    hooks.routeApi({ method: method || 'GET', url: url, headers: { host: 'sites.example' } }, res);
  });
}
FB.docs['events/qa-ux-b19-awards'] = { name: 'Digiplus Awards 2027', createdAt: '2026-11-01T00:00:00.000Z', published: true, publishedVersion: 3, publishedAt: '2026-11-02T00:00:00.000Z',
  start: '2027-03-12T10:41', end: '2027-03-12T23:41', venue: 'Taj Lands End, Mumbai', city: 'Mumbai', dateMode: 'exact', site: { version: 3, templateId: 'gen-qa-ux-b19-awards' } };
FB.files['events/qa-ux-b19-awards/published/index.html'] = PAGE.replace('<title>AutoTech</title>', '<title>Digiplus</title>\n<meta name="rv-pages" content=\'[{"slug":"award-jury","title":"Jury"}]\'>');
FB.docs['events/qa-ux-b19-draft'] = { name: 'Draft', createdAt: '2026-11-01T00:00:00.000Z', published: false, start: '2027-03-12' };
pending.push(Promise.all([
  route('/e/qa-ux-b19-awards/award-faqs'), route('/e/qa-ux-b19-awards/Award-FAQs'), route('/e/qa-ux-b19-awards/award-jury'),
  route('/e/qa-ux-b19-draft/award-faqs'), route('/preview/qa-ux-b19-awards/Award-FAQs'), route('/e/qa-ux-b19-awards/' + new Array(130).join('a')),
  route('/api/public/calendar?eventId=qa-ux-b19-awards'), route('/api/public/calendar?eventId=qa-ux-b19-draft'), route('/api/public/calendar?eventId=../x'),
  route('/e/qa-ux-b19-awards'), route('/api/public/calendar?eventId=qa-ux-b19-awards', 'HEAD')
]).then(function (r) {
  ok(r[0].status === 404 && /This page does not exist/.test(r[0].body) && /<a href="\/e\/qa-ux-b19-awards">Go to Digiplus Awards 2027<\/a>/.test(r[0].body), 'a wrong page address on a live site: "This page does not exist", and the way to the event', r[0].status + ' ' + r[0].body.slice(-260));
  ok(r[1].status === 404 && /Go to Digiplus Awards 2027/.test(r[1].body), 'a page name that cannot be one is answered the same');
  ok(r[2].status === 200 && /data-rv-current-page="award-jury"/.test(r[2].body), 'a real page is still served');
  ok(r[3].status === 404 && /not available/.test(r[3].body) && !/Go to/.test(r[3].body), 'a site that is not live gives nothing away: the plain 404');
  ok(r[4].status === 404 && r[5].status === 404 && !/Go to/.test(r[5].body), 'a preview, or an absurd name, is the plain 404');
  ok(r[6].status === 200 && r[6].headers['Content-Type'] === 'text/calendar; charset=utf-8' && /\r\nDTSTART;VALUE=DATE:20270312\r\nDTEND;VALUE=DATE:20270313\r\n/.test(r[6].body) &&
    /\r\nSUMMARY:Digiplus Awards 2027\r\n/.test(r[6].body) && /\r\nURL:https?:\/\/sites\.example\/e\/qa-ux-b19-awards\r\n/.test(r[6].body), 'the calendar file of a live event: its day, its name, its site', r[6].status + ' ' + r[6].body);
  ok(r[7].status === 404 && r[8].status === 404, 'none for a draft or a bad address');
  ok(r[10].status === 200 && r[10].headers['Content-Type'] === 'text/calendar; charset=utf-8' && r[10].body === '', 'HEAD of the calendar file: its headers, no body (it was a 404 "No such endpoint")', r[10].status + ' ' + r[10].body.slice(0, 80));
  var home = r[9].body;
  ok(r[9].status === 200 && /<a class="rv-skip" href="#rv-main"/.test(home) && /og:image" content="https:\/\/x\/generated\/overview\.png"/.test(home) && />About ETAuto</.test(home) && /"startDate":"2027-03-12"/.test(home),
    'the live page as served: the skip link, a share picture, the portal named, the date alone', r[9].status + ' ' + home.slice(0, 300));
  ok(/<style data-rv-hero-video>\.rv-hv-toggle\{[^}]*width:40px;height:40px;/.test(home), 'and the AI hero video\'s pause button is styled (UX-146)');
}));

/* UX-155: a section heading written twice is written again */
var answers = [{ parsed: { sections: [{ id: 'overview', html: '<section id="overview"><h2 class="o">Not more AI. <em>Better</em> AI.</h2></section>' }] } },
  { parsed: { sections: [{ id: 'key-discussion-points', html: '<section><h2>NOT MORE AI. BETTER AI.</h2></section>' }, { id: 'speakers', html: '<h2>The voices building it</h2>' }, { id: 'faqs', html: '<h2>The next phase is not more AI!</h2>' }] } }];
var plan = { design: { heroTagline: 'The next phase is NOT more AI' }, sections: [{ id: 'overview' }, { id: 'key-discussion-points' }, { id: 'speakers' }, { id: 'faqs' }, { id: 'award-jury', prebuilt: 'award-jury' }] };
ok(JSON.stringify(hooks.repeatedHeadingIds(answers, plan)) === '["key-discussion-points","faqs"]', 'the later of two sections with one heading, and one repeating the hero\'s line, are written again (the first keeps it)', JSON.stringify(hooks.repeatedHeadingIds(answers, plan)));
var taken = hooks.takenHeadings(answers, plan, ['key-discussion-points', 'faqs']);
ok(taken.shown.indexOf('Not more AI. Better AI.') !== -1 && taken.shown.indexOf('The next phase is NOT more AI') !== -1 && taken.shown.indexOf('NOT MORE AI. BETTER AI.') === -1, 'they are told the headings already taken', JSON.stringify(taken.shown));
var prompt = hooks.buildSectionCodePrompt({ designPlan: plan, write: ['key-discussion-points'], takenHeadings: taken.shown });
ok(/HEADINGS ALREADY ON THE PAGE[^\n]*Not more AI\. Better AI\./.test(prompt) && /Every section's heading \(h2\) is its own/.test(prompt), 'the prompt says so');
ok(/never draw a play button or triangle/.test(prompt), 'and no play button on something that plays nothing (the Knowledge Series card)');
ok(hooks.repeatedHeadingIds([{ parsed: { sections: [{ id: 'overview', html: '<h2>A</h2>' }, { id: 'speakers', html: '<p>no heading</p>' }] } }], { sections: [{ id: 'overview' }, { id: 'speakers' }] }).length === 0, 'no repeat, nothing written again');

/* UX-156 / UX-155: a contact's e-mail and phone are links on every page a visitor gets — the page pass, so a page
   published before has them too (its records are in the page: no script on the visitor's page puts them there) */
(function () {
  var A11y = require('./site-a11y');
  ok(A11y.contactHref('email', 'sachitanand.rai@timesinternet.in') === 'mailto:sachitanand.rai@timesinternet.in' && A11y.contactHref('phone', '+91 82993 73687') === 'tel:+918299373687' &&
    A11y.contactHref('phone', '(022) 6789-1234') === 'tel:02267891234', 'mailto: and tel: (digits only, with its +)');
  ok(A11y.contactHref('email', 'name@example') === '' && A11y.contactHref('email', 'Write to us') === '' && A11y.contactHref('phone', '+00 00') === '' &&
    A11y.contactHref('phone', '022 1234 5678 / 98765 43210') === '' && A11y.contactHref('phone', 'Call 98765 43210') === '', 'nothing that is not one address gets a link');
  ok(A11y.contactHref('email', 'name@example.com') === '' && A11y.contactHref('email', 'a@mail.example.org') === '' && A11y.contactHref('phone', '+00 00000 00000') === '' &&
    A11y.contactHref('email', 'events@examples.in') === 'mailto:events@examples.in', 'nor a sample\'s (name@example.com, +00 00000 00000)');
  var CARD = '<section data-rv-section="contact-us" id="contact-us"><div class="contact-us__grid"><article class="contact-us__card" data-rv-repeat-template="contact" data-rv-filled="">' +
    '<h3 data-rv-field="name">Sachitanand Rai</h3><p class="contact-us__line"><span class="contact-us__k">Email</span><span data-rv-field="email">sachitanand.rai@timesinternet.in</span></p>' +
    '<p class="contact-us__line"><span class="contact-us__k">Phone</span><span data-rv-field="phone"> +91 82993 73687 </span></p></article>' +
    '<a class="c2" href="mailto:a@b.co"><span data-rv-field="email">a@b.co</span></a><a data-rv-field="phone" href="tel:+911234567">+91 1234567</a>' +
    '<template data-rv-model><span data-rv-field="email">model@x.co</span></template><span data-rv-field="phone">To be announced</span></div></section>\n';
  var page = PAGE.replace('<footer data-rv-section', CARD + '<footer data-rv-section');
  function links(text) { return (text.match(/" data-rv-contact="(email|phone)">/g) || []).length; }
  var got = pass(page);
  ok(got.indexOf('<span data-rv-field="email"><a href="mailto:sachitanand.rai@timesinternet.in" data-rv-contact="email">sachitanand.rai@<wbr>timesinternet.in</a></span>') !== -1,
    'the card\'s e-mail is a link that may break after its "@" (never "…timesinternet.i / n")', (got.match(/<span data-rv-field="email">.{0,160}/) || [''])[0]);
  ok(got.indexOf('<span data-rv-field="phone"> <a href="tel:+918299373687" data-rv-contact="phone">+91 82993 73687</a> </span>') !== -1, 'the phone number is a link to call, shown as written');
  ok(got.indexOf('<a class="c2" href="mailto:a@b.co"><span data-rv-field="email">a@b.co</span></a>') !== -1 && got.indexOf('<a data-rv-field="phone" href="tel:+911234567">+91 1234567</a>') !== -1,
    'a field that is a link already, or sits inside one, is left as it is');
  ok(got.indexOf('<template data-rv-model><span data-rv-field="email">model@x.co</span></template>') !== -1 && got.indexOf('<span data-rv-field="phone">To be announced</span>') !== -1,
    'nor a list model, nor words that are not a number');
  ok(links(got) === 2 && /<style data-rv-a11y>[^<]*a\[data-rv-contact\]\{color:inherit;text-decoration:underline;[^<]*a\[data-rv-contact="email"\]\{word-break:normal;overflow-wrap:anywhere\}/.test(got),
    'the links keep the card\'s colour, are underlined, and an e-mail breaks only where it must');
  ok(pass(got) === got && links(pass(pass(got))) === 2, 'the pass on its own output changes nothing (the stored page is passed again as /e/ serves it)');
  var imported = page.replace('data-rv-template-id="gen-qa-x"', 'data-rv-template-id="imported-imp-x"').replace('id="gen"', 'id="imported"');
  ok(hooks.sitePagePass(imported, { mode: 'live', event: { name: 'X' }, templateId: 'imported-imp-x' }).indexOf('data-rv-contact') === -1, 'an imported page keeps its own markup');
  var tmpl = hooks.sitePagePass(page.replace(/data-rv-template-id="gen-qa-x"/, 'data-rv-template-id="tech500"').replace(' rv-generated', ''), { mode: 'live', event: { name: 'X' }, templateId: 'tech500' });
  ok(links(tmpl) === 2, 'a real template\'s contact card too');
  var gone = pass(got.replace('sachitanand.rai@<wbr>timesinternet.in', 'x').replace(/<a href="tel:[^>]*>[^<]*<\/a>/, ''));
  ok(links(gone) === 1 && /a\[data-rv-contact\]/.test(gone), 'the rules stay while a link is there');
  ok(pass(PAGE).indexOf('data-rv-contact') === -1, 'a page with no contact card gets no rules for one');
  var emptyList = pass(page.replace('<div class="contact-us__grid">', '<div class="contact-us__grid" data-rv-empty="contact">'));
  ok(links(emptyList) === 0 && emptyList.indexOf('a[data-rv-contact]') === -1, 'a contact list the page hides for having no records (its sample card) gets no links');

  /* UX-155: a play glyph that plays nothing (BWS Knowledge Series) is not shown on an AI-designed page */
  var RES = '<section data-rv-section="resources" id="resources"><div class="resources-card"><div class="resources-play" aria-hidden="true"><svg viewBox="0 0 24 24" width="40" height="40" fill="currentColor"><path d="M8 5v14l11-7z"></path></svg></div>' +
    '<h3 class="resources-ctitle">Knowledge Series</h3></div><a class="video-play" href="https://youtu.be/x"><svg><path d="M8 5v14l11-7z"></path></svg></a><div class="play-zone"><p>Play the quiz</p></div>' +
    '<span class="display-flex"><svg></svg></span><span class="play-btn">&#9654;</span></section>\n';
  var withRes = pass(PAGE.replace('<footer data-rv-section', RES + '<footer data-rv-section'));
  ok(/<div class="resources-play" aria-hidden="true" data-rv-inert-glyph="">/.test(withRes) && /<span class="play-btn" data-rv-inert-glyph="">&#9654;<\/span>/.test(withRes) &&
    /<style data-rv-a11y>[^<]*\[data-rv-inert-glyph\]\{display:none!important\}/.test(withRes), 'the play badge drawn on a card that is no link is not shown', (withRes.match(/<div class="resources-play"[^>]*>/) || [''])[0]);
  ok(/<a class="video-play" href="https:\/\/youtu\.be\/x">/.test(withRes) && /<div class="play-zone"><p>/.test(withRes) && /<span class="display-flex"><svg>/.test(withRes), 'a real link, words, and a class that only contains "play" are left alone');
  ok(pass(withRes) === withRes, 'and the pass on its own output changes nothing');
  var fileTemplate = hooks.sitePagePass(PAGE.replace('<footer data-rv-section', RES + '<footer data-rv-section').replace(/data-rv-template-id="gen-qa-x"/, 'data-rv-template-id="tech500"').replace(' rv-generated', ''), { mode: 'live', event: { name: 'X' }, templateId: 'tech500' });
  ok(fileTemplate.indexOf('data-rv-inert-glyph') === -1, 'a real template (whose own scripts may make a glyph play) is left alone');
})();

/* UX-155 / UX-151: the runtime (browser code: ES5) */
(function () {
  var src = fs.readFileSync(path.join(__dirname, '../../templates/_shared/et-runtime.js'), 'utf8');
  ok(/document\.addEventListener\('toggle', function \(e\) \{[\s\S]{0,200}moreLess\(sum, d\.open\)/.test(src) && /detailsMoreLess\(\); arrive\(\);/.test(src), '"Read more" in a <details> summary says "Read less" while open');
  ok(/if \(repeatsPage\(li\)\) \{ plan\.left\.push\(li\); return; \}/.test(src) && /plan\.left\.forEach\(function \(li\) \{ li\.classList\.add\('is-over'\); \}\);/.test(src), 'a section link that repeats a page tab is left out of the bar, More and the menu');
  ok(/groupHead\('Pages'\)/.test(src) && /groupHead\('On this page'\)/.test(src), 'the phone\'s menu lists the pages apart from the sections');
  ok(/var pageLinks = tabLinks\.filter\(function \(a\) \{ return a\.hasAttribute\('data-rv-page-link'\); \}\);/.test(src) && /var grouped = pageLinks\.length > 0 && sectionLinks\.length > 0;/.test(src) &&
    /otherTabs\.concat\(pageLinks, sectionLinks\)/.test(src), 'only the site\'s own pages are listed under "Pages" (a tab to another site is not one)');
  ok(/if \(a\.classList\.contains\('rv-skip'\)\) focusTarget\(a\.getAttribute\('href'\)\);/.test(src) &&
    /function focusTarget\(hash\) \{[\s\S]{0,200}setAttribute\('tabindex', '-1'\);[\s\S]{0,80}el\.focus\(\{ preventScroll: true \}\)/.test(src), 'the skip link moves the keyboard\'s focus to the main content, not only the view (UX-154)');
  var code = src.replace(/\/\*[\s\S]*?\*\//g, '');
  ok(!/=>/.test(code) && !/(^|[\s;(])(let|const)\s/.test(code) && code.indexOf('`') === -1, 'et-runtime.js stays ES5');
})();

/* ---------- the October template items (OCT-1 to OCT-3), re-checked on 5 Nov ---------- */
(function () {
  var T = path.join(__dirname, '..', '..', 'templates');
  function tf(p) { return fs.readFileSync(path.join(T, p), 'utf8'); }
  var maw = JSON.parse(tf('making-ai-work/template.json'));
  var ov = tf('making-ai-work/sections/overview/index.html'), st = tf('making-ai-work/sections/overview-stats/index.html'), ct = tf('making-ai-work/sections/contact-us/index.html');
  ok(ov.indexOf('custom_section_img_17912743388829') === -1 && ct.indexOf('5443c52a18ecaf0d0d3d') === -1 && !/<img[^>]*cntnd-hdng/.test(ct),
    'OCT-1: making-ai-work shows no picture of text: the four figures and the "Contact Us" heading are words');
  ok((st.match(/<li class="ovr-stat[^"]*"><span class="ovr-stat-num">[^<]+<\/span><span class="ovr-stat-label">[^<]+<\/span><\/li>/g) || []).length === 4 && /DAY TO QUESTION/i.test(st.replace(/<[^>]+>/g, ' ')),
    'OCT-1: the figures are their own section, four cards of a figure and its label');
  var statsMap = maw.content.map.filter(function (m) { return m.from === 'stats'; })[0], contactMap = maw.content.map.filter(function (m) { return m.from === 'contact'; })[0];
  ok(statsMap && statsMap.section === 'overview-stats' && statsMap.fill[0].list === '.ovr-stats > .ovr-stat' && statsMap.fill[0].items === 'stats.items' &&
    JSON.stringify(statsMap.fill[0].fill) === JSON.stringify([{ text: '.ovr-stat-num', value: '{v}' }, { text: '.ovr-stat-label', value: '{k}' }]) &&
    maw.sections.some(function (s) { return s.id === 'overview-stats'; }), 'OCT-1: the figures are filled from Create Event\'s Stats strip (figure and label)');
  ok(contactMap && contactMap.intro && contactMap.intro.heading === '.page_hdng4 h2.cntnd-hdng' && /<h2 class="cntnd-hdng">Contact Us<\/h2>/.test(ct), 'OCT-1: the Contact heading is an h2, filled from Contact\'s own heading');
  var conv = tf('cx-leaders-forum/sections/conventions-box/style.css').replace(/\/\*[\s\S]*?\*\//g, '');
  ok(/@media screen and \(max-width: 1199px\) \{\s*#conventions-box \.conventions-grid \{\s*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/.test(conv) &&
    /@media screen and \(min-width: 576px\) and \(max-width: 767px\) \{\s*#conventions-box \.conventions-grid \{\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/.test(conv),
    'OCT-2: the CX agenda cards go three a row below 1200 px and two on large phones, so a long word is never cut off');
  var lead = tf('cx-leaders-forum/sections/leaders/style.css').replace(/\/\*[\s\S]*?\*\//g, '');
  ok(/#leaders \.quote-grid::before,\s*#leaders \.quote-grid::after \{\s*content: none;\s*display: none;/.test(lead), 'OCT-3: the quotes grid starts in its first cell (the .row\'s ::before takes none)');
})();

/* UX-001: the dashboard's Agenda and Speakers QR codes name /e/<id>/agenda and /speakers; a one-page site opens at
   that section (its ?ag= kept), and one without it says "no such page" with the way home */
FB.docs['events/qa-ux-b02-qr'] = { name: 'QR Summit', createdAt: '2026-11-01T00:00:00.000Z', published: true, publishedVersion: 2, publishedAt: '2026-11-02T00:00:00.000Z',
  site: { version: 2, templateId: 'gen-qa-ux-b02-qr' } };
FB.files['events/qa-ux-b02-qr/published/index.html'] = PAGE.replace('<title>AutoTech</title>', '<title>QR Summit</title>').replace('</body>', '<section id="agenda"><h2>Agenda</h2></section></body>');
pending.push(Promise.all([route('/e/qa-ux-b02-qr/agenda?ag=mailer'), route('/e/qa-ux-b02-qr/speakers'), route('/e/qa-ux-b02-qr/agenda')]).then(function (r) {
  ok(r[0].status === 302 && r[0].headers.Location === '/e/qa-ux-b02-qr?ag=mailer#agenda', 'UX-001 the Agenda QR code opens a one-page site at its agenda, the AG code kept', r[0].status + ' ' + JSON.stringify(r[0].headers));
  ok(r[2].status === 302 && r[2].headers.Location === '/e/qa-ux-b02-qr#agenda', '…and without an AG code', r[2].headers.Location);
  ok(r[1].status === 404 && /This page does not exist/.test(r[1].body) && /Go to QR Summit/.test(r[1].body), 'UX-001 a site with no speakers section: "no such page" and the way home', r[1].status);
}));

Promise.all(pending).then(function () {
  if (failures.length) {
    console.error('published-page-ux: ' + failures.length + ' of ' + checks + ' checks FAILED\n  - ' + failures.join('\n  - '));
    process.exit(1);
  }
  console.log('published-page-ux: all ' + checks + ' checks passed');
}, function (err) { console.error('published-page-ux: ' + (err && err.stack || err)); process.exit(1); });
