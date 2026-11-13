/* node functions/lib/site-draw.test.js — what a saved site shows of the event itself (launch check, 13 Nov 2026):
     1. functions/lib/mini-dom.js: the DOM the browser code runs on, on the server — selectors, a <template>'s content
        apart, a style written as a browser writes it
     2. templates/_shared/rv-draw.js, Basics: the date in each site's own style (the same words as gen-design.js,
        et-nav.js and editor-fill.js write), a date not fixed yet, the place
     3. the four real templates' record lists drawn by the server (site-records.js renderRecords with opts): records
        reach the staged copy without the editor (TPL-034), the last one deleted takes its card away (TPL-007, ED-050),
        a list with none shows no model card and its section leaves the page (TPL-008); a second draw changes nothing
     4. Basics reach the banner (TPL-009, TPL-026) and an AI-designed site's banner and top bar (BE-040): a page made
        before the marks is marked, a detail rewritten by hand is kept, nothing for an imported site
     5. the site editor draws the same as the server (its own functions, run on the same page), and a detail it is
        given by hand stops following Basics
     6. the console's Basics show and change a date not fixed yet (CON-051), and stage the site when what it shows
        changes; Create Event sends the date not fixed yet, the client and the city (WZ-054)
     7. the approval list: marks alone are no change
   No network, no Firebase, no browser, no AI. Exits 1 listing every failure. */
'use strict';
var fs = require('fs'), path = require('path');
var failures = [], checks = 0;
function check(label, cond, detail) { checks++; if (!cond) failures.push(label + (detail !== undefined ? '\n      ' + String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 700) : '')); }
var ROOT = path.join(__dirname, '..', '..');
function read(f) { return fs.readFileSync(path.join(ROOT, f), 'utf8'); }

var MD = require('./mini-dom');
var RD = require('../../templates/_shared/rv-draw.js');
var SR = require('./site-records');
var genDesign = require('./gen-design');
var etNav = require('./et-nav');
var diffPages = require('./page-diff').diffPages;
var parseDocument = require('htmlparser2').parseDocument;
function docOf(html) { return MD.wrapDocument(parseDocument(html, { lowerCaseTags: false, lowerCaseAttributeNames: false })); }
function shown(html) { return String(html || '').replace(/<template[\s\S]*?<\/template>/g, ''); }
function sectionOf(html, id) {
  var m = new RegExp('<([a-z]+)[^>]*data-rv-section="' + id + '"[^>]*>').exec(html);
  if (!m) return '';
  var doc = docOf(html), el = doc.querySelector('[data-rv-section="' + id + '"]');
  return el ? el.outerHTML : '';
}
/* a real template's page as the loader builds it: each section file, its root marked with its id */
function templatePage(tpl, navLinks) {
  var j = JSON.parse(read('templates/' + tpl + '/template.json'));
  var body = j.sections.map(function (s) {
    var f = path.join(ROOT, 'templates', tpl, 'sections', s.id, 'index.html');
    if (!fs.existsSync(f)) return '';
    return fs.readFileSync(f, 'utf8').replace(/^(\s*(?:<!--[\s\S]*?-->\s*)*)<([a-z]+)/i, function (a, lead, tag) { return lead + '<' + tag + ' data-rv-section="' + s.id + '"'; });
  }).join('\n');
  return '<!DOCTYPE html><html><head><title>t</title></head><body>\n<header data-rv-section="nav">' + (navLinks || '') + '</header>\n' + body + '\n<footer data-rv-section="footer"></footer></body></html>';
}
var EV = { name: 'QA Summit 2027', start: '2027-03-14T09:00', end: '2027-03-15T18:00', venue: 'Grand Hyatt', city: 'Mumbai' };

/* ===================== 1. the DOM on the server ===================== */
(function () {
  var doc = docOf('<html><body><div class="a"><p class="x">1</p><span class="icn"><i class="bi bi-calendar3"></i> Date</span><template data-rv-pristine="k"><p class="x">model</p></template></div><ul><li>a</li><li>b</li></ul></body></html>');
  check('1.1 selectors: :has, >, :first-child, :last-child, an attribute', doc.querySelectorAll('.icn:has(.bi-calendar3)').length === 1 && doc.querySelectorAll('ul > li:first-child').length === 1 &&
    doc.querySelector('ul > li:last-child').textContent === 'b' && doc.querySelectorAll('[data-rv-pristine="k"]').length === 1 && doc.querySelectorAll('div:has(> p)').length === 1);
  check('1.2 nothing in a <template> is found from the page, only from its content', doc.querySelectorAll('.x').length === 1 && doc.querySelector('template').content.querySelectorAll('.x').length === 1 &&
    doc.querySelector('template').textContent === '' && doc.querySelector('.a').textContent === '1 Date');
  var icn = doc.querySelector('.icn');
  icn.style.display = 'none';
  check('1.3 a style is written as a browser writes it, and goes when emptied (the attribute stays, as in a browser)', icn.getAttribute('style') === 'display: none;' && (icn.style.display = '', icn.getAttribute('style') === ''));
  var li = doc.createElement('li');
  li.textContent = 'c';
  doc.querySelector('ul').insertBefore(li, null);
  check('1.4 elements are made, put and written back', MD.render(doc.querySelector('ul')) === '<ul><li>a</li><li>b</li><li>c</li></ul>' && li.parentNode === doc.querySelector('ul') && li.previousElementSibling.textContent === 'b');
  li.classList.add('on', 'x'); li.classList.remove('x');
  check('1.5 classList', li.className === 'on' && li.closest('ul') === doc.querySelector('ul') && li.matches('ul > .on'));
})();

/* ===================== 2. Basics: the date and the place ===================== */
(function () {
  var fill = SR.__fill ? SR.__fill() : null;
  var cases = [['2027-03-14', ''], ['2027-03-14T09:00', '2027-03-15T18:00'], ['2027-03-30', '2027-04-02'], ['2027-12-30', '2028-01-02'], ['2027-03-14', '2027-03-14']];
  var vm = require('vm'), ctx = { window: { console: console } };
  vm.createContext(ctx);
  vm.runInContext(read('editor-fill.js'), ctx);
  var F = ctx.window.RevampFill;
  var same = cases.every(function (c) {
    var ev = { start: c[0], end: c[1] };
    var dIso = function (v) { return v ? v.slice(0, 10) : ''; };
    return RD.dateText(ev, 'long') === genDesign.dateLabel(c[0], c[1]) && RD.dateText(ev, 'short') === etNav.shortDate(c[0], c[1]) &&
      RD.dateText(ev, '') === F.formatDate({ mode: 'exact', start: dIso(c[0]), end: dIso(c[1]) }) &&
      RD.dateText(ev, 'day') === F.formatDate({ mode: 'exact', start: dIso(c[0]), end: dIso(c[1]) }, 'day');
  });
  check('2.1 the date in each site\'s own words: the AI-designed banner\'s, its top bar\'s, and ET\'s own (editor-fill.js)', same,
    cases.map(function (c) { var ev = { start: c[0], end: c[1] }; return [RD.dateText(ev, 'long'), genDesign.dateLabel(c[0], c[1]), RD.dateText(ev, 'short'), etNav.shortDate(c[0], c[1]), RD.dateText(ev, '')]; }));
  check('2.2 ET\'s style: "14th – 15th March, 2027"; the "day" style without the ordinal', RD.dateText(EV, '') === '14th – 15th March, 2027' && RD.dateText(EV, 'day') === '14 – 15 March, 2027');
  check('2.3 a date not fixed yet: its words, else what its parts make; nothing invented', RD.dateText({ dateLabel: 'March 2027' }, 'long') === 'March 2027' &&
    RD.dateText({ dateMode: 'quarter', datePartial: { quarter: 'Q2', year: '2027' } }) === 'Q2 2027' && RD.dateText({ dateMode: 'month', datePartial: { month: '2027-03' } }) === 'March 2027' &&
    RD.dateText({ dateMode: 'tbd' }) === 'Date to be announced' && RD.dateText({ dateMode: 'none' }) === '' && RD.dateText({}) === '' &&
    RD.dateText({ start: '2027-03-14', dateLabel: 'Q2 2027' }, '') === '14th March, 2027');
  check('2.4 the place: venue and city, the city once; only the venue when the page shows the city apart', RD.placeText({ venue: 'Grand Hyatt', city: 'Mumbai' }) === 'Grand Hyatt, Mumbai' &&
    RD.placeText({ venue: 'Taj Mumbai', city: 'Mumbai' }) === 'Taj Mumbai' && RD.placeText({ city: 'Pune' }) === 'Pune' && RD.placeText({ venue: 'X', city: 'Y' }, true) === 'X' && RD.placeText({}) === '');
})();

/* ===================== 3. the real templates' record lists, by the server ===================== */
var TEMPLATES = {
  'tech500': { faqs: 'faq', contacts: 'contact-us' },
  'cx-leaders-forum': { speakers: 'speakers', gallery: 'glimpses_event', faqs: 'faqs', contacts: 'contact-us' },
  'retail-leadership-summit': { partners: 'partners', gallery: 'glimpses', faqs: 'faq', contacts: 'contact-us' },
  'making-ai-work': { speakers: 'our-speakers', gallery: 'glimpses_event', contacts: 'contact-us' }
};
var ROWS = {
  speakers: [{ id: 's1', name: 'Meera Iyer', desig: 'CTO', comp: 'Acme', status: 'confirmed', order: 0 }, { id: 's2', name: 'Ravi Invited', status: 'invited', order: 1 }],
  faqs: [{ id: 'f1', question: 'Is parking free?', answer: 'Yes, in the basement.', order: 0 }],
  partners: [{ id: 'p1', name: 'Acme', tierId: 't1', logoUrl: 'https://x.test/acme.png', url: 'https://acme.test', order: 0 }],
  'partner-tiers': [{ id: 't1', name: 'Gold', order: 0 }],
  contacts: [{ id: 'c1', label: 'Sponsorship', name: 'Asha Rao', email: 'asha@acme.test', phone: '', order: 0 }],
  gallery: [{ id: 'g1', imageUrl: 'https://x.test/day1.jpg', caption: 'Day 1', order: 0 }]
};
var NAMES = { speakers: 'Meera Iyer', faqs: 'Is parking free?', partners: 'Acme', contacts: 'Asha Rao', gallery: 'https://x.test/day1.jpg' };
var MODELS = { speakers: '>Speaker name<', faqs: '>Question<', partners: '>Partner name<', contacts: '>name@company.com<', gallery: '' };
Object.keys(TEMPLATES).forEach(function (tpl) {
  var want = TEMPLATES[tpl], res = Object.keys(want);
  var page = templatePage(tpl);
  /* a page nobody has drawn yet, the event with no records at all: no model card shows, every section leaves the page */
  var none = {};
  res.forEach(function (r) { none[r] = []; });
  if (res.indexOf('partners') !== -1) none['partner-tiers'] = [];
  var empty = SR.renderRecords(page, none, { templateId: tpl });
  var models = res.filter(function (r) { return MODELS[r] && shown(sectionOf(empty.html, want[r])).indexOf(MODELS[r]) !== -1; });
  var unmarked = res.filter(function (r) { return !/data-rv-empty="/.test(sectionOf(empty.html, want[r]).slice(0, 400)); });
  check('3.' + tpl + '.1 TPL-008: with no records, no model card is shown and each records section is marked empty (hidden on the site)', !models.length && !unmarked.length, { models: models, unmarked: unmarked });

  var rows = {};
  res.forEach(function (r) { rows[r] = ROWS[r]; });
  if (res.indexOf('partners') !== -1) rows['partner-tiers'] = ROWS['partner-tiers'];
  var full = SR.renderRecords(empty.html, rows, { templateId: tpl });
  var missing = res.filter(function (r) { return shown(sectionOf(full.html, want[r])).indexOf(NAMES[r]) === -1; });
  var stillEmpty = res.filter(function (r) { return /data-rv-empty="/.test(sectionOf(full.html, want[r]).slice(0, 400)); });
  check('3.' + tpl + '.2 TPL-034: the records reach the page without the editor, and their sections come back', full.changed && !missing.length && !stillEmpty.length && !full.unplaced.length, { missing: missing, stillEmpty: stillEmpty, unplaced: full.unplaced });
  check('3.' + tpl + '.3 an Invited speaker is not drawn', shown(full.html).indexOf('Ravi Invited') === -1);
  var again = SR.renderRecords(full.html, rows, { templateId: tpl });
  check('3.' + tpl + '.4 drawing the same records again changes nothing', !again.changed && again.html === full.html);
  var items = diffPages(empty.html, full.html);
  check('3.' + tpl + '.5 the approver reads them as records added, one each, and nothing else', items.length === res.length && items.every(function (i) { return i.type === 'record-added'; }),
    items.map(function (i) { return i.type + ' ' + i.name + ' ' + (i.after || i.before); }));
  var gone = SR.renderRecords(full.html, none, { templateId: tpl });
  var left = res.filter(function (r) { return shown(sectionOf(gone.html, want[r])).indexOf(NAMES[r]) !== -1; });
  check('3.' + tpl + '.6 TPL-007 / ED-050: the last record of each kind deleted, its cards leave the page', gone.changed && !left.length &&
    diffPages(full.html, gone.html).every(function (i) { return i.type === 'record-removed'; }), left);
});
(function () {
  var page = templatePage('tech500', '<a href="#frequently-asked-questions">FAQ</a><a href="#register" data-register-cta>Register</a>');
  var r = SR.renderRecords(page, { faqs: [], contacts: [] }, { templateId: 'tech500' });
  check('3.7 the menu\'s link to an emptied section goes with it (a Register button never)', /<a href="#frequently-asked-questions" data-rv-nav-empty="">FAQ<\/a>/.test(r.html) && /<a href="#register" data-register-cta="">Register<\/a>/.test(r.html), r.html.slice(0, 300));
  var back = SR.renderRecords(r.html, { faqs: ROWS.faqs, contacts: [] }, { templateId: 'tech500' });
  check('3.8 …and comes back with the first FAQ', /<a href="#frequently-asked-questions">FAQ<\/a>/.test(back.html) && back.filled.indexOf('faq') !== -1 && back.emptied.indexOf('contact') !== -1);
  var notRead = SR.renderRecords(back.html, { contacts: [] }, { templateId: 'tech500' });
  check('3.9 a kind whose records were not read is left as it is', shown(sectionOf(notRead.html, 'faq')).indexOf('Is parking free?') !== -1);
  var bytes = SR.renderRecords(page, { faqs: ROWS.faqs }, { templateId: 'tech500' });
  var at = page.indexOf('data-rv-section="faq"'), atNew = bytes.html.indexOf('data-rv-section="faq"');
  var why = /<section data-rv-section="why-now"[\s\S]*?<\/section>/.exec(page);
  check('3.10 only the sections drawn are written again: every other byte stays', at > 0 && bytes.html.slice(0, atNew) === page.slice(0, at) && why && bytes.html.indexOf(why[0]) !== -1);
})();

/* ===================== 4. Basics reach the banner ===================== */
(function () {
  var page = templatePage('tech500');
  var r = SR.renderRecords(page, {}, { templateId: 'tech500', event: EV });
  var banner = sectionOf(r.html, 'banner'), si = sectionOf(r.html, 'strategic-influence');
  check('4.1 TPL-009 / TPL-026: the banner shows Basics\' name, date and place', /<h1 class="banner-title" data-rv-bind="event.name">QA Summit 2027<\/h1>/.test(banner) &&
    /<div class="icn-box" data-rv-bind="event.date"><i class="bi bi-calendar3"><\/i> 14th – 15th March, 2027<\/div>/.test(banner) &&
    /<div class="icn-box" data-rv-bind="event.venue"><i class="bi bi-geo-alt"><\/i> Grand Hyatt, Mumbai<\/div>/.test(banner), banner.slice(0, 900));
  check('4.2 …and tech500\'s second line, in its own style', /data-rv-bind-style="day">14 – 15 March, 2027<\/span>/.test(si) && /<span data-rv-bind="event.venue">Grand Hyatt, Mumbai<\/span>/.test(si), si.slice(0, 900));
  var moved = SR.renderRecords(r.html, {}, { templateId: 'tech500', event: Object.assign({}, EV, { start: '', end: '', dateLabel: 'March 2027', venue: 'Jio World Centre', name: 'QA Summit 2027 Mumbai' }) });
  var b2 = sectionOf(moved.html, 'banner');
  check('4.3 a change in Basics reaches it: a date not fixed yet, a new venue and name', /> March 2027<\/div>/.test(b2) && /> Jio World Centre, Mumbai<\/div>/.test(b2) && />QA Summit 2027 Mumbai<\/h1>/.test(b2), b2.slice(0, 900));
  check('4.4 the approver reads it as the banner\'s words changing', diffPages(r.html, moved.html).some(function (i) { return i.section === 'banner' && i.type === 'text'; }));
  var noVenue = SR.renderRecords(r.html, {}, { templateId: 'tech500', event: Object.assign({}, EV, { venue: '', city: '' }) });
  check('4.5 a place Basics do not have: the line is empty and marked, so the site does not show it (nothing made up)', /<div class="icn-box" data-rv-bind="event.venue" data-rv-bind-empty="1"><i class="bi bi-geo-alt"><\/i> <\/div>/.test(sectionOf(noVenue.html, 'banner')),
    sectionOf(noVenue.html, 'banner').slice(0, 900));
  /* a page saved before the section files carried the marks: content.bind marks them */
  var old = page.replace(/ data-rv-bind="event\.(date|venue)"( data-rv-bind-style="day")?/g, '');
  var o = SR.renderRecords(old, {}, { templateId: 'tech500', event: EV });
  check('4.6 a page saved before the marks: content.bind marks the banner\'s date and place and tech500\'s second line (with its style)',
    /<div class="icn-box" data-rv-bind="event.date"><i class="bi bi-calendar3"><\/i> 14th – 15th March, 2027<\/div>/.test(o.html) && /data-rv-bind="event.date" data-rv-bind-style="day">14 – 15 March, 2027</.test(o.html), sectionOf(o.html, 'strategic-influence').slice(0, 700));
  /* the owner's own words stay theirs */
  var own = r.html.replace('<h1 class="banner-title" data-rv-bind="event.name">QA Summit 2027</h1>', '<h1 class="banner-title" data-rv-unbound="event.name">The Big One</h1>');
  check('4.7 a detail the owner rewrote by hand (data-rv-unbound) keeps their words', /The Big One/.test(SR.renderRecords(own, {}, { templateId: 'tech500', event: EV }).html));
  check('4.8 an imported site shows its own copy: nothing is drawn on it', SR.renderRecords('<html><body><section data-rv-section="hero"><span data-rv-bind="event.name">Old</span></section></body></html>', {}, { templateId: 'imported-x', event: EV }).changed === false);
  var hinted = noVenue.html.replace('<div class="icn-box" data-rv-bind="event.venue" data-rv-bind-empty="1"><i class="bi bi-geo-alt"></i> </div>',
    '<div class="icn-box" data-rv-bind="event.venue" data-rv-bind-empty="1"><i class="bi bi-geo-alt"></i> <span data-rv-editor="" data-rv-bind-hint="" data-ed="none" style="opacity:.55;font-style:italic">Add the venue in Basics</span></div>');
  check('4.9 the editor\'s hint in an empty detail stays through the server\'s draw (no change nobody made), and goes with a value',
    SR.renderRecords(hinted, {}, { templateId: 'tech500', event: Object.assign({}, EV, { venue: '', city: '' }) }).changed === false &&
    !/data-rv-bind-hint/.test(sectionOf(SR.renderRecords(hinted, {}, { templateId: 'tech500', event: EV }).html, 'banner')));

  /* an AI-designed site: its banner and top bar (BE-040) */
  var hero = genDesign.heroHtml({ date: '14–15 March 2027', place: 'Grand Hyatt, Mumbai', tagline: 'T' });
  var nav = etNav.build({ name: 'QA Summit 2027', sub: { date: '14–15 Mar 2027', place: 'Grand Hyatt, Mumbai' } }).html;
  check('4.10 a new AI-designed site\'s banner and top bar carry the marks', /class="hero-fact" data-rv-bind="event.date" data-rv-bind-style="long"/.test(hero) && /class="hero-fact" data-rv-bind="event.venue"/.test(hero) &&
    /class="rv-etnav-name" href="#hero" data-rv-bind="event.name"/.test(nav) && /class="rv-etnav-date" data-rv-bind="event.date" data-rv-bind-style="short"/.test(nav) && /class="rv-etnav-place" data-rv-bind="event.venue"/.test(nav));
  var genPage = '<!DOCTYPE html><html><body>' + nav.replace('<header ', '<header data-rv-section="nav" ') + hero.replace('<section ', '<section data-rv-section="hero" ') + '</body></html>';
  var g = SR.renderRecords(genPage, {}, { templateId: 'gen-qa', event: Object.assign({}, EV, { venue: 'Jio World Centre', start: '2027-04-01', end: '2027-04-02' }) });
  check('4.11 BE-040: a change in Basics reaches an AI-designed site\'s banner and top bar, each in its own words, the markup otherwise as it was',
    /data-rv-bind-style="long">(<svg[\s\S]*?<\/svg>)<span>1–2 April 2027<\/span>/.test(g.html) && />Jio World Centre, Mumbai<\/span><\/span>/.test(g.html) &&
    /data-rv-bind-style="short">1–2 Apr 2027<\/span>/.test(g.html) && /class="rv-etnav-place" data-rv-bind="event.venue">Jio World Centre, Mumbai</.test(g.html), g.html.slice(0, 1500));
  var before = genPage.replace(/ data-rv-bind="[^"]*"| data-rv-bind-style="[^"]*"/g, '').replace('>QA Summit 2027</a>', '>QA Summit</a>');
  var b = SR.renderRecords(before, {}, { templateId: 'gen-qa', event: EV });
  check('4.12 an AI-designed site built before the marks: its banner\'s and top bar\'s date and place are marked; a top-bar name the owner shortened is not',
    /<span class="hero-fact" data-rv-bind="event.date" data-rv-bind-style="long">/.test(b.html) && /<span class="hero-fact" data-rv-bind="event.venue">/.test(b.html) &&
    /<span class="rv-etnav-date" data-rv-bind="event.date" data-rv-bind-style="short">14–15 Mar 2027</.test(b.html) && />QA Summit<\/a>/.test(b.html) && !/rv-etnav-name[^>]*data-rv-bind/.test(b.html), b.html.slice(0, 1200));
  check('4.13 marks alone are no change for the approver', diffPages(before, b.html).length === 0, diffPages(before, b.html));
})();

/* ===================== 5. the site editor draws the same ===================== */
(async function () {
  var ED = read('editor-template-ui.js');
  function fnSrc(name) {
    var at = ED.indexOf('  function ' + name + '(');
    if (at < 0) return '';
    var open = ED.indexOf('{', at), depth = 0, q = null;
    for (var i = open; i < ED.length; i++) {
      var c = ED[i];
      if (q) { if (c === '\\') { i++; continue; } if (c === q) q = null; continue; }
      if (c === '"' || c === "'") { q = c; continue; }
      if (c === '/' && ED[i + 1] === '/') { i = ED.indexOf('\n', i); continue; }
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (!depth) return ED.slice(at, i + 1); }
    }
    return '';
  }
  var names = ['fetchMapContent', 'noteMapEmpty', 'avatarAddress', 'drawEventFacts', 'fillEmptyNote'];
  var missing = names.filter(function (n) { return !fnSrc(n); });
  check('5.0 the editor\'s functions are found', !missing.length, missing);
  var vm = require('vm'), ctx = { window: { console: console } };
  vm.createContext(ctx);
  vm.runInContext(read('editor-fill.js'), ctx);
  var RR = require('../../templates/_shared/rv-records.js');
  var make = new Function('window', 'RevampDraw', 'RevampFill', 'RevampRecords', 'RevampCore', 'canvas', 'eventId', 'currentEvent', 'templateId',
    names.map(fnSrc).join('\n') + '\nreturn { fetchMapContent: fetchMapContent, noteMapEmpty: noteMapEmpty, avatarAddress: avatarAddress, drawEventFacts: drawEventFacts };');
  async function editorDraw(tpl, html, rows, ev) {
    var doc = docOf(html), template = JSON.parse(read('templates/' + tpl + '/template.json'));
    var canvas = { doc: doc, template: template, retag: function () {} };
    var E = make({ RevampDraw: RD }, RD, ctx.window.RevampFill, RR, { fetchSub: function (r) { return Promise.resolve(rows[r] || []); } }, canvas, 'qa-x', ev, tpl);
    var content = await E.fetchMapContent();
    RD.drawMapLists(doc, template.content.map, content, { fill: ctx.window.RevampFill, avatar: E.avatarAddress(), retag: canvas.retag, notice: E.noteMapEmpty });
    E.drawEventFacts();
    return doc;
  }
  var tpl = 'cx-leaders-forum', page = templatePage(tpl);
  var rows = { speakers: ROWS.speakers, faqs: [], contacts: ROWS.contacts, gallery: ROWS.gallery };
  var doc = await editorDraw(tpl, page, rows, EV);
  var server = SR.renderRecords(page, rows, { templateId: tpl, event: EV }).html;
  var strip = function (h) { return h.replace(/<div data-rv-empty-state="[^"]*"[\s\S]*?<\/span><\/div>/g, ''); };
  var differ = ['banner', 'speakers', 'faqs', 'contact-us', 'glimpses_event'].filter(function (id) {
    return strip(doc.querySelector('[data-rv-section="' + id + '"]').outerHTML) !== sectionOf(server, id);
  });
  check('5.1 the editor draws a real template\'s records and Basics exactly as the server does (but for its own notices)', !differ.length, differ);
  var note = doc.querySelector('[data-rv-section="faqs"] [data-rv-empty-state="faq"]');
  check('5.2 …and says, in the emptied section, why visitors do not see it and where to add them', note && /^No FAQs yet: visitors do not see this section until there are some\. Add FAQs in Content › FAQ ↗$/.test(note.textContent) &&
    note.hasAttribute('data-rv-editor'), note && note.textContent);
  var waiting = await editorDraw(tpl, page, { speakers: [ROWS.speakers[1]] }, EV);
  var w = waiting.querySelector('[data-rv-section="speakers"] [data-rv-empty-state="speakers"]');
  check('5.3 …and how many speakers wait to be confirmed', w && w.getAttribute('data-rv-empty-waiting') === '1' && /Invited or Tentative/.test(w.textContent), w && w.textContent);
  var hintDoc = await editorDraw('tech500', templatePage('tech500'), {}, Object.assign({}, EV, { venue: '', city: '' }));
  var hint = hintDoc.querySelector('[data-rv-bind="event.venue"] [data-rv-bind-hint]');
  check('5.4 a detail Basics do not have says where to add it, in the editor only', hint && hint.textContent === 'Add the venue in Basics' && hint.hasAttribute('data-rv-editor'));
  var fill = fnSrc('fillRecords'), exit = fnSrc('exitEdit'), detach = fnSrc('detachFact'), enter = fnSrc('enterEdit');
  check('5.5 the editor draws them when it opens a site (its records step), the old one-shot copy is gone', /fetchMapContent\((?:unread)?\)/.test(fill) && /RevampDraw\.drawMapLists\(/.test(fill) && /drawEventFacts\(\)/.test(fill) &&
    !/fetchSubcollectionOverlay|translateSpeakers|SUBCOLLECTION_SOURCES/.test(ED));
  check('5.6 a detail rewritten by hand stops following Basics (data-rv-unbound); its hint is never typed into', /detachFact\(el\)/.test(exit) && /setAttribute\('data-rv-unbound', bound\.getAttribute\('data-rv-bind'\)\)/.test(detach) &&
    /\[data-rv-bind-hint\][\s\S]*contenteditable', 'false'/.test(enter));

  /* ===================== 6. the console and Create Event ===================== */
  var CON = read('edit-event.html');
  check('6.1 CON-051: Basics shows and changes the date not fixed yet, stored as dateLabel', /id="b-datelabel"/.test(CON) && /datelabel:'dateLabel'/.test(CON) && /datelabel: \$\('b-datelabel'\)/.test(CON));
  check('6.2 …and the console uses its words instead of "No start date yet" / "Date to be announced"', /trimmed\('datelabel'\) \? \{ cls:'', ico:IC\.clock, txt:'<b>'/.test(CON) &&
    /var when = s\.a \? fmtDT\(localIso\(s\.a\)\) : \(trimmed\('datelabel'\) \|\| 'Date to be announced'\);/.test(CON) && /EV\.start \? fmtDT\(EV\.start\) : \(String\(EV\.dateLabel \|\| ''\)\.trim\(\)/.test(CON));
  check('6.3 a saved change to what the site shows (name, dates, place) is drawn into the site\'s staged copy at once, with the site bar on Basics',
    /var ON_SITE = \{ name: 1, start: 1, end: 1, venue: 1, city: 1, datelabel: 1 \};/.test(CON) && /if \(changed\.some\(function\(k\)\{ return ON_SITE\[k\]; \}\)\) contentChanged\(\);/.test(CON) &&
    /SUB_ROUTE_KEY\[r\] \|\| r === 'content\/basics' \? siteBarHTML\(\) : ''/.test(CON));
  var FX = require('./fixtures/create-event-page');
  var p = FX.load();
  p.ce('S.creationMethod = "brief"; S.basics.category = "IP"; S.basics.name = "QA Summit"; S.basics.dateMode = "month"; S.basics.month = "2027-03"; S.basics.venue = "Grand Hyatt"; S.basics.city = "Mumbai"');
  var rec = JSON.parse(JSON.stringify(p.ce('eventRecordFromBasics()')));
  check('6.4 WZ-054: a month reaches the event: its kind, its parts and its words; the city', rec.dateMode === 'month' && rec.dateLabel === 'March 2027' && rec.datePartial && rec.datePartial.month === '2027-03' &&
    rec.start === null && rec.city === 'Mumbai' && rec.venue === 'Grand Hyatt', rec);
  p.ce('S.basics.dateMode = "quarter"; S.basics.quarter = "Q2"; S.basics.year = "2027"');
  rec = JSON.parse(JSON.stringify(p.ce('eventRecordFromBasics()')));
  check('6.5 …a quarter', rec.dateMode === 'quarter' && rec.dateLabel === 'Q2 2027' && rec.datePartial.quarter === 'Q2' && rec.datePartial.year === '2027', rec);
  p.ce('S.basics.dateMode = "tbd"; S.basics.dateNote = ""');
  rec = JSON.parse(JSON.stringify(p.ce('eventRecordFromBasics()')));
  check('6.6 …"to be announced"', rec.dateMode === 'tbd' && rec.dateLabel === 'Date to be announced', rec);
  p.ce('S.basics.dateMode = "month"; S.basics.month = ""');
  rec = JSON.parse(JSON.stringify(p.ce('eventRecordFromBasics()')));
  check('6.7 …a month not picked yet is no words ("Month not picked yet" never reaches a site)', rec.dateLabel === '' && rec.datePartial.month === '', rec);
  p.ce('S.basics.dateMode = "exact"; S.basics.start = "2027-03-14T09:00"');
  rec = JSON.parse(JSON.stringify(p.ce('eventRecordFromBasics()')));
  check('6.8 …an exact date clears the words an earlier choice left', rec.dateMode === 'exact' && rec.dateLabel === '' && rec.datePartial === null && rec.start === '2027-03-14T09:00', rec);
  p.ce('S.basics.category = "Client"; S.basics.client = "Tata Capital"');
  rec = JSON.parse(JSON.stringify(p.ce('eventRecordFromBasics()')));
  check('6.9 …and the client, for a type that asks for one', rec.client === 'Tata Capital', rec);
  var checksSrc = read('functions/lib/api.js');
  check('6.10 what Create Event sends is what the server takes (dateMode, datePartial with month, quarter, year and note, dateLabel, client)',
    /dateMode: function \(v\)/.test(checksSrc) && /datePartial: function \(v\)/.test(checksSrc) && /dateLabel: function \(v\) \{ return checkText\('"dateLabel"', v, 120, false\); \}/.test(checksSrc) &&
    /client: function \(v\) \{ return checkText\('The client name', v, 200, false\); \}/.test(checksSrc));
  p.ce('S.basics.category = "IP"; S.basics.dateMode = "exact"; S.basics.start = ""; S.basics.dateModePicked = false; refreshHeroCallout = function(){}; renderSchedule()');
  var sched = p.$('sched-body').innerHTML;
  check('6.11 WZ-054: Venue and City are two fields', /<label for="f-venue">Venue<\/label>/.test(sched) && /id="f-city" type="text"/.test(sched), sched.slice(0, 400));
  var src = FX.SRC;
  check('6.12 an award opens on its own date format (month) until the owner picks one', /\(!b\.dateModePicked && !b\.start && C\.defaultDateMode\)\) b\.dateMode = C\.defaultDateMode;/.test(src) &&
    /b\.dateMode = v; b\.dateModePicked = true;/.test(src));

  /* ===================== 7. the API: a Basics change reaches the staged copy ===================== */
  var siteRec = read('functions/lib/api.js');
  check('7.1 every draw of the saved site (a save, a Content or Basics change, a request for approval) is given the template and the event',
    /siteRecords\.renderRecords\(pageHtml, got\[2\] \|\| \{\}, \{ templateId: templateId, event: data \}\)/.test(siteRec) &&
    /siteRecords\.renderRecords\(page, got\[1\], \{ templateId: templateId, event: data \}\)/.test(siteRec) &&
    /var RECORD_RESOURCES = \['speakers', 'sessions', 'agenda-groups', 'faqs', 'partners', 'partner-tiers', 'contacts', 'gallery'\];/.test(siteRec));

  if (failures.length) { console.error('site-draw: ' + failures.length + ' of ' + checks + ' checks failed:\n  - ' + failures.join('\n  - ')); process.exit(1); }
  console.log('site-draw: all ' + checks + ' checks passed');
})().catch(function (e) { console.error(e); process.exit(1); });
