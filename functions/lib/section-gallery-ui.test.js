/* node functions/lib/section-gallery-ui.test.js — the template gallery in the site editor (the owner, 19 Nov 2026: "Add an
   option in each section to add to template gallary … By adding a section to the template gallary, that section will be
   available globally and easily can be accommodated in any site"): the section pill's "Add to gallery", the design
   already there answered in the dialog, Add section's Template gallery tab, and a gallery section made this site's own.
   Reads editor-template-ui.js, editor-canvas.js and custom_editor.html. No network. Exits 1 on any failure. */
'use strict';
var fs = require('fs'), path = require('path');
var passed = 0, failed = 0;
function check(name, ok) { if (ok) { passed++; return; } failed++; process.stderr.write('FAIL ' + name + '\n'); }
var root = path.join(__dirname, '..', '..');
var ED = fs.readFileSync(path.join(root, 'editor-template-ui.js'), 'utf8');
var CV = fs.readFileSync(path.join(root, 'editor-canvas.js'), 'utf8');
var HTML = fs.readFileSync(path.join(root, 'custom_editor.html'), 'utf8');

check('each section\'s pill has "Add to gallery" where the section can be shared',
  /canAddToGallery\(sec\) \? '<button data-action="gallery-add"/.test(ED) && /action === 'gallery-add'\) \{\n      openGallerySave\(sec\);/.test(ED));
check('…never the banner (the event\'s own, with its logo), ETB2B\'s top bar or footer, a hidden section, one with this event\'s form, or an imported site',
  /if \(!sec \|\| !galleryFamily\(\) \|\| pinnedSection\(sec\) \|\| sec\.classList\.contains\('is-hidden-sec'\)\) return false;/.test(ED) &&
  /=== 'hero' \|\| sec\.classList\.contains\('hero-root'\) \|\| sec\.querySelector\('\.hero-root, \[data-rv-logo-unit\]'\)\) return false;/.test(ED) &&
  /return !sec\.querySelector\('\[data-rv-form-embed\]'\);/.test(ED) && /if \(!id \|\| \/\^imported-\/\.test\(id\)\) return '';/.test(ED));
check('it is saved as the Developer zone shows it, a button for one of this event\'s forms opening the default form instead',
  /var src = devSource\(sec\);/.test(ED) && /a\.removeAttribute\('data-rv-form'\); a\.setAttribute\('data-register-cta', ''\);/.test(ED) &&
  /galleryCall\('POST', '\/api\/section-gallery', \{/.test(ED));
check('a design already in the gallery is answered in the dialog with its name, who added it and when',
  /r\.status === 409 && r\.body\.existing/.test(ED) && /'This design is in the gallery already, as “' \+ r\.body\.existing\.name/.test(ED));
check('Add section has no tab of the gallery\'s own: each design is under the tab of its kind, first, under its own heading (owner, 19 Nov 2026)',
  !/addTab\(GALLERY/.test(HTML) && /var t = api\.galleryTabOf\(item\) \|\| \{\};\n      if \(t\.key && categories\.indexOf\(t\.key\) !== -1\) return t\.key;/.test(HTML) &&
  /if \(drawSaved\(key, false\)\) gridLine\('Ready-made designs', 'variant-group'\);/.test(HTML) && /gridLine\('From the template gallery', 'variant-group'\);/.test(HTML));
check('…a kind Add section has no tab for gets one of its own, after the others; each tab counts its designs',
  /\.forEach\(function\(key\)\{ if \(!tabEl\(key\)\) addTab\(key, gal\.labels\[key\]\); \}\);/.test(HTML) && /Object\.keys\(gal\.byTab\)\.forEach\(markCount\);/.test(HTML) &&
  /if \(key\.indexOf\(KIND\) === 0\)\{ drawSaved\(key, true\); return; \}/.test(HTML));
check('…cards drawn with this site\'s stylesheets in a frame no script runs in',
  /frame\.setAttribute\('sandbox', 'allow-same-origin'\);/.test(HTML) && /frame\.srcdoc = api\.galleryPreviewDoc\(full\);/.test(HTML));
check('saving says which tab of Add section it will be under', /from Add section › ' \+ escHtml\(galleryTabOf\(/.test(ED) && /Add it to any site from Add section › ' \+ galleryTabOf\(/.test(ED));
check('…one made for sites of another design is shown but cannot be added; the person who added it can take it out (twice to confirm)',
  /if \(!fits\)\{ card\.setAttribute\('aria-disabled', 'true'\);/.test(HTML) && /if \(item\.canDelete\)\{/.test(HTML) && /api\.galleryDelete\(item\.id\)/.test(HTML));
check('adding it copies its pictures into this event first (the server), then puts it on the page',
  /galleryCall\('POST', '\/api\/section-gallery\/use', \{ eventId: eventId, id: id \}\)/.test(ED) && /insertSection\(\{ gallery: r\.body\.item \}/.test(ED));
check('an AI-designed section gets a type of its own here, never "<type>-<number>", its CSS scoped to it and kept right after it',
  /type = base \+ '-g' \+ r;/.test(ED) && /styleEl\.setAttribute\('data-rv-style', type\);/.test(ED) && /el\.after\(el\.__rvGalleryStyle\)/.test(ED) &&
  /canvas\.adopt\(el\);/.test(ED));
check('…a section of a design kept as files brings its CSS inside it; a ready-made design fits any site',
  /own\.setAttribute\('data-rv-custom-css', ''\);/.test(ED) && /item\.family === 'generic' \|\| \(!!galleryFamily\(\) && item\.family === galleryFamily\(\)\)/.test(ED));
check('its words are another event\'s: marked as samples, records drawn from this event\'s Content',
  /samples = el\.querySelectorAll\('\[data-rv-placeholder\]'\)\.length;/.test(ED) && /if \(spec\.gallery && spec\.gallery\.records\) drawRecords\(false\);/.test(ED));
check('the canvas builds a section from markup of its own', /createSectionFrom: function \(html, name\) \{/.test(CV) && /return prepare\(doc\.importNode\(el, true\), name\);/.test(CV));
check('the page can reach the gallery', /galleryFamily: galleryFamily, galleryFits: galleryFits, galleryTabOf: galleryTabOf, galleryList: galleryList, galleryItem: galleryItem,/.test(ED) &&
  /galleryPreviewDoc: galleryPreviewDoc, galleryDelete: galleryDelete, addFromGallery: addFromGallery,/.test(ED));

/* the type scope rewrite itself */
var m = /var scope = new RegExp\(('[^\n]+'), 'g'\);/.exec(ED);
check('the scope rewrite can be read', !!m);
if (m) {
  var old = 'why-join-us';
  var scope = new RegExp(eval(m[1].replace("old.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')", JSON.stringify(old))), 'g');
  var css = '[data-rv-section="why-join-us"] .a{x:1}[data-rv-section=\'why-join-us\']{y:2}[data-rv-section=why-join-us] b{}[data-rv-section="why-join-us-2"]{z:3}';
  var out = css.replace(scope, '[data-rv-section="why-join-us-gab12"]');
  check('every form of the scope is moved to the new type, and only that type', (out.match(/why-join-us-gab12/g) || []).length === 3 && /why-join-us-2"\]\{z:3\}/.test(out));
}
/* the tab a design goes under, read from its type, else its name */
var tabSrc = /(  var GALLERY_TABS = \[[\s\S]*?\n  function galleryTabOf\(item\) \{[\s\S]*?\n  \}\n)/.exec(ED);
check('the tab matcher can be read', !!tabSrc);
if (tabSrc) {
  var tabOf = new Function(tabSrc[1] + '\nreturn galleryTabOf;')();
  var cases = [
    [{ srcType: 'overview', kind: 'Overview' }, 'overview'], [{ srcType: 'overview-gab12' }, 'overview'], [{ srcType: 'why-join-us', kind: 'Why Join Us' }, 'why'],
    [{ srcType: 'who-should-attend' }, 'attend'], [{ srcType: 'key-discussion-points' }, 'discussion'], [{ srcType: 'what-awaits-you' }, 'waits'],
    [{ srcType: 'speakers-2' }, 'speaker'], [{ srcType: 'partners' }, 'sponsors'], [{ srcType: 'about-the-awards' }, 'overview'], [{ srcType: 'event-stats' }, 'stats'],
    [{ srcType: 'generic', kind: 'Agenda' }, 'agenda'], [{ srcType: 'faq' }, 'faq'], [{ srcType: 'contact-us' }, 'contact'], [{ srcType: 'glimpses' }, 'glimpses'],
    [{ srcType: 'status-board', kind: 'Status board' }, '']
  ];
  var wrong = cases.filter(function (c) { return tabOf(c[0]).key !== c[1]; }).map(function (c) { return JSON.stringify(c[0]) + ' -> ' + tabOf(c[0]).key; });
  check('each kind goes under its own tab (' + wrong.join('; ') + ')', !wrong.length);
  var own = tabOf({ srcType: 'membership-plan', kind: 'Membership plan', name: 'Membership plan' });
  check('a kind Add section has no tab for is named by itself (Membership plan)', own.key === '' && own.label === 'Membership plan');
}
process.stdout.write('section-gallery-ui: ' + passed + ' passed, ' + failed + ' failed\n');
process.exit(failed ? 1 : 0);
