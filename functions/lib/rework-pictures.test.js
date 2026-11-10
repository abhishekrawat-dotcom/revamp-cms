/* A section rework keeps the section's own background picture (owner, 10 Nov 2026: CISO Secufest's hero went blank
   twice after "reduce the opacity of white overlay a little bit to show the background properly"), and a stylesheet
   never carries url(&quot;…&quot;). lib/api.js keepRootBackground, cssUrlQuotes. Plain node. */
'use strict';
var fs = require('fs'), path = require('path');
var H = require('./api')._testHooks;
var passed = 0, failed = 0;
function check(name, ok, info) { if (ok) passed++; else { failed++; console.log('FAIL ' + name + (info !== undefined ? ' — ' + JSON.stringify(info).slice(0, 400) : '')); } }
var URL1 = 'https://storage.googleapis.com/revamp-cms.firebasestorage.app/events/ciso-secufest-2027/generated/20261110083558-chat-place-FSLGZj1u.png';
var ORIG = '<section data-rv-section="hero" id="hero" class="hero-root hero-on-light" style="background-image: url(&quot;' + URL1 + '&quot;);"><div class="hero-veil"></div><h1>CISO Secufest</h1></section>';
var LOST = '<section id="hero" class="hero-root"><div class="hero-veil"></div><h1>CISO Secufest</h1></section>';
var out = H.keepRootBackground(ORIG, LOST, '.hero-veil{background:rgba(255,255,255,.6)}', 'reduce the opacity of white overlay a little bit to show the background properly');
check('the lost background is put back on the new element', out.indexOf('<section id="hero" class="hero-root" style="background-image: url(&quot;' + URL1 + '&quot;);">') === 0, out);
out = H.keepRootBackground(ORIG, '<section id="hero" class="hero-root" style="min-height: 80vh;"><h1>x</h1></section>', '', 'make the white wash lighter');
check('…beside a style the new element already has', /^<section id="hero" class="hero-root" style="min-height: 80vh; background-image: url\(&quot;https:/.test(out), out);
check('kept as it is when the new HTML still has it', H.keepRootBackground(ORIG, ORIG, '', 'lighter overlay') === ORIG);
var inCss = '<section id="hero"><h1>x</h1></section>';
check('kept as it is when the new CSS has it', H.keepRootBackground(ORIG, inCss, '.hero-root{background-image:url("' + URL1 + '")}', 'lighter overlay') === inCss);
['remove the background picture', 'replace the background with a plain colour', 'use a new background image', 'no background image, just white', 'make the background a solid colour'].forEach(function (t) {
  check('not put back when the owner asked to drop or change it: "' + t + '"', H.keepRootBackground(ORIG, LOST, '', t) === LOST);
});
check('nothing to keep when the section had no background picture of its own', H.keepRootBackground('<section id="x" style="color: red;"><p>a</p></section>', LOST, '', 'lighter') === LOST);
check('a stylesheet\'s url(&quot;…&quot;) is written plainly', H.cssUrlQuotes('.a{background-image:url(&quot;' + URL1 + '&quot;)}') === '.a{background-image:url("' + URL1 + '")}' && H.cssUrlQuotes('.b{color:red}') === '.b{color:red}');
var API = fs.readFileSync(path.join(__dirname, 'api.js'), 'utf8');
check('the section rework uses both, on the original section (before its pictures became tokens)',
  /var pictures = \{\}, origHtml = html;/.test(API) && /newCss = cssUrlQuotes\(genDesign\.restorePictures\(newCss, pictures, found\[0\] \|\| ''\)\);/.test(API) &&
  /if \(mode === 'edit'\) newHtml = keepRootBackground\(origHtml, newHtml, newCss, String\(payload\.instruction \|\| ''\)\);/.test(API));
console.log('rework-pictures: ' + passed + ' passed' + (failed ? ', ' + failed + ' FAILED' : ''));
process.exit(failed ? 1 : 0);
