/* node functions/lib/section-gallery.test.js — the template gallery (lib/section-gallery.js; the owner, 19 Nov 2026: "Add an
   option in each section to add to template gallary, and when a user is trying to add duplicate template it should be
   avoided"). The design's fingerprint (one design kept once, whatever its words and pictures), the markup made safe for
   every site, the pictures copied by their own addresses only, and who may take a design out. No network. Exits 1 on
   any failure. */
'use strict';
var G = require('./section-gallery')._test;
var passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; return; }
  failed++;
  process.stderr.write('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail).slice(0, 400) : '') + '\n');
}

/* ---------- one design, kept once ---------- */
var A = '<section data-rv-section="why-join-us" id="why-join-us" class="why-root" data-sec-name="Why Join Us"><h2 class="h">Why join</h2>' +
  '<img src="https://storage.googleapis.com/b/events/one/a.png" alt="Room"><a class="btn" href="#register">Register</a></section>';
var CSS = '[data-rv-section="why-join-us"] .h{color:var(--rv-text)} [data-rv-section="why-join-us"]{background:url("https://storage.googleapis.com/b/events/one/bg.jpg")}';
var f1 = G.fingerprint('gen', 'why-join-us', A, CSS, '');
check('the fingerprint is an id of its own (g + 32 hex)', /^g[0-9a-f]{32}$/.test(f1), f1);
var otherWords = A.replace('Why join', 'Reasons to attend').replace('Register', 'Book a seat').replace('alt="Room"', 'alt="Hall"');
check('other words: the same design', G.fingerprint('gen', 'why-join-us', otherWords, CSS, '') === f1);
var otherPics = A.replace('events/one/a.png', 'events/two/z.webp');
check('other pictures and from another event: the same design', G.fingerprint('gen', 'why-join-us', otherPics, CSS.replace('events/one/bg.jpg', 'section-gallery/gx/2.jpg'), '') === f1);
/* as galleryElement adds it to a site: a type of its own in data-rv-section and in its CSS scope, a new id and name,
   its class names untouched */
var renamed = A.replace('data-rv-section="why-join-us"', 'data-rv-section="why-join-us-gk3x"').replace('id="why-join-us"', 'id="why-join-us-2"').replace('data-sec-name="Why Join Us"', 'data-sec-name="Reasons"');
check('added to a site from the gallery (a new type, name and id) and saved back: the same design',
  G.fingerprint('gen', 'why-join-us-gk3x', renamed, CSS.split('[data-rv-section="why-join-us"]').join('[data-rv-section="why-join-us-gk3x"]'), '') === f1);
check('…a class that happens to hold the type name is still design', G.fingerprint('gen', 'why-join-us', A.replace('class="why-root"', 'class="why-join-us-root"'), CSS, '') !== f1);
check('another class: another design', G.fingerprint('gen', 'why-join-us', A.replace('class="h"', 'class="h big"'), CSS, '') !== f1);
check('other CSS: another design', G.fingerprint('gen', 'why-join-us', A, CSS.replace('var(--rv-text)', 'red'), '') !== f1);
check('another element: another design', G.fingerprint('gen', 'why-join-us', A.replace('</section>', '<p>x</p></section>'), CSS, '') !== f1);
check('the same markup for another family of designs: another design', G.fingerprint('tech500', 'why-join-us', A, CSS, '') !== f1);
check('an inline style is design; the picture named in it is not',
  G.fingerprint('gen', 'why-join-us', A.replace('<h2 class="h">', '<h2 class="h" style="text-align:left">'), CSS, '') !== f1 &&
  G.fingerprint('gen', 'x', '<div style="background:url(a.png);padding:4px"></div>', '', '') === G.fingerprint('gen', 'x', '<div style="background:url(b.png);padding:4px"></div>', '', ''));

/* ---------- safe on every site ---------- */
var dirty = '<section><!-- note --><script>alert(1)</script><img src="x" onerror="alert(2)"><a href="javascript:alert(3)">x</a><button onclick=\'go()\'>y</button></section>';
var clean = G.cleanHtml(dirty);
check('no script, handler or javascript: link reaches the gallery', !/script|onerror|onclick|javascript:|<!--/i.test(clean), clean);
check('…and the rest is kept', /<img src="x">/.test(clean) && /<a href="#">x<\/a>/.test(clean) && /<button>y<\/button>/.test(clean), clean);
check('one root element, not a style or script', G.oneRoot('<section></section>') && G.oneRoot('<div class="a"></div>') && !G.oneRoot('<style></style>') && !G.oneRoot('text'));

/* ---------- pictures ---------- */
var urls = G.urlsIn('<img src="https://storage.googleapis.com/b/events/one/a.png" srcset="https://storage.googleapis.com/b/events/one/a-800.png 800w, https://storage.googleapis.com/b/events/one/a-400.png 400w"> url("//storage.googleapis.com/b/events/one/bg.jpg")');
check('every picture address is found, srcset ones included, without the comma after them', urls.length === 4 && urls.every(function (u) { return !/,$/.test(u); }), urls);
check('only this bucket\'s objects under the folder asked for', G.objectOf('https://storage.googleapis.com/b/events/one/a.png', 'b', 'events/') === 'events/one/a.png' &&
  G.objectOf('//storage.googleapis.com/b/events/one/a%20b.png?v=2', 'b', 'events/') === 'events/one/a b.png' &&
  G.objectOf('https://storage.googleapis.com/other/events/one/a.png', 'b', 'events/') === '' &&
  G.objectOf('https://storage.googleapis.com/b/section-gallery/g1/1.png', 'b', 'events/') === '' &&
  G.objectOf('https://storage.googleapis.com/b/events/../x', 'b', 'events/') === '');

/* copyPictures on a stand-in bucket: copied once each, addresses changed, a picture that is gone left alone */
var copies = [], publics = [];
var fb = { bucket: { name: 'b', file: function (p) {
  return { copy: function (t) { if (/gone/.test(p)) { var e = new Error('No such object'); e.code = 404; return Promise.reject(e); } copies.push([p, t.path]); return Promise.resolve(); },
    makePublic: function () { publics.push(p); return Promise.resolve(); }, path: p };
} } };
var html = '<section><img src="https://storage.googleapis.com/b/events/one/a.png"><img src="https://storage.googleapis.com/b/events/one/a.png"><img src="https://storage.googleapis.com/b/events/one/gone.png"><img src="https://example.org/x.png"></section>';
G.copyPictures(fb, [html, 'x{background:url(https://storage.googleapis.com/b/events/one/bg.jpg)}'], 'events/', 'section-gallery/g1/').then(function (r) {
  check('each picture copied once, into the gallery\'s own folder', copies.length === 2 && copies[0][1] === 'section-gallery/g1/1.png' && copies[1][1] === 'section-gallery/g1/3.jpg' && publics.length === 2, copies);
  check('…the markup and CSS point at the copies', (r.texts[0].match(/section-gallery\/g1\/1\.png/g) || []).length === 2 && /section-gallery\/g1\/3\.jpg/.test(r.texts[1]), r.texts);
  check('…a picture that is gone, and one that is not ours, keep their address', /events\/one\/gone\.png/.test(r.texts[0]) && /example\.org\/x\.png/.test(r.texts[0]) && r.copied === 2);
}).then(function () {
  /* ---------- who may take a design out ---------- */
  var d = { savedBy: 'a@x.in' };
  check('the person who added it, an approver or an admin may take it out; another editor may not',
    G.canDelete(d, { email: 'A@x.in', access: { role: 'editor' } }) && G.canDelete(d, { email: 'b@x.in', access: { role: 'approver' } }) &&
    G.canDelete(d, { email: 'b@x.in', access: { role: 'admin' } }) && !G.canDelete(d, { email: 'b@x.in', access: { role: 'editor' } }) && !G.canDelete(d, null));
  check('QA keeps its own collection and folder when told', (function () {
    var c = process.env.SECTION_GALLERY_COL, f = process.env.SECTION_GALLERY_PREFIX;
    delete process.env.SECTION_GALLERY_COL; delete process.env.SECTION_GALLERY_PREFIX;
    var def = G.col() === 'sectionGallery' && G.filesPrefix() === 'section-gallery/';
    process.env.SECTION_GALLERY_COL = 'qaSectionGallery'; process.env.SECTION_GALLERY_PREFIX = 'qa-section-gallery/';
    var qa = G.col() === 'qaSectionGallery' && G.filesPrefix() === 'qa-section-gallery/';
    if (c === undefined) delete process.env.SECTION_GALLERY_COL; else process.env.SECTION_GALLERY_COL = c;
    if (f === undefined) delete process.env.SECTION_GALLERY_PREFIX; else process.env.SECTION_GALLERY_PREFIX = f;
    return def && qa;
  })());
  var AC = require('./access-control');
  check('saving and adding need the site editor; seeing the gallery needs only a sign-in',
    JSON.stringify(AC.sectionsFor('POST', '/api/section-gallery')) === '["design"]' && JSON.stringify(AC.sectionsFor('POST', '/api/section-gallery/use')) === '["design"]' &&
    JSON.stringify(AC.sectionsFor('DELETE', '/api/section-gallery?id=g1')) === '["design"]' && AC.sectionsFor('GET', '/api/section-gallery') === null);
  process.stdout.write('section-gallery: ' + passed + ' passed, ' + failed + ' failed\n');
  process.exit(failed ? 1 : 0);
}).catch(function (e) { console.error(e); process.exit(1); });
