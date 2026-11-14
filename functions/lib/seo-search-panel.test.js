// node functions/lib/seo-search-panel.test.js — Settings › Search and sharing, the "Google result" panel
// (edit-event-seo.js searchHtml, the clean redesign of 14 Nov 2026 and its review round): plain words, no numbering and
// no badges, no actions in its head (the page's heading has Suggest with ETB2B AI for every field), at most one muted
// line under a field (where its value comes from, or what a search result cuts off) ending with that field's own small
// Suggest with ETB2B AI (Suggest again on ETB2B AI's own), the site's own main heading said instead of a field, the main
// web address said as what Google lists, the page's shared label row, link and switch, and the same ids and settings the
// save, the live preview and the leave guard read. The panel's functions are run as written, with the file's own
// helpers. No browser, no network.
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
var code = ['LABEL', 'IDEAL', 'MAX', 'OVER'].map(decl).concat(['same', 'norm', 'str', 'line', 'esc', 'svg', '$', 'counter', 'toggle', 'cutAt',
  'ownHeading', 'aiWriting', 'aiAgain', 'aiOne', 'aiOwn', 'aiLink', 'aiLeftOut', 'aiWrote', 'overNote', 'searchNote', 'paintSearchNote', 'searchField', 'searchHtml'].map(fn)).join('\n');

function render(over) {
  over = over || {};
  var F = Object.assign({ title: 'ET CIO Summit 2027 | Leaders on AI and cloud', description: 'Two days for CIOs in Delhi.', keywords: ['CIO summit 2027', 'CIO events Delhi'],
    h1: '', canonicalUrl: '', noindex: false, aiWritten: ['title'] }, over.F || {});
  var B = Object.assign(JSON.parse(JSON.stringify(F)), over.B || {});
  var auto = Object.assign({ title: 'ET CIO Summit 2027', url: 'https://sites.example/e/cio-summit-2027', h1: { own: '', used: '' }, indexing: { on: true, reason: '', text: 'On: search engines may list it.' } }, over.auto || {});
  var ST = { F: F, B: B, data: { auto: auto, head: { description: '' } }, dropped: over.dropped || [], prev: over.prev || null, aiBusy: over.aiBusy || '', aiFields: over.aiFields || [], prevBusy: false, canonOpen: !!over.canonOpen,
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
ok(/<h3>Google result<\/h3><\/div><div class="panel-body">/.test(h) && h.indexOf('seo2-acts') === -1, 'the panel is "Google result", with no subtitle and nothing else in its head', h.slice(0, 200));
ok(h.indexOf('1 ·') === -1 && h.indexOf('class="badge') === -1 && h.indexOf('seo-src') === -1, 'no numbering and no coloured badges');
['SEO title', 'Meta description', 'Keywords', 'H1 heading', 'Canonical address', 'Indexing', 'Write with ETB2B AI', 'Not set'].forEach(function (w) {
  ok(h.indexOf('>' + w + '<') === -1 && h.indexOf('>' + w + ' ') === -1, 'the old word "' + w + '" is gone');
});
var labels = (h.match(/<label for="[^"]+">[\s\S]*?<\/label>|<span class="seo2-label">[^<]*<\/span>/g) || []).map(function (l) { return l.replace(/<[^>]+>/g, ''); });
ok(JSON.stringify(labels) === JSON.stringify(['Title in Google', 'Description in Google', 'Search words', 'Main heading (not shown on the page)', 'Main web address']),
  'the fields, in order, in plain words', JSON.stringify(labels));
ok(/<label for="seo-h1">Main heading <span class="seo2-aside">\(not shown on the page\)<\/span><\/label>/.test(h), 'the main heading says it is not shown, in muted words');

/* ---------- no actions of its own: the page's heading has them; per field only "Suggest again", on what ETB2B AI wrote ---------- */
ok(h.indexOf('data-seo="ai-all"') === -1 && h.indexOf('data-seo2-ai') === -1 && h.indexOf('data-seo="prev') === -1 && h.indexOf('Bring in') === -1,
  'no Suggest with ETB2B AI for every field and no Bring in in the panel (the heading has the one; the other sits where what it brings lands)');
var actions = fn('actionsHtml');
ok((actions.match(/data-seo="ai-all"/g) || []).length === 1 && /Suggest with ETB2B AI<\/button>/.test(actions) && (actions.match(/<button/g) || []).length === 1 &&
  SRC.indexOf('data-seo="prev"') === -1 && SRC.indexOf('data-seo2-ai') === -1,
  'the page\'s heading has one helper, Suggest with ETB2B AI (Bring in is not there: it brought in only what is inside the closed Advanced fold)');
ok((h.match(/data-seo-ai="/g) || []).length === 4 && /<p class="seo2-note" id="seo2-note-title">Suggested by ETB2B AI · <button class="seo2-link" type="button" data-seo-ai="title"[^>]*>Suggest again<\/button><\/p>/.test(h) &&
  /id="seo2-note-description"><button class="seo2-link" type="button" data-seo-ai="description" aria-label="Suggest with ETB2B AI: Description in Google">Suggest with ETB2B AI<\/button><\/p>/.test(h) &&
  /id="seo2-note-keywords"><button class="seo2-link" type="button" data-seo-ai="keywords" aria-label="Suggest with ETB2B AI: Search words">Suggest with ETB2B AI<\/button><\/p>/.test(h),
  'each field has its own small action: Suggest again on the title ETB2B AI wrote (said in one muted line), Suggest with ETB2B AI on the team\'s', h);
var busy = render({ aiBusy: 'writing' });
ok(/data-seo-ai="title" disabled /.test(busy) && !/data-seo-ai="title" disabled/.test(h), 'while ETB2B AI writes, Suggest again waits');

/* ---------- the line under a field: where the value comes from ---------- */
var edited = render({ F: { title: 'A title the team changed' }, B: { title: 'ET CIO Summit 2027 | Leaders on AI and cloud' } });
ok(/id="seo2-note-title"><button class="seo2-link" type="button" data-seo-ai="title" aria-label="Suggest with ETB2B AI: Title in Google">Suggest with ETB2B AI<\/button><\/p>/.test(edited),
  'once edited, the title is the team\'s: its line is only Suggest with ETB2B AI, for that field alone');
var empty = render({ F: { title: '', description: '', h1: '', keywords: [], aiWritten: [] } });
ok(/id="seo2-note-title">Until you write one, Google shows the event’s name, from Basics\. <button class="seo2-link" type="button" data-seo-ai="title"/.test(empty), 'an empty title says Google shows the event\'s name, and offers ETB2B AI for it');
ok(/id="seo2-note-description">Until you write one, Google shows the short description from Basics\. <button/.test(empty) &&
  /placeholder="A summit for CIOs on enterprise AI, cloud and security\."/.test(empty), 'an empty description says (and shows) Basics\' short description');
ok(/id="seo2-note-description">Until you write one, Google picks lines from the page itself\. <button/.test(render({ F: { description: '' }, basics: '' })), 'and with none in Basics, says so');
ok(/id="seo2-note-h1">Google reads it as the page’s main heading\. Until you write one, the event’s name is used\. <button class="seo2-link" type="button" data-seo-ai="h1"/.test(empty), 'an empty main heading: what it is for, and the event\'s name meanwhile');
ok(/id="seo2-note-keywords">What people type into Google to find it/.test(empty) && /placeholder="Type a word or phrase, then press Enter"/.test(empty), 'no search words yet: what to type, once');
var ownH = render({ auto: { h1: { own: 'Welcome to ET CIO', used: 'Welcome to ET CIO' } } });
ok(ownH.indexOf('id="seo-h1"') === -1 && ownH.indexOf('data-seo-ai="h1"') === -1 && ownH.indexOf('not shown on the page') === -1 &&
  /<span class="seo2-label">Main heading<\/span><\/div><p class="seo2-note">The site’s own, “Welcome to ET CIO”\. Google reads it from the page, so there is nothing to write here\.<\/p>/.test(ownH),
  'a site with its own main heading: that heading, in one line, with nothing to type and no ETB2B AI (its field is in Advanced)');
var left = render({ dropped: [{ field: 'description', why: 'left out: it said “2000+”, which the event\'s details do not say' }] });
ok(/id="seo2-note-description"><span class="seo2-warn"><svg data-ic="info"><\/svg> ETB2B AI left out: it said “2000\+”, which the event&#39;s details do not say\.<\/span> <button class="seo2-link" type="button" data-seo-ai="description"/.test(left) ||
  /id="seo2-note-description"><span class="seo2-warn"><svg data-ic="info"><\/svg> ETB2B AI left out: it said “2000\+”, which the event's details do not say\.<\/span> <button class="seo2-link" type="button" data-seo-ai="description"/.test(left),
  'what ETB2B AI left out: one warning line with a small icon, and Suggest again', left.slice(left.indexOf('seo2-note-description') - 10, left.indexOf('seo2-note-description') + 300));
/* the previous edition's search words: from the answer GET /api/event/seo/previous gives ({ previous: { seo } }) */
var prev = render({ F: { aiWritten: [] }, prev: { previous: { name: 'ET CIO Summit 2026', seo: { keywords: ['CIO summit 2026', 'ETCIO events'] } }, sameVenue: true } });
ok(/id="seo2-note-keywords">The previous edition used: CIO summit 2026, ETCIO events \(ETB2B AI reads them as a reference\)\. <button/.test(prev), 'the previous edition\'s search words are shown as a reference');

/* ---------- past what a search result shows: said in words, not by the counter's colour alone ---------- */
var long = render({ F: { title: 'ET CIO Summit 2027, New Delhi | Leaders on AI, cloud and the future of IT', aiWritten: [] } });
ok(/<span class="ctr seo-ctr over" id="seo-ctr-title">7\d \/ 60<\/span>/.test(long) && /id="seo2-note-title"><span class="seo2-warn"><svg data-ic="info"><\/svg> Google shows about 60 characters; the rest may be cut off\.<\/span> <button class="seo2-link" type="button" data-seo-ai="title"/.test(long),
  'a title past 60 characters: the line says what a search result does with it', long.slice(long.indexOf('seo2-note-title') - 10, long.indexOf('seo2-note-title') + 260));
var longD = render({ F: { description: new Array(20).join('Two days for CIOs. '), aiWritten: [] } });
ok(/id="seo2-note-description"><span class="seo2-warn"><svg data-ic="info"><\/svg> Google shows about 160 characters; the rest may be cut off\.<\/span>/.test(longD), 'and a description past 160');

/* ---------- while ETB2B AI writes a field, it cannot be typed in ---------- */
var writing = render({ aiBusy: 'writing', aiFields: ['description', 'keywords'] });
ok(/<textarea class="inp" rows="3" id="seo-description"[^>]* readonly>/.test(writing) && !/id="seo-title"[^>]* readonly/.test(writing) && /id="seo-kw-in"[^>]* readonly>/.test(writing) &&
  /data-seo="kw-add" disabled>/.test(writing) && /data-seo-kw-x="0" aria-label="[^"]*" disabled>/.test(writing),
  'the fields ETB2B AI is writing are read-only (the search words take no word in or out), the others stay open');

/* ---------- the same ids and settings as before ---------- */
['id="seo-title" data-seo-field="title" maxlength="70"', '<textarea class="inp" rows="3" id="seo-description" data-seo-field="description" maxlength="320"', 'id="seo-h1" data-seo-field="h1" maxlength="120"',
  'id="seo-ctr-title"', 'id="seo-ctr-description"', 'id="seo-ctr-h1"', 'id="seo-ctr-keywords"', 'id="seo-kw-in"', 'data-seo="kw-add"', 'data-seo-kw-x="0"', 'data-seo-kw-x="1"',
  'id="seo-noindex"', 'data-seo="canon-own"', 'id="seo-kw-list"'].forEach(function (s) { ok(h.indexOf(s) !== -1, 'kept: ' + s); });
var canon = render({ F: { canonicalUrl: 'https://cio.example/summit' } });
ok(/<label for="seo-canonicalUrl">Main web address<\/label>/.test(canon) && /id="seo-canonicalUrl" data-seo-field="canonicalUrl" type="url" maxlength="500" value="https:\/\/cio\.example\/summit"/.test(canon) &&
  /data-seo="canon-auto">Use the site’s own<\/button>/.test(canon), 'another main web address: the field the save checks, and the way back to the site\'s own');
ok(/<span class="num">https:\/\/sites\.example\/e\/cio-summit-2027<\/span><button class="seo2-link" type="button" data-seo="canon-own">Point Google to another page<\/button><\/div><p class="seo2-note">Google lists the site at this address\.<\/p>/.test(h),
  'else the site\'s own address, as the server works it out, said as what Google lists — and another page offered as just that, not as a way to change the address');
ok(/<p class="seo2-note" id="seo2-note-canon">Only if this event’s main page is on another site\. Google then lists that page instead of this one\.<\/p>/.test(canon), 'once open, it says when to use it and what it does');
ok(/<span class="ctr seo-ctr" id="seo-ctr-keywords">2 added · 8 to 12 works best<\/span>/.test(h) && /id="seo-ctr-title">44 \/ 60<\/span>/.test(h), 'the counters: small, at the right of the label');
var fifteen = render({ F: { keywords: new Array(16).join('k,').split(',').slice(0, 15).map(function (k, i) { return 'word ' + i; }) } });
ok(/id="seo-kw-in" maxlength="60" aria-describedby="seo2-note-keywords" placeholder="15 is the most" disabled>/.test(fifteen) && /data-seo="kw-add" disabled>Add/.test(fifteen) && /15 added · 8 to 12 works best/.test(fifteen) && /seo-ctr over/.test(fifteen),
  'fifteen search words: no more can be added, and the count says it is over');

/* ---------- the page's shared pieces (edit-event.css "seo2: shared"): label row, inline row, switch ---------- */
ok((h.match(/<div class="seo2-lrow"><label for="seo-(title|description|kw-in|h1)">/g) || []).length === 4 && /<div class="seo2-lrow"><span class="seo2-label">Main web address<\/span><\/div>/.test(h),
  'every field\'s label sits in the page\'s one label row');
ok(/<div class="seo2-inline"><span class="num">/.test(h) && h.indexOf('seo2-row') === -1 && h.indexOf('seo2-head') === -1, 'the address and its action are an inline row (seo2-row and seo2-head are the speakers\' and FAQs\' list rows and headings)');
ok(/<div class="seo2-switch"><button type="button" class="tgl" id="seo-noindex"/.test(h) && /<div class="seo2-switch">[\s\S]*?<p class="seo2-note">Google is asked not to list it/.test(render({ F: { noindex: true } })),
  'Show in Google is the page\'s one switch, its line under it like the Advanced panels\' switches');

/* ---------- Show in Google: the switch is the team's choice; the line says what else keeps the site out ---------- */
ok(/id="seo-noindex" aria-pressed="true"><span class="track"><i><\/i><\/span><span>Show in Google<\/span>/.test(h) && !/Google is asked not to list it/.test(h), 'shown in Google: switched on, nothing more said');
var off = render({ F: { noindex: true } });
ok(/id="seo-noindex" aria-pressed="false"/.test(off) && /Google is asked not to list it\. Anyone with the address can still open it\./.test(off), 'kept out: switched off, and what that means');
ok(/Not listed yet: the event’s name says it is a test\./.test(render({ auto: { indexing: { on: false, reason: 'test', text: '' } } })), 'a test event: not listed all the same, said so');
ok(/Listed once the site is live\./.test(render({ auto: { indexing: { on: false, reason: 'not-live', text: '' } } })), 'a site not live yet: listed once it is');
ok(h.indexOf('short link') === -1 && h.indexOf('ethrworld') === -1 && /Short links are not available yet: share the site’s own address\./.test(fn('view')),
  'the short link: not in the Google result; said honestly, in one line, in Advanced (no other portal\'s address)');

/* ---------- its wiring ---------- */
ok(/if \(what === 'ai-all'\) askThenWrite\(aiFields\(\), true\);/.test(SRC) && /var AI_FIELDS = \['title', 'description', 'keywords', 'h1', 'schemaTitle', 'schemaDescription'\];/.test(SRC) &&
  /function aiFields\(\) \{ return AI_FIELDS\.filter\(function \(k\) \{ return k !== 'h1' \|\| !ownHeading\(\); \}\); \}/.test(SRC),
  'the heading\'s Suggest with ETB2B AI writes every field it may (the panel\'s four among them; not the main heading while the site has its own), asking before it replaces what is filled in');
ok(/if \(one\) \{ askThenWrite\(\[one\], false\); return; \}/.test(SRC), 'a field\'s own Suggest with ETB2B AI writes that field alone (asking first when it is filled in)');
ok(/if \(k === 'title' \|\| k === 'description' \|\| \(k === 'h1' && !ownHeading\(\)\)\) paintSearchNote\(k\);/.test(SRC), 'the line under a field follows the typing');
ok(/if \(b\.id === 'seo-noindex'\) \{ ST\.F\.noindex = !ST\.F\.noindex;/.test(SRC), 'the switch still flips settings.seo.noindex');
ok(!/\b(let|const)\s|=>|`/.test(['searchNote', 'paintSearchNote', 'searchField', 'searchHtml', 'aiOne', 'aiLink', 'overNote'].map(fn).join('\n')), 'ES5 only');

console.log(failed ? 'seo-search-panel: ' + failed + ' of ' + (passed + failed) + ' checks FAILED' : 'seo-search-panel: all ' + passed + ' checks passed');
process.exit(failed ? 1 : 0);
