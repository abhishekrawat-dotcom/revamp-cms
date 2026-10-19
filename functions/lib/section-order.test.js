// node functions/lib/section-order.test.js — this edition's sponsors straight after the hero, and the top
// bar's links in the page's order.
const so = require('./section-order');

var passed = 0, failed = 0;
function check(name, ok, detail) { if (ok) { passed++; return; } failed++; console.error('FAIL ' + name + (detail ? ' — ' + detail : '')); }
function ids(list) { return list.map(function (s) { return s.id; }).join(','); }

/* brand-world-summit-2026's plan as stored */
var BWS = [
  { id: 'overview', kind: 'custom' }, { id: 'sponsors', kind: 'partners' }, { id: 'key-discussion-points', kind: 'custom' },
  { id: 'agenda', kind: 'sessions' }, { id: 'resources', kind: 'custom' }, { id: 'why-join-us', kind: 'custom' },
  { id: 'who-should-attend', kind: 'custom' }, { id: 'faqs', kind: 'faq' },
  { id: 'previous-speakers', kind: 'custom', prebuilt: 'speakers' }, { id: 'previous-agenda', kind: 'custom', prebuilt: 'agenda' },
  { id: 'previous-sponsors', kind: 'custom', prebuilt: 'sponsors' }, { id: 'previous-glimpses', kind: 'custom', prebuilt: 'glimpses' },
  { id: 'contact-us', kind: 'contact' }, { id: 'about-vertical', kind: 'custom' }
];

/* ---- the plan ---- */
var moved = so.sponsorsFirst(BWS);
check('sponsors, then the previous edition\'s sponsors, move to the top of the plan', ids(moved) === 'sponsors,previous-sponsors,overview,key-discussion-points,agenda,resources,why-join-us,who-should-attend,faqs,previous-speakers,previous-agenda,previous-glimpses,contact-us,about-vertical', ids(moved));
check('the plan given is not changed', ids(BWS).indexOf('overview,sponsors') === 0);
check('the same objects, none lost or added', moved.length === BWS.length && BWS.every(function (s) { return moved.indexOf(s) !== -1; }));
check('applying the rule twice changes nothing', ids(so.sponsorsFirst(moved)) === ids(moved));
check('already first: unchanged', ids(so.sponsorsFirst([{ id: 'sponsors', kind: 'partners' }, { id: 'overview' }])) === 'sponsors,overview');

var noSponsors = BWS.filter(function (s) { return s.id !== 'sponsors'; });
check('no sponsors section of this edition: the previous edition\'s sponsors open the page alone', ids(so.sponsorsFirst(noSponsors)) === 'previous-sponsors,' + ids(noSponsors.filter(function (s) { return s.id !== 'previous-sponsors'; })), ids(so.sponsorsFirst(noSponsors)));
var noneAtAll = noSponsors.filter(function (s) { return s.id !== 'previous-sponsors'; });
check('no sponsors of either edition: nothing moves', ids(so.sponsorsFirst(noneAtAll)) === ids(noneAtAll));
check('the previous edition\'s sponsors are found by prebuilt, and by id on a stored page', so.previousSponsorsId(BWS) === 'previous-sponsors' && so.previousSponsorsId([{ id: 'previous-sponsors', kind: 'custom' }]) === 'previous-sponsors' && so.previousSponsorsId([{ id: 'sponsors', kind: 'partners' }]) === '');
check('only the other sections keep their order', ids(moved.filter(function (s) { return !/sponsors/.test(s.id); })) === ids(BWS.filter(function (s) { return !/sponsors/.test(s.id); })));
check('previous-sponsors is never taken for this edition\'s', so.sponsorsId(noSponsors) === '');
check('a prebuilt section of kind partners is not taken either', so.sponsorsId([{ id: 'x', kind: 'partners', prebuilt: 'sponsors' }]) === '');
check('past-partners by name is not taken', so.sponsorsId([{ id: 'past-partners', kind: 'custom' }]) === '');
check('"become a partner" is a call to action, not the list', so.sponsorsId([{ id: 'become-a-partner', kind: 'custom' }, { id: 'partnership-opportunities', kind: 'custom' }]) === '');
check('a "partners" kind under any id is the list', so.sponsorsId([{ id: 'overview' }, { id: 'in-good-company', kind: 'partners' }]) === 'in-good-company');
check('a custom section named partners is the list', so.sponsorsId([{ id: 'overview' }, { id: 'our-partners', kind: 'custom' }]) === 'our-partners');
check('sponsors-and-partners by name', so.sponsorsId([{ id: 'sponsors-and-partners', kind: 'custom' }]) === 'sponsors-and-partners');
check('the kind wins over a name further up', so.sponsorsId([{ id: 'partners', kind: 'custom' }, { id: 'ecosystem', kind: 'partners' }]) === 'ecosystem');
check('only the first sponsors section moves', ids(so.sponsorsFirst([{ id: 'a' }, { id: 's1', kind: 'partners' }, { id: 's2', kind: 'partners' }])) === 's1,a,s2');
check('nothing given: an empty list', so.sponsorsFirst(undefined).length === 0 && so.sponsorsId(null) === '');

/* ---- the page ---- */
var page = ['nav', 'hero'].concat(BWS.map(function (s) { return s.id; })).concat(['footer']).map(function (id) {
  var p = BWS.filter(function (s) { return s.id === id; })[0];
  return { id: id, kind: p ? (p.prebuilt ? 'custom' : p.kind) : id, html: '<section id="' + id + '"></section>' };
});
var pageMoved = so.sponsorsAfterHero(page, BWS);
check('on the page, sponsors then the previous edition\'s right after the hero', ids(pageMoved) === 'nav,hero,sponsors,previous-sponsors,overview,key-discussion-points,agenda,resources,why-join-us,who-should-attend,faqs,previous-speakers,previous-agenda,previous-glimpses,contact-us,about-vertical,footer', ids(pageMoved));
check('page: idempotent', ids(so.sponsorsAfterHero(pageMoved, BWS)) === ids(pageMoved));
check('page: found without the plan too (stored sections carry no prebuilt flag)', ids(so.sponsorsAfterHero(page)) === ids(pageMoved), ids(so.sponsorsAfterHero(page)));
var pageNone = page.filter(function (s) { return !/sponsors/.test(s.id); });
check('page: no sponsors of either edition, nothing moves', ids(so.sponsorsAfterHero(pageNone, noneAtAll)) === ids(pageNone));
check('page: the previous edition\'s alone come under the hero', ids(so.sponsorsAfterHero(page.filter(function (s) { return s.id !== 'sponsors'; }), noSponsors)).indexOf('nav,hero,previous-sponsors,overview,') === 0);
check('page with no hero: after the nav', ids(so.sponsorsAfterHero([{ id: 'nav' }, { id: 'overview' }, { id: 'sponsors', kind: 'partners' }, { id: 'footer' }])) === 'nav,sponsors,overview,footer');
check('page with neither: first', ids(so.sponsorsAfterHero([{ id: 'overview' }, { id: 'sponsors', kind: 'partners' }])) === 'sponsors,overview');
check('sponsors above the hero come down under it', ids(so.sponsorsAfterHero([{ id: 'nav' }, { id: 'sponsors', kind: 'partners' }, { id: 'hero' }, { id: 'overview' }])) === 'nav,hero,sponsors,overview');
check('the plan names a sponsors section the page lacks: the page\'s own is used', ids(so.sponsorsAfterHero([{ id: 'hero' }, { id: 'overview' }, { id: 'partners', kind: 'partners' }], [{ id: 'sponsors', kind: 'partners' }])) === 'hero,partners,overview');

/* ---- the top bar ---- */
var NAV = '<nav id="nav" class="nav-root" aria-label="Main"><div class="nav-inner"><a href="#hero" data-rv-et-logo-link style="display:inline-block"><img data-rv-et-logo src="/x.svg" alt="ET"></a><div class="nav-logo-space" aria-hidden="true"></div><ul class="nav-links"><li><a class="nav-link" href="#overview">Overview</a></li><li><a class="nav-link" href="#agenda">Agenda</a></li><li><a class="nav-link" href="#why-join-us">Why Attend</a></li><li><a class="nav-link" href="#sponsors">Partners</a></li><li><a class="nav-link" href="#contact-us">Contact</a></li></ul><a class="nav-btn" href="#why-join-us">Register Now</a></div></nav>';
var navOut = so.orderNavLinks(NAV, ids(pageMoved).split(','));
function hrefs(html) { return (html.match(/href="#[^"]*"/g) || []).map(function (h) { return h.slice(7, -1); }).join(','); }
check('nav links follow the page: Partners first', hrefs(navOut) === 'hero,sponsors,overview,agenda,why-join-us,contact-us,why-join-us', hrefs(navOut));
check('nav: only the order changed (same length, same items)', navOut.length === NAV.length && navOut.indexOf('<li><a class="nav-link" href="#sponsors">Partners</a></li><li><a class="nav-link" href="#overview">Overview</a></li>') !== -1);
check('nav: the logo link and the button stay where they were', navOut.indexOf('<a href="#hero" data-rv-et-logo-link') === NAV.indexOf('<a href="#hero" data-rv-et-logo-link') && /<\/ul><a class="nav-btn" href="#why-join-us">Register Now<\/a><\/div><\/nav>$/.test(navOut));
check('nav: idempotent', so.orderNavLinks(navOut, ids(pageMoved).split(',')) === navOut);
check('nav: in order already, unchanged', so.orderNavLinks(NAV, ['nav', 'hero', 'overview', 'agenda', 'why-join-us', 'sponsors', 'contact-us', 'footer']) === NAV);

var TWO_ROWS = '<nav id="nav"><div class="bar">\n  <a href="#overview">Overview</a>\n  <a href="#sponsors">Sponsors</a>\n  <a href="https://example.com/past">Past</a>\n  <a href="#agenda">Agenda</a>\n</div><details><summary>Menu</summary><ul>\n<li><a href="#agenda">Agenda</a></li>\n<li class="m"><a href="#sponsors">Sponsors</a></li>\n</ul></details></nav>';
var two = so.orderNavLinks(TWO_ROWS, ['nav', 'hero', 'sponsors', 'overview', 'agenda', 'footer']);
check('nav: each row (bar, mobile menu) is ordered on its own', hrefs(two) === 'sponsors,overview,agenda,sponsors,agenda', hrefs(two));
check('nav: a link elsewhere keeps its place in the row', two.indexOf('Overview</a>\n  <a href="https://example.com/past">Past</a>\n  <a href="#agenda">') !== -1);
check('nav: the white space between links is kept', /\n  <a href="#sponsors">Sponsors<\/a>\n  <a href="#overview">Overview<\/a>\n  <a href="https:/.test(two));
check('nav: a link to a section the page does not have stays put', hrefs(so.orderNavLinks('<a href="#agenda">A</a><a href="#nowhere">N</a><a href="#sponsors">S</a>', ['sponsors', 'agenda'])) === 'sponsors,nowhere,agenda');
check('nav: a Register button among the links is not moved', hrefs(so.orderNavLinks('<a href="#overview">Overview</a><a href="#contact-us">Register</a><a href="#sponsors">Sponsors</a>', ['sponsors', 'overview', 'contact-us'])) === 'sponsors,contact-us,overview');
check('nav: nothing to order', so.orderNavLinks('', ['a']) === '' && so.orderNavLinks('<nav></nav>', []) === '<nav></nav>');


/* a dropdown in the bar: its <li> holds a link and a nested list; it is never cut in two or merged with another */
var DD = '<ul><li><a href="#agenda">Agenda</a></li><li class="dd"><a href="#overview">About</a><ul><li><a href="#faqs">FAQ</a></li></ul></li><li><a href="#sponsors">Partners</a></li></ul>';
var ddOut = so.orderNavLinks(DD, ['hero', 'sponsors', 'overview', 'agenda', 'faqs']);
check('nav: a dropdown keeps its nesting', (ddOut.match(/<ul>/g) || []).length === 2 && ddOut.indexOf('<a href="#overview">About</a><ul><li><a href="#faqs">FAQ</a></li></ul></li>') !== -1, ddOut);
/* page-sized nav input with no closing tags stays fast (no backtracking blow-up) */
var big = new Array(4000).join('<li><a href="#x">x ') + '<a href="#a">a</a><a href="#b">b</a>';
var t0 = Date.now(); so.orderNavLinks(big, ['b', 'a']);
check('nav: an unclosed 100 KB bar is read in well under a second', Date.now() - t0 < 1000, (Date.now() - t0) + ' ms');

/* ---- as the server reads a stored site (api.js) ---- */
var hooks = require('./api')._testHooks;
var stored = page.map(function (s) { return { id: s.id, kind: s.kind }; });
check('the editor\'s template lists sponsors after the hero for a plan stored in the old order', hooks.generatedPageIds({ sections: BWS }, stored).join(',') === ids(pageMoved), hooks.generatedPageIds({ sections: BWS }, stored).join(','));
check('a section the site lacks is left out, nothing else moves', hooks.generatedPageIds({ sections: BWS }, stored.filter(function (s) { return s.id !== 'agenda'; })).join(',') === ids(pageMoved.filter(function (s) { return s.id !== 'agenda'; })));
/* a standard plan as the model may write it: the server adds the overview first; the rule then puts sponsors above it */
var std = hooks.sanitizeDesignPlanSections({ sections: [{ id: 'agenda' }, { id: 'sponsors' }, { id: 'faqs' }] }, 'standard');
check('a standard plan: overview put first by the sanitiser, sponsors first by the rule', ids(so.sponsorsFirst(std)) === 'sponsors,overview,agenda,faqs', ids(so.sponsorsFirst(std)));

console.log('section-order: ' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
