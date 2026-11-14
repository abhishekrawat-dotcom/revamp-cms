// node functions/lib/seo-search-panel.test.js — Settings › URL & SEO, the "Google result" panel (edit-event-seo.js
// searchHtml, the clean redesign of 14 Nov 2026): plain words, no numbering and no badges, the panel's one action row,
// at most one muted line under a field saying where its value comes from, and the same ids and settings the save, the
// live preview and the leave guard read. The panel's functions are run as written, with the file's own helpers. No
// browser, no network.
'use strict';
var fs = require('fs'), path = require('path'), vm = require('vm');
var SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'edit-event-seo.js'), 'utf8');

var passed = 0, failed = 0;
function ok(cond, name, detail) { if (cond) { passed++; return; } failed++; console.error('FAIL ' + name + (detail !== undefined ? ' — ' + String(detail).slice(0, 600) : '')); }

/* the panel's functions and the helpers they call, taken from the file as they are */
function fn(name) {
  var one = new RegExp('^  function ' + name.replace('$', '\\$') + '\\([^)]*\\) \\{.*\\}$', 'm').exec(SRC);
  if (one) return one[0];
  var block = new RegExp('^  function ' + name + '\\([^)]*\\) \\{[\\s\\S]*?\\n  \\}$', 'm').exec(SRC);
  if (!block) throw new Error('edit-event-seo.js has no function ' + name);
  return block[0];
}
function decl(name) {
  var m = new RegExp('^  var ' + name + ' = [\\s\\S]*?;$', 'm').exec(SRC);
  if (!m) throw new Error('edit-event-seo.js has no var ' + name);
  return m[0];
}
var code = ['LABEL', 'IDEAL', 'MAX', 'SEARCH_FIELDS'].map(decl).concat(['same', 'norm', 'str', 'line', 'esc', 'svg', '$', 'counter', 'toggle',
  'searchNote', 'paintSearchNote', 'searchField', 'searchHtml'].map(fn)).join('\n');

function render(over) {
  over = over || {};
  var F = Object.assign({ title: 'ET CIO Summit 2027 | Leaders on AI and cloud', description: 'Two days for CIOs in Delhi.', keywords: ['CIO summit 2027', 'CIO events Delhi'],
    h1: '', canonicalUrl: '', noindex: false, aiWritten: ['title'] }, over.F || {});
  var B = Object.assign(JSON.parse(JSON.stringify(F)), over.B || {});
  var auto = Object.assign({ title: 'ET CIO Summit 2027', url: 'https://sites.example/e/cio-summit-2027', h1: { own: '', used: '' }, indexing: { on: true, reason: '', text: 'On: search engines may list it.' } }, over.auto || {});
  var ST = { F: F, B: B, data: { auto: auto, head: { description: '' } }, dropped: over.dropped || [], prev: over.prev || null, aiBusy: over.aiBusy || '', prevBusy: false, canonOpen: !!over.canonOpen,
    ctx: {
      EV: { description: over.basics === undefined ? 'A summit for CIOs on enterprise AI, cloud and security.' : over.basics },
      IC: { star: 'star', info: 'info' },
      esc: function (s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); },
      svg: function (ic) { return '<svg data-ic="' + ic + '"></svg>'; },
      panel: function (title, sub, body, right) { return '<div class="panel"><div class="panel-head"><h3>' + title + '</h3>' + (sub ? '<span class="sub">' + sub + '</span>' : '') + (right || '') + '</div><div class="panel-body">' + body + '</div></div>'; }
    } };
  var box = { ST: ST, document: { getElementById: function () { return null; } } };
  vm.runInNewContext(code + '\n;out = searchHtml();', box);
  return box.out;
}

/* ---------- the panel: plain words, quiet ---------- */
var h = render();
ok(/<h3>Google result<\/h3><div class="seo2-acts">/.test(h), 'the panel is "Google result", with no subtitle and its action row in its head', h.slice(0, 200));
ok(h.indexOf('1 ·') === -1 && h.indexOf('class="badge') === -1 && h.indexOf('seo-src') === -1, 'no numbering and no coloured badges');
['SEO title', 'Meta description', 'Keywords', 'H1 heading', 'Canonical address', 'Indexing', 'Write with ETB2B AI', 'Not set'].forEach(function (w) {
  ok(h.indexOf('>' + w + '<') === -1 && h.indexOf('>' + w + ' ') === -1, 'the old word "' + w + '" is gone');
});
var labels = (h.match(/<label for="[^"]+">[\s\S]*?<\/label>|<span class="seo2-label">[^<]*<\/span>/g) || []).map(function (l) { return l.replace(/<[^>]+>/g, ''); });
ok(JSON.stringify(labels) === JSON.stringify(['Title in Google', 'Description in Google', 'Search words', 'Main heading (not shown on the page)', 'Main web address']),
  'the fields, in order, in plain words', JSON.stringify(labels));
ok(/<label for="seo-h1">Main heading <span class="seo2-aside">\(not shown on the page\)<\/span><\/label>/.test(h), 'the main heading says it is not shown, in muted words');

/* ---------- one action row; per field only "Suggest again", on what ETB2B AI wrote ---------- */
ok((h.match(/data-seo2-ai="title,description,keywords,h1"/g) || []).length === 1 && /Suggest with ETB2B AI<\/button>/.test(h), 'Suggest with ETB2B AI: once, for the panel\'s four fields');
ok((h.match(/data-seo="prev"/g) || []).length === 1 && /Bring in from previous edition<\/button>/.test(h), 'Bring in from previous edition: once');
ok((h.match(/data-seo-ai="/g) || []).length === 1 && /<p class="seo2-note" id="seo2-note-title">Suggested by ETB2B AI · <button class="seo2-link" type="button" data-seo-ai="title"/.test(h),
  'the title ETB2B AI wrote says so in one muted line, with Suggest again; nothing else has a per-field AI button');
var busy = render({ aiBusy: 'writing' });
ok(/data-seo2-ai="title,description,keywords,h1" disabled>/.test(busy) && /data-seo-ai="title" disabled /.test(busy) && !/data-seo2-ai="[^"]*" disabled/.test(h), 'while ETB2B AI writes, its buttons wait');

/* ---------- the line under a field: where the value comes from ---------- */
var edited = render({ F: { title: 'A title the team changed' }, B: { title: 'ET CIO Summit 2027 | Leaders on AI and cloud' } });
ok(/id="seo2-note-title" hidden><\/p>/.test(edited), 'once edited, the title is the team\'s: no line under it');
var empty = render({ F: { title: '', description: '', h1: '', keywords: [], aiWritten: [] } });
ok(/id="seo2-note-title">Until you write one, Google shows the event’s name, from Basics\.<\/p>/.test(empty), 'an empty title says Google shows the event\'s name');
ok(/id="seo2-note-description">Until you write one, Google shows the short description from Basics\.<\/p>/.test(empty) &&
  /placeholder="A summit for CIOs on enterprise AI, cloud and security\."/.test(empty), 'an empty description says (and shows) Basics\' short description');
ok(/id="seo2-note-description">Until you write one, Google picks lines from the page itself\.<\/p>/.test(render({ F: { description: '' }, basics: '' })), 'and with none in Basics, says so');
ok(/id="seo2-note-h1">Until you write one, the event’s name is used\.<\/p>/.test(empty), 'an empty main heading: the event\'s name');
ok(/id="seo2-note-keywords">What people type into Google to find it/.test(empty) && /placeholder="Type a word or phrase, then press Enter"/.test(empty), 'no search words yet: what to type, once');
ok(/id="seo2-note-h1">The site has its own main heading, “Welcome to ET CIO”, which Google reads instead\.<\/p>/.test(render({ auto: { h1: { own: 'Welcome to ET CIO', used: 'Welcome to ET CIO' } } })),
  'a site with its own main heading says Google reads that one');
var left = render({ dropped: [{ field: 'description', why: 'left out: it said “2000+”, which the event\'s details do not say' }] });
ok(/id="seo2-note-description"><span class="seo2-warn"><svg data-ic="info"><\/svg> ETB2B AI left out: it said “2000\+”, which the event&#39;s details do not say\.<\/span> <button class="seo2-link" type="button" data-seo-ai="description"/.test(left) ||
  /id="seo2-note-description"><span class="seo2-warn"><svg data-ic="info"><\/svg> ETB2B AI left out: it said “2000\+”, which the event's details do not say\.<\/span> <button class="seo2-link" type="button" data-seo-ai="description"/.test(left),
  'what ETB2B AI left out: one warning line with a small icon, and Suggest again', left.slice(left.indexOf('seo2-note-description') - 10, left.indexOf('seo2-note-description') + 300));
/* the previous edition's search words: from the answer GET /api/event/seo/previous gives ({ previous: { seo } }) */
var prev = render({ F: { aiWritten: [] }, prev: { previous: { name: 'ET CIO Summit 2026', seo: { keywords: ['CIO summit 2026', 'ETCIO events'] } }, sameVenue: true } });
ok(/id="seo2-note-keywords">The previous edition used: CIO summit 2026, ETCIO events \(ETB2B AI reads them as a reference\)\.<\/p>/.test(prev), 'the previous edition\'s search words are shown as a reference');

/* ---------- the same ids and settings as before ---------- */
['id="seo-title" data-seo-field="title" maxlength="70"', '<textarea class="inp" rows="3" id="seo-description" data-seo-field="description" maxlength="320"', 'id="seo-h1" data-seo-field="h1" maxlength="120"',
  'id="seo-ctr-title"', 'id="seo-ctr-description"', 'id="seo-ctr-h1"', 'id="seo-ctr-keywords"', 'id="seo-kw-in"', 'data-seo="kw-add"', 'data-seo-kw-x="0"', 'data-seo-kw-x="1"',
  'id="seo-noindex"', 'data-seo="canon-own"', 'id="seo-kw-list"'].forEach(function (s) { ok(h.indexOf(s) !== -1, 'kept: ' + s); });
var canon = render({ F: { canonicalUrl: 'https://cio.example/summit' } });
ok(/<label for="seo-canonicalUrl">Main web address<\/label>/.test(canon) && /id="seo-canonicalUrl" data-seo-field="canonicalUrl" type="url" maxlength="500" value="https:\/\/cio\.example\/summit"/.test(canon) &&
  /data-seo="canon-auto">Use the site’s own<\/button>/.test(canon), 'another main web address: the field the save checks, and the way back to the site\'s own');
ok(/<span class="num">https:\/\/sites\.example\/e\/cio-summit-2027<\/span><button class="seo2-link" type="button" data-seo="canon-own">Use another address<\/button>/.test(h), 'else the site\'s own address, as the server works it out');
ok(/<span class="ctr seo-ctr" id="seo-ctr-keywords">2 added · 8 to 12 works best<\/span>/.test(h) && /id="seo-ctr-title">44 \/ 60<\/span>/.test(h), 'the counters: small, at the right of the label');
var fifteen = render({ F: { keywords: new Array(16).join('k,').split(',').slice(0, 15).map(function (k, i) { return 'word ' + i; }) } });
ok(/id="seo-kw-in" maxlength="60" aria-describedby="seo2-note-keywords" placeholder="15 is the most" disabled>/.test(fifteen) && /data-seo="kw-add" disabled>Add/.test(fifteen) && /15 added · 8 to 12 works best/.test(fifteen) && /seo-ctr over/.test(fifteen),
  'fifteen search words: no more can be added, and the count says it is over');

/* ---------- Show in Google: the switch is the team's choice; the line says what else keeps the site out ---------- */
ok(/id="seo-noindex" aria-pressed="true"><span class="track"><i><\/i><\/span><span>Show in Google<\/span>/.test(h) && !/Google is asked not to list it/.test(h), 'shown in Google: switched on, nothing more said');
var off = render({ F: { noindex: true } });
ok(/id="seo-noindex" aria-pressed="false"/.test(off) && /Google is asked not to list it\. Anyone with the address can still open it\./.test(off), 'kept out: switched off, and what that means');
ok(/Not listed yet: the event’s name says it is a test\./.test(render({ auto: { indexing: { on: false, reason: 'test', text: '' } } })), 'a test event: not listed all the same, said so');
ok(/Listed once the site is live\./.test(render({ auto: { indexing: { on: false, reason: 'not-live', text: '' } } })), 'a site not live yet: listed once it is');
ok(/No short link: ETB2B’s link shortener \(ethrworld\.com\/s\/…\) cannot be used from EventSphere, so the site’s own address is used\./.test(h), 'the short link: not available, said honestly in one line');

/* ---------- its wiring ---------- */
ok(/closest\('\[data-seo2-ai\]'\)/.test(SRC) && /askThenWrite\(b\.getAttribute\('data-seo2-ai'\)\.split\(','\), true\)/.test(SRC), 'Suggest with ETB2B AI asks before it replaces what the team wrote (with "Only the empty ones")');
ok(/if \(k === 'title' \|\| k === 'description' \|\| k === 'h1'\) paintSearchNote\(k\);/.test(SRC), 'the line under a field follows the typing');
ok(/if \(b\.id === 'seo-noindex'\) \{ ST\.F\.noindex = !ST\.F\.noindex;/.test(SRC), 'the switch still flips settings.seo.noindex');
ok(!/\b(let|const)\s|=>|`/.test(['searchNote', 'paintSearchNote', 'searchField', 'searchHtml'].map(fn).join('\n')), 'ES5 only');

console.log(failed ? 'seo-search-panel: ' + failed + ' of ' + (passed + failed) + ' checks FAILED' : 'seo-search-panel: all ' + passed + ' checks passed');
process.exit(failed ? 1 : 0);
