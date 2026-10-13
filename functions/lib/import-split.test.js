/* node functions/lib/import-split.test.js — exits 1 on the first failure it lists. No network, no Firebase. */
const { splitImportedPage } = require('./import-split');

var failures = [], checks = 0;
function ok(cond, label, detail) { checks++; if (!cond) failures.push(label + (detail ? '\n      ' + detail : '')); }
function ids(r) { return r ? r.sections.map(function (s) { return s.id; }).join(',') : 'null'; }
function whole(r) { return r.frameOpen + r.decor + r.sections.map(function (s) { return s.html; }).join('') + r.frameClose; }

/* a plain page: wrappers, a curtain, header, sections, footer */
var plain = '<div id="root"><div class="min-h-screen app"><div aria-hidden="true" class="fixed inset-0 curtain"></div>' +
  '<header class="bar"><a href="#a">Home</a></header>' +
  '<div id="top"><h1>Big Event 2027</h1><p>Mumbai</p></div>' +
  '<section id="about"><h2>About the <br>event</h2><p>Text</p></section>' +
  '<div class="h-10"></div>' +
  '<section><h2>Why Attend</h2><p>Reasons</p></section>' +
  '<div aria-hidden="true" class="strip"><img src="s.png" alt=""></div>' +
  '<footer><p>© ET</p></footer></div></div>';
var r = splitImportedPage(plain);
ok(ids(r) === 'nav,hero,about,why-attend,footer', 'sections where the author cut the page', ids(r));
ok(r.frameOpen === '<div class="rv-imported"><div id="root"><div class="min-h-screen app">' && r.frameClose === '</div></div></div>', 'the wrappers are the frame', r.frameOpen + ' … ' + r.frameClose);
ok(/curtain/.test(r.decor) && !/strip/.test(r.decor), 'an empty curtain is frame decor; a picture strip is not', r.decor);
ok(/class="h-10"/.test(r.sections[3].html) && /^<div data-rv-wrap>/.test(r.sections[3].html), 'a spacer rides with the section after it, in one root', r.sections[3].html.slice(0, 80));
ok(/class="strip"/.test(r.sections[4].html), 'a decorative picture stays in place, with the block after it', r.sections[4].html.slice(0, 80));
ok(r.sections[2].name === 'About the event', 'a name reads across a line break', r.sections[2].name);
ok(r.sections.every(function (s) { return (s.html.match(/^<[a-z]+/) || []).length === 1; }), 'every section starts with one root');
ok(whole(r).replace(/<div data-rv-wrap>|<\/div>/g, '').length > 0 && ['Home', 'Big Event 2027', 'Why Attend', '© ET'].every(function (t) { return whole(r).indexOf(t) !== -1; }), 'nothing of the page is lost');

/* sections behind <main> and a theme wrapper: opened up, each carrying copies of the wrappers */
var nested = '<div class="shell"><header><b>Brand</b></header><main class="flex-1"><div class="theme-dark min-h-screen">' +
  '<div aria-hidden="true" class="backdrop"></div>' +
  '<section id="one"><h2>One</h2></section><section id="two"><h2>Two</h2></section><section id="three"><h2>Three</h2></section>' +
  '</div></main><footer><p>End</p></footer></div>';
var n = splitImportedPage(nested);
ok(ids(n) === 'nav,one,two,three,footer', 'a holder of sections is opened up', ids(n));
ok(/^<div class="flex-1" data-rv-wrap><div class="theme-dark min-h-screen" data-rv-wrap>/.test(n.sections[1].html), 'its wrappers go around each section', n.sections[1].html.slice(0, 120));
ok(/class="backdrop"/.test(n.sections[1].html) && !/backdrop/.test(n.decor), 'a backdrop inside the holder stays inside a copy of it');
ok(!/data-rv-wrap/.test(n.sections[0].html), 'a section that had no wrapper gets none');

/* the builder's badge is not a section; ids are unique and never "imported" */
var badge = '<main><section id="imported"><h2>A</h2></section><section id="imported"><h2>B</h2></section><aside id="lovable-badge"><a>Edit with Lovable</a></aside></main>';
var b = splitImportedPage(badge);
ok(ids(b) === 'imported-2,imported-3', 'ids are unique and the badge is dropped', ids(b));
ok(whole(b).indexOf('lovable-badge') === -1, 'no badge in what comes out');

/* pages that cannot be cut */
ok(splitImportedPage('<div><section><h1>Only one</h1><p>text</p></section></div>') === null, 'one block: not cut');
ok(splitImportedPage('') === null, 'nothing: not cut');
ok(splitImportedPage('<p>just words</p>') === null, 'no structure: not cut');

/* a very long page is bounded */
var long = '<main>' + new Array(60).join('<section><h2>Part</h2><p>x</p></section>') + '</main>';
var l = splitImportedPage(long);
ok(l && l.sections.length === 40 && (whole(l).match(/<h2>Part<\/h2>/g) || []).length === 59, 'at most 40 sections, with the rest kept in the last', l && l.sections.length);

if (failures.length) {
  console.log(failures.length + ' of ' + checks + ' checks FAILED:\n\n  - ' + failures.join('\n  - '));
  process.exit(1);
}
console.log('import-split: all ' + checks + ' checks passed');
