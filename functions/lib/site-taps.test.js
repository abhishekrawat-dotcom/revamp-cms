/* node functions/lib/site-taps.test.js — tap targets on a phone on every published and previewed site (UX-002
   screen-size sweep: an imported award site had 49 controls under 40px at 390px, the AI-designed sites 18 to 20).
   No network, no Firebase, no browser: the browser checks were made on the harness (see the batch's report).
     1. plan(): how far each side of a small control may grow — to 40px where there is room, never past 4px short of
        another control's middle (a dense list, a row of carousel dots), never past the window's sides or the page's
        end, the need shared between two sides and rounded up in half pixels;
     2. the script as pages carry it (site-a11y.js TAPS_JS): ES5, no comments, nothing that could end its <script>, and
        it only waits for the page when it runs in one (nothing runs when Node loads it);
     3. the page pass writes it into every kind of page (template, AI-designed, imported) once, afresh on every run,
        so /e/<id> gives it to a site published before it existed; an AI-designed site also gets its "Read more" rule;
        a fragment with no <head> or <body> gets nothing.
   Exits 1 listing every failure. */
'use strict';
var fs = require('fs'), path = require('path');
var T = require('../../templates/_shared/rv-taps.js');
var A11y = require('./site-a11y');
var hooks = require('./api')._testHooks;

var failures = [], checks = 0;
function check(label, cond, detail) { checks++; if (!cond) failures.push(label + (detail !== undefined ? '\n      ' + JSON.stringify(detail).slice(0, 600) : '')); }
function box(l, t, w, h) { return { l: l, t: t, r: l + w, b: t + h }; }
var PAGE = { w: 390, h: 10000 };

/* ---------- 1. plan() ---------- */
var g = T.plan(box(100, 500, 92, 17), [], PAGE);
check('a lone 17px link ("NOMINATE") grows 11.5px above and below, to 40px, and not sideways', g.top === 11.5 && g.bottom === 11.5 && g.left === 0 && g.right === 0, g);
g = T.plan(box(100, 500, 92, 19.5), [], PAGE);
check('a 19.5px link comes to at least 40 (half pixels rounded up: 10.5 + 10)', g.top + g.bottom >= 20.5 && g.top + g.bottom <= 21, g);
g = T.plan(box(100, 500, 40, 40), [], PAGE);
check('a 40px control is left alone', g.top === 0 && g.bottom === 0 && g.left === 0 && g.right === 0, g);
g = T.plan(box(100, 500, 16, 16), [], PAGE);
check('a 16px icon link grows 12px on every side', g.top === 12 && g.bottom === 12 && g.left === 12 && g.right === 12, g);
/* a list of 16px links 24px apart (8px gaps), as the ET footer and an imported footer have */
var list = [0, 1, 2].map(function (i) { return box(20, 1000 + i * 24, 90, 16); });
g = T.plan(list[1], [list[0], list[2]], PAGE);
check('a link in a list 24px apart reaches 40px (12px each way), up to 4px short of its neighbours\' middles', g.top === 12 && g.bottom === 12, g);
var tight = [0, 1, 2].map(function (i) { return box(20, 1000 + i * 20, 90, 16); });
g = T.plan(tight[1], [tight[0], tight[2]], PAGE);
check('in a list 20px apart it stops 4px short of each neighbour\'s middle (8px each way), so a tap on a neighbour\'s words stays the neighbour\'s',
  g.top === 8 && g.bottom === 8, g);
/* carousel dots: 8px wide, 16px apart */
var dots = [0, 1, 2, 3].map(function (i) { return box(100 + i * 16, 2000, 8, 8); });
g = T.plan(dots[1], [dots[0], dots[2], dots[3]], PAGE);
check('a carousel dot grows to 40px tall but only 8px each side, as its neighbours\' middles are 16px apart', g.top === 16 && g.bottom === 16 && g.left === 8 && g.right === 8, g);
g = T.plan(box(2, 500, 16, 16), [], PAGE);
check('at the window\'s left edge it grows no further left than the edge, and the rest goes right', g.left === 2 && g.right === 22, g);
g = T.plan(box(380, 500, 8, 16), [], PAGE);
check('at the right edge, no further right than the window', g.right === 2 && g.left === 30, g);
g = T.plan(box(20, 9990, 90, 10), [], PAGE);
check('at the end of the page it does not make the page longer (all of the growth above)', g.bottom === 0 && g.top === 30, g);
g = T.plan(box(20, 4, 90, 16), [], PAGE);
check('at the top of the page, no further up than the top', g.top === 4 && g.bottom === 20, g);
g = T.plan(box(20, 500, 300, 20), [box(250, 505, 10, 10)], PAGE);
check('a control whose middle is inside this one (an icon in a card link) does not hold it back', g.top === 10 && g.bottom === 10, g);
g = T.plan(box(20, 500, 90, 16), [box(20, 520, 90, 16)], PAGE);
check('a neighbour right under it (its middle 12px below) leaves 8px of growth below; the rest goes above', g.bottom === 8 && g.top === 16, g);
var s = T.split(7.4, 99, 99);
check('split(): half pixels, rounded up (7.4 -> 4 + 3.5)', s[0] === 4 && s[1] === 3.5, s);
s = T.split(24, 3.7, 99);
check('split(): a side with 3.7px of room takes 3.5, never more than its room', s[0] === 3.5 && s[1] === 20.5, s);

/* ---------- 2. the script as pages carry it ---------- */
var JS = A11y.TAPS_JS, SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'templates', '_shared', 'rv-taps.js'), 'utf8');
check('the page pass has the script', JS.length > 2000 && /RevampTaps/.test(JS));
var parses = true; try { new Function(JS); } catch (e) { parses = false; }
check('without its comments it still parses', parses);
check('no comments and no indentation go to every visitor\'s phone', JS.indexOf('/*') === -1 && !/^\s/m.test(JS));
check('nothing in it could end its <script> early', !/<\/script/i.test(JS));
var code = SRC.replace(/\/\*[\s\S]*?\*\//g, '');
check('ES5: no arrow functions, let, const, classes or template strings', !/=>|\blet\s|\bconst\s|\bclass\s|`/.test(code), (code.match(/=>|\blet\s|\bconst\s|\bclass\s|`/) || [])[0]);
check('it is a phone\'s rule, at the width where a site\'s ET bar takes its phone layout', T.PHONE === '(max-width: 860px)' && T.MIN === 40);
check('the site editor never loads it (only the publish and serve pass writes it into a page)',
  ['custom_editor.html', 'editor-template-ui.js', 'editor-ai-mode.js'].every(function (f) { return fs.readFileSync(path.join(__dirname, '..', '..', f), 'utf8').indexOf('rv-taps') === -1; }));
check('it never writes a width or a height (a size the page changes later is still the page\'s)', !/set\('(width|height)'/.test(code));
check('what it grows is checked after and put back if anything moved or it did not grow', /function moved\(t\)/.test(code) && /'no room'/.test(code) && /undo\(t\.el\)/.test(code));
check('it runs again when the window changes size, when parts are added and when a class changes', /'resize'/.test(code) && /childList: true/.test(code) && /attributeFilter: \['class'\]/.test(code));

/* ---------- 3. the page pass ---------- */
function count(h, s) { return h.split(s).length - 1; }
var HEAD = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>X</title></head>';
var gen = HEAD + '<body id="gen" data-rv-template-id="gen-qa-x" class="microsite rv-generated"><section data-rv-section="hero" id="hero"><h1>X</h1>' +
  '<details><summary class="overview-summary">Read more</summary><p>More</p></details></section></body></html>';
var tpl = HEAD + '<body data-rv-template-id="tech500"><div class="col-md-12 no-padding"><section id="banner"><h1>X</h1><a href="#r">Register</a></section></div></body></html>';
var imp = HEAD + '<body id="imported" class="microsite imported-microsite"><main class="flex-1"><section><h1>X</h1><a class="inline-flex" href="#n">NOMINATE</a></section></main></body></html>';
var opts = function (t) { return { mode: 'live', event: { name: 'X' }, templateId: t }; };
var G = hooks.sitePagePass(gen, opts('gen-qa-x')), P = hooks.sitePagePass(tpl, opts('tech500')), I = hooks.sitePagePass(imp, opts('imported-imp-x'));
[['an AI-designed site', G], ['a template site', P], ['an imported site', I]].forEach(function (k) {
  check(k[0] + ' carries the tap script once, in its <head>', count(k[1], '<script data-rv-a11y>') === 1 && k[1].indexOf('<script data-rv-a11y>') < k[1].indexOf('</head>'), k[1].slice(0, 200));
});
check('the pass on its own output changes nothing (as /e/ serves a page already published with it)',
  hooks.sitePagePass(G, opts('gen-qa-x')) === G && hooks.sitePagePass(I, opts('imported-imp-x')) === I && hooks.sitePagePass(P, opts('tech500')) === P);
var stale = I.replace(/<script data-rv-a11y>[\s\S]*?<\/script>/, '<script data-rv-a11y>/* an older copy */</script>');
check('a page published with an older copy gets this one in its place', hooks.sitePagePass(stale, opts('imported-imp-x')) === I);
check('an AI-designed site\'s "Read more" is 40px on a phone, its words in the middle, in the pass\'s one style block',
  G.indexOf(A11y.GEN_TAP_CSS) !== -1 && count(G, '<style data-rv-a11y>') === 1 &&
  /@media \(max-width:860px\)\{body\.rv-generated \[data-rv-section\] summary\{min-height:40px;align-content:center\}\}/.test(A11y.GEN_TAP_CSS));
check('that rule is only on AI-designed sites', P.indexOf(A11y.GEN_TAP_CSS) === -1 && I.indexOf(A11y.GEN_TAP_CSS) === -1);
check('an imported page keeps its own tags: only the script is added to its <head>', I.indexOf('<a class="inline-flex" href="#n">NOMINATE</a>') !== -1);
var frag = hooks.sitePagePass('<section><a href="#x">x</a></section>', opts('gen-qa-x'));
check('a fragment with no <head> or <body> gets nothing', frag.indexOf('RevampTaps') === -1, frag.slice(0, 200));
/* the live serving path: a page published before the pass runs it on its way out (handlePublicPage) */
var live = hooks.publishTransform(gen, { eventId: 'qa-x', event: { name: 'X' }, mode: 'live', templateId: 'gen-qa-x', publicBase: 'https://sites.example' });
check('publishing writes it into the live page too', count(live, '<script data-rv-a11y>') === 1);

if (failures.length) { console.error('site-taps: ' + failures.length + ' of ' + checks + ' checks failed:\n  - ' + failures.join('\n  - ')); process.exit(1); }
console.log('site-taps: all ' + checks + ' checks passed');
