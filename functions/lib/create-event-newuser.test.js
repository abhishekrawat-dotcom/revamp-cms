// node functions/lib/create-event-newuser.test.js — Create Event explains itself to a first-time user (newcomer QA,
// 14 Nov 2026):
//   NU-001  a section left empty shows the template's sample words (another event's): the wizard finds them on the design
//           filled with the draft, the way the editor and the check before publishing do, tags their rows, says it over
//           their form and lists them in the summary before the event is created;
//   NU-003  the gallery says what each design can show (speakers, agenda, sponsors, photo gallery, FAQs) from its own
//           template.json, and never promises what it lacks;
//   NU-005  an event created on another portal than the events list shows moves the list to it, and says so;
//   NU-006  the logo is optional on every path, and says where it is added later;
//   NU-012  four real steps, an eyebrow per screen, and one summary before the event is made;
//   NU-015  designs named for how they look, their event-specific section names under neutral labels;
//   NU-016  the two previous-edition features have their own names (create-event-portal.test.js checks the words);
//   NU-017  guidance over the section list, and what each section is for with an example, in sight;
//   NU-024  a logo file that is not taken is said under the field, and why (JPG: transparency);
//   NU-026  the generating screen names only what was given, and no technical wording;
//   NU-027  the type's hint in plain words; NU-028 the address prefix grey and never cut part-way; NU-029 an
//           information box is neutral, not red; NU-031 previous editions as cards, the latest edition first.
// The page runs in a vm over a fake DOM (fixtures/create-event-page.js). No network, no Firebase, no browser, no AI.
// Exits 1 on failure.
'use strict';
var F = require('./fixtures/create-event-page');
var passed = 0, failed = 0;
function check(name, ok, detail) { if (ok) { passed++; return; } failed++; console.error('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); }
function tick(n) { var p = Promise.resolve(); for (var i = 0; i < (n || 12); i++) p = p.then(function () { return new Promise(function (r) { setImmediate(r); }); }); return p; }
var page = F.page, SRC = F.SRC;
function tpl(id) { return JSON.parse(F.read('templates/' + id + '/template.json')); }
var T = { 'tech500': tpl('tech500'), 'retail-leadership-summit': tpl('retail-leadership-summit'), 'cx-leaders-forum': tpl('cx-leaders-forum'), 'making-ai-work': tpl('making-ai-work') };

/* ---------- a tiny DOM, enough for samplesLeftOn: matches / closest / querySelectorAll on tag, [attr] and .class ---------- */
function el(tag, attrs, kids) {
  var node = { tagName: tag.toUpperCase(), attrs: attrs || {}, children: [], parentNode: null };
  (kids || []).forEach(function (k) { if (typeof k === 'string') k = { text: k, children: [], parentNode: null }; k.parentNode = node; node.children.push(k); });
  return node;
}
function textOf(n) { return n.text != null ? n.text : n.children.map(textOf).join(' '); }
function one(n, sel) {
  if (!n.tagName) return false;
  sel = sel.trim();
  var m = /^\[([a-z-]+)\]$/.exec(sel);
  if (m) return Object.prototype.hasOwnProperty.call(n.attrs, m[1]);
  m = /^\.([a-z-]+)$/.exec(sel);
  if (m) return (' ' + (n.attrs['class'] || '') + ' ').indexOf(' ' + m[1] + ' ') !== -1;
  return n.tagName === sel.toUpperCase();
}
function matches(n, sel) { return sel.split(',').some(function (s) { return one(n, s); }); }
function all(n, sel, out) { out = out || []; n.children.forEach(function (c) { if (c.tagName) { if (matches(c, sel)) out.push(c); all(c, sel, out); } }); return out; }
function live(n) {
  if (!n || !n.tagName || n.__live) return n;
  n.__live = true;
  Object.defineProperty(n, 'textContent', { get: function () { return textOf(n); } });
  n.matches = function (s) { return matches(n, s); };
  n.closest = function (s) { for (var x = n; x && x.tagName; x = x.parentNode) if (matches(x, s)) return live(x); return null; };
  n.querySelectorAll = function (s) { return all(n, s).map(live); };
  n.getAttribute = function (k) { return Object.prototype.hasOwnProperty.call(n.attrs, k) ? n.attrs[k] : null; };
  n.children.forEach(live);
  return n;
}
/* a canvas: library() is each section as the template has it (html is a key into `pristine`), doc is the filled page */
function fakeCanvas(pristine, filled) {
  var root = live(el('body', {}, filled));
  return {
    library: function () { return Object.keys(pristine).map(function (k) { return { id: k, html: k + ' data-rv-sample' }; }); },
    doc: {
      createElement: function () {
        var box = { content: null };
        Object.defineProperty(box, 'innerHTML', { set: function (h) { var k = h.replace(' data-rv-sample', ''); box.content = live(el('div', {}, [pristine[k]()])); } });
        return box;
      },
      querySelectorAll: function (s) { return root.querySelectorAll(s); }
    }
  };
}

async function main() {
  check('ES5: the page script', (function () {
    try { require('esbuild').transformSync(SRC, { loader: 'js', target: 'es5' }); return true; } catch (e) { return String(e.message).slice(0, 200); }
  })());

  /* ================================================================ NU-012 four real steps and their eyebrows */
  var p = F.load();
  await p.ce('loadPortalRoster()');
  check('NU-012 the rail names the four screens a person goes through', JSON.stringify(p.ce('STEPS')) === '["Portal and type","How to build","Details and content","Create"]');
  var stages = ['category', 'method', 'details'].map(function (ph) { return p.ce('S.step = 1; S.step1Phase = "' + ph + '"; busy = null; railPos()'); });
  check('NU-012 …each of step 1\'s phases is its own dot', JSON.stringify(stages) === '[1,2,3]', stages);
  check('NU-012 …and creating (the hand-off, or a site being generated) is dot 4',
    p.ce('S.step = 4; railPos()') === 4 && p.ce('S.step = 1; S.step1Phase = "details"; busy = { kind: "brief" }; var _r = railPos(); busy = null; _r') === 4 &&
    p.ce('S.step1Phase = "method"; busy = { kind: "import" }; var _q = railPos(); busy = null; _q') === 2);
  p.ce('S.step = 1; S.step1Phase = "details"; renderRail()');
  check('NU-012 …the rail says where the person is', p.$('rail').getAttribute('aria-label') === 'Step 3 of 4: Details and content' &&
    /data-goto="3" aria-current="step"/.test(p.$('rail').innerHTML) && /data-goto="4" disabled/.test(p.$('rail').innerHTML), p.$('rail').innerHTML.slice(0, 300));
  check('NU-012 every screen\'s eyebrow says the same count', page.indexOf('>Step 1 of 4 &middot; Portal and type<') !== -1 &&
    page.indexOf('>Step 2 of 4 &middot; How would you like to build it?<') !== -1 && page.indexOf('>Step 3 of 4 &middot; Details and content<') !== -1 &&
    /stepEyebrow\(4, 'Create'\)/.test(page) && page.indexOf('of 2 &middot;') === -1 && p.ce('stepEyebrow(4, "Create")') === 'Step 4 of 4 · Create');
  var gone = [];
  p.ce('changeCategory = function(){ window.__went = "category"; }; setStep1Phase = function(ph){ window.__went = ph; };');
  p.ce('S.step = 1; S.step1Phase = "details"; railGo(2)'); gone.push(p.ctx.__went);
  p.ce('S.step1Phase = "details"; railGo(1)'); gone.push(p.ctx.__went);
  p.ctx.__went = 'none';
  p.ce('S.step1Phase = "method"; railGo(3)'); gone.push(p.ctx.__went);
  check('NU-012 a done dot goes back to its screen; a dot ahead does nothing', JSON.stringify(gone) === '["method","category","none"]', gone);

  /* ================================================================ NU-015 / NU-003 the gallery */
  p = F.load();
  await p.ce('loadPortalRoster()');
  var names = p.ce('TEMPLATES.map(function(t){ return t.name + "|" + t.sub; })');
  check('NU-015 the designs are named for how they look, for any portal, not after another team\'s event',
    JSON.stringify(p.ce('TEMPLATES.map(function(t){ return t.name; })')) === '["Editorial light","Bold maroon","Warm retreat","Dark keynote"]' &&
    !names.some(function (n) { return /TECH500|Retail|CX |Making AI|CXO|CMO|summit/i.test(n); }), names);
  check('NU-015 …and say where their sample words come from, to be replaced', p.ce('sampleWordsNote(templateById("tech500"))') ===
    'Until you write your own, it shows sample words from TECH500, another event. You replace them with yours.');
  ['tech500', 'retail-leadership-summit', 'cx-leaders-forum', 'making-ai-work'].forEach(function (id) {
    p.ctx.__t = T[id];
    p.ce('setTemplateInfo(templateById("' + id + '"), window.__t)');
  });
  var shows = {};
  ['tech500', 'retail-leadership-summit', 'cx-leaders-forum', 'making-ai-work'].forEach(function (id) { shows[id] = p.ce('canShow(capsOf("' + id + '")).has.join()'); });
  check('NU-003 what each design can show is read from its own content map', shows['tech500'] === 'FAQs' && shows['retail-leadership-summit'] === 'Sponsors,Photo gallery,FAQs' &&
    shows['cx-leaders-forum'] === 'Speakers,Photo gallery,FAQs' && shows['making-ai-work'] === 'Speakers,Photo gallery', shows);
  /* the content map is the truth: every "Can show" a design gets is a section it has a form for */
  var honest = Object.keys(T).every(function (id) {
    var froms = (T[id].content.map || []).map(function (m) { return m.from; });
    var lib = { Speakers: 'speakers', Agenda: 'agenda', Sponsors: 'partners', 'Photo gallery': 'glimpses', FAQs: 'faq' };
    return p.ce('canShow(capsOf("' + id + '")).has').every(function (label) { return froms.indexOf(lib[label]) !== -1; });
  });
  check('NU-003 …never a promise the design cannot keep', honest);
  var mawHtml = p.ce('canShowHtml(capsOf("making-ai-work"))');
  check('NU-003 …said as chips, with the missing ones and where they come from', /tcs on[^>]*>.*?Has <\/span>Speakers/.test(mawHtml) && /tcs off[^>]*>.*?No <\/span>Agenda/.test(mawHtml) &&
    mawHtml.indexOf('No agenda, sponsor or FAQ section in this design: the site editor can add one later.') !== -1, mawHtml);
  check('NU-003 Making AI Work\'s design no longer promises partner logos', page.indexOf('partner logos, a full speaker grid') === -1);
  check('NU-015 a section named after the sample event or a portal goes by a neutral label in the wizard; template.json keeps its own name',
    p.ce('designRows("tech500", capsOf("tech500")).map(function(r){ return r.title; }).join("|")').indexOf('About the event|Who should attend') !== -1 &&
    p.ce('designRows("cx-leaders-forum", capsOf("cx-leaders-forum")).map(function(r){ return r.title; }).join("|")').indexOf('The Editorial Agenda') === -1 &&
    T['tech500'].sections.filter(function (s) { return s.id === 'overview'; })[0].name === 'What is Tech500');
  check('NU-015 …"The Editorial Agenda" (not an agenda) is "What awaits"', T['cx-leaders-forum'].sections.filter(function (s) { return s.id === 'conventions-box'; })[0].label === 'What awaits');
  /* the gallery card draws both lines */
  p.ctx.RevampCanvas = { mount: function () { return new Promise(function () {}); } };
  p.ce('S.basics.portal = "hr"; S.basics.category = "IP"; S.step = 1; S.step1Phase = "method"; S.template = null; tplCarouselIdx = 3; renderTemplateCarousel();');
  check('NU-003 the gallery card shows what the design can show before its picture has loaded', p.$('tpl-carousel-shows').hidden === false &&
    p.$('tpl-carousel-shows').innerHTML.indexOf('Photo gallery') !== -1 && p.$('tpl-carousel-name').textContent === 'Dark keynote' &&
    p.$('tpl-carousel-sample').textContent.indexOf('sample words from Making AI Work, another event') !== -1);

  /* ================================================================ NU-001 sample words left on the design */
  var pristine = {
    overview: function () { return el('section', { 'data-rv-section': 'overview' }, [el('h2', { 'data-rv-sample': '' }, ['THE NEXT PHASE IS NOT MORE AI.']), el('div', { 'data-rv-sample': '' }, [el('p', {}, ['Agentic AI is moving enterprises beyond automation into decisions.'])])]); },
    stats: function () { return el('section', { 'data-rv-section': 'stats' }, [el('div', { 'data-rv-sample': '' }, ['100+ CX Decision Makers'])]); },
    quotes: function () { return el('section', { 'data-rv-section': 'quotes' }, [el('figure', { 'data-rv-sample': '' }, [el('p', {}, ['This summit changed how our whole team thinks about AI.']), el('figcaption', {}, ['A Person'])])]); }
  };
  var filled = [
    /* the heading left as the design had it; the paragraph rewritten */
    el('section', { 'data-rv-section': 'overview' }, [el('h2', { 'data-rv-sample': '' }, ['THE NEXT PHASE IS NOT MORE AI.']), el('div', { 'data-rv-sample': '' }, [el('p', {}, ['Our own words about the HR Leaders Summit and who it is for.'])])]),
    /* a figure card built from the event's own content: never a sample by its whole text */
    el('section', { 'data-rv-section': 'stats' }, [el('div', { 'data-rv-sample': '', 'data-rv-item': 'stats' }, ['100+ CX Decision Makers'])]),
    /* switched off: never counted */
    el('section', { 'data-rv-section': 'quotes', 'class': 'is-hidden-sec' }, [el('figure', { 'data-rv-sample': '' }, [el('p', {}, ['This summit changed how our whole team thinks about AI.']), el('figcaption', {}, ['A Person'])])])
  ];
  var left = p.ce('samplesLeftOn')(fakeCanvas(pristine, filled));
  check('NU-001 a heading still as the design wrote it is found; words of the event\'s own, a built card and a switched-off section are not', JSON.stringify(left) === '{"overview":1}', left);
  var filled2 = [el('section', { 'data-rv-section': 'quotes' }, [el('figure', { 'data-rv-sample': '' }, [el('p', {}, ['This summit changed how our whole team thinks about AI.']), el('figcaption', {}, ['Someone Else'])])])];
  check('NU-001 a sample quote is known by its words, whoever it is credited to', JSON.stringify(p.ce('samplesLeftOn')(fakeCanvas(pristine, filled2))) === '{"quotes":1}');
  check('NU-001 no canvas, nothing found', JSON.stringify(p.ce('samplesLeftOn')(null)) === '{}');

  /* the details form: tags, the count, the note over the form */
  p = F.load();
  await p.ce('loadPortalRoster()');
  p.ctx.__t = T['making-ai-work'];
  p.ce('S.basics.portal = "hr"; S.basics.category = "IP"; setTemplateInfo(templateById("making-ai-work"), window.__t); commitTemplate("making-ai-work");');
  p.ce('S.creationMethod = "template"; S.step = 1; S.step1Phase = "details"; renderBuildWorkspace($("step1-build-host"));');
  var host = p.$('step1-build-host').innerHTML;
  check('NU-017 over the section list: fill what you have now, what an empty section does, and that the site cannot go live with sample words',
    host.indexOf('Fill in what you have now.') !== -1 && host.indexOf('A section you leave empty keeps the template’s sample words, which are another event’s') !== -1 &&
    host.indexOf('The site cannot go live while they show.') !== -1 && host.indexOf('class="callout build-guide"') !== -1);
  check('NU-001 before any check, no row is tagged', p.$('sec-list').innerHTML.indexOf('class="sec-sample"') === -1);
  p.ce('sampleState = { tplId: "making-ai-work", bySection: { overview: 2, "who-enter": 3, "about-wrapper": 1 } }; S.excludedSections = { "making-ai-work": { "who-enter": true } }; renderSampleMarks();');
  var list = p.$('sec-list').innerHTML;
  check('NU-001 the rows still showing sample words carry "Sample text"; a section switched off does not',
    /<span class="nm">Overview<span class="sec-sample"[^>]*>Sample text<\/span>/.test(list) && /<span class="nm">Manifesto<span class="sec-sample"/.test(list) &&
    !/Questions this raises<span class="sec-sample"/.test(list), list.slice(0, 900));
  check('NU-001 …and the count under the list says how many', p.$('prog-sample').textContent === '2 sections still show the template’s sample words' && p.$('prog-sample').hidden === false);
  p.ce('S.active = sectionByLib("about").id; renderEditor();');
  check('NU-001 over the open form of such a section: what shows on the site and what to do', p.$('sec-sample-note').hidden === false &&
    p.$('sec-sample-note').innerHTML.indexOf('Until you fill this in, your site shows the template’s sample words here: another event’s, not yours.') !== -1);
  check('NU-017 the open form says what the section is for, with an example, in sight', /<p class="eh-help">What the event is about, in a paragraph or two\. <span class="eh-example">For example: /.test(p.$('editor-panel').innerHTML));
  p.ce('sampleState.texts = { overview: ["THE NEXT PHASE IS NOT MORE AI. IT IS WHEN AI STARTS CHANGING THE ENTERPRISE ITSELF, FROM THE BOARDROOM TO THE SHOP FLOOR AND BEYOND."] }; sectionByLib("about").data.body = "Our own words about the summit, long enough to count."; renderSampleNote();');
  var note = p.$('sec-sample-note').innerHTML;
  check('NU-001 a section partly filled says part of it is still sample, and quotes the words meant (cut at a word)',
    note.indexOf('Part of this section still shows the template’s sample words: another event’s, not yours, such as “THE NEXT PHASE IS NOT MORE AI. IT IS WHEN AI STARTS CHANGING THE ENTERPRISE ITSELF,…”.') !== -1, note);
  p.ce('sectionByLib("about").data.body = "";');
  p.ce('S.active = sectionByLib("manifesto").id; renderEditor();');
  check('NU-017 …the Manifesto says what to write', p.$('editor-panel').innerHTML.indexOf('For example: why this event exists and who it is for, in two or three sentences.') !== -1);
  p.ce('S.active = sectionByLib("contact").id; renderEditor();');
  check('NU-001 a section with nothing of the design\'s left has no note', p.$('sec-sample-note').hidden === true);

  /* ================================================================ NU-012 / NU-001 / NU-005 the summary before the event is made */
  p.ce('S.basics.name = "HR Leaders Summit 2027"; S.basics.slug = "qa-hr-leaders-2027"; S.basics.dateMode = "tbd"; S.basics.dateNote = ""; S.basics.venue = ""; S.basics.city = "Mumbai"; S.basics.logo = false;' +
    'workingPortal = "retail"; detailsIssues = function(){ return []; }; contentProblems = function(){ return []; }; window.__go = 0; goStep = function(n){ window.__go = n; };');
  var looked = 0;
  p.ce('checkSamplesNow = function(){ window.__looked = (window.__looked || 0) + 1; return Promise.resolve(["overview", "about-wrapper"]); };');
  p.ce('onNext()');
  var md = p.log.modals[p.log.modals.length - 1] || {};
  check('NU-012 Review and create opens one summary first, and creates nothing', md.title === 'Create “HR Leaders Summit 2027”?' && md.confirm === 'Create event' &&
    md.cancelLabel === 'Go back' && p.ctx.__go === 0, md.title);
  check('NU-012 …it lists the event, its address, portal and type, date, venue, logo, design and how much is filled',
    md.body.indexOf('<dt>Event</dt><dd>HR Leaders Summit 2027') !== -1 && /<dt>Web address<\/dt><dd>[^<]*\/e\/qa-hr-leaders-2027/.test(md.body) &&
    md.body.indexOf('<dt>Portal and type</dt><dd>ETHRWorld · IP Event') !== -1 && md.body.indexOf('<dt>Date</dt><dd>Date to be announced') !== -1 &&
    md.body.indexOf('<dt>Venue</dt><dd>Mumbai') !== -1 && md.body.indexOf('<dt>Logo</dt><dd>Not added yet<span class="rv-note">The banner shows the event name until you add one, later in the event’s Basics.') !== -1 &&
    md.body.indexOf('<dt>Design</dt><dd>Dark keynote template · ') !== -1 && /<dt>Filled in here<\/dt><dd>0 of \d+ sections/.test(md.body), md.body);
  check('NU-005 …and that the events list will switch to the event\'s portal', md.body.indexOf('Your events list will switch to ETHRWorld, so you can find this event there.') !== -1);
  check('NU-001 …while it looks, it says so', md.body.indexOf('<div class="review-samples" id="review-samples"><p class="hint review-checking"><span class="gb-spin"></span> Checking which sections still show the template’s sample words…') !== -1);
  await tick();
  var rs = p.$('review-samples').innerHTML;
  check('NU-001 …then names the sections still showing another event\'s words, and what that means', rs.indexOf('2 sections still show the template’s sample words, which are another event’s, not yours:') !== -1 &&
    rs.indexOf('Overview, Manifesto.') !== -1 && rs.indexOf('the site cannot go live while they show') !== -1 && rs.indexOf('amber outline') !== -1, rs);
  p.ce('pickSection = function(id){ window.__picked = id; };');
  md.onCancel();
  check('NU-001 Go back opens the first of them', p.ctx.__picked === p.ce('sectionByLib("about").id'));
  md.onConfirm();
  check('NU-012 Create event makes it (the hand-off)', p.ctx.__go === 4);
  p.ce('checkSamplesNow = function(){ return Promise.resolve([]); };');
  p.ce('onNext()');
  await tick();
  check('NU-001 nothing left: it says so', p.$('review-samples').innerHTML.indexOf('No section shows the template’s sample words.') !== -1);
  p.ce('checkSamplesNow = function(){ return Promise.resolve(null); };');
  p.ce('onNext()');
  await tick();
  check('NU-001 when the design could not be looked at, the sections left empty are named instead', p.$('review-samples').innerHTML.indexOf('Sections you left empty show the template’s sample words') !== -1);

  /* ================================================================ NU-005 the events list follows the new event */
  var set = [];
  p = F.load({ cached: 'retail', core: { createEvent: function (b) { return Promise.resolve({ eventId: b.eventId, createdAt: 'x' }); } } });
  p.ctx.RevampPortals.setWorking = function (v) { set.push(v); return Promise.resolve(v); };
  await p.ce('loadPortalRoster()');
  p.ce('startPortal(true); S.basics.portal = "hr"; S.basics.category = "IP"; S.basics.name = "QA HR"; S.basics.slug = "qa-hr-x"; S.creationMethod = "brief"; currentDetailsIssue = function(){ return ""; };');
  await tick();
  check('NU-005 (the list shows ETRetail before)', p.ce('workingPortal') === 'retail');
  await p.ce('createEventRecord()');
  await tick();
  check('NU-005 creating the event on another portal moves the working portal to it, and says so', JSON.stringify(set) === '["hr"]' &&
    p.log.toasts.some(function (t) { return t.msg === 'Your events list now shows ETHRWorld, where this event is.'; }) && p.ce('workingPortal') === 'hr', [set, p.log.toasts.map(function (t) { return t.msg; })]);
  set.length = 0;
  p.ce('showEventOnItsPortal("hr")');
  p.ce('workingPortal = "all"; showEventOnItsPortal("cio")');
  check('NU-005 …not when the list already shows it, or shows every portal', set.length === 0);
  p.ce('workingPortal = "retail"');
  p.ctx.RevampPortals.setWorking = function () { return Promise.reject(new Error('kept here')); };
  p.ce('showEventOnItsPortal("cio")');
  await tick();
  check('NU-005 …and a switch that could not be saved is said', p.log.toasts.some(function (t) { return t.msg === 'Your events list may still show ETRetail: switch it to ETCIO there to find this event.'; }));
  check('NU-005 the portal box says beforehand that the list will follow', page.indexOf("on the dashboard. Your events list switches to it when the event is created.'") !== -1);
  p.ce('S.createdEventId = null; S.basics.portal = "hr"; workingPortal = "retail"; S.brief.text = ""; briefDoc = null;');
  check('NU-005 …and so does the review before a site is generated', p.ce('briefReview(false).items').indexOf('Your events list will switch to ETHRWorld, so you can find this event there.') !== -1);
  p.ce('workingPortal = "hr"');
  check('NU-005 …only when it would switch', p.ce('briefReview(false).items').join('|').indexOf('will switch to') === -1);

  /* ================================================================ NU-006 / NU-024 the logo */
  p = F.load();
  await p.ce('loadPortalRoster()');
  p.ce('S.basics.portal = "hr"; S.basics.category = "IP"; S.basics.name = "QA"; S.basics.slug = "qa-logo-x"; S.basics.logo = false; S.basics.dateMode = "tbd";');
  var tIssues = p.ce('validateBasics("template").map(function(i){ return i.field; })');
  check('NU-006 a site on a template can be made without a logo, as one from a brief can', tIssues.indexOf('logo-drop') === -1, tIssues);
  p.ce('S.creationMethod = "template"; applySmartDefaults();');
  check('NU-006 …the field says Optional on every path, and where it is added later', p.$('logo-requirement').textContent === 'Optional' && p.$('logo-requirement').className === 'pill-opt' &&
    page.indexOf('No logo yet? The banner shows the event name until you add one, here or later in the event&rsquo;s Basics.') !== -1);
  check('NU-024 a JPG says why: a logo needs a transparent background', p.ce('logoFileIssue({ name: "logo.jpg", type: "image/jpeg", size: 1000 })') ===
    'A logo needs a transparent background, which a JPG file cannot have. Use a PNG, WEBP or SVG file instead.');
  check('NU-024 a file too big says its size and the limit', p.ce('logoFileIssue({ name: "big.png", type: "image/png", size: 6 * 1048576 })') === 'This file is 6.0 MB. Use a logo file of 5 MB or less.');
  check('NU-024 another kind of file is named', p.ce('logoFileIssue({ name: "logo.gif", type: "image/gif", size: 10 })') === '“logo.gif” is not a PNG, WEBP or SVG file. Choose a logo in one of those formats.' &&
    p.ce('logoFileIssue({ name: "ok.svg", type: "", size: 10 })') === '');
  p.ce('S.step = 1; S.step1Phase = "details"; initStep1 = (function(real){ return function(){ try { real(); } catch(e){} }; })(initStep1); initStep1();');
  var input = p.$('f-logo');
  input.files = [{ name: 'big.png', type: 'image/png', size: 6 * 1048576 }];
  input.onchange();
  check('NU-024 the error is under the field, not a passing toast', p.$('logo-hint').textContent === 'This file is 6.0 MB. Use a logo file of 5 MB or less.' &&
    p.$('logo-hint').getAttribute('role') === 'alert' && /bad/.test(p.$('logo-hint').className) && !p.log.toasts.some(function (t) { return /5 MB or smaller/.test(t.msg); }));
  p.ctx.URL.createObjectURL = function () { return 'blob:x'; };
  p.ce('storeLogo = function(){};');
  input.files = [{ name: 'small.png', type: 'image/png', size: 12000 }];
  input.onchange();
  check('NU-024 …and goes once a logo is taken', p.ce('logoError') === '' && p.$('logo-hint').textContent.indexOf('6.0 MB') === -1 && p.$('logo-hint').getAttribute('role') === null &&
    p.$('logo-later').hidden === true);

  /* ================================================================ NU-026 the generating screen */
  check('NU-026 a run from a description alone names only the description', p.ce('briefStepDoing("generate", { text: "x", file: null, urls: {} })') ===
    'Writing every section from your description. This is the longest step.');
  check('NU-026 …and names what else was given', p.ce('briefStepDoing("generate", { text: "x", file: {}, urls: { previous: "https://a.test", comp1: "https://b.test" } })') ===
    'Writing every section from your description, your document, the previous edition’s site and the pages you linked. This is the longest step.');
  check('NU-026 no technical wording, and no "keep this tab open" for a run that carries on', page.indexOf('the request is open and waiting for its answer') === -1 &&
    page.indexOf('Keep this tab open.') === -1 && page.indexOf('Still working — this step can take a few minutes.') !== -1 &&
    page.indexOf('You can work in another tab meanwhile: your site opens here when it is ready.') !== -1);

  /* ================================================================ NU-027 / NU-028 / NU-029 words and looks */
  check('NU-027 the type\'s hint is plain', p.ce('CATS.IP.hint') === 'Owned conferences, summits and residential events. If the date is not fixed yet, choose Month only, Quarter or To be announced.' &&
    page.indexOf('section stack') === -1 && page.indexOf('jury milestones') === -1);
  check('NU-028 the address prefix is grey, and the empty box\'s example reads as one', page.indexOf('.sheet .slug-prefix{ color: var(--text-muted); }') !== -1 &&
    page.indexOf('.sheet .slug-prefix{ color: var(--accent-strong); }') === -1 && page.indexOf('placeholder="e.g. martech-plus-summit-2026"') !== -1);
  var pre = p.$('slug-prefix-text'), holder = { clientWidth: 120, scrollWidth: 300 };
  pre._parent = holder;
  p.ce('drawSlugPrefix()');
  check('NU-028 a host too long for its box is "…/e/", never cut part-way through a word; the whole address in its title', pre.textContent === '…/e/' && /\/e\/qa-logo-x$/.test(p.$('slug-prefix').title), [pre.textContent, p.$('slug-prefix').title]);
  holder.scrollWidth = 100;
  p.ce('drawSlugPrefix()');
  check('NU-028 …and the whole host when it fits', /\/e\/$/.test(pre.textContent) && pre.textContent !== '…/e/');
  check('NU-029 an information box is neutral; red is for errors', /\.callout\{\s*display:flex;[^}]*background: var\(--surface-2\); color: var\(--text\);/.test(page) &&
    !/\.callout\{\s*display:flex;[^}]*background: var\(--accent-soft\)/.test(page) && /\.callout\.crit\{ background: var\(--crit-soft\); color: var\(--crit\); \}/.test(page));

  /* ================================================================ NU-031 the latest edition first */
  var order = p.ce('cloneCandidates')([
    { id: 'a', portal: 'hr', category: 'ip', templateId: 'tech500', start: '2025-11-10T09:00', updatedAt: '2026-11-01T00:00:00Z' },
    { id: 'b', portal: 'hr', category: 'ip', templateId: 'tech500', start: '2026-11-12T09:00', updatedAt: '2026-01-01T00:00:00Z' },
    { id: 'c', portal: 'hr', category: 'ip', templateId: 'tech500', start: null, updatedAt: '2026-11-13T00:00:00Z' }
  ], 'hr', 'IP', '').map(function (x) { return x.id; }).join();
  check('NU-031 previous editions come latest edition first, by their date; one with no date after them', order === 'b,a,c', order);
  check('NU-031 …and each says when it took place', p.ce('cloneEditionDate({ start: "2026-11-12T09:00", end: "2026-11-13T18:00" })') === '12 Nov 2026 – 13 Nov 2026' &&
    p.ce('cloneEditionDate({ dateLabel: "Q1 2027" })') === 'Q1 2027' && p.ce('cloneEditionDate({})') === 'No date set');

  console.log('create-event-newuser: ' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exit(1);
}
main().catch(function (e) { console.error('the test itself broke:', e && e.stack || e); process.exit(1); });
