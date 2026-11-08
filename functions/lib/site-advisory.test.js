/* node functions/lib/site-advisory.test.js — exits 1 on the first failure it lists.
   The check before Publish (owner decision #11, part 3.2): what lib/site-checks.js reads off a page for it (outside
   links, internal page links, pictures not in storage, empty sections, the event's dates and place, forms, the
   banner's logo, the ET logo rule), how lib/site-advisory.js words it with the places to put it right, and how
   lib/api.js siteCheckOf adds it — advisory only: it never blocks, and the gate never asks for it. Outside sites
   are a stub (no network); the address guard is safe-fetch.js's, checked here through link-check.js too. */
'use strict';
const http = require('http');
const SC = require('./site-checks');
const SA = require('./site-advisory');
const LC = require('./link-check');
const api = require('./api');
const hooks = api._testHooks;
const kit = hooks.TOKEN_KIT;

var failures = [], checks = 0;
function ok(cond, label, detail) { checks++; if (!cond) failures.push(label + (detail !== undefined ? '\n      ' + String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 700) : '')); }
function page(body, bodyAttrs, head) {
  return '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>x</title>' + (head || '') + '</head><body ' + (bodyAttrs || '') + '>' + body + '</body></html>';
}

/* other sites, as a stub: what each address answers to HEAD and to GET */
var asked = [];
var SITES = {
  'https://ok.example/': { HEAD: 200 },
  'https://dead.example/agenda.pdf': { HEAD: 404, GET: 404 },
  'https://nohead.example/page': { HEAD: 405, GET: 200 },
  'https://linkedin.com/company/x': { HEAD: 999, GET: 999 },
  'https://slow.example/x': { HEAD: 'timeout', GET: 'timeout' },
  'https://gone.example/': { HEAD: 'unreachable', GET: 'unreachable' },
  'https://cdn.example/photo-404.jpg': { HEAD: 404, GET: 404 },
  'https://cdn.example/fine.jpg': { HEAD: [200, 'image/jpeg'] },
  'https://cdn.example/login.png': { HEAD: [200, 'text/html; charset=utf-8'] }
};
function stubFetch(url, o) {
  asked.push(o.method + ' ' + url);
  var site = SITES[url] || { HEAD: 200 };
  var a = site[o.method] != null ? site[o.method] : site.HEAD;
  if (typeof a === 'string') return Promise.reject(Object.assign(new Error(a), { code: a }));
  var st = Array.isArray(a) ? a[0] : a, type = Array.isArray(a) ? a[1] : 'text/html';
  return Promise.resolve({ status: st, headers: { 'content-type': type }, body: Buffer.alloc(0) });
}

var EVENT = { name: 'Agentic Summit 2026', start: '2026-03-20T10:00', end: '2026-03-21', venue: 'JW Marriott', city: 'Mumbai',
  templateId: 'gen-agentic', designPlan: { design: { logoUnitUrl: 'https://storage.googleapis.com/revamp-cms.firebasestorage.app/events/a/unit.png' } } };
var BODY =
  '<header data-rv-section="nav" id="nav"><a href="#hero">ET</a><p class="rv-etnav-sub"><span class="rv-etnav-date">12 Mar 2026</span><span class="rv-etnav-place">Taj Lands End, Mumbai</span></p>' +
    '<a href="https://ok.example/">Partner site</a></header>' +
  '<section data-rv-section="hero" id="hero"><h1>Agentic Summit 2026</h1><p>20–21 March 2026 · JW Marriott, Mumbai · then Delhi</p>' +
    '<a class="btn" href="#register" data-register-cta>Register now</a></section>' +
  '<section data-rv-section="about" data-rv-key="about-2" id="about"><h2>About</h2><p>Join us on 25 March 2026 at the summit. Nominations close on 1 Feb 2026. In March 2024 we began. See you on 21 Mar.</p>' +
    '<a class="btn" href="https://dead.example/agenda.pdf">Download the agenda</a><a href="https://nohead.example/page">A page</a><a href="https://slow.example/x">Slow site</a>' +
    '<a href="https://linkedin.com/company/x">LinkedIn</a><a href="https://gone.example/">Gone</a><a href="http://169.254.169.254/latest/meta-data/">Meta</a>' +
    '<a data-rv-page-link="faq" href="#">FAQ page</a><a data-rv-page-link="award-categories" href="#">Categories</a></section>' +
  '<section data-rv-section="speakers" id="speakers"><h2>Speakers</h2><div class="grid"></div></section>' +
  '<section data-rv-section="hidden-one" data-rv-empty="speakers"><h2>Hidden</h2></section>' +
  '<section data-rv-section="glimpses" id="glimpses"><h2>Glimpses</h2><img src="https://cdn.example/photo-404.jpg" alt="a"><img src="/templates/_shared/img/none-such.png" alt="b">' +
    '<img src="https://cdn.example/fine.jpg" alt="c"><img src="https://cdn.example/login.png" alt="d"><img src="/assets/et-b2b-logo.svg" alt="e">' +
    '<img src="https://storage.googleapis.com/revamp-cms.firebasestorage.app/events/a/x.png" alt="ours"></section>' +
  '<section data-rv-section="nominate" id="nominate"><h2>Nominate</h2><p>Long enough words to be more than a heading, for sure.</p>' +
    '<a class="btn" data-rv-form="nomination" href="#rv-form-nomination">Nominate now</a><a class="btn" data-rv-form="old-form" href="#rv-form-old-form">Old form</a></section>' +
  '<footer data-rv-section="footer" id="footer"><p>Other events: 5 June 2026, Delhi</p><img src="/assets/et-b2b-logo.svg" alt="ETB2B" style="filter: invert(1)"></footer>';
var PAGE = page(BODY, 'id="gen" data-rv-template-id="gen-agentic" class="microsite rv-generated"', '<meta name="rv-pages" content=\'[{"slug":"award-categories","title":"Award Categories"}]\'>');

/* ---------- 1. what the page is read for ---------- */
var links = SC.outsideLinks(PAGE, kit);
ok(links[0].url === 'https://dead.example/agenda.pdf' && links[links.length - 1].url === 'https://ok.example/' && links[0].key === 'about-2' && links[0].section === 'About',
  'outside links: a section\'s button first, the header\'s last; each with its section and the key the editor finds it by', links.map(function (l) { return l.url; }));
ok(!links.some(function (l) { return /^#|^\/|storage\.googleapis/.test(l.url); }), 'only links to other sites (not "#", this site\'s own addresses)');
var pl = SC.pageLinks(PAGE, kit, [{ slug: 'award-categories' }]);
ok(pl.length === 1 && pl[0].page === 'faq' && pl[0].label === 'FAQ page', 'a link to an internal page the site does not have; one it has is fine', pl);
var pics = SC.pictureRefs(PAGE, kit);
ok(pics.filter(function (p) { return p.kind === 'outside'; }).length === 3 && pics.filter(function (p) { return p.kind === 'own'; }).length === 2 && !pics.some(function (p) { return /storage\.googleapis/.test(p.url); }),
  'pictures: those of other sites and this product\'s own files; storage\'s are the site check\'s own (pictureProblems)', pics);
ok(SC.pictureRefs(page('<div style="background-image:url(&quot;https://cdn.example/bg.jpg&quot;)"></div><img srcset="https://cdn.example/a.jpg 1x, https://cdn.example/b.jpg 2x">'), kit).map(function (p) { return p.url; }).join() === 'https://cdn.example/bg.jpg,https://cdn.example/a.jpg',
  'a background picture and a srcset\'s first picture are read too');
var empty = SC.emptySections(PAGE, kit);
ok(empty.length === 1 && empty[0].section === 'Speakers' && empty[0].heading === 'Speakers', 'an empty section: shown, with only its heading; a hidden one is not shown, so not empty', empty);
ok(SC.emptySections(page('<section data-rv-section="reg"><h2>Register</h2><div data-rv-form-embed="register"></div></section><section data-rv-section="b" style="background:url(x.jpg)"><h2>B</h2></section>'), kit).length === 0,
  'a section the forms runtime fills, or with a background picture, is not empty');
/* what is in a section besides its first heading (the browser check of 8 Nov 2026 called each of these "only its
   heading", every heading being skipped) */
var FILLED = {
  'a stats section in spans': '<section data-rv-section="stats"><div class="stat"><span>500+</span><span>Delegates</span></div><div class="stat"><span>60+</span><span>Speakers</span></div></section>',
  'a stats section in headings': '<section data-rv-section="numbers"><h2>In numbers</h2><div><h3>500+</h3><p>Delegates</p></div></section>',
  'a list of key topics': '<section data-rv-section="topics"><h2>Key topics</h2><ul><li>AI</li><li>Cloud</li><li>Data</li></ul></section>',
  'cards with h4 titles': '<section data-rv-section="why"><h2>Why attend</h2><div><h4>Learn</h4></div><div><h4>Meet</h4></div></section>',
  'an FAQ with one short answer': '<section data-rv-section="faq"><h2>FAQ</h2><h3>Is it free?</h3><p>Yes.</p></section>',
  'an FAQ in details': '<section data-rv-section="faq2"><h2>FAQ</h2><details><summary>Free?</summary><p>Yes.</p></details></section>',
  'an SVG-only section': '<section data-rv-section="map"><svg viewBox="0 0 10 10"><path d="M0 0h10"/></svg></section>',
  'a banner with its title and date': '<section data-rv-section="hero"><h1>Tech Summit</h1><p>12–13 Mar 2027</p></section>',
  'a banner with only its title': '<section data-rv-section="hero"><h1>Tech Summit</h1></section>',
  'a film in a frame': '<section data-rv-section="film"><h2>Watch</h2><iframe src="https://www.youtube.com/embed/x"></iframe></section>'
};
Object.keys(FILLED).forEach(function (what) {
  var got = SC.emptySections(page(FILLED[what]), kit);
  ok(got.length === 0, what + ' is not empty', got);
});
var EMPTIES = [
  '<section data-rv-section="speakers"><h2>Speakers</h2><div class="grid"></div></section>',
  '<section data-rv-section="speakers"><p class="eyebrow">Speakers</p><h2>Meet the minds</h2><div class="grid"></div></section>',
  '<section data-rv-section="agenda"><h2>Agenda</h2><ul></ul><ul><li class="hidden">Day one</li></ul><svg hidden></svg><h3 hidden>Day 1</h3></section>'
];
EMPTIES.forEach(function (html, n) {
  var got = SC.emptySections(page(html), kit);
  ok(got.length === 1 && got[0].heading, 'still empty (' + n + '): a heading, a short label, an empty grid, and what is hidden', got);
});

ok(SC.datesIn('12-13 March 2026, March 12, 2026, Mar 14, May 5 but may 6, June 2024, 30th Nov – 1st Dec 2026').map(function (d) { return d.text; }).join('|') === '12-13 March 2026|March 12, 2026|Mar 14|May 5|June 2024|30th Nov|1st Dec 2026',
  'dates are read in the ways pages write them ("may" the word is not May)', SC.datesIn('12-13 March 2026, March 12, 2026, Mar 14, May 5 but may 6, June 2024, 30th Nov – 1st Dec 2026'));
var dates = SC.dateFindings(PAGE, kit, EVENT).map(function (d) { return d.text + '@' + d.section; });
ok(dates.join('|') === '12 Mar 2026@Header|25 March 2026@About', 'dates that are not the event\'s: the header\'s date, a day in the words; never a deadline, history, the event\'s own days, or the footer\'s other events', dates);
ok(SC.dateFindings(page('<section data-rv-section="previous-agenda"><div class="pe-agd-date">18 February 2026</div></section>'), kit, EVENT).length === 0,
  'a previous edition\'s agenda gives its own days: not the event\'s to compare (seen on a live page, 8 Nov 2026)');
ok(SC.dateFindings(PAGE, kit, Object.assign({}, EVENT, { dateMode: 'month' })).length === 0 && SC.dateFindings(PAGE, kit, { name: 'x' }).length === 0, 'an event with no exact dates: nothing to compare with');
ok(SC.dateFindings(page('<section data-rv-section="hero"><p>12 March 2025</p></section><section data-rv-section="story"><p>On 12 March 2025 it began.</p></section>'), kit, EVENT).length === 1,
  'last year\'s date in the banner is said; in the words of a section, it is history');
var places = SC.venueFindings(PAGE, kit, EVENT).map(function (p) { return p.text + '@' + p.section; });
ok(places.join('|') === 'Taj Lands End, Mumbai@Header|Delhi@Banner', 'places that are not the event\'s: another venue in its city, another city in the banner; never the footer', places);
ok(SC.venueFindings(page('<header data-rv-section="nav"><span class="x-place">JW Marriott, Mumbai</span><span class="y-venue">Mumbai</span></header>'), kit, EVENT).length === 0, 'the event\'s venue, or only its city, is fine');
ok(SC.venueFindings(page('<header data-rv-section="nav"><span class="x-place">Bangalore</span></header>'), kit, { venue: 'Taj', city: 'Bengaluru' }).length === 0, 'a city by its other name is the same city');
ok(SC.venueFindings(page('<section data-rv-section="hero"><span class="t5-meta-venue">Venue</span><span class="t5-meta-place">Location:</span></section>'), kit, EVENT).length === 0,
  'a label over the place ("Venue") is not a place (tech500\'s banner, seen in the browser check of 8 Nov 2026)');
var fb = SC.formButtons(PAGE, kit);
ok(fb.length === 3 && fb[0].forms.length === 0 && fb[1].forms[0] === 'nomination' && fb[2].forms[0] === 'old-form', 'what opens a form: the main one, a named one', fb);
ok(SC.bannerLogo(PAGE, kit).shown === false && SC.bannerLogo(page('<section data-rv-section="hero"><div data-rv-logo-unit><img src="/x.png"></div></section>'), kit).shown === true, 'the banner\'s logo unit');
ok(SC.bannerLogo(PAGE, kit).key === 'hero' && SC.bannerLogo(page('<section data-rv-section="banner" id="banner"><h1>T</h1></section>'), kit).key === 'banner',
  'the banner\'s section key, for the link to it: "banner" on tech500 (the browser check of 8 Nov 2026 linked "hero", which that page has not)');
var rec = SC.etLogoRecoloured(PAGE, kit);
ok(rec.length === 1 && rec[0].section === 'Footer' && /filter/.test(rec[0].how), 'an ET logo under a colour filter breaks the rule (its red square changes)', rec);
ok(SC.etLogoRecoloured(page('<img src="/assets/et-b2b-logo.svg" alt="ETB2B">'), kit).length === 0, 'the ET logo as it is: fine');

/* ---------- 2. the whole check: wording, places to fix, advisory only ---------- */
function fakeFb(objects) {
  var store = Object.assign({}, objects || {});
  function coll() { return { doc: function () { return { get: function () { return Promise.resolve({ exists: false, data: function () { return undefined; } }); }, collection: coll }; },
    get: function () { return Promise.resolve({ docs: [], empty: true, size: 0 }); }, orderBy: function () { return this; }, limit: function () { return this; }, where: function () { return this; }, select: function () { return this; } }; }
  return {
    bucket: { name: 'revamp-cms.firebasestorage.app', file: function (p) { return {
      exists: function () { return Promise.resolve([Object.prototype.hasOwnProperty.call(store, p)]); },
      download: function () { return Object.prototype.hasOwnProperty.call(store, p) ? Promise.resolve([Buffer.from(store[p])]) : Promise.reject(Object.assign(new Error('No such object'), { code: 404 })); }
    }; } },
    db: { collection: coll }
  };
}
var FORMS = { v: 1, open: true, defaultFormId: 'register', forms: [{ id: 'register', name: 'Registration', open: true }, { id: 'nomination', name: 'Nominations', open: false }] };
var pending = [];
LC._reset();
pending.push(hooks.siteCheckOf(fakeFb({ 'events/a/x.png': 'x' }), 'qa-a', EVENT, PAGE, { forms: FORMS, advisory: { version: 3, waitMs: 2000, fetch: stubFetch } }).then(function (r) {
  var by = {}; r.items.forEach(function (x) { by[x.code] = x; });
  var codes = r.items.map(function (x) { return x.code + ':' + x.level; });
  ok(!r.blocking && r.items.every(function (x) { return !x.advisory || x.level !== 'block'; }), 'what the check before Publish finds never holds the version back', codes);
  ok(hooks.siteCheckError(r, 'approver') === null && hooks.siteCheckError(r, 'owner') === null, 'so neither Send, Publish nor Approve is refused for it (siteCheckError)');
  ok(['links', 'outside-pictures', 'links-unchecked', 'empty-sections', 'dates', 'venue', 'logo-unit', 'et-logo', 'forms-off'].every(function (c) { return by[c] && by[c].advisory; }), 'each kind is found and marked advisory', codes);
  ok(r.pending === 0 && !by['links-pending'], 'every outside site answered within the wait: nothing pending', r.pending);
  var L = by.links;
  ok(L.title === '4 links lead nowhere' && /“Download the agenda” \(About\) goes to dead\.example\/agenda\.pdf: that page is not there \(404\)/.test(L.lines.join('\n')) &&
    /“Meta” \(About\) goes to 169\.254\.169\.254\/latest\/meta-data\/: it points to a private or internal network address/.test(L.lines.join('\n')) &&
    /“Gone” \(About\) goes to gone\.example: its site could not be reached/.test(L.lines.join('\n')) && /“FAQ page” \(About\) goes to a page this site does not have \(“faq”\)/.test(L.lines.join('\n')),
    'broken links in words: not there, a private address, a site that cannot be reached, an internal page the site does not have', L.lines);
  ok(L.fix[0].where === 'editor' && L.fix[0].key === 'about-2' && L.fix[0].href === '/custom_editor.html?event=qa-a&template=gen-agentic&section=about-2' && L.fix[0].label === '“About” in the site editor',
    'each with a link to its section in the site editor', L.fix);
  ok(!/nohead|ok\.example/.test(L.lines.join()), 'a site that refuses HEAD but answers GET works, and links that work are not listed', L.lines);
  ok(asked.indexOf('GET https://nohead.example/page') !== -1 && asked.indexOf('GET https://ok.example/') === -1, 'HEAD first, GET only when HEAD does not say it works', asked);
  var U = by['links-unchecked'];
  ok(U.level === 'info' && /LinkedIn.*would not let us check it \(999\)/.test(U.lines.join('\n')) && /Slow site.*took too long/.test(U.lines.join('\n')), 'what could not be checked is said so, never as broken', U && U.lines);
  var P = by['outside-pictures'];
  ok(P.title === '3 pictures do not load' && /“photo-404\.jpg” \(Glimpses\) from cdn\.example: that page is not there/.test(P.lines.join('\n')) && /“login\.png”.*answers with a web page, not a picture/.test(P.lines.join('\n')) &&
    /“none-such\.png” \(Glimpses\): there is no such file/.test(P.lines.join('\n')) && !/fine\.jpg|et-b2b-logo/.test(P.lines.join()), 'pictures that do not load: not there, a web page instead, a missing file of ours; those that load are not listed', P.lines);
  ok(by['empty-sections'].lines[0] === '“Speakers” shows only its heading, “Speakers”' && by['empty-sections'].fix[0].key === 'speakers', 'an empty section, with the way to it', by['empty-sections']);
  var D = by.dates;
  ok(/The event is on 20–21 Mar 2026 \(Content › Basics\)/.test(D.hint) && D.fix.some(function (f) { return f.where === 'console' && f.route === 'content/basics' && f.href === '/edit-event.html?event=qa-a#content/basics'; }),
    'dates: says the event\'s own and links to Content › Basics too', D);
  ok(/The event is at JW Marriott, Mumbai/.test(by.venue.hint), 'the place: says the event\'s own', by.venue.hint);
  ok(by['logo-unit'].fix[0].key === 'hero' && /red square never does/.test(by['et-logo'].hint), 'the banner\'s logo and the ET logo rule', [by['logo-unit'], by['et-logo']]);
  var F = by['forms-off'];
  ok(F.title === '2 buttons open a form that is switched off' && /“Nominate now” \(Nominate\) opens “Nominations”, which is switched off/.test(F.lines.join('\n')) && /“Old form” \(Nominate\) opens “old-form”, a form that no longer exists/.test(F.lines.join('\n')) &&
    F.fix[0].route === 'settings/form' && !/Register now/.test(F.lines.join()), 'forms switched off or gone, with Settings › Registration forms; the open one is fine', F);
  ok(r.items.filter(function (x) { return x.code === 'placeholders' || x.code === 'samples'; }).length === 0, 'nothing of the old check is said twice');
}));
/* the same version asked again: the outside sites are not asked again */
pending.push(Promise.all(pending).then(function () {
  var before = asked.length;
  return hooks.siteCheckOf(fakeFb({ 'events/a/x.png': 'x' }), 'qa-a', EVENT, PAGE, { forms: FORMS, advisory: { version: 3, waitMs: 0, fetch: stubFetch } }).then(function (r) {
    ok(asked.length === before && r.pending === 0 && r.items.some(function (x) { return x.code === 'links'; }), 'asked again for the same version: answered from what is known, no site asked twice', asked.length - before);
  });
}));
/* slow sites: the check answers within the wait with what is known, and says what is still being checked */
pending.push(Promise.all(pending).then(function () {
  LC._reset();
  var release = null, hold = new Promise(function (r) { release = r; });
  function slow(url, o) { return url === 'https://ok.example/' ? hold.then(function () { return { status: 200, headers: {} }; }) : stubFetch(url, o); }
  var t0 = Date.now();
  return hooks.siteCheckOf(fakeFb({}), 'qa-b', EVENT, PAGE, { forms: FORMS, advisory: { version: 1, waitMs: 300, fetch: slow } }).then(function (r) {
    var p = r.items.filter(function (x) { return x.code === 'links-pending'; })[0];
    ok(Date.now() - t0 < 2500 && r.pending === 1 && p && p.level === 'info' && p.title === 'Still checking 1 link or picture on other sites', 'within the wait, with what is still being asked said so', { ms: Date.now() - t0, pending: r.pending, p: p });
    release();
    return new Promise(function (r2) { setTimeout(r2, 30); });
  }).then(function () {
    return hooks.siteCheckOf(fakeFb({}), 'qa-b', EVENT, PAGE, { forms: FORMS, advisory: { version: 1, waitMs: 0, fetch: slow } });
  }).then(function (r) {
    ok(r.pending === 0 && !r.items.some(function (x) { return x.code === 'links-pending'; }), 'asked again once it has answered: filled in', r.pending);
  });
}));
/* the gate and the check without advisory: exactly as before (nothing asked of other sites, no new items) */
pending.push(Promise.all(pending).then(function () {
  var before = asked.length;
  return hooks.siteCheckOf(fakeFb({}), 'qa-c', EVENT, PAGE, { forms: FORMS }).then(function (r) {
    ok(asked.length === before && !r.items.some(function (x) { return x.advisory; }) && r.pending === 0, 'without advisory (the gate, the console\'s panel): no outside site asked, no advisory item', r.items.map(function (x) { return x.code; }));
  });
}));
/* at most 40 links each time, the most visible first; the rest counted */
pending.push(Promise.all(pending).then(function () {
  LC._reset();
  var many = '';
  for (var i = 0; i < 45; i++) many += '<a href="https://site' + i + '.example/">Link ' + i + '</a>';
  var n = 0;
  return hooks.siteCheckOf(fakeFb({}), 'qa-d', { name: 'D' }, page('<section data-rv-section="links">' + many + '</section>'), { forms: null, advisory: { version: 1, waitMs: 2000, fetch: function (u, o) { n++; return stubFetch(u, o); } } }).then(function (r) {
    var u = r.items.filter(function (x) { return x.code === 'links-unchecked'; })[0];
    ok(n === 40 && u && /5 more links were not checked: at most 40 links and pictures from other sites are checked each time/.test(u.lines.join('\n')), 'at most 40 links are asked about; the rest are said not checked', { n: n, u: u });
  });
}));
/* about 40 addresses a check in all, links and pictures together (it was 40 of each: 80) */
pending.push(Promise.all(pending).then(function () {
  LC._reset();
  var many = '';
  for (var i = 0; i < 30; i++) many += '<a href="https://l' + i + '.example/">Link ' + i + '</a><img src="https://p' + i + '.example/a.jpg" alt="p">';
  var heads = [];
  return hooks.siteCheckOf(fakeFb({}), 'qa-d2', { name: 'D' }, page('<section data-rv-section="links">' + many + '</section>'), { forms: null, advisory: { version: 1, waitMs: 2000,
    fetch: function (u, o) { heads.push(o.method + ' ' + u); return Promise.resolve({ status: 200, headers: { 'content-type': /p\d+\.example/.test(u) ? 'image/jpeg' : 'text/html' } }); } } }).then(function (r) {
    var u = r.items.filter(function (x) { return x.code === 'links-unchecked'; })[0];
    var links = heads.filter(function (h) { return /\/\/l\d/.test(h); }).length, pics = heads.filter(function (h) { return /\/\/p\d/.test(h); }).length;
    ok(heads.length === 40 && links === 20 && pics === 20 && heads.every(function (h) { return /^HEAD /.test(h); }), '30 links and 30 pictures: 40 asked in all, 20 of each, each by HEAD alone when it answers', { n: heads.length, links: links, pics: pics });
    ok(u && u.title === 'Not every link and picture was checked' && /10 more links were not checked\./.test(u.lines.join('\n')) && /10 more pictures from other sites were not checked: at most 40 links and pictures/.test(u.lines.join('\n')),
      'and the rest of each are said not checked', u);
  });
}));
/* the console's own items have their place to put it right too: the buttons the live page puts right, and ET's
   header and footer (its one-click repair is in the console's site check) */
pending.push(Promise.all(pending).then(function () {
  var P = page('<header data-rv-section="nav" id="nav"><a href="#hero">Home</a></header><section data-rv-section="hero" id="hero"><h1>E</h1></section>' +
    '<section data-rv-section="about" data-rv-key="about-9" id="about"><h2>About</h2><p>Long words to make it not empty for sure here and there.</p><a class="btn" href="#missing-target">Read more</a></section>' +
    '<footer data-rv-section="footer" id="footer"><p>Footer words</p></footer>', 'id="gen" class="microsite rv-generated"');
  return hooks.siteCheckOf(fakeFb({}), 'qa-f', { name: 'F' }, P, {}).then(function (r) {
    var by = {}; r.items.forEach(function (x) { by[x.code] = x; });
    ok(by.buttons && by.buttons.fix && by.buttons.fix[0].where === 'editor' && by.buttons.fix[0].key === 'about-9' && /&section=about-9$/.test(by.buttons.fix[0].href),
      'what the live page puts right links to its section in the site editor', by.buttons);
    ok(by['et-chrome'] && by['et-chrome'].fix && by['et-chrome'].fix[0].where === 'console' && by['et-chrome'].fix[0].href === '/edit-event.html?event=qa-f#dashboard' &&
      /Update this site’s header and footer/.test(by['et-chrome'].fix[0].label), 'ET\'s header and footer link to the console, where its one-click repair is', by['et-chrome']);
  });
}));
/* the wait counts from when the request came in: reading the event first does not add to it */
pending.push(Promise.all(pending).then(function () {
  LC._reset();
  var never = function () { return new Promise(function () {}); };
  var t0 = Date.now();
  return hooks.siteCheckOf(fakeFb({}), 'qa-g', { name: 'G' }, page('<section data-rv-section="l"><h2>L</h2><a href="https://hang.example/">Hang</a></section>'),
    { forms: null, advisory: { version: 1, waitMs: 1500, since: Date.now() - 1200, fetch: never } }).then(function (r) {
    var ms = Date.now() - t0;
    ok(ms < 900 && r.pending === 1, 'a request 1.2 s old with a wait of 1.5 s waits about 0.3 s more, not 1.5 s', { ms: ms, pending: r.pending });
  });
}));
/* the forms are read while other sites are asked, not before */
pending.push(Promise.all(pending).then(function () {
  LC._reset();
  var started = 0, formsAsked = 0;
  var slowForms = new Promise(function (r) { setTimeout(function () { formsAsked = Date.now(); r(FORMS); }, 400); });
  return SA.check(PAGE, { kit: kit, eventId: 'qa-h', event: EVENT, forms: slowForms, version: 1, waitMs: 2000,
    fetch: function (u, o) { if (!started) started = Date.now(); return stubFetch(u, o); } }).then(function (r) {
    ok(started && formsAsked && started < formsAsked && r.items.some(function (x) { return x.code === 'forms-off'; }), 'other sites are asked while the forms are still being read, and the forms are still checked', { started: started, formsAsked: formsAsked });
  });
}));
/* the existing items gain their places too */
pending.push(Promise.all(pending).then(function () {
  return hooks.siteCheckOf(fakeFb({}), 'qa-e', { name: 'E' }, page('<section data-rv-section="faq" data-rv-key="faq-1"><h2>FAQ</h2><h3>Question goes here?</h3><p>Answer goes here.</p></section>'), {}).then(function (r) {
    var ph = r.items.filter(function (x) { return x.code === 'placeholders'; })[0];
    ok(ph && ph.level === 'block' && ph.fix && ph.fix[0].key === 'faq-1' && ph.fix[0].label === '“Faq” in the site editor' && /&section=faq-1$/.test(ph.fix[0].href), 'template text (still a block, as before) links to its section', ph);
  });
}));

/* ---------- 3. the address guard, through link-check.js and the real safe-fetch.js ---------- */
var secretHits = 0;
var helper = http.createServer(function (req, res) {
  if (req.url === '/secret') { secretHits++; res.writeHead(200); return res.end('INTERNAL'); }
  if (req.url === '/to-metadata') { res.writeHead(302, { Location: 'http://169.254.169.254/computeMetadata/v1/' }); return res.end(); }
  if (req.url === '/to-internal') { res.writeHead(301, { Location: 'http://metadata.google.internal/' }); return res.end(); }
  if (req.url === '/to-private-name') { res.writeHead(302, { Location: 'https://intranet.example/' }); return res.end(); }
  if (req.url === '/fine') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(req.method === 'HEAD' ? undefined : 'ok'); }
  res.writeHead(404); res.end();
});
pending.push(Promise.all(pending).then(function () {
  return new Promise(function (r) { helper.listen(0, '127.0.0.1', r); });
}).then(function () {
  LC._reset();
  var lookup = function (host, o, cb) { cb(null, [{ address: host === 'intranet.example' ? '10.1.2.3' : host === 'private.example' ? '192.168.0.9' : '93.184.216.34', family: 4 }]); };
  var fo = { lookup: lookup, _connectTo: function () { return { address: '127.0.0.1', port: helper.address().port }; } };
  var list = ['http://127.0.0.1/secret', 'http://169.254.169.254/latest/meta-data/', 'http://metadata.google.internal/', 'http://[::1]/secret', 'http://10.0.0.8/secret',
    'https://private.example/secret', 'http://public.example/to-metadata', 'http://public.example/to-internal', 'http://public.example/to-private-name', 'http://public.example/fine'];
  return LC.check(list.map(function (u) { return { url: u }; }), { key: 'guard', waitMs: 8000, fetchOptions: fo }).then(function (r) {
    var by = {}; r.results.forEach(function (x) { by[x.url] = x; });
    var refused = list.slice(0, 9).filter(function (u) { return by[u] && by[u].state === 'broken' && /private or internal network/.test(by[u].why); });
    ok(refused.length === 9, 'loopback, link-local (metadata), internal names, private ranges and names resolving to them, before and after a redirect: refused, said as a link visitors cannot open', r.results);
    ok(secretHits === 0, 'and nothing inside our network was ever reached', secretHits);
    ok(by['http://public.example/fine'] && by['http://public.example/fine'].state === 'ok', 'a public site answers as usual through the same guard', by['http://public.example/fine']);
  });
}).then(function () { helper.close(); }, function (e) { helper.close(); throw e; }));

Promise.all(pending).then(function () {
  /* wait for every chained check */
  return new Promise(function (r) { setTimeout(r, 50); });
}).then(function () {
  if (failures.length) {
    console.error(failures.length + ' of ' + checks + ' checks FAILED:\n');
    failures.forEach(function (f) { console.error('  - ' + f + '\n'); });
    process.exit(1);
  }
  console.log('site-advisory: all ' + checks + ' checks passed');
  process.exit(0);
}, function (e) { console.error('site-advisory test crashed: ' + (e && e.stack || e)); process.exit(1); });
