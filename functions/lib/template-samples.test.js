/* node functions/lib/template-samples.test.js — exits 1 on the first failure it lists.
   The real templates (templates/<id>/) no longer carry the source event's own copy with nowhere to change it
   (TPL-046 tech500, TPL-049 making-ai-work), and what they still show until an event's own is entered is marked
   as a sample (TPL-051): site-checks.js finds it on a page by its words, the editor marks it, and the check before
   publishing holds it back. No network, no Firebase. */
'use strict';
var fs = require('fs'), path = require('path');
var SC = require('./site-checks');
var api = require('./api');
var kit = api._testHooks.TOKEN_KIT;

var ROOT = path.join(__dirname, '..', '..');
var TEMPLATES = ['tech500', 'making-ai-work', 'cx-leaders-forum', 'retail-leadership-summit'];
var failures = [], checks = 0;
function ok(cond, label, detail) { checks++; if (!cond) failures.push(label + (detail !== undefined ? '\n      ' + String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 700) : '')); }
function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
function tpl(id) { return JSON.parse(read('templates/' + id + '/template.json')); }
function section(id, sec) { return read('templates/' + id + '/sections/' + sec + '/index.html'); }
function page(body) { return '<!DOCTYPE html><html><head><title>x</title></head><body>' + body + '</body></html>'; }
/* a section as a page has it: the loader marks its root with its id */
function onPage(id, sec, html) { return (html || section(id, sec)).replace(/<section\b/, '<section data-rv-section="' + sec + '" data-rv-key="' + sec + '"'); }
function visibleText(html) {
  var tokens = kit.tokenizeHtml(html), out = [], skip = 0;
  tokens.forEach(function (t) {
    if (t.t === 'open' && /^(?:script|style|svg|template)$/.test(t.name)) skip++;
    else if (t.t === 'close' && /^(?:script|style|svg|template)$/.test(t.name)) skip = Math.max(0, skip - 1);
    else if (t.t === 'text' && !skip) out.push(html.slice(t.s, t.e));
    if (t.t === 'open' && kit.attrValue(t, 'alt')) out.push(kit.attrValue(t, 'alt'));
  });
  return out.join(' ');
}

/* ---------- 1. the source event's own copy is gone (TPL-046, TPL-049) ---------- */
var SOURCE_NAMES = { 'tech500': /tech\s?500/i, 'making-ai-work': /making\s+ai\s+work|agentic way/i };
Object.keys(SOURCE_NAMES).forEach(function (id) {
  var t = tpl(id);
  t.sections.forEach(function (s) {
    var words = visibleText(section(id, s.id));
    ok(!SOURCE_NAMES[id].test(words), '1 ' + id + '/' + s.id + ' names no source event in what a visitor reads', words.match(SOURCE_NAMES[id]));
  });
});
ok(!/ai-logo|file_17652832944699_Group\.svg/.test(section('making-ai-work', 'about-wrapper')), '1 the Manifesto has no source-event logo');
ok(!/Seats are limited to 500/.test(section('tech500', 'why-attend')) && /data-rv-sample="instruction">A line beside the button/.test(section('tech500', 'why-attend')), '1 tech500: the seat limit is a neutral model, not another event\'s number');
ok(!/<br>/.test(/<p class="strategic-influence-copy"[^>]*>[\s\S]*?<\/p>/.exec(section('tech500', 'strategic-influence'))[0]) &&
  /margin: calc\(52px \+ 24\.38px\) 0 0;/.test(read('templates/tech500/sections/strategic-influence/style.css')), '1 tech500: the pitch\'s opening line break is margin now, so a filled pitch keeps the gap');

/* ---------- 2. every piece of it has a field in Create Event ---------- */
var WIZ = read('create-event.html');
var LIB = {};
(/var LIBRARY = \[([\s\S]*?)\n  \];/.exec(WIZ)[1].match(/id:'([a-z]+)'/g) || []).forEach(function (m) { LIB[m.slice(4, -1)] = 1; });
TEMPLATES.forEach(function (id) {
  tpl(id).content.map.forEach(function (m) {
    ok(m.from === 'event' || LIB[m.from], '2 ' + id + ': "' + m.from + '" (' + m.section + ') is a Create Event library section', Object.keys(LIB));
  });
});
function entry(id, from, sec) { return tpl(id).content.map.filter(function (m) { return m.from === from && m.section === sec; })[0]; }
var closing = entry('tech500', 'closing', 'strategic-influence');
ok(closing && closing.intro.heading && closing.intro.subheading && closing.intro.body === '.strategic-influence-copy' && closing.intro.cta.label === '.strategic-influence-btn.is-primary', '2 tech500 Beyond sponsorship: sub heading, heading, paragraph and main button come from "Closing call to action"', closing);
var attend = entry('tech500', 'attend', 'power-chain');
ok(/data-rv-sample>\s*<div class="power-chain-number">1,000\+/.test(section('tech500', 'power-chain')) && tpl('tech500').content.map.filter(function (m) { return m.section === 'power-chain'; }).length === 1,
  '2 tech500 Power Chain\'s research figures are a marked sample on the section\'s one form (no second form on a section, UX-050)');
ok(attend && attend.intro.points && attend.intro.points.list === '.power-chain-insight' && attend.fill.some(function (r) { return r.show === '.power-chain-insights'; }), '2 tech500 Power Chain insights are the pointers of "Who should attend"; the strip goes with none', attend);
ok(entry('tech500', 'whyjoin', 'why-attend').intro.points.list === '.agenda-footer > .agenda-note', '2 tech500 the line beside Be in the room\'s button is the pointers of "Why join us"');
ok(/blockquote/.test(entry('tech500', 'priorities', 'why-now').intro.body), '2 tech500 Why now\'s quote is the second line of its paragraph');
var manifesto = entry('making-ai-work', 'manifesto', 'about-wrapper'), who = entry('making-ai-work', 'keyquestions', 'who-enter');
ok(manifesto && manifesto.intro.heading && manifesto.intro.body, '2 making-ai-work the Manifesto comes from Create Event\'s "Manifesto"', manifesto);
ok(who && who.intro.subheading && who.intro.heading && who.intro.body === '.page_hdng4 > p', '2 making-ai-work who-enter takes its sub heading, heading and paragraphs from "Questions this raises"', who);
ok(/\.second_content > h4/.test(entry('making-ai-work', 'about', 'overview').intro.body), '2 making-ai-work the overview\'s larger line is the paragraph\'s second line');
ok(/closing: \['heading', 'body', 'cta'\], manifesto: \['heading', 'body'\]/.test(WIZ), '2 the wizard asks for the new sections\' heading and paragraph from the start');
/* what the wizard offers for each design: create-event.html's own templateCaps, run as it is */
var vm = require('vm');
function wizFn(name) {
  var i = WIZ.indexOf('  function ' + name + '(');
  if (i === -1) return '';
  var line = WIZ.slice(i, WIZ.indexOf('\n', i));
  if (line.split('{').length === line.split('}').length) return line;          // a function on one line (libBy)
  return WIZ.slice(i, WIZ.indexOf('\n  }\n', i) + 4);
}
var sandbox = {};
vm.runInNewContext('var LIBRARY = [' + /var LIBRARY = \[([\s\S]*?)\n  \];/.exec(WIZ)[1] + '];' +
  'var HIDDEN_SLOT_RE = /\\.(hidden|visually-hidden|sr-only)\\b/; var UNSEEN_ATTRS = { alt: 1, title: 1, \'aria-label\': 1 };' +
  ['libBy', 'slotPaths', 'ruleIsVisible', 'listItemFields', 'templateCaps'].map(wizFn).join('\n') + '\nthis.templateCaps = templateCaps;', sandbox);
var t5 = sandbox.templateCaps(tpl('tech500')), maw = sandbox.templateCaps(tpl('making-ai-work'));
function rowOf(caps, id) { return caps.sections.filter(function (x) { return x.id === id; })[0] || {}; }
ok(t5.byLib.closing && t5.byLib.closing.sectionId === 'strategic-influence' && t5.byLib.closing.intro.heading && t5.byLib.closing.intro.cta, '2 the wizard offers tech500 a "Closing call to action" form for Beyond sponsorship', t5.byLib.closing);
ok(t5.byLib.attend.intro.points && t5.byLib.whyjoin.intro.points, '2 … and pointers for Who should attend and Why join us', Object.keys(t5.byLib));
TEMPLATES.forEach(function (id) {
  var caps = sandbox.templateCaps(tpl(id)), perSection = {};
  Object.keys(caps.byLib).forEach(function (k) { perSection[caps.byLib[k].sectionId] = (perSection[caps.byLib[k].sectionId] || 0) + 1; });
  ok(Object.keys(perSection).every(function (k) { return perSection[k] === 1; }), '2 ' + id + ': one Create Event form per section (the wizard\'s one list, UX-050)', perSection);
});
ok(rowOf(t5, 'power-chain').libId === 'attend' && rowOf(t5, 'strategic-influence').libId === 'closing', '2 … the Power Chain is still the "Who should attend" row', t5.sections);
ok(maw.byLib.manifesto && maw.byLib.manifesto.sectionId === 'about-wrapper' && rowOf(maw, 'about-wrapper').libId === 'manifesto' && maw.byLib.keyquestions.intro.heading, '2 the wizard offers making-ai-work a "Manifesto" form and who-enter\'s heading', maw.byLib.manifesto);
var FILL = read('editor-fill.js');
ok(/if \(pt\.list\) r\.push\(\{ list: pt\.list, items: from \+ '\.points', require: '\{\.\}', empty: 'hide'/.test(FILL), '2 editor-fill draws pointers as a design\'s own cards (intro points: { list, fill })');

/* ---------- 3. samples are marked, and known by their words (TPL-051) ---------- */
var MARKED = {
  'tech500': ['overview', 'why-now', 'power-chain', 'summit-spotlight', 'why-attend', 'industries', 'strategic-influence'],
  'making-ai-work': ['about-wrapper', 'overview', 'overview-stats', 'who-enter', 'key-topic', 'fact-marquee', 'conventions-box'],
  'cx-leaders-forum': ['stats-3', 'overview-', 'conventions-box', 'pillars', 'who-should-attend', 'leaders'],
  'retail-leadership-summit': ['awaits', 'stats', 'overview', 'priorities', 'tracks', 'whyjoin', 'factoids', 'exhibitors', 'attend']
};
Object.keys(MARKED).forEach(function (id) {
  MARKED[id].forEach(function (sec) {
    var html = section(id, sec), samples = SC.samplesOf(html, kit);
    ok(samples.wholes.length + samples.texts.length > 0, '3 ' + id + '/' + sec + ' marks its samples', samples);
    var hits = SC.sampleHits(page(onPage(id, sec, html)), kit, samples);
    ok(hits.length > 0 && hits.every(function (h) { return h.places[0] && h.places[0].key === sec; }), '3 ' + id + '/' + sec + ': as the template has it, its samples are found on a page, in that section', hits.slice(0, 2));
  });
  /* never a record's model: speakers, FAQs, contacts, the gallery and the banner are the event's own */
  tpl(id).sections.forEach(function (s) {
    var html = section(id, s.id);
    if (/data-rv-bound=|data-rv-item=/.test(html) || s.id === 'banner') ok(html.indexOf('data-rv-sample') === -1, '3 ' + id + '/' + s.id + ' (records, or the banner) has no samples');
  });
});
/* the figures of the summit spotlight: a figure is known only with its label, and only on a card the owner did not write */
var SPOT = section('tech500', 'summit-spotlight'), spot = SC.samplesOf(SPOT, kit);
ok(spot.wholes.some(function (w) { return w.tag === 'article' && w.cls === 'summit-spotlight-card' && w.text === '500 Decision-Makers CIOS, CTOS, CDOS, CISOS'; }), '3 a figure card is known by all of its words', spot.wholes);
ok(spot.texts.length === 0, '3 … never a short line on its own (no quotes in it)', spot.texts);
var built = SPOT.replace('<article class="summit-spotlight-card" data-rv-sample>', '<article class="summit-spotlight-card" data-rv-sample data-rv-item="stats">');
ok(SC.sampleHits(page(onPage('tech500', 'summit-spotlight', built)), kit, spot).filter(function (h) { return /^500 Decision/.test(h.text); }).length === 0, '3 a card the wizard built from the event\'s own figures is never a sample, even with the same words');
var edited = SPOT.replace('>CIOS, CTOS, CDOS, CISOS<', '>CIOs and CISOs<');
ok(SC.sampleHits(page(onPage('tech500', 'summit-spotlight', edited)), kit, spot).filter(function (h) { return /^500 /.test(h.text); }).length === 0, '3 a card changed in any part is the owner\'s');
ok(SC.sampleHits(page('<section data-rv-section="x"><p>500 Decision-Makers CIOS, CTOS, CDOS, CISOS</p></section>'), kit, spot).length === 0, '3 the same words in another kind of element are not the sample');
var hid = onPage('tech500', 'summit-spotlight').replace('<article class="summit-spotlight-card" data-rv-sample>', '<article class="summit-spotlight-card" data-rv-sample hidden>');
var allSpot = SC.sampleHits(page(onPage('tech500', 'summit-spotlight')), kit, spot).length;
ok(allSpot === 7 && SC.sampleHits(page(hid), kit, spot).length === allSpot - 1, '3 a hidden card is not on the page', [allSpot, SC.sampleHits(page(hid), kit, spot).length]);
/* an icon the design repeats on every card is never a sample: the owner's own cards keep it */
var WHO = section('making-ai-work', 'who-enter');
ok(SC.samplesOf(WHO, kit).srcs.length === 0, '3 the icons of the who-enter cards are not samples', SC.samplesOf(WHO, kit).srcs);
var ownWho = onPage('making-ai-work', 'who-enter', WHO).replace(/<li( class="last")? data-rv-sample>[\s\S]*?<\/li>/g, function (m) {
  return m.replace('data-rv-sample', 'data-rv-sample data-rv-item="keyquestions"').replace(/<h4>[^<]*<\/h4>/, '<h4>Our question</h4>').replace(/<p>[^<]*<\/p>/, '<p>Our own framing of the question, long enough to read.</p>');
}).replace(/<h2 data-rv-sample>[\s\S]*?<\/h2>/, '<h2>Our heading</h2>').replace(/<p data-rv-sample>[^<]*(?:<strong>[^<]*<\/strong>[^<]*)?<\/p>/g, '<p>Our paragraph.</p>');
var whoHits = SC.sampleHits(page(ownWho), kit, SC.samplesOf(WHO, kit));
ok(whoHits.length === 0, '3 who-enter with the owner\'s own heading, paragraphs and cards (the icons kept) has no samples', whoHits);
/* a sample's quote still counts when the card around it changed (the cx-leaders quotes, as before) */
var LEAD = section('cx-leaders-forum', 'leaders'), lead = SC.samplesOf(LEAD, kit);
ok(lead.texts.length === 10 && lead.srcs.length === 10, '3 cx-leaders quotes are still read as before', { texts: lead.texts.length, srcs: lead.srcs.length });
var hits = SC.sampleHits(page(onPage('cx-leaders-forum', 'leaders')), kit, lead);
ok(hits.length === 20 && hits.filter(function (h) { return h.picture; }).length === 10, '3 … an untouched quote card is known by its quote and its photo, as before (never its whole card)', hits.length);
var renamed = SC.sampleHits(page(onPage('cx-leaders-forum', 'leaders', LEAD.replace('Anjani Rathor', 'Asha Rao'))), kit, lead);
ok(renamed.some(function (h) { return /bloodline/.test(h.text) && !/Asha/.test(h.text); }), '3 … a card with only its name changed still shows another event\'s quote', renamed.slice(0, 3));

/* ---------- 4. the check before publishing and the editor ---------- */
var tsamples = api._testHooks.templateSamples ? api._testHooks.templateSamples('tech500') : null;
var SRC = read('functions/lib/api.js');
ok(/samples\.wholes = samples\.wholes\.concat\(got\.wholes\)/.test(SRC), '4 the site check reads each template\'s marked words from its section files');
ok(/hint: 'They belong to another event: its words, figures, quotes, people or logos/.test(SRC), '4 … and says what they are and where they are marked');
var UI = read('editor-template-ui.js');
ok(/function seedSnapshot\(draft\) \{\s*\/\/[^\n]*\n\s*markTemplateSamples\(\);\s*var snap = canvas\.snapshot\(\);/.test(UI), '4 the editor marks a fresh page\'s samples before its first step');
ok(/RevampSamples\.learn\(box\.content, DOM_TREE, out\);/.test(UI) && /RevampSamples\.find\(doc\.body, samples, DOM_TREE,/.test(UI) &&
  /function builtFromData\(n, A\) \{ return !!String\(A\.attr\(n, 'data-rv-item'\) \|\| ''\)\.trim\(\); \}/.test(read('templates/_shared/rv-samples.js')),
  '4 … by the check\'s own rule (templates/_shared/rv-samples.js), never a card filled from the event\'s own content by its whole text');
ok(/' with the design, or with a section or block you added'/.test(UI), '4 the question before publishing says the samples came with the design');
if (tsamples) ok(tsamples.wholes.length >= 30, '4 tech500\'s samples, read from disk', tsamples.wholes.length);

/* ---------- 5. the first-time-user QA (14 Nov 2026) ---------- */
/* NU-034: a heading of two parts, one of them rewritten — the other is still another event's */
var MAW = api._testHooks.templateSamples('making-ai-work');
var ovr = onPage('making-ai-work', 'overview');
var halfDone = ovr.replace('<span>IT IS WHEN AI STARTS CHANGING THE ENTERPRISE ITSELF.</span>', '<span>WHERE PEOPLE STRATEGY MEETS THE MACHINE.</span>');
var halfHits = SC.sampleHits(page(halfDone), kit, MAW).map(function (h) { return h.text; });
ok(halfHits.indexOf('THE NEXT PHASE IS NOT MORE AI.') !== -1 && !halfHits.some(function (t) { return /WHERE PEOPLE/.test(t); }),
  '5 NU-034 a heading with one of its two parts rewritten: the part left as the template wrote it is still found', halfHits);
var bothDone = halfDone.replace('<clr>THE NEXT PHASE IS NOT MORE AI.</clr>', '<clr>OUR OWN FIRST LINE.</clr>');
ok(!SC.sampleHits(page(bothDone), kit, MAW).some(function (h) { return /NEXT PHASE|WHEN AI STARTS/.test(h.text); }), '5 NU-034 … and with both parts rewritten, the heading is the owner\'s');
var figure = onPage('making-ai-work', 'overview-stats').replace(/(<li class="ovr-stat[^"]*"[^>]*><span class="ovr-stat-num">)[^<]+/, '$1' + '9');
ok(SC.sampleHits(page(figure), kit, MAW).every(function (h) { return !/^\d+$/.test(h.text); }), '5 NU-034 a figure on its own is never a part that counts (too short to be another event\'s words)');
/* NU-023: the design's own notes of what to write are samples, said apart */
var MAN = SC.sampleHits(page(onPage('making-ai-work', 'about-wrapper')), kit, MAW);
ok(MAN.length === 1 && MAN[0].instruction === true && /^What this event stands for/.test(MAN[0].text), '5 NU-023 the Manifesto\'s line is a writing tip from the template, not another event\'s words', MAN);
ok(MAW.instructions.length === 1 && api._testHooks.templateSamples('tech500').instructions.length === 4, '5 NU-023 the templates mark their writing tips (data-rv-sample="instruction")',
  [MAW.instructions, api._testHooks.templateSamples('tech500').instructions]);
/* NU-002: the editor's names for the sections (template.json), never their ids in words */
var NAMES = api._testHooks.sectionNamesFor({ site: { templateId: 'making-ai-work' } });
ok(NAMES['who-enter'] === 'Questions this raises' && NAMES['conventions-box'] === 'Who should attend' && NAMES['about-wrapper'] === 'Manifesto' &&
  NAMES['overview-stats'] === 'Key numbers' && NAMES['fact-marquee'] === 'Reasons not to miss', '5 NU-002 a real template\'s sections by their template.json names', NAMES);
var GEN = api._testHooks.sectionNamesFor({ templateId: 'gen-x', designPlan: { sections: [{ id: 'why-attend', name: 'Why you should come' }, { id: 'stats', name: 'stats' }] } });
ok(GEN['why-attend'] === 'Why you should come' && GEN.stats === 'Stats' && GEN.nav === 'Top bar', '5 NU-002 an AI-designed site\'s by its plan, as the editor lists them', GEN);
ok(JSON.stringify(api._testHooks.sectionNamesFor({ templateId: 'imported-x' })) === '{}', '5 NU-002 an imported site has no names of its own (it is one page)');
var named = Object.assign({}, kit, { names: NAMES });
var page2 = page(onPage('making-ai-work', 'who-enter') + onPage('making-ai-work', 'conventions-box') + onPage('making-ai-work', 'about-wrapper') +
  '<section data-rv-section="generic" data-rv-key="generic-2"><h2>Our partners’ pledge</h2><p>Lorem ipsum dolor.</p></section>' +
  '<section data-rv-section="auto-speakers" data-rv-key="auto-speakers"><h2>Speakers</h2></section>');
var where = [];
SC.sampleHits(page2, named, MAW).forEach(function (h) { h.sections.forEach(function (s) { if (where.indexOf(s) === -1) where.push(s); }); });
ok(where.join('|') === 'Questions this raises|Who should attend|Manifesto', '5 NU-002 the samples are named as the site editor names their sections', where);
var ph = SC.placeholderHits(page2, named);
ok(ph.length && ph[0].sections[0] === 'Our partners’ pledge', '5 NU-002 a section the design does not name is named by its heading, never by its id', ph);
ok(SC.sectionName('auto-speakers') === 'Speakers' && SC.sectionName('auto-sessions') === 'Agenda', '5 NU-002 the sections the editor adds for records, by the names it lists them under');
ok(SC.sampleHits(page2, kit, MAW).some(function (h) { return h.sections[0] === 'Who enter'; }), '5 without the names, as before (the id in words): the live page pass is unchanged');
pending4 = api._testHooks.siteCheckOf(null, 'qa-n', { name: 'N', site: { templateId: 'making-ai-work' } }, page(onPage('making-ai-work', 'who-enter') + onPage('making-ai-work', 'about-wrapper')), {}).then(function (r) {
  var s = r.items.filter(function (x) { return x.code === 'samples'; })[0], n = r.items.filter(function (x) { return x.code === 'instructions'; })[0];
  ok(s && s.level === 'block' && s.lines.every(function (l) { return / — Questions this raises$/.test(l); }) && s.fix[0].label === '“Questions this raises” in the site editor' &&
    /&section=who-enter$/.test(s.fix[0].href), '5 NU-002 the check names the section as the editor does, with a link straight to it', s);
  ok(n && n.level === 'block' && n.title === 'A writing tip from the template is still on the page' && / — Manifesto$/.test(n.lines[0]) && !/another event/.test(n.hint) &&
    n.fix[0].label === '“Manifesto” in the site editor', '5 NU-023 a writing tip is said as one, apart from another event\'s samples, and still holds the site back', n);
}, function (err) { ok(false, '5 the site check ran', err && err.stack); });

/* ---------- 6. the editor and the check: one rule (NEW-3), and the banner's own picture (NEW-4) ---------- */
/* the editor's own adapter (editor-template-ui.js DOM_TREE), run as it is over the server's small DOM, against the
   check on the same page: what the editor outlines is what the check lists, piece for piece */
var RS = require('../../templates/_shared/rv-samples.js');
var miniDom = require('./mini-dom'), parseDocument = require('htmlparser2').parseDocument;
var DOM_SRC = /var DOM_TREE = \{[\s\S]*?\n  \};/.exec(UI);
ok(!!DOM_SRC, '6 the editor reads the page through its own adapter (DOM_TREE)');
var DOM_TREE = DOM_SRC ? vm.runInNewContext('(function(){ ' + DOM_SRC[0] + ' return DOM_TREE; })()', { window: { RevampSamples: RS } }) : null;
function domOf(html) { return miniDom.wrapDocument(parseDocument(html)); }
/* as the editor learns the design's samples: each section of the template as the canvas mounts it */
function editorSamples(id) {
  var out = { texts: [], srcs: [], wholes: [], instructions: [] };
  tpl(id).sections.forEach(function (s) {
    var html = onPage(id, s.id);
    if (!/data-rv-sample|data-rv-media="bg-image"/.test(html)) return;
    RS.learn(domOf(html), DOM_TREE, out);
  });
  return out;
}
function editorHits(id, html) {
  var doc = domOf(/<body/i.test(html) ? html : page(html)), out = [];
  RS.find(doc.body, editorSamples(id), DOM_TREE, function (h) { out.push({ text: h.text, kind: h.kind, tag: String(h.node.tagName).toLowerCase(), banner: h.banner }); });
  return out;
}
function checkTexts(id, html) {
  var out = [];
  SC.sampleHits(page(html), kit, api._testHooks.templateSamples(id)).forEach(function (h) { for (var i = 0; i < h.count; i++) out.push(h.text); });
  return out.sort();
}
if (DOM_TREE) {
  TEMPLATES.forEach(function (id) {
    var whole = tpl(id).sections.map(function (s) { return onPage(id, s.id); }).join('');
    var mine = editorHits(id, page(whole)).map(function (h) { return h.text; }).sort(), theirs = checkTexts(id, whole);
    ok(mine.length > 0 && JSON.stringify(mine) === JSON.stringify(theirs), '6 NEW-3 ' + id + ': the editor outlines exactly the samples the check lists (' + theirs.length + ')',
      { editor: mine.length, check: theirs.length, onlyEditor: mine.filter(function (t) { return theirs.indexOf(t) === -1; }).slice(0, 3), onlyCheck: theirs.filter(function (t) { return mine.indexOf(t) === -1; }).slice(0, 3) });
  });
  /* NU-034 / NEW-3: one line of the Overview's heading rewritten — the other line is outlined on its own, as the check names it */
  var halfEditor = editorHits('making-ai-work', halfDone);
  var line = halfEditor.filter(function (h) { return h.text === 'THE NEXT PHASE IS NOT MORE AI.'; })[0];
  ok(line && line.kind === 'part' && line.tag === 'clr' && !halfEditor.some(function (h) { return /WHERE PEOPLE/.test(h.text); }),
    '6 NEW-3 a two-line heading with one line rewritten: the line left is outlined on its own (not the heading), the new one is not', halfEditor);
  ok(JSON.stringify(halfEditor.map(function (h) { return h.text; }).sort()) === JSON.stringify(checkTexts('making-ai-work', halfDone)), '6 NEW-3 … the same as the check lists for that section');
  var bothEditor = editorHits('making-ai-work', bothDone);
  ok(!bothEditor.some(function (h) { return /NEXT PHASE|WHEN AI STARTS/.test(h.text); }), '6 NEW-3 … with both lines rewritten, nothing of the heading is outlined (the check ignores it)', bothEditor);

  /* NEW-4: the banner's own picture (img[data-rv-media="bg-image"]) is a sample of each design, said plainly */
  TEMPLATES.forEach(function (id) {
    var banner = onPage(id, 'banner'), src = /<img src="([^"]+)"[^>]*class="banner-bg-image"/.exec(banner)[1];
    var s = api._testHooks.templateSamples(id);
    ok(s.srcs.indexOf(src) !== -1 && SC.hasSamples(section(id, 'banner')), '6 NEW-4 ' + id + ': the design\'s own banner picture is one of its samples', src);
    var hit = SC.sampleHits(page(banner), kit, s).filter(function (h) { return h.banner; })[0];
    ok(hit && hit.picture && hit.say === 'The banner still shows the design’s sample picture, from another event — replace it' && hit.places[0].key === 'banner',
      '6 NEW-4 ' + id + ': still on the page, the check lists it, said plainly, with the way to the banner', hit);
    var eh = editorHits(id, page(banner)).filter(function (h) { return h.banner; });
    ok(eh.length === 1 && eh[0].kind === 'banner', '6 NEW-4 ' + id + ': … and the editor outlines it as the banner\'s picture', eh);
    var own = banner.replace(src, 'https://storage.googleapis.com/x/events/qa-x/media/our-banner.jpg');
    ok(!SC.sampleHits(page(own), kit, s).some(function (h) { return h.banner; }) && !editorHits(id, page(own)).some(function (h) { return h.banner; }),
      '6 NEW-4 ' + id + ': the event\'s own banner picture is never one');
  });
  pending6 = api._testHooks.siteCheckOf(null, 'qa-n', { name: 'N', site: { templateId: 'making-ai-work' } }, page(onPage('making-ai-work', 'banner')), {}).then(function (r) {
    var s = r.items.filter(function (x) { return x.code === 'samples'; })[0];
    ok(s && s.level === 'block' && s.lines.indexOf('The banner still shows the design’s sample picture, from another event — replace it') !== -1 &&
      s.fix[0].label === '“Banner” in the site editor' && /&section=banner$/.test(s.fix[0].href), '6 NEW-4 the check before publishing holds the site back for it, in plain words, with a link to the banner', s);
  }, function (err) { ok(false, '6 the site check ran', err && err.stack); });

  /* A1-01: the event's banner video with a still of its own. Visitors get the still in the banner picture's place
     (api.js applyHeroVideo), so the design's picture under it is no sample: the check reads the page as served
     (servedSampleHits) and the editor leaves it out of its outline, count and "Show next" by the same rule
     (rv-hero-video-core.js pictureUnderStill). Without a still, that picture is the video's still: it stays one. */
  var HVC = require('../../templates/_shared/rv-hero-video-core.js');
  var VIDEO = { enabled: true, url: 'https://storage.googleapis.com/b/events/qa-x/media/loop.mp4', contentType: 'video/mp4',
    posterUrl: 'https://storage.googleapis.com/b/events/qa-x/media/still.jpg', overlay: { mode: 'auto' }, updatedAt: '2026-11-14T10:00:00.000Z' };
  var NO_STILL = Object.assign({}, VIDEO, { posterUrl: '' }), VIDEO_OFF = Object.assign({}, VIDEO, { enabled: false });
  function isBanner(h) { return h.banner; }
  function servedHits(id, html, hv) { return api._testHooks.servedSampleHits(html, { site: { templateId: id }, heroVideo: hv }, kit); }
  function hitCount(list) { return list.reduce(function (n, h) { return n + h.count; }, 0); }
  /* the editor's own marking, run as it is (editor-template-ui.js, from SAMPLE_LEFT to samplesLeft, and heroVideoChanged)
     on a small DOM of the page, the canvas's untouched copies of the sections as its library */
  function fnText(name) {
    var i = UI.indexOf('  function ' + name + '('), open = UI.indexOf('{', i), depth = 0;
    for (var j = open; i !== -1 && j < UI.length; j++) {
      if (UI[j] === '{') depth++;
      else if (UI[j] === '}' && --depth === 0) return UI.slice(i, j + 1);
    }
    return '';
  }
  var MARK_SRC = UI.slice(UI.indexOf('  var SAMPLE_LEFT = '), UI.indexOf('  var sampleCursor = -1;'));
  ok(/function markTemplateSamples\(\)/.test(MARK_SRC) && /function samplesLeft\(\)/.test(MARK_SRC) && /function bannerUnderStill\(doc\)/.test(MARK_SRC) &&
    /markTemplateSamples\(\);/.test(fnText('heroVideoChanged')), '6 A1-01 the editor\'s marking and its banner-video change, read from its source');
  function editorOn(id, html, hv) {
    var doc = domOf(html), box = {
      window: { RevampSamples: RS, RevampHeroVideoCore: HVC }, RevampSamples: RS, templateId: id, heroVideo: hv || null, remounting: false, changeListeners: [],
      editorWords: { placeholderLeft: function () { return true; } }, console: console,
      canvas: { doc: doc, pictureOf: function () { return ''; }, library: function () { return tpl(id).sections.map(function (s) { return { id: s.id, html: onPage(id, s.id) }; }); } }
    };
    vm.runInNewContext(MARK_SRC + fnText('drawHeroVideo') + '\n' + fnText('heroVideoChanged') +
      '\nthis.ed = { mark: markTemplateSamples, left: samplesLeft, changed: heroVideoChanged, listen: function (fn) { changeListeners.push(fn); } };', box);
    var ed = box.ed;
    ed.doc = doc;
    ed.bannerMark = function () { var img = doc.querySelector('img.banner-bg-image'); return img ? img.getAttribute('data-rv-sample-left') : null; };
    return ed;
  }
  TEMPLATES.forEach(function (id) {
    var whole = page(tpl(id).sections.map(function (s) { return onPage(id, s.id); }).join(''));
    var still = servedHits(id, whole, VIDEO), none = servedHits(id, whole, null), noStill = servedHits(id, whole, NO_STILL), off = servedHits(id, whole, VIDEO_OFF);
    ok(!still.some(isBanner) && none.some(isBanner) && noStill.some(isBanner) && off.some(isBanner),
      '6 A1-01 ' + id + ': the check lists the banner\'s sample picture unless the banner video has a still of its own (no video, a video without a still, a video switched off: listed)',
      { still: still.filter(isBanner).length, none: none.filter(isBanner).length, noStill: noStill.filter(isBanner).length, off: off.filter(isBanner).length });
    ok(hitCount(still) === hitCount(none) - 1 && JSON.stringify(still.map(function (h) { return h.text; })) === JSON.stringify(none.filter(function (h) { return !h.banner; }).map(function (h) { return h.text; })),
      '6 A1-01 ' + id + ': … and the still changes nothing else the check lists', { still: hitCount(still), none: hitCount(none) });
    [[VIDEO, still, 'a still of its own'], [NO_STILL, noStill, 'no still'], [null, none, 'no video']].forEach(function (c) {
      var ed = editorOn(id, whole, c[0]), marked = ed.mark(), left = ed.left();
      ok(marked === hitCount(c[1]) && ed.bannerMark() === (c[0] === VIDEO ? null : 'banner') && left.banner === (c[0] === VIDEO ? 0 : 1) && left.total === marked,
        '6 A1-01 ' + id + ' (' + c[2] + '): the editor outlines and counts exactly what the check lists, the banner\'s picture with it or not',
        { marked: marked, check: hitCount(c[1]), banner: ed.bannerMark(), left: left });
    });
    /* the video or its still changed in Design › Banner video: outlined again, or no longer, before the line above the
       page and the first steps count them (they listen to the change) */
    var ed = editorOn(id, whole, VIDEO), heard = [];
    ed.mark();
    ed.listen(function () { heard.push(ed.left().banner); });
    ed.changed(NO_STILL);
    var afterNoStill = ed.bannerMark();
    ed.changed(VIDEO);
    var afterStill = ed.bannerMark();
    ed.changed(null);
    ok(afterNoStill === 'banner' && afterStill === null && ed.bannerMark() === 'banner' && heard.join() === '1,0,1',
      '6 A1-01 ' + id + ': taking the still away outlines the banner\'s picture again, giving one back takes the outline off, and the count is told after', { afterNoStill: afterNoStill, afterStill: afterStill, heard: heard });
  });
  /* the page has no banner video layer (an edit took it out): nothing is served over the picture, so it stays one */
  var noLayer = page(onPage('making-ai-work', 'banner').replace(/<div class="bnr-bg-video" data-rv-media="bg-video"><\/div>/, ''));
  ok(noLayer.indexOf('bnr-bg-video') === -1 && servedHits('making-ai-work', noLayer, VIDEO).some(isBanner) && editorOn('making-ai-work', noLayer, VIDEO).mark() === 1,
    '6 A1-01 a banner with no place for the video keeps its picture, and the check and the editor still count it');
  pending6b = Promise.all([
    api._testHooks.siteCheckOf(null, 'qa-n', { name: 'N', site: { templateId: 'making-ai-work' }, heroVideo: VIDEO }, page(onPage('making-ai-work', 'banner')), {}),
    api._testHooks.siteCheckOf(null, 'qa-n', { name: 'N', site: { templateId: 'making-ai-work' }, heroVideo: NO_STILL }, page(onPage('making-ai-work', 'banner')), {})
  ]).then(function (r) {
    var withStill = r[0].items.filter(function (x) { return x.code === 'samples'; })[0], without = r[1].items.filter(function (x) { return x.code === 'samples'; })[0];
    ok(!withStill, '6 A1-01 the check before publishing does not hold a site back for a banner picture its video\'s still covers', r[0].items);
    ok(without && without.level === 'block' && without.lines[0] === 'The banner still shows the design’s sample picture, from another event — replace it',
      '6 A1-01 … and still does when the video has no still of its own (the picture is its still)', without);
  }, function (err) { ok(false, '6 A1-01 the site check ran', err && err.stack); });
}

var pending4, pending6, pending6b;
Promise.all([pending4, pending6, pending6b]).then(function () {
  if (failures.length) {
    console.error('template-samples: ' + failures.length + ' of ' + checks + ' checks failed:\n  - ' + failures.join('\n  - '));
    process.exit(1);
  }
  console.log('template-samples: all ' + checks + ' checks passed');
});
