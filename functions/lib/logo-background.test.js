/* node functions/lib/logo-background.test.js — a banner's background picture is never taken for the event's logo (the
   owner, 19 Nov 2026, on TechGig Pro: "when I have created this website no logo was added"). Its previous edition page,
   techgig.com/devnext, has its skyline as img.hero__background-image, the first picture of the hero; it scored above the
   real logo (finallogodevnext.svg) and became the "logo unit" — a photograph with no lettering in it.
   Checks: the background is ruled out (and a class that also says logo is not), the real logo comes first; a candidate
   read with no lettering is passed over for the next; a unit examined before the fix is examined again; and the owner is
   told when the logo taken does not name the event. No network. Exits 1 on any failure. */
'use strict';
var fs = require('fs'), path = require('path');
var L = require('./logo-unit');
var passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; return; }
  failed++;
  process.stderr.write('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail).slice(0, 400) : '') + '\n');
}

/* DevNext's hero as the page has it: the background first, the logo after it */
var devnext = '<html><body><header class="site-header"><img src="https://st.etb2bimg.com/Themes/Release/theme4/images/logos/techgig-logo.svg"></header>' +
  '<section class="hero"><img class="hero__background-image" src="https://img.etb2bimg.com/files/cp/06c81d2a9373c8f0f36b.jpg" alt="">' +
  '<div class="hero__content"><img src="https://img.etb2bimg.com/files/cp/upload-1782290063-finallogodevnext.svg" alt="">' +
  '<h1>Developer Conference Hyderabad</h1><p class="date">21-23 Nov</p><a class="btn">Register</a></div></section></body></html>';
var c = L.findLogoCandidates(devnext, 'https://techgig.com/devnext', 'TechGig Pro');
check('the banner\'s background picture is not a candidate', !c.some(function (x) { return /06c81d2a9373c8f0f36b/.test(x.url); }), c);
check('the real logo comes first', c[0] && /finallogodevnext\.svg$/.test(c[0].url), c);

var other = ['hero-bg', 'banner-bg-image', 'bg', 'background', 'hero__background', 'section-backdrop', 'cover-image', 'parallax'];
other.forEach(function (cls) {
  var html = '<section class="hero"><img class="' + cls + '" src="https://example.org/a/bg.png"><img src="https://example.org/a/logo.svg"><h1>X</h1></section>';
  var got = L.findLogoCandidates(html, 'https://example.org/event', 'Example Summit');
  check('class "' + cls + '": not a candidate', !got.some(function (x) { return /bg\.png$/.test(x.url); }), got);
});
var boxed = '<section class="hero"><div class="hero-background"><img src="https://example.org/a/sky.jpg"></div><img src="https://example.org/a/logo.png"><h1>X</h1></section>';
check('a picture in a box classed as the background: not a candidate', !L.findLogoCandidates(boxed, 'https://example.org/event', 'Example Summit').some(function (x) { return /sky\.jpg$/.test(x.url); }));
var logoBg = '<section class="hero"><img class="event-logo logo-bg-white" src="https://example.org/a/logo.png"><h1>X</h1></section>';
check('a class that says logo as well stays a candidate (logo-bg-white)', L.findLogoCandidates(logoBg, 'https://example.org/event', 'Example Summit').some(function (x) { return /logo\.png$/.test(x.url); }));
var plain = '<section class="hero"><img class="hero-logo" src="https://example.org/a/logo.png"><h1>X</h1></section>';
check('an ordinary hero logo is unaffected', (L.findLogoCandidates(plain, 'https://example.org/event', 'Example Summit')[0] || {}).url === 'https://example.org/a/logo.png');

/* the examination: no lettering means the next candidate; units examined before are examined again; the owner is told */
var API = fs.readFileSync(path.join(__dirname, 'api.js'), 'utf8');
var GEN = fs.readFileSync(path.join(__dirname, 'api-generate.js'), 'utf8');
check('the first reading of a candidate says whether it has any lettering', /if \(r && !readings\+\+\) \{ lettering = String\(r\.allText \|\| ''\); blank = !\/\[A-Za-z0-9\\u00C0-\\uFFFF\]\/\.test\(lettering\); \}/.test(API) &&
  /blank: blank, lettering: lettering \};/.test(API));
check('a candidate with no lettering is passed over for the next one', /if \(ex\.blank && !ex\.unread\) \{/.test(GEN) && /return examineFrom\(got\.at \+ 1\);/.test(GEN) && /return examineFrom\(0\)\.then\(function \(found\) \{/.test(GEN));
check('a unit examined before the fix (TechGig Pro\'s skyline) is examined again', /var cacheKey = 'v2\|' \+ candidates\.map/.test(GEN));
check('the owner is told when the logo taken does not name the event', /!logoUnit\.sharesWord\(ex\.lettering, nameWords\)/.test(GEN) && /which does not name ' \+ o\.eventMeta\.name/.test(GEN));
check('…by words that are the event\'s own', JSON.stringify(L.distinctiveWords('TechGig Pro')) === '["techgig","pro"]' && !L.sharesWord('DevNext 2026', ['techgig', 'pro']) && L.sharesWord('TechGig Pro 2026', ['techgig', 'pro']));

process.stdout.write('logo-background: ' + passed + ' passed, ' + failed + ' failed\n');
process.exit(failed ? 1 : 0);
