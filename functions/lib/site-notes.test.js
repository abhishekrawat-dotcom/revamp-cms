/* node functions/lib/site-notes.test.js — the event console's Content tabs say what they mean on the site (batch B16 of the
   UX sweep of 3 Nov 2026):
     UX-066  an empty Speakers / Agenda / Sponsors / Gallery / FAQ / Contact tab says that its site section is hidden until
             a record is added, or that the site has no section for it; so does the Dashboard's "Ready to publish"
     UX-067  a tab whose site shows the previous edition's people, sponsors, sessions or photos says so, with how many, and
             opens the site editor at that section
     UX-068  one "Priority" (Top / High / Normal / Low) on Speakers, Agenda and Sponsors, a pill only when it is not
             Normal, "Sort by priority" in place of "Sort by weight" and "Match weights"; sponsors start at Normal
     UX-069  the logo note and a sponsor without a logo are information, never a red error banner
     UX-070  the registration drawer saves everything as it changes (no "Save notes and tags"), a message never covers
             its buttons, and a place reads as the visitor gave it
     UX-071  the Event logo tile shows the logo visitors see, with the upload one click away
   edit-event-site-notes.js runs in node; the Dashboard runs in a vm over the real core; the pages are read as files and
   their small pure helpers run in a vm. No network, no browser. Exits 1 on failure. */
'use strict';
var fs = require('fs'), path = require('path'), vm = require('vm');

var ROOT = path.join(__dirname, '..', '..');
function read(p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); }
var passed = 0, failed = 0;
function check(name, ok, detail) { if (ok) { passed++; return; } failed++; console.error('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail).slice(0, 700) : '')); }
function j(v) { return JSON.stringify(v); }
function es5(name, src) {
  var code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/.*$/gm, '$1');
  check(name + ' is ES5: no let, const or arrow functions', !/\blet\s/.test(code) && !/\bconst\s/.test(code) && code.indexOf('=>') === -1);
}

var SN = require('../../edit-event-site-notes.js');
es5('edit-event-site-notes.js', read('edit-event-site-notes.js'));

/* what GET /api/event/site-outline answered for brand-world-summit-2026 (its live page of 5 Nov 2026) */
var BWS = {
  eventId: 'brand-world-summit-2026', of: 'live', version: 4,
  places: { speakers: [], sessions: [{ key: 'agenda', name: 'Agenda', hides: true }], partners: [{ key: 'sponsors', name: 'Sponsors', hides: true }],
    faq: [{ key: 'faqs', name: 'FAQs', hides: true }], glimpses: [], contact: [{ key: 'contact-us', name: 'Contact us', hides: true }] },
  previous: [{ kind: 'sponsors', key: 'previous-sponsors', name: 'Previous Edition Sponsors', count: 8 },
    { kind: 'speakers', key: 'previous-speakers', name: 'Previous Edition Speakers', count: 49 },
    { kind: 'agenda', key: 'previous-agenda', name: 'Previous Edition Agenda', count: 20 },
    { kind: 'glimpses', key: 'previous-glimpses', name: 'Previous Edition Glimpses', count: 24 }],
  logo: 'https://storage.googleapis.com/revamp-cms.firebasestorage.app/events/brand-world-summit-2026/generated/20261015054729-logo-unit.svg'
};

/* ---------- UX-066 / UX-067: the tabs ---------- */
var n = SN.forTab('sponsors', null, { total: 0, shown: 0 });
check('nothing is said about a site that is not known yet', !n.hidden && !n.none && !n.previous, n);
check('nothing is said about a site never saved', (function () { var x = SN.forTab('faq', { of: 'none', places: BWS.places, previous: [] }, { total: 0 }); return !x.hidden && !x.none && !x.previous; })());

n = SN.forTab('sponsors', BWS, { total: 0, shown: 0 });
check('Sponsors, empty: the live site\'s section is hidden until a confirmed sponsor is added',
  n.hidden === 'Your live site’s “Sponsors” section is hidden until you add a confirmed sponsor.' && !n.none, n);
check('Sponsors: the previous edition\'s 8 sponsors are said, with the section the editor opens',
  n.previous && n.previous.key === 'previous-sponsors' && n.previous.count === 8 &&
  n.previous.text === 'Your live site also shows 8 sponsors from the previous edition, in its “Previous Edition Sponsors” section. They are part of the site’s design, not of this list: change or remove them in the site editor.', n.previous);
n = SN.forTab('sponsors', BWS, { total: 3, shown: 0 });
check('Sponsors with only invited ones: hidden until one is confirmed', n.hidden === 'Your live site’s “Sponsors” section is hidden until one of these sponsors is confirmed.', n.hidden);
n = SN.forTab('sponsors', BWS, { total: 3, shown: 1 });
check('Sponsors with a confirmed one: nothing hidden', !n.hidden && !n.none && n.previous, n);

n = SN.forTab('speakers', BWS, { total: 0, shown: 0 });
check('Speakers on BWS (UX-067): no section for this edition\'s speakers, and the 49 of the previous edition said',
  n.none === 'Your live site has no section for speakers yet, so speakers added here do not show on it until it has one. Add them here first: the next time the site editor opens, it adds a “Speakers” section for them (confirmed speakers only). Press Save there to keep it.' &&
  n.add && n.add.name === 'Speakers' && n.add.ready === false &&
  !n.hidden && n.previous && n.previous.count === 49 && /also shows 49 speakers from the previous edition, in its “Previous Edition Speakers” section/.test(n.previous.text), n);
n = SN.forTab('speakers', BWS, { total: 2, shown: 2 });
check('Speakers added with no section for them: none of these is on the site, and opening the editor adds the section (NU-004)',
  n.none === 'Your live site has no section for speakers yet, so these are not on it. Open the site editor: it adds a “Speakers” section for the confirmed speakers as it opens. Press Save there to keep it.' &&
  n.add && n.add.ready === true, n);
n = SN.forTab('speakers', BWS, { total: 2, shown: 0 });
check('NU-004 only invited speakers: the section comes once one is confirmed, and nothing is offered yet', /Once one of them is confirmed, the site editor adds a “Speakers” section/.test(n.none) && n.add && n.add.ready === false, n);
n = SN.forTab('agenda', Object.assign({}, BWS, { places: Object.assign({}, BWS.places, { sessions: [] }) }), { total: 3 });
check('NU-004 the agenda: the editor\'s “Agenda” section, for every session (no confirming)', /it adds an “Agenda” section for them as it opens/.test(n.none) && n.add.ready === true, n);
n = SN.forTab('speakers', Object.assign({}, BWS, { imported: true }), { total: 2, shown: 2 });
check('NU-004 an imported site says it cannot show them, and offers nothing', n.none === 'Your live site was imported as one finished page, so it cannot show speakers added here.' && !n.add, n);
n = SN.forTab('speakers', BWS, { total: 0, shown: 0 }, { award: true });
check('an award\'s speakers are its jury', /no section for jury members yet/.test(n.none), n.none);

check('Agenda, FAQ and Contact: each section named, hidden until one is added',
  SN.forTab('agenda', BWS, { total: 0 }).hidden === 'Your live site’s “Agenda” section is hidden until you add a session.' &&
  SN.forTab('faq', BWS, { total: 0 }).hidden === 'Your live site’s “FAQs” section is hidden until you add a question.' &&
  SN.forTab('contact', BWS, { total: 0 }).hidden === 'Your live site’s “Contact us” section is hidden until you add a contact desk.' &&
  !SN.forTab('faq', BWS, { total: 1 }).hidden && !SN.forTab('faq', BWS, { total: 0 }).previous);
n = SN.forTab('gallery', BWS, { total: 0 });
check('Gallery on BWS: no section for photos, and the previous edition\'s 24 photos said', /has no section for photos yet/.test(n.none) &&
  n.previous && /24 photos from the previous edition/.test(n.previous.text) && n.previous.key === 'previous-glimpses', n);
var SAVED = { of: 'saved', places: { speakers: [{ key: 'speakers', name: 'Speakers', hides: true }, { key: 'jury', name: 'Jury', hides: true }],
  sessions: [], partners: [], faq: [], glimpses: [], contact: [{ key: 'contact-us', name: 'Contact us', hides: false }] }, previous: [{ kind: 'speakers', key: 'previous-speakers', name: 'Previous Edition Speakers', count: 0 }] };
n = SN.forTab('speakers', SAVED, { total: 0, shown: 0 });
check('a site not live yet is "your site"; two sections are named together; a previous section that could not be counted has no number',
  n.hidden === 'Your site’s “Speakers” and “Jury” sections are hidden until you add a confirmed speaker.' && /^Your site also shows speakers from the previous edition/.test(n.previous.text), n);
check('a section that holds more than its list only shows none',
  SN.forTab('contact', SAVED, { total: 0 }).hidden === 'Your site’s “Contact us” section shows no contact desks until you add a contact desk.', SN.forTab('contact', SAVED, { total: 0 }).hidden);

/* a real template (tech500) whose FAQ and Contact lists still hold the template's sample card: nothing hides them, so
   the tabs never say "hidden" (the B16 verifier's finding of 7 Nov 2026), they say what stands there and how to replace it */
var TECH = { of: 'saved', places: { speakers: [], sessions: [], partners: [], glimpses: [],
  faq: [{ key: 'faq', name: 'FAQ', hides: false, stands: 1 }], contact: [{ key: 'contact-us', name: 'Contact us', hides: false, stands: 1 }] }, previous: [] };
n = SN.forTab('faq', TECH, { total: 0 });
check('real template, empty FAQ: not hidden; the sample question is said, with what shows yours',
  n.hidden === '' && !n.none && n.stands && n.stands.key === 'faq' && n.stands.name === 'FAQ' && n.stands.count === 1 &&
  n.stands.text === 'Your site’s “FAQ” section shows 1 question not in this list: it is written into the site itself. To show yours in its place, add a question here, then open the site editor and save the site.', n);
n = SN.forTab('contact', Object.assign({}, TECH, { of: 'live' }), { total: 0 });
check('real template, live, empty Contact: the sample contact desk is said; a live site is published again',
  !n.hidden && n.stands.text === 'Your live site’s “Contact us” section shows 1 contact desk not in this list: it is written into the site itself. To show yours in its place, add a contact desk here, then open the site editor and save the site and publish it.', n.stands);
check('real template: a tab with records says nothing of what stood there', !SN.forTab('faq', TECH, { total: 2 }).stands);
var CX = { of: 'live', places: { speakers: [{ key: 'speakers', name: 'Speakers', hides: false, stands: 3 }, { key: 'jury', name: 'Jury', hides: true }],
  sessions: [], partners: [], faq: [], glimpses: [], contact: [] }, previous: [] };
n = SN.forTab('speakers', CX, { total: 2, shown: 0 });
check('a hidden section and one that shows its own are both said; only invited speakers: confirm one',
  n.hidden === 'Your live site’s “Jury” section is hidden until one of these speakers is confirmed.' &&
  n.stands.text === 'Your live site’s “Speakers” section shows 3 speakers not in this list: they are written into the site itself. To show yours in their place, confirm one of these speakers, then open the site editor and save the site and publish it.', n);
check('readiness: a section showing its own is a thing to do, never "hidden"',
  j(SN.readiness('speakers', 0, { of: 'saved', places: { speakers: [{ key: 'speakers', name: 'Speakers', hides: false, stands: 3 }] } })) ===
  j({ ok: false, text: 'None yet: the site’s “Speakers” section shows 3 speakers not in your list' }));
check('readiness: a hidden section is still said first', /“Jury” section is hidden until one is added/.test(SN.readiness('speakers', 0, CX).text), SN.readiness('speakers', 0, CX));

/* ---------- the Dashboard's rows ---------- */
check('readiness, site not known: as before', j(SN.readiness('speakers', 3, null)) === j({ ok: true, text: '3 speakers on the site' }) &&
  j(SN.readiness('agenda', 0, null)) === j({ ok: false, text: 'None on the site yet' }));
check('readiness: a hidden section is a thing to do, said', j(SN.readiness('sponsors', 0, BWS)) === j({ ok: false, text: 'None yet: the site’s “Sponsors” section is hidden until one is added' }), SN.readiness('sponsors', 0, BWS));
check('readiness: no section for them: not a thing to get ready, and the previous edition\'s said', j(SN.readiness('speakers', 0, BWS)) === j({ ok: 'na', text: 'The site has no section for speakers; it shows 49 speakers from the previous edition' }), SN.readiness('speakers', 0, BWS));
check('readiness: some added but no section shows them: a thing to do, with the step (NU-004)', j(SN.readiness('speakers', 1, BWS)) === j({ ok: false, text: '1 speaker, not on the site yet: open the site editor to add a “Speakers” section, then save' }), SN.readiness('speakers', 1, BWS));
var NOPREV = Object.assign({}, BWS, { previous: [] });
check('NU-004 readiness: no section and none added: says one comes with the first', j(SN.readiness('agenda', 0, Object.assign({}, NOPREV, { places: Object.assign({}, BWS.places, { sessions: [] }) }))) ===
  j({ ok: 'na', text: 'The site has no section for sessions yet: add some, and the site editor adds one' }));
check('NU-004 the Dashboard\'s "Add a speaker" says when the site has no section for them', SN.actionNote('speakers', NOPREV) === 'Your site has no Speakers section yet: add speakers, then open the site editor, which adds one' &&
  SN.actionNote('speakers', Object.assign({}, NOPREV, { imported: true })) === 'This imported site cannot show speakers' && SN.actionNote('speakers', null) === '' &&
  SN.actionNote('agenda', BWS) === '', [SN.actionNote('speakers', NOPREV), SN.actionNote('agenda', BWS)]);
check('readiness: shown, with a section: ready, counted with commas', j(SN.readiness('agenda', 1200, BWS)) === j({ ok: true, text: '1,200 sessions on the site' }));

/* ---------- UX-071: the Event logo tile ---------- */
var UPLOAD = 'https://storage.googleapis.com/b/events/bws/logo/upload.svg', UNIT = BWS.logo;
var EV = { logoUrl: UPLOAD, designPlan: { design: { logoUnitUrl: UNIT, logoUnitSource: 'owner', logoUnitFrom: UPLOAD, logoUnitNote: '“SAMSUNG Ads …” was cropped out of your logo' } } };
var t = SN.logoTile(EV, BWS);
check('logo tile (BWS): the banner\'s logo, made from the upload, with the upload a click away', t.url === UNIT && t.original === UPLOAD && t.text === 'On the site’s banner, made from your upload.', t);
t = SN.logoTile(EV, null);
check('logo tile before the site is read: the design\'s own unit', t.url === UNIT && t.original === UPLOAD, t);
t = SN.logoTile({ logoUrl: UPLOAD, designPlan: { design: { logoUnitUrl: UNIT, logoUnitSource: 'previous' } } }, Object.assign({}, BWS, { logo: UNIT }));
check('logo tile: the banner shows another logo than the upload: said, and how to put the upload in', t.url === UNIT && t.original === UPLOAD && /Your latest upload is not in it yet: open the site editor to put it in\./.test(t.text), t);
/* brand-world-summit-2026 on 5 Nov 2026: its banner keeps the copy of 15 Oct, its design the same crop made again on 19 Oct */
var OLDER = 'https://storage.googleapis.com/b/events/bws/generated/20261015054729-logo-unit.svg', NEWER = 'https://storage.googleapis.com/b/events/bws/generated/20261019195923-logo-unit.svg';
var EV2 = { logoUrl: UPLOAD, designPlan: { design: { logoUnitUrl: NEWER, logoUnitSource: 'owner', logoUnitFrom: UPLOAD } } };
t = SN.logoTile(EV2, Object.assign({}, BWS, { logo: OLDER, logoIsUnit: true }));
check('logo tile: the banner\'s copy is the same stored file as the design\'s unit: made from the upload', t.url === OLDER && t.original === UPLOAD && t.text === 'On the site’s banner, made from your upload.', t);
t = SN.logoTile(EV2, Object.assign({}, BWS, { logo: OLDER, logoIsUnit: false }));
check('logo tile: another file than the design\'s unit: the upload is not in the banner yet', t.url === OLDER && /Your latest upload is not in it yet/.test(t.text), t);
t = SN.logoTile({ logoUrl: UPLOAD }, Object.assign({}, BWS, { logo: '' }));
check('logo tile: a site with no logo unit shows the upload, as it always did', t.url === UPLOAD && !t.original && t.text === 'Opens the site’s hero.', t);
t = SN.logoTile({ logoUrl: UPLOAD, designPlan: { design: { logoUnitUrl: UPLOAD, logoUnitSource: 'owner' } } }, null);
check('logo tile: the unit is the upload itself: no second link', t.url === UPLOAD && !t.original, t);
t = SN.logoTile({}, BWS);
check('logo tile: no upload, the banner has a unit made for the site: shown and said', t.url === UNIT && !t.original && /No logo uploaded: the site’s banner shows this one/.test(t.text), t);
t = SN.logoTile({}, null);
check('logo tile: nothing at all: no picture, the old words', t.url === '' && /No logo yet/.test(t.text), t);
t = SN.logoTile({ logoUrl: 'javascript:alert(1)' }, { of: 'live', places: BWS.places, logo: 'http://evil.example/x.png' });
check('logo tile: only https or this site\'s own addresses are pictures', t.url === '' && !t.original, t);

/* ---------- UX-068: one priority ---------- */
check('one scale: Top / High / Normal / Low over the four stored values', j(SN.PRIORITIES.map(function (p) { return p.id + ':' + p.label; })) ===
  j(['keynote:Top', 'headline:High', 'featured:Normal', 'standard:Low']));
check('a missing or unknown priority reads as Normal', SN.priorityLabel(undefined) === 'Normal' && SN.priorityLabel('huge') === 'Normal' && SN.isNormal('') && !SN.isNormal('standard') && SN.priorityLabel('keynote') === 'Top');
var sorted = SN.byPriority([{ n: 'a', weight: 'standard' }, { n: 'b' }, { n: 'c', weight: 'keynote' }, { n: 'd', weight: 'featured' }, { n: 'e', weight: 'headline' }, { n: 'f', weight: 'keynote' }]);
check('Sort by priority: Top first, Low last, equals keep their order', sorted.map(function (x) { return x.n; }).join('') === 'cfebda', sorted.map(function (x) { return x.n; }));
check('the menu explains the order only where the list can be sorted by it', SN.priorityOptions(true)[0].note === 'First when sorted by priority' && SN.priorityOptions(false).every(function (o) { return !o.note; }));
check('the menus\' foot lines say priority and never "weight"', Object.keys(SN.PRIORITY_FOOT).every(function (k) { return /Priority|priority/.test(SN.PRIORITY_FOOT[k]) && !/weight/i.test(SN.PRIORITY_FOOT[k]); }));

/* ---------- the console page ---------- */
var page = read('edit-event.html');
check('the console loads the notes before the Dashboard', page.indexOf('<script src="edit-event-site-notes.js"></script>') !== -1 &&
  page.indexOf('edit-event-site-notes.js') < page.indexOf('edit-event-dashboard.js'));
var userText = page.replace(/\/\*[\s\S]*?\*\//g, '');
check('UX-068: no "Weight", "Sort by weight" or "Match weights" left for the user to read',
  !/['>]Weight|Weight:|Weight —|Sort by weight|Match weights|weight was not saved|data-ptsize/.test(userText), (userText.match(/.{40}(Weight|Sort by weight|Match weights|data-ptsize).{40}/) || [])[0]);
check('UX-068: Sort by priority on Speakers and on Sponsors, through the one sort', (userText.match(/ Sort by priority<\/button>/g) || []).length === 2 &&
  /data-gsort=/.test(userText) && /data-ptsort=/.test(userText) && (userText.match(/SN\.byPriority\(/g) || []).length === 2);
check('UX-068: the rows\' pill is prPill, which draws nothing for Normal', (userText.match(/prPill\('data-(weight|agw|ptw)', /g) || []).length === 3 &&
  /function prPill\(attr, r\)\{\s*if \(SN\.isNormal\(r\.weight\)\) return '';/.test(page));
check('UX-068: the three dialogs say Priority and offer the one scale', (userText.match(/>Priority<\/label>/g) || []).length === 3 && (userText.match(/prOptions\(e\.weight\)/g) || []).length === 3);
check('UX-068: a new sponsor and a new tier start at Normal; a break no longer drops to Low',
  /if \(G\.tab === 'sponsors'\) return \{ weight: 'featured' \};/.test(page) && !/NEW_TIER_WEIGHT|tierWeight|weightTouched/.test(page) && !/\$\('ag-weight'\)\.value = 'standard'/.test(page));
check('UX-069: the logo note is an info callout, and the red "no logo yet" banner is gone',
  /'<div class="callout info" style="margin-top:10px" role="note" id="b-logo-note">'/.test(page) && !/sponsors have\) no logo yet|' sponsors have' : ''|no logo yet<\/strong>/.test(page) &&
  /No logo yet: the site shows the name as text/.test(page));
check('UX-071: the logo tile is drawn from SN.logoTile, with "See your upload"', /var tile = SN\.logoTile\(e, OUTLINE\);/.test(page) && /See your upload ↗/.test(page) &&
  /imgTag\(tile\.url\)/.test(page) && !/imgTag\(e\.logoUrl\) \|\| svg/.test(page));
['speakers', 'agenda', 'sponsors', 'gallery', 'faq', 'contact'].forEach(function (tab) {
  check('UX-066/067: the ' + tab + ' tab works out its notes', page.indexOf("siteNotes('" + tab + "'") !== -1);
});
check('UX-066: the empty states carry the site line; every tab has the callout', (userText.match(/emptySiteLine\(notes\) \+/g) || []).length === 6 && (userText.match(/siteCallout\(notes, (true|false|items\.length > 0|team\.length > 0)\)/g) || []).length === 9);
check('UX-067: the previous edition\'s note opens the editor at that section', /editorAt\(notes\.previous\.key\)/.test(page) && /'&section=' \+ encodeURIComponent\(key\)/.test(page));
/* the console's own lines, run in a vm over the page's helpers */
(function () {
  var a = page.indexOf('  function editorAt(key)'), b = page.indexOf('  /* ============================================================\n     NAVIGATION MODEL');
  var box = { esc: function (v) { return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); },
    svg: function () { return '<svg/>'; }, IC: { info: 1 }, editorUrl: function () { return '/custom_editor.html?event=e1'; } };
  vm.createContext(box);
  vm.runInContext(page.slice(a, b), box);
  var tech = SN.forTab('faq', TECH, { total: 0 });
  var line = box.emptySiteLine(tech);
  check('the empty FAQ tab of a real template: the line says what stands, and opens the editor at that section',
    line.indexOf('shows 1 question not in this list') !== -1 && line.indexOf('hidden') === -1 &&
    line.indexOf('<a href="/custom_editor.html?event=e1&amp;section=faq">Open “FAQ” in the site editor</a>') !== -1, line);
  var hid = box.emptySiteLine(SN.forTab('faq', BWS, { total: 0 }));
  check('an AI site\'s hidden FAQ: the line as before, no editor link', /section is hidden until you add a question\.<\/span><\/p>$/.test(hid) && hid.indexOf('<a ') === -1, hid);
  var none = box.emptySiteLine(SN.forTab('speakers', BWS, { total: 0, shown: 0 }));
  check('no section for speakers and none added: the line says what to do first, and offers no editor link that would add nothing (NU-004)', /Add them here first: the next time the site editor opens, it adds a “Speakers” section for them/.test(none) && none.indexOf('<a ') === -1, none);
  var ready = box.siteCallout(SN.forTab('speakers', BWS, { total: 2, shown: 2 }), true);
  check('NU-004 speakers added with no section: the callout offers the one step, a button to the site editor', ready.indexOf('<a class="btn btn-secondary btn-sm sn-add" href="/custom_editor.html?event=e1">Open the site editor to add the “Speakers” section</a>') !== -1, ready);
  var call = box.siteCallout(SN.forTab('speakers', CX, { total: 2, shown: 0 }), true);
  check('a tab with only invited speakers: the callout says the hidden section and the one that shows its own',
    call.indexOf('“Jury” section is hidden') !== -1 && call.indexOf('section=speakers">Open “Speakers” in the site editor</a>') !== -1, call);
})();
check('the site is read once the console is up, and handed to the Dashboard', /setTimeout\(loadOutline, 0\);/.test(page) && /C\.fetchSiteOutline\(id\)/.test(page) &&
  /CTX\.siteNotes = SN;/.test(page) && /CTX\.siteOutline = function\(\)\{ return OUTLINE; \};/.test(page));
check('the glance lists no longer claim a section is hidden without knowing', !/The Speakers section is hidden on the site|The Sponsors section is hidden on the site|The Agenda section is hidden on the site/.test(page));
check('the core asks GET /api/event/site-outline', /api\('GET', '\/api\/event\/site-outline\?eventId=' \+ q\(eventId\)\)/.test(read('edit-event-core.js')) && /fetchSiteOutline: fetchSiteOutline/.test(read('edit-event-core.js')));

/* the site editor opens at the section the console names, once the site is up and its opening state is over (B14) */
var ed = read('editor-template-ui.js');
check('the editor selects ?section= once the site is up', /function focusAskedSection\(\)/.test(ed) && /logoUnitNotice\(\);\s*setOpening\(null\);\s*focusAskedSection\(\);/.test(ed) &&
  /get\('section'\)/.test(ed) && /selectSection\(sec\)/.test(ed));

/* ---------- the Dashboard, in a vm over the real core, with the notes ---------- */
function loadDash(opts) {
  var win = { location: { origin: 'https://revamp.example' } };
  var ctx = { window: win, location: win.location, console: console, Promise: Promise, URLSearchParams: URLSearchParams, setTimeout: setTimeout,
    document: { getElementById: function () { return null; } } };
  ctx.window = win;
  vm.createContext(ctx);
  vm.runInContext(read('edit-event-core.js'), ctx);
  var C = win.RevampCore;
  C.fetchStats = function () { return Promise.resolve({ registrations: 0, confirmed: 0, byDay: [] }); };
  C.fetchActivityLog = function () { return Promise.resolve({ items: opts.log || [] }); };
  C.fetchForms = function () { return Promise.resolve({ forms: [{ id: 'f1' }], registration: { open: true } }); };
  vm.runInContext(read('edit-event-dashboard.js'), ctx);
  var D = win.EditEventDashboard, x = C.makeCtx({ EV: opts.ev, S: {}, render: function () {} });
  x.$ = function (id) { return id === 'dash-root' ? {} : null; };
  x.contentCounts = function () { return Promise.resolve(opts.counts); };
  x.isAward = function () { return false; };
  x.siteNotes = SN;
  x.siteOutline = function () { return opts.outline; };
  if (opts.words) x.log = { detail: opts.words.detailText };
  return { D: D, ctx: x };
}
function text(html) { return html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' '); }
(async function () {
  var d = loadDash({ ev: { id: 'bws', eventId: 'bws', name: 'BWS', start: '2026-12-05T10:41', venue: 'Taj', city: 'Chennai', category: 'ip', description: 'x'.repeat(200), portal: 'brandequity', portalName: 'ET BrandEquity', site: { version: 6 } },
    counts: { speakers: 0, agenda: 0, sponsors: 0 }, outline: BWS });
  d.D.view(d.ctx); d.D.wire(d.ctx);
  await new Promise(function (r) { setTimeout(r, 30); });
  var v = d.D.view(d.ctx), tv = text(v);
  check('Dashboard: Speakers is not a thing to do on a site with no section for them, and says the previous edition\'s 49',
    /Speakers The site has no section for speakers; it shows 49 speakers from the previous edition No section/.test(tv), tv);
  check('Dashboard: Agenda and Sponsors say their sections are hidden until one is added',
    /Agenda None yet: the site’s “Agenda” section is hidden until one is added To do/.test(tv) && /Sponsors None yet: the site’s “Sponsors” section is hidden until one is added To do/.test(tv), tv);
  check('Dashboard: the ready count leaves out the row with no section', /Ready to publish \d of 5 ready/.test(tv), (tv.match(/Ready to publish .{0,20}/) || [])[0]);
  check('NU-004 Dashboard: "Add a speaker" says the site has no section for them, and what adds one',
    /Add a speaker Your site has no Speakers section yet: add speakers, then open the site editor, which adds one/.test(tv) && !/The line-up drives registrations/.test(tv), tv);
  var d2 = loadDash({ ev: { id: 'x2', eventId: 'x2', name: 'X', site: { version: 1 } }, counts: { speakers: 0, agenda: 0, sponsors: 0 }, outline: null,
    words: require('../../activity-words.js'), log: [{ at: '2026-11-14T05:52:00Z', by: 'qa@x.in', action: 'updated', area: 'event', detail: 'templateId', fields: [{ field: 'templateId', before: '', after: 'gen-x2' }] }] });
  d2.D.view(d2.ctx); d2.D.wire(d2.ctx);
  await new Promise(function (r) { setTimeout(r, 30); });
  var tv2 = text(d2.D.view(d2.ctx));
  check('NU-025 Recent activity says a field by its label, never its key', /› Template/.test(tv2.replace(/&rsaquo;/g, '›')) && !/templateId/.test(tv2), (tv2.match(/Recent activity.{0,200}/) || [])[0]);
  check('NU-004 … and while the site is not known, the quick action says what it always did', /Add a speaker The line-up drives registrations/.test(tv2));

  /* ---------- the registrations drawer (UX-070) ---------- */
  var reg = read('audience-registrations.html');
  check('UX-070: no "Save notes and tags" button: notes and tags save when their box is left', !/dr-save|Save notes and tags<\/button>/.test(reg) &&
    /\$\('dr-notes'\)\.onchange = saveText;/.test(reg) && /\$\('dr-tags'\)\.onchange = saveText;/.test(reg) && /Every change here is saved as you make it/.test(reg));
  check('UX-070: check-in, notes and tags save quietly (the drawer is not drawn again); a status change still redraws it',
    /patch\(r, \{ checkedIn: this\.checked \}, this\.checked \? 'Checked in' : 'Check-in undone', true\)/.test(reg) && /patch\(row, ch, savedText\(ch\), true\)/.test(reg) &&
    /if \(!quiet\)\{ openDrawer\(id\); return true; \}/.test(reg));
  check('UX-070: changes are sent one after another', /SAVING = SAVING\.then\(function\(\)\{/.test(reg));
  check('UX-070: closing the drawer saves what was typed', /function closeDrawer\(\)\{[\s\S]{0,700}sendText\(row, notes\.value, tags\.value\)/.test(reg));
  /* the message is RevampCore.toast's (UX-006, bottom centre): while the drawer is open it is centred on the rest of the page */
  check('UX-070: messages sit beside the drawer, or above its foot on a narrow screen', /body:has\(\.drawer\) \.rv-toasts\{ left:calc\(\(100% - 460px\) \/ 2\); \}/.test(reg) &&
    /@media \(max-width: 900px\)\{ body:has\(\.drawer\) \.rv-toasts\{ left:50%; \} body:has\(\.drawer\)\{ --rv-toast-bottom:80px; \} \}/.test(reg));
  check('UX-070: a place reads as the visitor gave it', !/' \(typed, not from the list\)'/.test(reg) && /function placeOf\(r\)\{ return r\.location \|\| ''; \}/.test(reg));
  /* the drawer's pure helpers, run as they are written */
  var src = ['tagsOf', 'textChanges', 'savedText'].map(function (name) {
    var m = new RegExp('  function ' + name + '\\(([^)]*)\\)\\{[\\s\\S]*?\\n  \\}').exec(reg);
    return m ? m[0] : '';
  }).join('\n');
  var box = {};
  vm.createContext(box);
  vm.runInContext(src + '\nthis.tagsOf = tagsOf; this.textChanges = textChanges; this.savedText = savedText;', box);
  check('tags: trimmed, each once whatever its case', j(box.tagsOf(' VIP, press ,vip,, Speaker ')) === j({ tags: ['VIP', 'press', 'Speaker'] }));
  check('tags: more than 20, or one over 40 characters, cannot be saved', !!box.tagsOf(new Array(22).join('t,') + 'x').error === false && !!box.tagsOf('a,b,c,d,e,f,g,h,i,j,k,l,m,n,o,p,q,r,s,t,u').error && !!box.tagsOf(new Array(42).join('x')).error);
  var row = { notes: 'Old', tags: ['VIP'] };
  check('nothing new in the boxes: nothing to send', box.textChanges(row, 'Old', 'VIP') === null && box.textChanges(row, 'Old', ' vip , VIP') !== null);
  check('only what changed is sent', j(box.textChanges(row, 'New', 'VIP')) === j({ notes: 'New' }) && j(box.textChanges(row, 'Old', 'VIP, Press')) === j({ tags: ['VIP', 'Press'] }) &&
    box.savedText({ notes: 'x' }) === 'Notes saved' && box.savedText({ tags: [] }) === 'Tags saved' && box.savedText({ notes: 'x', tags: [] }) === 'Notes and tags saved');

  /* ---------- seeded sponsors start at Normal (UX-068) ---------- */
  var seed = require('./api-audience').readSeedPayload({ partners: [{ name: 'Acme' }], partnerTiers: [{ name: 'Gold' }] });
  check('Create Event\'s sponsors and tiers start at Normal priority, as a speaker does', seed.partners[0].data.weight === 'featured' && seed.partnerTiers[0].data.weight === 'featured', seed);

  if (failed) { console.error('site-notes: ' + failed + ' of ' + (passed + failed) + ' checks failed'); process.exit(1); }
  console.log('site-notes: all ' + passed + ' checks passed');
})().catch(function (err) { console.error('site-notes: crashed — ' + (err && err.stack || err)); process.exit(1); });
