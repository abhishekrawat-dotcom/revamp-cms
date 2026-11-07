/* node functions/lib/page-diff.test.js — exits 1 on the first failure it lists. No network, no Firebase. */
const { diffPages, summarise, listed, changeCount } = require('./page-diff');
const fs = require('fs'), path = require('path'), vm = require('vm');

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

/* ---- the event's records, one by one (UX-114): the approver sees each FAQ, speaker, sponsor… by name ---- */
function faqItem(id, q, a, extra) {
  return '<div class="qa" data-rv-repeat-template="faq"' + (id ? ' data-rv-filled="" data-rv-id="' + id + '"' : ' data-rv-filled=""') + (extra || '') + '>' +
    '<h3 data-rv-field="t">' + q + '</h3><p data-rv-field="d">' + a + '</p></div>';
}
var MODEL = '<div class="qa" data-rv-repeat-template="faq"><h3 data-rv-field="t">Question goes here</h3><p data-rv-field="d">Answer goes here.</p></div>';
function faqPage(list, emptyMark) {
  return page(sec('nav', '<a href="#faq"' + (emptyMark ? ' data-rv-nav-empty=""' : '') + '>FAQ</a>') +
    sec('faq', '<h2>Questions</h2><div class="list">' + list + '</div>', ' id="faq"' + (emptyMark ? ' data-rv-empty="faq"' : '')));
}
var none = faqPage(MODEL, true);
var one = faqPage(faqItem('f1', 'Is there parking at the venue?', 'Yes, in the basement.'));
var firstFaq = diffPages(none, one);
ok(types(firstFaq) === 'record-added:faq' && firstFaq[0].name === 'FAQ' && firstFaq[0].kind === 'faq' && firstFaq[0].after === 'Is there parking at the venue?',
  'the first FAQ is one added record, named by its question — not "faq: layout or formatting changed", nor a change to the menu', JSON.stringify(firstFaq));
ok(summarise(firstFaq) === 'Content: 1 FAQ added', 'its summary says what Content added', summarise(firstFaq));
var two = faqPage(faqItem('f1', 'Is there parking at the venue?', 'Yes, in the basement.') + faqItem('f2', 'Is lunch served?', 'Yes.'));
var gone = diffPages(two, one);
ok(types(gone) === 'record-removed:faq' && gone[0].before === 'Is lunch served?', 'a removed record, by name', JSON.stringify(gone));
var answer = diffPages(one, faqPage(faqItem('f1', 'Is there parking at the venue?', 'Yes, at the Gate 2 lot.')));
ok(types(answer) === 'record-changed:faq' && answer[0].before === 'Yes, in the basement.' && answer[0].after === 'Yes, at the Gate 2 lot.' && answer[0].note === 'Is there parking at the venue?',
  'a changed answer: the lines that differ, and which FAQ', JSON.stringify(answer));
var renamed = diffPages(one, faqPage(faqItem('f1', 'Where do I park?', 'Yes, in the basement.')));
ok(types(renamed) === 'record-changed:faq' && renamed[0].before === 'Is there parking at the venue?' && renamed[0].after === 'Where do I park?', 'the same record (by its id) with a new question is changed, not removed and added', JSON.stringify(renamed));
var reordered = diffPages(two, faqPage(faqItem('f2', 'Is lunch served?', 'Yes.') + faqItem('f1', 'Is there parking at the venue?', 'Yes, in the basement.')));
ok(types(reordered) === 'record-order:faq' && reordered[0].name === 'FAQs', 'the same records in another order', JSON.stringify(reordered));
ok(summarise(reordered) === 'Content: FAQs reordered', 'summary of a new order', summarise(reordered));
var oldIds = faqPage(faqItem('', 'Is there parking at the venue?', 'Yes, in the basement.'));
ok(diffPages(oldIds, one).length === 0, 'a page saved before records carried their id: the same record, matched by name, is no change');
ok(diffPages(faqPage(MODEL), faqPage(MODEL.replace('Question goes here', 'Your question'))).length === 0, 'the design\'s sample item is not a record, and its words are not the page\'s');
var hiddenPlace = diffPages(two, faqPage(faqItem('f1', 'Is there parking at the venue?', 'Yes, in the basement.') + faqItem('f2', 'Is lunch served?', 'Yes.'), true));
ok(types(hiddenPlace) === 'record-removed:faq,record-removed:faq', 'records in a place marked empty are not shown', JSON.stringify(hiddenPlace));
var mixed = diffPages(one, faqPage(faqItem('f1', 'Is there parking at the venue?', 'Yes, in the basement.') + faqItem('f2', 'Is lunch served?', 'Yes.')).replace('<h2>Questions</h2>', '<h2>Your questions</h2>'));
ok(types(mixed) === 'text:faq,record-added:faq' && summarise(mixed) === '1 section edited, content: 1 FAQ added', 'an edit and a record: both, apart', types(mixed) + ' / ' + summarise(mixed));
function spk(id, name, photo) {
  return '<article data-rv-repeat-template="speakers" data-rv-filled="" data-rv-id="' + id + '"><img data-rv-field="photo" src="' + photo + '" alt=""><h3 data-rv-field="n">' + name + '</h3></article>';
}
var photo = diffPages(page(sec('speakers', '<h2>Speakers</h2>' + spk('p1', 'Priya Sharma', 'https://x/events/e/media/old.jpg'))),
  page(sec('speakers', '<h2>Speakers</h2>' + spk('p1', 'Priya Sharma', 'https://x/events/e/media/new.jpg'))));
ok(types(photo) === 'record-changed:speakers' && photo[0].name === 'Speaker' && photo[0].before === 'old.jpg' && photo[0].after === 'new.jpg' && photo[0].note === 'Priya Sharma',
  'a speaker\'s new photo is a change to that speaker, not to the section\'s pictures', JSON.stringify(photo));
var card = diffPages(page(sec('faq', '<h2>FAQ</h2><ul data-rv-list="li"></ul>')), page(sec('faq', '<h2>FAQ</h2><ul data-rv-list="li"><li data-rv-item="faq" data-rv-id="f9"><b>When is it?</b><p>In June.</p></li></ul>')));
ok(types(card) === 'record-added:faq' && card[0].after === 'When is it?', 'a real template\'s card that carries its record\'s id is a record too', JSON.stringify(card));
var wizard = diffPages(page(sec('faq', '<h2>FAQ</h2><ul><li data-rv-item="faq"><b>A</b></li></ul>')), page(sec('faq', '<h2>FAQ</h2><ul><li data-rv-item="faq"><b>B</b></li></ul>')));
ok(!wizard.some(function (i) { return /^record-/.test(i.type); }), 'a card the wizard wrote (no record id) is not one of Content\'s records', JSON.stringify(wizard));

/* a site with pages shows a record on the home page and again on a page of its own: it is one record (B05 verify:
   one FAQ added read "Content: 2 FAQs added") */
function mpPage(homeList, pageList) {
  return page(sec('nav', '<a>Home</a>', ' data-rv-page="*"') + sec('faq', '<h2>FAQs</h2><div class="list">' + homeList + '</div>', ' id="faq"') +
    sec('award-faq', '<h2>All the FAQs</h2><div class="list">' + pageList + '</div>', ' id="award-faq" data-rv-page="award-faq"'));
}
var P = faqItem('f1', 'Is there parking at the venue?', 'Yes, in the basement.'), L = faqItem('f2', 'Is lunch served?', 'Yes.');
var mpAdded = diffPages(mpPage(P, P), mpPage(P + L, P + L));
ok(types(mpAdded) === 'record-added:faq' && summarise(mpAdded) === 'Content: 1 FAQ added', 'one FAQ added, shown on the home page and the FAQ page: 1 FAQ added', types(mpAdded) + ' / ' + summarise(mpAdded));
var mpChanged = diffPages(mpPage(P + L, P + L), mpPage(P + L.replace('Yes.', 'Yes, at noon.'), P + L.replace('Yes.', 'Yes, at noon.')));
ok(types(mpChanged) === 'record-changed:faq' && mpChanged[0].before === 'Yes.' && mpChanged[0].after === 'Yes, at noon.' && summarise(mpChanged) === 'Content: 1 FAQ changed', 'its answer changed in both places: 1 FAQ changed', JSON.stringify(mpChanged));
var mpRemoved = diffPages(mpPage(P + L, P + L), mpPage(P, P));
ok(types(mpRemoved) === 'record-removed:faq' && mpRemoved[0].before === 'Is lunch served?', 'removed from both places: 1 FAQ removed', JSON.stringify(mpRemoved));
var mpHomeOnlyQuestion = mpPage(faqItem('f2', 'Is lunch served?', ''), L);
ok(diffPages(mpHomeOnlyQuestion, mpHomeOnlyQuestion.split('Yes.').join('Yes, at noon.')).map(function (i) { return i.type + ':' + i.kind + ':' + i.after; }).join() === 'record-changed:faq:Yes, at noon.',
  'one place shows the question, the other the answer too: what it shows is what both show');
var mpOld = mpPage(faqItem('', 'Is lunch served?', 'Yes.'), faqItem('', 'Is lunch served?', 'Yes.'));
ok(diffPages(mpOld, mpPage(L, L)).length === 0, 'saved before records carried their id: the same name on both pages is the same record, so ids coming in are no change');
var twins = faqPage(faqItem('', 'To be announced', 'Soon.') + faqItem('', 'To be announced', 'Later.'));
ok(types(diffPages(twins, faqPage(MODEL, true))) === 'record-removed:faq,record-removed:faq', 'two records named the same in one list are still two');

/* ---- a real-sized award site: every record is listed, and none is ever cut unsaid (UX-114, B05 verify: 54 jury
   members and 4 FAQs were cut at 60, the summary said "3 FAQs added" and the fourth FAQ was missing, unsaid) ---- */
function jury(n, from) { var out = ''; for (var i = 0; i < n; i++) out += spk('j' + (from + i), 'Jury Member ' + (from + i), 'https://x/events/e/media/j' + (from + i) + '.jpg'); return out; }
function faqs(n) { var out = ''; for (var i = 1; i <= n; i++) out += faqItem('q' + i, 'QA question ' + i + '?', 'Answer ' + i + '.'); return out; }
function award(nJury, nFaq, heading) {
  return page(sec('speakers', '<h2>' + (heading || 'The jury') + '</h2>' + jury(nJury, 1)) + sec('faq', '<h2>Questions</h2><div class="list">' + faqs(nFaq) + '</div>', ' id="faq"'));
}
var trendies = diffPages(award(0, 0), award(54, 4, 'Meet the jury'));
ok(trendies.length === 59 && !trendies.some(function (i) { return i.type === 'more'; }) && trendies.some(function (i) { return i.after === 'QA question 4?'; }) &&
  summarise(trendies) === '1 section edited, content: 54 speakers added, 4 FAQs added' && changeCount(trendies) === 59,
  '54 jury members, 4 FAQs and a heading: every one listed (the fourth FAQ too), and the summary counts them all', trendies.length + ' / ' + summarise(trendies));
var big = diffPages(award(0, 0), award(700, 4));
var more = big[big.length - 1];
ok(big.length === 601 && more.type === 'more' && more.count === 104 && changeCount(big) === 704 && big.filter(function (i) { return i.type === 'more'; }).length === 1,
  'past the cap of records listed, the rest are counted in one last "more" item', big.length + ' / ' + JSON.stringify(more));
ok(summarise(big) === 'Content: 700 speakers added, 4 FAQs added', 'the summary still counts every record, listed or not', summarise(big));
ok(more.note === '104 more changes are not listed here: Content: 100 speakers added, 4 FAQs added.', 'the "more" item says how many and what they are', more.note);
ok(more.section === '' && more.name === '' && JSON.stringify(JSON.parse(JSON.stringify(more))) === JSON.stringify(more) && Object.keys(more.left).join() === 'n,edited,records',
  'the "more" item is plain values only (it is kept in Firestore) and names no section (the activity log names sections)', JSON.stringify(more));
var again = listed(big);
ok(JSON.stringify(again) === JSON.stringify(big), 'listing a listed list again changes nothing (the approval request lists what a save listed)');
var both = listed(big.concat(diffPages(award(0, 0), award(0, 2, 'Meet the jury'))));
ok(both.filter(function (i) { return i.type === 'more'; }).length === 1 && both[both.length - 1].type === 'more' && changeCount(both) === 707 &&
  summarise(both) === '1 section edited, content: 700 speakers added, 6 FAQs added',
  'two saves\' lists put together keep one "more", holding both: the summary counts all of them', changeCount(both) + ' / ' + summarise(both));
var wordy = []; for (var w = 0; w < 600; w++) wordy.push({ section: 'speakers', name: 'Speaker', kind: 'speakers', type: 'record-changed', before: new Array(13).join('x'.repeat(280) + '\n'), after: new Array(13).join('y'.repeat(280) + '\n'), note: 'Jury Member ' + w });
var kept = listed(wordy);
ok(Buffer.byteLength(JSON.stringify(kept), 'utf8') < 400000 && kept[kept.length - 1].type === 'more' && changeCount(kept) === 600 && summarise(kept) === 'Content: 600 speakers changed',
  'long changes are kept within one document\'s room, the rest counted', JSON.stringify(kept).length + ' chars, ' + kept.length + ' items');
var hindi = []; for (var h = 0; h < 600; h++) hindi.push({ section: 'faq', name: 'FAQ', kind: 'faq', type: 'record-added', before: '', after: 'क्या कार्यक्रम स्थल पर पार्किंग है? '.repeat(8) + h, note: '' });
ok(Buffer.byteLength(JSON.stringify(listed(hindi)), 'utf8') < 400000 && changeCount(listed(hindi)) === 600, 'room is counted in bytes as stored: questions in Hindi are kept within it too');
ok(listed([]).length === 0 && changeCount([]) === 0 && summarise(listed([])) === 'no visible change', 'no change: nothing listed, no "more"');

/* the review page tells the "more" item after the groups and counts it in "What changed (N)" */
var REVIEW = fs.readFileSync(path.join(__dirname, '..', '..', 'review.html'), 'utf8');
function reviewFn(name) {
  var at = REVIEW.indexOf('function ' + name + '(');
  if (at === -1) return '';
  var depth = 0, i = REVIEW.indexOf('{', at);
  for (; i < REVIEW.length; i++) { if (REVIEW[i] === '{') depth++; else if (REVIEW[i] === '}' && --depth === 0) break; }
  return REVIEW.slice(at, i + 1);
}
var RV = {};
vm.runInNewContext(['esc', 'isRecord', 'isMore', 'changeCount', 'changeHtml', 'changesHtml'].map(reviewFn).join('\n') +
  '\nvar KIND = { text:"Text", "record-added":"Added" }, TONE = { "record-added":"added" };\nout.count = changeCount; out.html = changesHtml;', { out: RV });
var shownHtml = RV.html(big, '/preview/ev?version=11');
ok(RV.count(big) === 704 && (shownHtml.match(/class="chg"/g) || []).length === 600 && /<h3>Content \(600\) <small>from the event console<\/small><\/h3>/.test(shownHtml) &&
  /<p class="more-note">104 more changes are not listed here: Content: 100 speakers added, 4 FAQs added\. <a href="\/preview\/ev\?version=11"[^>]*>Open the proposed version<\/a> to see them all\.<\/p>$/.test(shownHtml) &&
  /'<h2>What changed \(' \+ changeCount\(r\.items \|\| \[\]\) \+ '\)<\/h2>'/.test(REVIEW),
  'review page: 600 records listed, "104 more…" said after them with the way to see them, and "What changed" counts 704', RV.count(big) + ' ' + shownHtml.slice(-300));
var shownSmall = RV.html(trendies, '/preview/ev?version=11');
ok(shownSmall.indexOf('more-note') === -1 && /QA question 4\?/.test(shownSmall) && RV.count(trendies) === 59, 'review page: a list with nothing left out has no note, and shows the fourth FAQ');

ok(summarise(t) === '2 sections edited', 'summary of edits', summarise(t));
ok(summarise(added.concat(moved, design)) === '1 added, 1 moved, site design changed', 'summary of a mix', summarise(added.concat(moved, design)));
ok(summarise([]) === 'no visible change', 'summary of nothing');
ok(diffPages('', base).filter(function (i) { return i.type === 'added'; }).length === 5 && diffPages(base, '').filter(function (i) { return i.type === 'removed'; }).length === 5, 'from nothing and to nothing');

if (failures.length) {
  console.log(failures.length + ' of ' + checks + ' checks FAILED:\n\n  - ' + failures.join('\n  - '));
  process.exit(1);
}
console.log('page-diff: all ' + checks + ' checks passed');
