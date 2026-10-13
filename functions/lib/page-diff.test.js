/* node functions/lib/page-diff.test.js — exits 1 on the first failure it lists. No network, no Firebase. */
const { diffPages, summarise } = require('./page-diff');

var failures = [], checks = 0;
function ok(cond, label, detail) { checks++; if (!cond) failures.push(label + (detail ? '\n      ' + detail : '')); }
function page(body, style, state) {
  return '<html><head>' + (state ? '<style data-rv-design data-rv-state=\'' + JSON.stringify(state) + '\'></style>' : '') + '</head><body style="' + (style || '') + '">' + body + '</body></html>';
}
function sec(key, inner, extra) { return '<section data-rv-section="' + key + '" data-rv-key="' + key + '" data-sec-name="' + key.toUpperCase() + '"' + (extra || '') + '>' + inner + '</section>'; }
function types(items) { return items.map(function (i) { return i.type + ':' + i.section; }).join(','); }

var base = page(sec('nav', '<a>Home</a>') + sec('hero', '<h1>Big Event 2026</h1><p>Mumbai</p>') + sec('about', '<h2>About</h2><p>First line.</p><p>Second line.</p><img src="https://x/a.png">') + sec('faq', '<h2>FAQ</h2>') + sec('footer', '<p>End</p>'), '--theme-color:#111111');

ok(diffPages(base, base).length === 0, 'the same page: no change');
ok(diffPages(base, base.replace(/<h1>/, '<h1 data-editable="text" class="ed-selected">')).length === 0, 'the editor\'s own marks are not a change');

var t = diffPages(base, base.replace('Big Event 2026', 'Big Event 2027').replace('Second line.', 'A new second line.'));
ok(types(t) === 'text:hero,text:about', 'wording changes, per section', types(t));
ok(t[0].before === 'Big Event 2026' && t[0].after === 'Big Event 2027', 'before and after are the lines that differ', JSON.stringify(t[0]));
ok(t[1].before === 'Second line.' && t[1].after === 'A new second line.', 'only the changed line is listed', JSON.stringify(t[1]));

var pic = diffPages(base, base.replace('https://x/a.png', 'https://x/events/e/media/new-photo.jpg?v=2'));
ok(types(pic) === 'pictures:about' && pic[0].before === 'a.png' && pic[0].after === 'new-photo.jpg', 'a replaced picture, by file name', JSON.stringify(pic));

var look = diffPages(base, base.replace('<h2>About</h2>', '<h2 style="color:red">About</h2>'));
ok(types(look) === 'look:about' && /layout or formatting/.test(look[0].note), 'same words, different markup', JSON.stringify(look));

var added = diffPages(base, base.replace(sec('faq', '<h2>FAQ</h2>'), sec('faq', '<h2>FAQ</h2>') + sec('venue', '<h2>Venue</h2><p>Jio World</p>')));
ok(types(added) === 'added:venue' && /Jio World/.test(added[0].after), 'a new section, with its text', JSON.stringify(added));
var removed = diffPages(base, base.replace(sec('faq', '<h2>FAQ</h2>'), ''));
ok(types(removed) === 'removed:faq' && removed[0].before === 'FAQ', 'a removed section', JSON.stringify(removed));

var moved = diffPages(base, page(sec('nav', '<a>Home</a>') + sec('faq', '<h2>FAQ</h2>') + sec('hero', '<h1>Big Event 2026</h1><p>Mumbai</p>') + sec('about', '<h2>About</h2><p>First line.</p><p>Second line.</p><img src="https://x/a.png">') + sec('footer', '<p>End</p>'), '--theme-color:#111111'));
ok(types(moved) === 'moved:faq' && moved[0].before === '4th of 5' && moved[0].after === '2nd of 5', 'one moved section is one line, not three', JSON.stringify(moved));

var hidden = diffPages(base, base.replace('data-sec-name="FAQ"', 'data-sec-name="FAQ" class="is-hidden-sec"'));
ok(types(hidden) === 'hidden:faq', 'hiding a section', types(hidden));

var design = diffPages(base, base.replace('--theme-color:#111111', '--theme-color:#cc0000;--rv-bg:#ffffff'));
ok(types(design) === 'design:' && /Theme colour: #111111/.test(design[0].before) && /Theme colour: #cc0000/.test(design[0].after) && /Page background: #ffffff/.test(design[0].after), 'site-wide settings, named', JSON.stringify(design));
var state = diffPages(page(sec('a', '<p>x</p>'), '', { headingSize: 40 }), page(sec('a', '<p>x</p>'), '', { headingSize: 48, radius: '8px' }));
ok(types(state) === 'design:' && /Heading size: 40/.test(state[0].before) && /Corner rounding: 8px/.test(state[0].after), 'the design rules kept by the editor', JSON.stringify(state));

/* records drawn into a section are not the page's words */
var rec = diffPages(page(sec('sp', '<h2>Speakers</h2><div data-rv-repeat-template="speakers"><h3>A</h3></div>')), page(sec('sp', '<h2>Speakers</h2><div data-rv-repeat-template="speakers"><h3>A</h3></div><div data-rv-repeat-template="speakers"><h3>B</h3></div>')));
ok(!rec.some(function (i) { return i.type === 'text'; }), 'a record drawn into a list is not a wording change', JSON.stringify(rec));

ok(summarise(t) === '2 sections edited', 'summary of edits', summarise(t));
ok(summarise(added.concat(moved, design)) === '1 added, 1 moved, site design changed', 'summary of a mix', summarise(added.concat(moved, design)));
ok(summarise([]) === 'no visible change', 'summary of nothing');
ok(diffPages('', base).filter(function (i) { return i.type === 'added'; }).length === 5 && diffPages(base, '').filter(function (i) { return i.type === 'removed'; }).length === 5, 'from nothing and to nothing');

if (failures.length) {
  console.log(failures.length + ' of ' + checks + ' checks FAILED:\n\n  - ' + failures.join('\n  - '));
  process.exit(1);
}
console.log('page-diff: all ' + checks + ' checks passed');
