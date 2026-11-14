// node functions/lib/create-event-saves.test.js — Create Event saves what it says it saves, and its details form tells the
// truth (UX batch B08):
//   UX-042/043  the template path's hand-off uploads the logo (set on the event), the banner and every section picture, writes
//               speakers, sponsors, FAQs, contacts and glimpses into the event's Content, hands the editor addresses (never a
//               picture inside the page), does nothing twice on a retry, and the editor saves the filled page as version 1;
//   UX-044      "previous edition's content" lists the team's real events of the draft's portal and type and reads their
//               real records (create-event-editions.js); its button is secondary and absent on a design with no such block;
//   UX-045      the address is checked with the server as it is typed, a taken one offers the free one ("Use …"), and a
//               taken address at the hand-off leads back to the address box instead of a Retry that cannot work;
//   UX-047      the brief's previous edition can always be given by its link, which opens by itself when ETB2B's list fails;
//   UX-048      drafts are saved to the person's account as typed (the header says where they are), several at once; ?new=1
//               keeps an unfinished one in the account instead of discarding it; Resume (?draft=) opens one on any computer
//               with its pictures; a save from another computer is never overwritten unseen; the dashboard lists them;
//   UX-049      Starts / Ends are a date and a time, a date alone is whole (9:00 / 18:00), half-typed boxes are named for
//               what they lack, Ends is optional as in the console, and the boxes are wide enough.
// The page runs in a vm over a fake DOM (fixtures/create-event-page.js); editor-template-ui.js's functions are extracted.
// No network, no Firebase, no browser, no AI. Exits 1 on failure.
'use strict';
var fs = require('fs'), path = require('path'), vm = require('vm');
var F = require('./fixtures/create-event-page');
var passed = 0, failed = 0;
function check(name, ok, detail) { if (ok) { passed++; return; } failed++; console.error('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); }
function tick(n) { var p = Promise.resolve(); for (var i = 0; i < (n || 12); i++) p = p.then(function () { return new Promise(function (r) { setImmediate(r); }); }); return p; }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
var page = F.page, SRC = F.SRC;
var EDITIONS = F.read('create-event-editions.js'), ED = F.read('editor-template-ui.js');
function balanced(src, open) {
  if (open < 0) return null;
  var depth = 0, i = open, q = null;
  for (; i < src.length; i++) {
    var c = src[i];
    if (q) { if (c === '\\') { i++; continue; } if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (!depth) return src.slice(open, i + 1); }
  }
  return null;
}
function fnSrc(src, name) {
  var at = src.indexOf('function ' + name + '(');
  if (at === -1) return null;
  var open = src.indexOf('{', src.indexOf(')', at));
  return src.slice(at, open) + balanced(src, open);
}
/* a function of editor-template-ui.js's own scope, to the closing brace at its own indent: fnSrc reads an apostrophe in a
   comment ("doesn't") as a quote, and resolveFromBrowser's comments have several */
function topFn(src, name) {
  var at = src.indexOf('\n  function ' + name + '(');
  if (at === -1) return null;
  var end = src.indexOf('\n  }\n', at);
  return end === -1 ? null : src.slice(at + 1, end + 4);
}
var TECH = JSON.parse(F.read('templates/retail-leadership-summit/template.json'));

/* =====================================================================================================
   The files
   ===================================================================================================== */
check('ES5: the page script, create-event-editions.js and editor-template-ui.js', (function () {
  var es = require('esbuild');
  try { [SRC, EDITIONS, ED].forEach(function (s) { es.transformSync(s, { loader: 'js', target: 'es5' }); }); return true; } catch (e) { return String(e.message).slice(0, 200); }
})() === true);
check('UX-045 the hard-coded "taken" list is gone, and the made-up domain with it', SRC.indexOf('TAKEN_SLUGS') === -1 && SRC.indexOf('slugFree') === -1 && page.indexOf('etoneworld') === -1);
check('UX-045 the address made from the name is "Suggested", not AI', SRC.indexOf('AI suggests') === -1 && SRC.indexOf("'Suggested <span class=\"mono\">'") !== -1);
check('UX-045 the check is the server\'s (RevampCore.slugAvailable), a moment after typing', SRC.indexOf('RevampCore.slugAvailable(slug)') !== -1 && /var SLUG_CHECK_MS = 450;/.test(SRC));
check('UX-043 the dialog no longer says pictures stay behind', page.indexOf('not carried into the site editor') === -1);
check('UX-042 the hand-off says what it saves', page.indexOf('Your details, logo, pictures and content are saved with the event, then the editor opens and keeps your page as its first saved version') !== -1);
check('UX-044 no browser-only edition registry or static seed list is read', EDITIONS.indexOf('RevampCore.EVENTS') === -1 && EDITIONS.indexOf('localStorage') === -1 &&
  EDITIONS.indexOf('revamp.eventTemplates') === -1);
check('UX-044 the previous-edition button is never the red primary', SRC.indexOf("'<button class=\"btn btn-secondary btn-sm\" id=\"btn-edition-menu\"") !== -1 &&
  SRC.indexOf("(locked ? 'btn-primary' : 'btn-secondary') + ' btn-sm\" id=\"btn-edition-menu\"") === -1);
check('UX-048 the header says where the draft is, hidden until there is one', /<span class="save-state" id="save-state" title="Your draft is saved to your account: resume it from Drafts on the events dashboard, on any computer\." hidden><span class="d"><\/span>Saved to your account<\/span>/.test(page) &&
  page.indexOf('Draft autosaved</span>') === -1 && SRC.indexOf("'Draft autosaved'") === -1);
check('UX-048 the page loads create-drafts.js before its own script', page.indexOf('<script src="create-drafts.js"></script>') !== -1 && page.indexOf('<script src="create-drafts.js"></script>') < page.indexOf(SRC));
check('UX-048 the dashboard lists the drafts in its Drafts tab, with Resume and Discard', (function () {
  var L = F.read('Event_Listing.html');
  return L.indexOf('<script src="create-drafts.js"></script>') !== -1 && L.indexOf('<section id="create-drafts" aria-label="Unfinished in Create Event"></section>') !== -1 &&
    /function renderCreateDrafts\(\)\{[\s\S]*?if \(state\.specialView !== 'draft'/.test(L) && L.indexOf('>Resume</a>') !== -1 && L.indexOf('data-cdraft-discard=') !== -1 &&
    /function renderResults\(\)\{[\s\S]*?renderCreateDrafts\(\);/.test(L);     // events-dashboard-drafts.test.js runs it
})());
check('UX-048 Save & exit goes to the dashboard\'s Drafts, where the draft is listed', SRC.indexOf("window.location.href = 'Event_Listing.html' + (toDrafts === true ? '#view=draft' : '');") !== -1 &&
  SRC.indexOf("toast('Draft saved to your account. It is under Drafts on the events dashboard.');") !== -1);
check('UX-049 Starts and Ends are no longer datetime-local boxes', page.indexOf('id="f-start" type="datetime-local"') === -1 && SRC.indexOf('dateTimeCell(\'start\', \'Starts\', true) + dateTimeCell(\'end\', \'Ends\', false)') !== -1);
check('UX-047 the link fallback is in the markup: a button and a visible URL box', /<button class="et-chip-btn et-pick-cancel" type="button" id="gb-et-paste">Paste the link instead<\/button>/.test(page) &&
  /<div class="et-link" id="gb-prev-link" hidden>\s*<input class="inp" id="gb-previous" type="url"/.test(page) && page.indexOf('<input type="hidden" id="gb-previous">') === -1);

/* =====================================================================================================
   create-event-editions.js
   ===================================================================================================== */
var E = (function () { var w = {}; w.window = w; vm.createContext(w); vm.runInContext(EDITIONS, w, { filename: 'create-event-editions.js' }); return w; })();
var NOW = Date.parse('2026-11-05T00:00:00Z');
var LIST = [
  { id: 'cio-2025', name: 'CIO Conclave 2025', portal: 'cio', category: 'ip', start: '2025-11-10T09:00', updatedAt: '2025-11-12T00:00:00Z' },
  { id: 'cio-2024', name: 'CIO Conclave 2024', portal: 'cio', category: 'editorial', start: '2024-11-10T09:00', updatedAt: '2026-01-01T00:00:00Z' },
  { id: 'cio-2027', name: 'CIO Conclave 2027', portal: 'cio', category: 'ip', start: '2027-11-10T09:00', updatedAt: '2026-10-01T00:00:00Z' },
  { id: 'cio-nodate', name: 'CIO Nodate', portal: 'cio', category: 'ip', updatedAt: '2026-10-20T00:00:00Z' },
  { id: 'cio-awards', name: 'CIO Awards', portal: 'cio', category: 'awards', start: '2025-01-01T09:00' },
  { id: 'hr-2025', name: 'HR Summit', portal: 'hr', category: 'ip', start: '2025-05-01T09:00' },
  { id: 'cio-own', name: 'This draft', portal: 'cio', category: 'ip', start: '2025-02-01T09:00' },
  { id: 'cio-gone', name: 'Deleted', portal: 'cio', category: 'ip', start: '2025-03-01T09:00', deletedAt: '2026-01-01T00:00:00Z' }
];
var ed = E.RevampEditions.editions(LIST, 'cio', 'IP', 'cio-own', NOW);
check('UX-044 editions: this portal and type only, not the draft\'s own, not a deleted one', JSON.stringify(ed.map(function (x) { return x.id; })) === '["cio-2025","cio-2024","cio-nodate","cio-2027"]', ed);
check('UX-044 editions: past ones first, latest on top, marked past; the rest by their last change', ed[0].past === true && ed[1].past === true && ed[2].past === false && ed[3].past === false);
check('UX-044 editions: no portal or no type, nothing', E.RevampEditions.editions(LIST, '', 'IP').length === 0 && E.RevampEditions.editions(LIST, 'cio', '').length === 0);
var content = E.RevampEditions.toContent({
  speakers: [{ id: 's2', name: 'Ravi', desig: 'CTO', comp: 'Acme', photoUrl: 'https://storage.googleapis.com/b/r.png', order: 2 }, { id: 's1', name: 'Asha', desig: 'CIO', comp: 'Beta', photoUrl: 'data:image/png;base64,xx', order: 1 }],
  sessions: [{ title: 'Day 2 talk', start: '09:00', groupId: 'd2', speakerIds: ['s1'] }, { title: 'Late keynote', start: '11:00', groupId: 'd1', speakerIds: ['s2', 's1'] }, { title: 'Opening', start: '09:30', groupId: 'd1' }],
  agendaGroups: [{ id: 'd2', name: 'Day 2', order: 2 }, { id: 'd1', name: 'Day 1', order: 1 }],
  partners: [{ name: 'Gold One', tierId: 't1', logoUrl: 'https://x.test/g.png', url: 'https://g.test', order: 1 }, { name: 'Loose', order: 3 }, { name: 'Silver One', tierId: 't2', order: 2 }],
  partnerTiers: [{ id: 't2', name: 'Silver', order: 2 }, { id: 't1', name: 'Gold', order: 1 }, { id: 't3', name: 'Empty', order: 3 }],
  gallery: [{ imageUrl: 'https://x.test/1.jpg', caption: 'Day 1', order: 1 }, { imageUrl: '', caption: 'none' }]
});
check('UX-044 toContent: speakers in their order, an https photo kept and anything else not', JSON.stringify(content.speakers.items) ===
  JSON.stringify([{ n: 'Asha', r: 'CIO', c: 'Beta', photoUrl: '' }, { n: 'Ravi', r: 'CTO', c: 'Acme', photoUrl: 'https://storage.googleapis.com/b/r.png' }]), content.speakers);
check('UX-044 toContent: the agenda by day then time, with its speakers\' names', JSON.stringify(content.agenda.items) ===
  JSON.stringify([{ t: '09:30', ti: 'Opening', sp: '' }, { t: '11:00', ti: 'Late keynote', sp: 'Ravi, Asha' }, { t: '09:00', ti: 'Day 2 talk', sp: 'Asha' }]), content.agenda);
check('UX-044 toContent: sponsors by tier, an empty tier dropped, one with no tier kept', JSON.stringify(content.partners.tiers) ===
  JSON.stringify([{ t: 'Gold', logos: [{ n: 'Gold One', url: 'https://g.test', logoUrl: 'https://x.test/g.png' }] }, { t: 'Silver', logos: [{ n: 'Silver One', url: '', logoUrl: '' }] }, { t: '', logos: [{ n: 'Loose', url: '', logoUrl: '' }] }]), content.partners);
check('UX-044 toContent: glimpses with their captions, only real pictures', JSON.stringify(content.glimpses.items) === JSON.stringify([{ url: 'https://x.test/1.jpg', caption: 'Day 1' }]));
check('UX-044 toContent: nothing real, nothing offered', JSON.stringify(E.RevampEditions.toContent({ speakers: [{ name: '' }], gallery: [] })) === '{}');

async function main() {
  var reads = [];
  E.RevampCore = { fetchSub: function (res, id) { reads.push(res + ':' + id); return res === 'gallery' && id === 'bad' ? Promise.reject(new Error('down')) : Promise.resolve([]); } };
  var c = await E.RevampEditions.contentFor('cio-2025');
  check('UX-044 contentFor reads the event\'s six lists of Content', reads.length === 6 && reads.indexOf('speakers:cio-2025') !== -1 && reads.indexOf('partner-tiers:cio-2025') !== -1 && reads.indexOf('agenda-groups:cio-2025') !== -1 && JSON.stringify(c) === '{}', reads);
  var failedRead = await E.RevampEditions.contentFor('bad').then(function () { return false; }, function () { return true; });
  check('UX-044 contentFor: one list that cannot be read fails the read (never half taken over)', failedRead);

  /* =====================================================================================================
     UX-045 the address
     ===================================================================================================== */
  var answers = {};
  var asked = [];
  function slugPage(extra) {
    return F.load({ core: Object.assign({
      publicUrl: function (id) { return 'https://cms.example/e/' + encodeURIComponent(id); },
      slugAvailable: function (slug) { asked.push(slug); var a = answers[slug]; return a instanceof Error ? Promise.reject(a) : Promise.resolve(a || { available: true, suggestion: slug, reason: '' }); }
    }, extra || {}) });
  }
  var p = slugPage();
  check('UX-045 the address shown is the one the site will have', p.ce('siteAddress("cio-conclave-2026")') === 'https://cms.example/e/cio-conclave-2026' && p.ce('addressPrefix()') === 'cms.example/e/');
  answers['brand-world-summit-2026'] = { available: false, reason: 'taken', suggestion: 'brand-world-summit-2026-2', message: 'That address is already used by another event.' };
  p.ce('S.basics.slug = "brand-world-summit-2026"');
  await p.ce('checkSlugNow()');
  check('UX-045 a taken address is said to be taken, with the free one', p.ce('slugIssue(S.basics.slug)') === 'That address is already used by another event. Use “brand-world-summit-2026-2”, or change it.', p.ce('slugIssue(S.basics.slug)'));
  var st = p.$('slug-status');
  check('UX-045 …and its line offers "Use brand-world-summit-2026-2"', st.className === 'slug-status bad' && st.innerHTML.indexOf('id="slug-use">Use brand-world-summit-2026-2</button>') !== -1, st.innerHTML);
  check('UX-045 …and Continue says so: it is a problem of the details form', p.ce('validateBasics("brief")').some(function (x) { return x.field === 'f-slug' && /already used/.test(x.message); }));
  p.$('slug-use').onclick();
  check('UX-045 "Use it" takes the free address, shown as free with the real address', p.ce('S.basics.slug') === 'brand-world-summit-2026-2' && p.$('f-slug').value === 'brand-world-summit-2026-2' &&
    p.$('slug-status').innerHTML.indexOf('https://cms.example/e/brand-world-summit-2026-2</span> is free') !== -1 && p.ce('slugIssue(S.basics.slug)') === '', p.$('slug-status').innerHTML);
  asked = [];
  p.ce('S.basics.slug = "cio-conclave-2026"; slugChanged()');
  check('UX-045 typing says "Checking…" at once and asks only after a pause', p.$('slug-status').innerHTML === 'Checking whether this address is free…' && asked.length === 0);
  p.ce('S.basics.slug = "cio-conclave-2027"; slugChanged()');
  await sleep(520); await tick();
  check('UX-045 …once, for the address as it stands', JSON.stringify(asked) === '["cio-conclave-2027"]' && p.ce('slugCheck.state') === 'free', asked);
  answers['slow-one'] = { available: false, reason: 'taken', suggestion: 'slow-one-2' };
  p.ce('S.basics.slug = "slow-one"');
  var pending = p.ce('checkSlugNow()');
  p.ce('S.basics.slug = "another-one"; slugChanged()');
  await pending;
  check('UX-045 an answer for an address since changed is not shown', p.ce('slugCheck.slug') === 'another-one' && p.ce('slugIssue("another-one")') === '');
  answers['net-down'] = new TypeError('Failed to fetch');
  p.ce('S.basics.slug = "net-down"');
  await p.ce('checkSlugNow()');
  check('UX-045 not reachable: said plainly, with Check again, and nothing is blocked (creating checks again)', p.ce('slugCheck.state') === 'unknown' && p.ce('slugIssue("net-down")') === '' &&
    p.$('slug-status').innerHTML.indexOf('It is checked again when the event is created.') !== -1 && p.$('slug-status').innerHTML.indexOf('id="slug-recheck">Check again') !== -1);
  p.ce('S.createdEventId = "net-down"');
  check('UX-045 an event that exists is never asked about', p.ce('slugCheckable("net-down")') === false);

  /* the hand-off: a taken address is answered with the way back, never "Try again" */
  p = slugPage({ createEvent: function () { return Promise.reject(Object.assign(new Error('The address "qa-taken" is already used by another event. Try "qa-taken-2".'), { status: 409, code: 'slug-taken', suggestion: 'qa-taken-2' })); } });
  p.ce('currentDetailsIssue = function(){ return ""; }; S.basics.slug = "qa-taken"; S.basics.name = "QA Taken"; S.creationMethod = "template"');
  var err = await p.ce('createEventRecord()').then(function () { return null; }, function (e) { return e; });
  check('UX-045 the create step\'s failure carries the free address', !!err && err.slugTaken && err.slugTaken.suggestion === 'qa-taken-2' && /already used/.test(err.message) &&
    p.ce('slugCheck.state') === 'taken' && p.ce('slugCheck.suggestion') === 'qa-taken-2', err && err.slugTaken);
  var runs = 0;
  p.ce('window.__steps = [{ key: "create", label: "Creating your event", run: function(){ window.__runs = (window.__runs || 0) + 1; return window.__runs === 1 ? Promise.reject(window.__err) : Promise.resolve(); } }, { key: "open", label: "Opening the editor", run: function(){ return new Promise(function(){}); } }]');
  p.ctx.__err = err;
  p.ce('runHandoff(window.__steps)');
  await tick();
  var h4 = p.$('step-4').innerHTML;
  check('UX-045 at the hand-off: "Back to my details" leads, "Use qa-taken-2" beside it, no "Try again"', h4.indexOf('<button class="btn btn-primary btn-sm" type="button" id="asm-back">Back to my details</button>') !== -1 &&
    h4.indexOf('id="asm-use-slug">Use qa-taken-2</button>') !== -1 && h4.indexOf('Try again') === -1, h4);
  p.$('asm-use-slug').onclick();
  await tick();
  check('UX-045 "Use qa-taken-2" takes it and runs the step again', p.ce('S.basics.slug') === 'qa-taken-2' && p.ctx.__runs === 2 && p.$('step-4').innerHTML.indexOf('Opening the editor') !== -1);

  /* =====================================================================================================
     UX-049 the dates
     ===================================================================================================== */
  p = F.load();
  p.ce('S.basics.category = "IP"; S.basics.dateMode = "exact"; S.basics.start = ""; S.basics.end = ""; refreshHeroCallout = function(){}');
  p.ce('renderSchedule()');
  var sched = p.$('sched-body').innerHTML;
  check('UX-049 Starts: a date and a time box; Ends the same, marked optional', /<input class="inp" id="f-start" type="date" value="">/.test(sched) && /id="f-start-time" type="time"/.test(sched) &&
    /<label for="f-end">Ends<\/label><span class="pill-opt">Optional<\/span>/.test(sched), sched);
  check('UX-049 each takes three columns, and the venue the rest of the row', /field c3 dt-cell/.test(sched) && /<div class="field c4" id="venue-cell">/.test(sched) &&
    /* WZ-054: the city has a field of its own, at the start of the next row beside the registration note */
    /<div class="field c4" id="city-cell">/.test(sched) && /class="field c8" id="payment-cell"/.test(sched));
  var d = p.$('f-start'), t = p.$('f-start-time');
  d.value = '2027-02-10'; d.oninput();
  check('UX-049 a date alone is a whole start: 09:00, shown in its box', t.value === '09:00' && p.ce('S.basics.start') === '2027-02-10T09:00');
  t.value = '10:30'; t.oninput();
  check('UX-049 the time is changed like any other', p.ce('S.basics.start') === '2027-02-10T10:30');
  var de = p.$('f-end'), te = p.$('f-end-time');
  de.value = '2027-02-10'; de.oninput();
  check('UX-049 an end date alone ends at 18:00', te.value === '18:00' && p.ce('S.basics.end') === '2027-02-10T18:00');
  te.value = ''; te.validity = { badInput: true }; te.oninput(); te.onblur();
  check('UX-049 a time being typed is never overwritten', te.value === '' && p.ce('S.basics.end') === '2027-02-10T18:00');
  var issues = p.ce('validateBasics("brief")').filter(function (x) { return x.field === 'f-end'; });
  check('UX-049 …and a half-typed time is named for what it lacks', issues.length === 1 && issues[0].message === 'Finish the end time, e.g. 06:00 PM.', issues);
  te.validity = { badInput: false }; de.value = ''; de.oninput();
  check('UX-049 Ends may be empty, as in the console', p.ce('S.basics.end') === '' && !p.ce('validateBasics("brief")').some(function (x) { return x.field === 'f-end'; }));
  d.value = ''; d.validity = { badInput: true }; d.oninput();
  issues = p.ce('validateBasics("brief")').filter(function (x) { return x.field === 'f-start'; });
  check('UX-049 a half-typed date says finish the date, not "pick a date"', issues.length === 1 && /^Finish the start date/.test(issues[0].message), issues);
  d.validity = { badInput: false };
  issues = p.ce('validateBasics("brief")').filter(function (x) { return x.field === 'f-start'; });
  check('UX-049 no date at all: pick one, or To be announced', issues.length === 1 && /^Pick a start date, or choose “To be announced”\.$/.test(issues[0].message), issues);
  p.ce('S.basics.start = "2027-02-11T09:00"; S.basics.end = "2027-02-10T18:00"');
  check('UX-049 an end before the start is still said', p.ce('validateBasics("brief")').some(function (x) { return x.field === 'f-end' && x.message === 'The end is before the start.'; }));
  /* with a client, the address gets a row of its own */
  p = F.load();
  var row = p.$('identity-row');
  ['name-cell', 'client-wrap', 'slug-cell', 'logo-cell'].forEach(function (id) { row.appendChild(p.$(id)); });
  p.ce('S.basics.category = "Client"; S.creationMethod = "template"');
  p.ce('applySmartDefaults()');
  check('UX-049 with a client: name, client and logo on one row, the address wide on the next, in the keyboard\'s order too',
    p.$('slug-cell').className === 'field c8' && JSON.stringify(row.children.map(function (c) { return c.id; })) === '["name-cell","client-wrap","logo-cell","slug-cell"]',
    row.children.map(function (c) { return c.id; }));
  p.ce('S.basics.category = "IP"');
  p.ce('applySmartDefaults()');
  check('UX-049 without one: three across, in the markup\'s order', p.$('slug-cell').className === 'field c4' && JSON.stringify(row.children.map(function (c) { return c.id; })) === '["name-cell","client-wrap","slug-cell","logo-cell"]');

  /* =====================================================================================================
     UX-047 the previous edition by its link
     ===================================================================================================== */
  p = F.load({ core: { authedFetch: function () { return Promise.reject(new TypeError('Failed to fetch')); } } });
  await p.ce('loadPortalRoster()');
  p.ce('S.basics.portal = "cio"; S.basics.category = "IP"; S.creationMethod = "brief"; wireEtPicker()');
  await tick();
  check('UX-047 ETB2B\'s list failing opens the link box by itself, with the reason', p.$('gb-prev-link').hidden === false && p.$('gb-et-pickers').hidden === true && p.$('gb-et-paste').hidden === true &&
    p.$('gb-et-status').textContent === 'ETB2B’s list of ETCIO’s events is not available just now. Paste the link to last year’s site instead.', p.$('gb-et-status').textContent);
  p.ce('S.brief.previous = "https://example.com/client-summit-2025"');
  p.fire(p.$('gb-previous'), 'change');
  check('UX-047 a whole link is then shown as the chosen edition', p.$('gb-prev-link').hidden === true && p.$('gb-et-chip').hidden === false &&
    p.$('gb-et-chip-title').textContent === 'https://example.com/client-summit-2025' && p.$('gb-et-chip-sub').textContent === 'Previous edition link');
  p.$('gb-et-change').onclick();
  check('UX-047 Change on a link opens its box again', p.$('gb-prev-link').hidden === false && p.ce('etPick.linkMode') === true);
  p = F.load({ etEvents: { '/api/et/events?portal=cio': [] } });
  await p.ce('loadPortalRoster()');
  p.ce('S.basics.portal = "cio"; S.basics.category = "IP"; S.creationMethod = "brief"; wireEtPicker()');
  await tick();
  check('UX-047 with ETB2B\'s list there, "Paste the link instead" is always offered', p.$('gb-et-paste').hidden === false && p.$('gb-prev-link').hidden === true);
  p.$('gb-et-paste').onclick();
  check('UX-047 …and opens the box with the keyboard in it', p.$('gb-prev-link').hidden === false && p.doc.activeElement === p.$('gb-previous'));
  p.ce('S.brief.previous = "not a link"');
  p.$('gb-et-list').onclick();
  check('UX-047 back to the list: half an address is not kept', p.ce('S.brief.previous') === '' && p.$('gb-prev-link').hidden === true && p.$('gb-et-pickers').hidden === false);
  p.ce('S.brief.previous = "nope"');
  p.ce('focusProblem({ field: "gb-previous", message: "x" })');
  check('UX-047 a link that is not an address is corrected in its own box', p.$('gb-prev-link').hidden === false);

  /* =====================================================================================================
     UX-048 drafts in the person's account: saved as typed, listed, resumed anywhere, several at once
     ===================================================================================================== */
  var CD = require('../../create-drafts.js');
  /* the account, as create-drafts.js reaches it, in memory: drafts with their revision, pictures by slot */
  function account() {
    var A = { store: {}, files: {}, calls: [], fail: null };
    function clone(v) { return JSON.parse(JSON.stringify(v)); }
    A.api = {
      writerId: function () { return 'wtest01'; }, serverSlot: CD.serverSlot, localSlot: CD.localSlot, whenLabel: CD.whenLabel,
      put: function (id, rev, state, opts) {
        A.calls.push('put ' + id + ' ' + rev + (opts && opts.force ? ' force' : ''));
        if (A.hangPut) return new Promise(function () {});      // an account that takes a save and never answers
        if (A.fail) return Promise.reject(A.fail);
        var cur = A.store[id], curRev = cur ? cur.rev : 0;
        if (!(opts && opts.force) && curRev !== rev) {
          return Promise.reject(Object.assign(new Error('conflict'), { status: 409, code: 'draft-conflict',
            current: cur ? { rev: cur.rev, savedAt: cur.state.savedAt, updatedAt: cur.state.savedAt, writer: cur.writer } : null }));
        }
        A.store[id] = { rev: curRev + 1, state: clone(state), writer: (opts && opts.writer) || '' };
        return Promise.resolve({ ok: true, rev: curRev + 1, savedAt: state.savedAt });
      },
      get: function (id) {
        A.calls.push('get ' + id);
        if (A.hang) return new Promise(function () {});         // an account that never answers
        if (A.fail) return Promise.reject(A.fail);
        var cur = A.store[id];
        return Promise.resolve(cur ? { id: id, rev: cur.rev, savedAt: cur.state.savedAt, files: cur.state.files || {}, state: clone(cur.state) } : null);
      },
      remove: function (id) { A.calls.push('remove ' + id); delete A.store[id]; return Promise.resolve(); },
      flushRemovals: function () { return Promise.resolve(); },
      putFile: function (id, slot, blob, name) { A.calls.push('putFile ' + id + ' ' + slot + ' ' + name); if (A.fail) return Promise.reject(A.fail); A.files[id + '/' + slot] = blob; return Promise.resolve({ ok: true }); },
      getFile: function (id, slot) { A.calls.push('getFile ' + id + ' ' + slot); return Promise.resolve(A.files[id + '/' + slot] || null); }
    };
    return A;
  }
  var AUTH = { authedFetch: function () { return Promise.reject(new Error('not used here')); }, currentUser: function () { return { uid: 'u-asha' }; },
    whenResolved: function () { return Promise.resolve(); }, ensureSession: function () { return Promise.resolve(); } };
  /* FileReader, which node has not: the page reads a fetched logo back as a data URL */
  function FakeReader() {}
  FakeReader.prototype.readAsDataURL = function (blob) {
    var self = this;
    blob.arrayBuffer().then(function (buf) { self.result = 'data:' + (blob.type || '') + ';base64,' + Buffer.from(buf).toString('base64'); self.onload(); });
  };
  function acctPage(A, o) {
    o = o || {};
    var pg = F.load(Object.assign({ keepSave: true, globals: { RevampCreateDrafts: A.api, RevampAuth: o.auth || AUTH, FileReader: FakeReader } }, o));
    pg.ctx.Blob = Blob;
    pg.ce('PUSH_DELAY_MS = 0; PUSH_RETRY_MS = 60000; ENSURE_TIMEOUT_MS = 2000; LEAVE_WAIT_MS = 2000; OPEN_WAIT_MS = ' + (o.openWait || 2000) + ';');
    return pg;
  }
  var A = account();
  p = acctPage(A);
  p.ce('S.step = 1; S.step1Phase = "category"; renderSaveState()');
  check('UX-048 nothing is said about saving on the first screen before anything is entered', p.$('save-state').hidden === true);
  p.ce('S.step1Phase = "method"; save()');
  await tick();
  check('UX-048 a type picked but nothing typed: nothing goes to the account, and nothing is said', A.calls.length === 0 && p.$('save-state').hidden === true, A.calls);
  check('UX-048 …this browser keeps it under its own key, named as its last draft', p.ce('localStorage.getItem(CURRENT_KEY)') === p.ce('S.draftId') &&
    !!p.store['revamp.createEvent.draft.v2.' + p.ce('S.draftId')] && !p.store['revamp.createEvent.draft.v1']);
  check('UX-048 …and the tab\'s address names the draft (a reload opens this one)', p.log.replaceState >= 1);
  p.ce('S.basics.name = "QA Account Summit"; save()');
  check('UX-048 typed: "Saving…" while it goes to the account', p.$('save-state').hidden === false && p.$('save-state').innerHTML.indexOf('Saving…') !== -1, p.$('save-state').innerHTML);
  await sleep(20); await tick();
  var id1 = p.ce('S.draftId');
  check('UX-048 …then it is in the account, as this draft, revision 1', !!A.store[id1] && A.store[id1].rev === 1 && A.store[id1].state.basics.name === 'QA Account Summit' &&
    p.ce('S.rev') === 1 && p.ce('inAccount()') === true, A.calls);
  check('UX-048 …and the header says "Saved to your account", with where to find it', p.$('save-state').innerHTML.indexOf('Saved to your account') !== -1 &&
    p.$('save-state').title === 'Your draft is saved to your account: resume it from Drafts on the events dashboard, on any computer.', p.$('save-state').innerHTML);
  check('UX-048 …the browser\'s copy knows its revision; the draft is marked as this person\'s', JSON.parse(p.store['revamp.createEvent.draft.v2.' + id1]).rev === 1 && p.ce('S.owner') === 'u-asha');
  /* the account cannot be reached */
  A.fail = new TypeError('Failed to fetch');
  p.ce('S.basics.venue = "Jio World Centre"; save()');
  await sleep(20); await tick();
  check('UX-048 offline: "Saved on this computer only", and the warning says why, with Try now', p.ce('sync.state') === 'failed' &&
    p.$('save-state').innerHTML.indexOf('Saved on this computer only') !== -1 && p.$('draft-warning').hidden === false &&
    p.$('draft-warning').innerHTML.indexOf('Your draft is saved on this computer only: it could not be saved to your account. The server could not be reached. Check your connection and try again. It is tried again by itself.') !== -1 &&
    !!p.$('draft-warning-act') && p.$('draft-warning-act').textContent === 'Try now', [p.$('save-state').innerHTML, p.$('draft-warning').innerHTML]);
  check('UX-048 …nothing is lost: this browser has it, and leaving does not warn', JSON.parse(p.store['revamp.createEvent.draft.v2.' + id1]).basics.venue === 'Jio World Centre' && p.ce('draftUnsaved()') === false);
  A.fail = null;
  p.winFire('online');
  await sleep(20); await tick();
  check('UX-048 back online: sent at once, and the warning goes', A.store[id1].rev === 2 && A.store[id1].state.basics.venue === 'Jio World Centre' && p.$('draft-warning').hidden === true &&
    p.$('save-state').innerHTML.indexOf('Saved to your account') !== -1);
  /* changed on another computer meanwhile */
  A.store[id1] = { rev: 5, state: Object.assign({}, A.store[id1].state, { savedAt: '2026-11-05T09:20:00.000Z', basics: { name: 'Changed elsewhere' } }), writer: 'wother9' };
  p.ce('S.basics.city = "Mumbai"; save()');
  await sleep(20); await tick();
  check('UX-048 changed on another computer: not overwritten unseen; the person is told and chooses', p.ce('sync.state') === 'conflict' && A.store[id1].rev === 5 &&
    /^This draft was changed on another computer \([^)]+\)\. What you change here is not saved to your account until you choose which to keep\.$/.test(p.ce('unsavedReason()')) &&
    p.$('draft-warning-act').textContent === 'Open the newer one' && p.$('draft-warning-act-1').textContent === 'Keep this one' &&
    p.$('save-state').innerHTML.indexOf('Not saved to your account') !== -1, [p.ce('unsavedReason()'), p.$('draft-warning').innerHTML]);
  p.$('draft-warning-act-1').onclick();
  await sleep(20); await tick();
  check('UX-048 Keep this one: saved over it as a new revision', A.store[id1].rev === 6 && A.store[id1].state.basics.city === 'Mumbai' && p.ce('sync.state') === 'saved' && A.calls.slice(-1)[0] === 'put ' + id1 + ' 5 force' || A.calls.slice(-1)[0] === 'put ' + id1 + ' 1 force' || /force$/.test(A.calls.slice(-1)[0]), A.calls.slice(-2));
  var replaced = null;
  p.ctx.location.replace = function (u) { replaced = u; };
  A.store[id1].rev = 9; A.store[id1].writer = 'wother9';
  p.ce('S.basics.city = "Pune"; save()');
  await sleep(20); await tick();
  p.$('draft-warning-act').onclick();
  check('UX-048 Open the newer one: the page opens the account\'s copy of this draft', replaced === '/create-event.html?draft=' + id1 + '&from=account', replaced);
  /* this browser's own earlier save whose answer never came back is not "another computer" */
  p = acctPage(A);
  p.ce('S.basics.name = "QA Own Echo"; save()');
  await sleep(20); await tick();
  var id2 = p.ce('S.draftId');
  A.store[id2].rev = 4;            // as if a save from this browser had landed and its answer been lost
  p.ce('S.basics.name = "QA Own Echo 2"; save()');
  await sleep(20); await tick();
  check('UX-048 a save of this browser\'s own whose answer was lost: taken up without asking', A.store[id2].rev === 5 && A.store[id2].state.basics.name === 'QA Own Echo 2' && p.ce('sync.state') === 'saved', A.calls.slice(-3));
  /* discarded elsewhere */
  delete A.store[id2];
  p.ce('S.basics.name = "QA Own Echo 3"; save()');
  await sleep(20); await tick();
  check('UX-048 discarded on the dashboard while open here: said, with Save it again and Discard it here too', p.ce('sync.state') === 'conflict' &&
    p.ce('unsavedReason()') === 'This draft was discarded from your Drafts, on the events dashboard or on another computer. What you change here is not saved to your account.' &&
    p.$('draft-warning-act').textContent === 'Save it again' && p.$('draft-warning-act-1').textContent === 'Discard it here too');
  p.$('draft-warning-act').onclick();
  await sleep(20); await tick();
  check('UX-048 Save it again: back in the account', !!A.store[id2] && A.store[id2].state.basics.name === 'QA Own Echo 3' && p.ce('sync.state') === 'saved');
  /* pictures go to the account too, by slot and version */
  p.ce('keepFile("img:3", { name: "speaker.png", blob: new Blob(["png"], { type: "image/png" }), savedAt: 77 })');
  await sleep(20); await tick();
  check('UX-048 a section picture goes to the account under its slot, and the draft lists it by version', A.calls.indexOf('putFile ' + id2 + ' img-3 speaker.png') !== -1 &&
    JSON.stringify(p.ce('S.files["img-3"]')) === '{"name":"speaker.png","savedAt":77}' && A.store[id2].state.files['img-3'].savedAt === 77, A.calls.slice(-3));
  p.ce('dropImageFile(3)');
  check('UX-048 a picture taken off the draft is no longer listed', p.ce('S.files["img-3"]') === undefined);
  check('UX-048 a PSD is never sent (its flattened banner is)', (function () { var before = A.calls.length; p.ce('sendDraftFile("psd", { name: "x.psd", blob: new Blob(["x"]), savedAt: 1 })'); return A.calls.length === before; })());
  /* the hand-off: the draft leaves the person's Drafts before the editor opens */
  var went = null;
  p.ctx.location.replace = function (u) { went = u; };
  p.ce('busy = { kind: "handoff" }; leaveForEditor(busy, "custom_editor.html?from=create&slug=qa-x")');
  await sleep(20); await tick();
  check('UX-048 opened in the editor: removed from the account first, then the editor opens', !A.store[id2] && A.calls.indexOf('remove ' + id2) !== -1 && went === 'custom_editor.html?from=create&slug=qa-x' &&
    !p.store['revamp.createEvent.draft.v2.' + id2], [A.calls.slice(-2), went]);

  /* ?new=1 beside an unfinished draft: kept in the account, never discarded */
  A = account();
  var old = { draftId: 'draft-mold01-aaa111', savedAt: '2026-11-05T08:00:00.000Z', owner: 'u-asha', step: 1, step1Phase: 'details', creationMethod: 'template',
    basics: { category: 'IP', name: 'Old Forum', slug: 'old-forum' }, brief: {}, sections: [] };
  p = acctPage(A, { search: '?new=1', draft: old });
  p.ce('start = function(d){ window.__started = d === null ? "new" : (d && d.draftId) || "current"; }');
  p.ce('init()');
  await sleep(20); await tick();
  check('UX-048 Create Event with an unfinished draft: it is put in the account and a new event starts at once — nothing asked, nothing discarded',
    p.ctx.__started === 'new' && p.log.modals.length === 0 && !!A.store[old.draftId] && A.store[old.draftId].state.basics.name === 'Old Forum' &&
    !!p.store['revamp.createEvent.draft.v2.' + old.draftId], [p.ctx.__started, p.log.modals.map(function (m) { return m.title; }), A.calls]);
  A = account(); A.fail = new TypeError('Failed to fetch');
  p = acctPage(A, { search: '?new=1', draft: old });
  p.ce('start = function(d){ window.__started = d === null ? "new" : (d && d.draftId) || "current"; }');
  p.ce('init()');
  await sleep(20); await tick();
  check('UX-048 …when it cannot be put there now, the person is asked as before, and told why', p.ctx.__started === undefined && p.log.modals.length === 1 &&
    p.log.modals[0].title === 'You have an unfinished event' && p.log.modals[0].body.indexOf('it could not be saved to your account just now, so it is not in your Drafts') !== -1);
  /* …and while it is being put there on a slow account the page says so, instead of a blank page with a dead Continue */
  A = account(); A.hangPut = true;
  p = acctPage(A, { search: '?new=1', draft: Object.assign({}, old, { basics: { category: 'IP', name: 'QA Local Only' } }) });
  p.ce('ENSURE_TIMEOUT_MS = 40');
  p.ce('window.__realStart = start; start = function(d){ window.__started = d === null ? "new" : d; return window.__realStart(d); }');
  p.ce('init()');
  await tick();
  check('regression: Create Event beside a draft not in the account yet: while it is saved there the page says so, not a blank page',
    p.$('draft-opening').hidden === false && p.$('draft-opening-text').textContent === 'Saving your unfinished draft to your account…' &&
    p.ctx.__started === undefined && p.log.modals.length === 0, p.$('draft-opening-text').textContent);
  check('regression: …with the footer\'s Back and Continue and the header\'s Save & exit put away (no step to act on yet)',
    p.$('wiz-foot').hidden === true && p.$('btn-save-exit').hidden === true);
  p.ce('window.__realExit = exitToDashboard; exitToDashboard = function(t){ window.__left = t; }');
  p.$('btn-close').onclick();
  check('regression: …and the close button leaves, to the events list (not Drafts: that draft is not listed there yet)', p.ctx.__left === false, p.ctx.__left);
  p.ce('exitToDashboard = window.__realExit');
  await sleep(80); await tick();
  check('regression: …an account that does not answer in time: the line goes and the person is asked about the unfinished event',
    p.$('draft-opening').hidden === true && p.log.modals.length === 1 && p.log.modals[0].title === 'You have an unfinished event' && p.ctx.__started === undefined,
    p.log.modals.map(function (m) { return m.title; }));
  check('regression: …behind that question the footer stays put away: its own buttons are the ways on', p.$('wiz-foot').hidden === true);
  p.log.modals[0].onConfirm();
  await tick();
  check('regression: …Continue this draft opens it, with the footer and Save & exit back and Review and create (NU-012) on its step',
    p.ce('S.basics.name') === 'QA Local Only' && p.$('wiz-foot').hidden === false && p.$('btn-save-exit').hidden === false &&
    p.$('btn-next').hidden === false && p.$('btn-next').textContent.indexOf('Review and create') !== -1 && p.ce('draftOpening') === false);
  /* a draft the account already has answers at once: the line is never left showing, and the new event starts */
  A = account();
  A.store[old.draftId] = { rev: 2, state: Object.assign({}, old), writer: 'wtest01' };
  p = acctPage(A, { search: '?new=1', draft: Object.assign({}, old, { rev: 2, syncedAt: old.savedAt }) });
  p.ce('window.__realStart = start; start = function(d){ window.__started = d === null ? "new" : d; return window.__realStart(d); }');
  p.ce('init()');
  await tick();
  check('regression: …one already in the account: the new event starts at once, with no saving line and its footer shown',
    p.ctx.__started === 'new' && p.$('draft-opening').hidden === true && p.$('wiz-foot').hidden === false && A.calls.filter(function (c) { return /^put /.test(c); }).length === 0, A.calls);
  A = account();
  p = acctPage(A, { search: '?new=1', draft: Object.assign({}, old, { owner: 'u-someone-else' }) });
  p.ce('start = function(d){ window.__started = d === null ? "new" : (d && d.draftId) || "current"; }');
  p.ce('init()');
  await sleep(20); await tick();
  check('UX-048 another person\'s draft left in this browser: never sent to this account, never asked about', p.ctx.__started === 'new' && !p.log.modals.length && !A.store[old.draftId] &&
    A.calls.filter(function (c) { return /^put /.test(c); }).length === 0, A.calls);

  /* Resume (?draft=<id>) on another computer: the account's copy, with its pictures */
  A = account();
  var their = { draftId: 'draft-mres01-bbb222', savedAt: '2026-11-05T10:00:00.000Z', owner: 'u-asha', step: 1, step1Phase: 'details', creationMethod: 'template', template: null,
    basics: { category: 'IP', name: 'Resumed Summit', slug: 'resumed-summit', logo: true, logoName: 'logo.png' }, brief: {}, sections: [],
    files: { logo: { name: 'logo.png', savedAt: 50 }, 'img-2': { name: 'p.jpg', savedAt: 60 } } };
  A.store[their.draftId] = { rev: 3, state: their, writer: 'wother9' };
  A.files[their.draftId + '/logo'] = new Blob(['png'], { type: 'image/png' });
  A.files[their.draftId + '/img-2'] = new Blob(['jpg'], { type: 'image/jpeg' });
  p = acctPage(A, { search: '?draft=' + their.draftId });
  var puts = [];
  p.ctx.RevampStore.put = function (k, rec) { puts.push([k, rec]); return Promise.resolve(); };
  p.ce('start = function(d){ window.__started = d; }');
  p.ce('init()');
  await sleep(30); await tick(20);
  var st = p.ctx.__started;
  check('UX-048 Resume on another computer opens the account\'s copy, known to be in the account', !!st && st.draftId === their.draftId && st.basics.name === 'Resumed Summit' && st.rev === 3 && st.syncedAt === st.savedAt, st);
  check('UX-048 …with its pictures fetched into the draft\'s own slots first (the logo as the form reads it)', puts.length === 2 &&
    puts.some(function (x) { return x[0] === 'create:' + their.draftId + ':logo' && /^data:image\/png;base64,/.test(x[1].dataUrl) && x[1].savedAt === 50; }) &&
    puts.some(function (x) { return x[0] === 'create:' + their.draftId + ':img:2' && x[1].blob && x[1].savedAt === 60; }), puts.map(function (x) { return x[0]; }));
  /* this browser's copy is newer (typed here, not sent yet): that one opens */
  A = account();
  A.store[their.draftId] = { rev: 3, state: their, writer: 'wother9' };
  p = acctPage(A, { search: '?draft=' + their.draftId, draft: Object.assign({}, their, { savedAt: '2026-11-05T11:00:00.000Z', rev: 3, syncedAt: '2026-11-05T10:00:00.000Z', basics: { category: 'IP', name: 'Typed here later' } }) });
  p.ce('start = function(d){ window.__started = d; }');
  p.ce('init()');
  await sleep(20); await tick();
  check('UX-048 …this browser\'s newer copy wins over an older one in the account', p.ctx.__started && p.ctx.__started.basics.name === 'Typed here later');
  /* the account does not answer: "Opening your draft…" meanwhile, then this browser's copy opens */
  A = account(); A.hang = true;
  p = acctPage(A, { search: '?draft=' + their.draftId, openWait: 40, draft: Object.assign({}, their, { basics: { category: 'IP', name: 'Kept here' } }) });
  /* the page's own start() runs here (recorded on the way), as it shows the step the draft opens on and its footer */
  p.ce('window.__realStart = start; start = function(d){ window.__started = d; return window.__realStart(d); }');
  p.ce('init()');
  await tick();
  check('UX-048 while the draft is fetched the page says "Opening your draft…", not a blank page', p.$('draft-opening').hidden === false && p.ctx.__started === undefined);
  check('regression: …and the footer\'s Back and Continue, which have no step to act on yet, are put away meanwhile', p.$('wiz-foot').hidden === true);
  check('regression: …so is the header\'s Save & exit (nothing typed here to save yet)', p.$('btn-save-exit').hidden === true);
  p.ce('window.__realExit = exitToDashboard; exitToDashboard = function(t){ window.__left = t; }');
  p.$('btn-close').onclick();
  check('regression: …while the close button still leaves, straight back to Drafts', p.ctx.__left === true, p.ctx.__left);
  p.ce('exitToDashboard = window.__realExit');
  await sleep(80); await tick();
  check('UX-048 …an account that does not answer in time: this browser\'s copy opens, and the line goes', p.ctx.__started && p.ctx.__started.basics.name === 'Kept here' && p.$('draft-opening').hidden === true);
  check('regression: …and the footer comes back with the step the draft opens on, its Back and Review and create working', p.$('wiz-foot').hidden === false &&
    p.ce('S.basics.name') === 'Kept here' && p.$('btn-next').hidden === false && p.$('btn-next').textContent.indexOf('Review and create') !== -1);
  check('regression: …with Save & exit back in the header, and the close button\'s quick way out gone (start() wires its own)', p.$('btn-save-exit').hidden === false &&
    p.ce('draftOpening') === false && (function () { p.ctx.__left = 'no'; p.ce('window.__realExit = exitToDashboard; exitToDashboard = function(t){ window.__left = t; }'); p.$('btn-close').onclick(); p.ce('exitToDashboard = window.__realExit'); return p.ctx.__left === 'no'; })());
  A = account(); A.hang = true;
  p = acctPage(A, { search: '?draft=' + their.draftId, openWait: 40 });
  p.ce('start = function(d){ window.__started = d === null ? "new" : d; }');
  p.ce('init()');
  await sleep(80); await tick();
  check('UX-048 …with no copy here either: the person is told, with Try again (nothing is opened blank)', p.ctx.__started === undefined && p.log.modals.length === 1 &&
    p.log.modals[0].title === 'Your draft could not be opened' && p.log.modals[0].sub.indexOf('did not answer in time') !== -1 && p.$('draft-opening').hidden === true, p.log.modals.map(function (m) { return m.title + ' / ' + m.sub; }));
  check('regression: …and behind that dialog the footer stays put away: its Try again and Start a new event are the only ways on', p.$('wiz-foot').hidden === true);

  /* gone from the account: not opened, and said */
  A = account();
  p = acctPage(A, { search: '?draft=' + their.draftId, draft: Object.assign({}, their, { rev: 3, syncedAt: their.savedAt }) });
  p.ce('start = function(d){ window.__started = d === null ? "new" : d; }');
  p.ce('init()');
  await sleep(20); await tick();
  check('UX-048 a draft no longer in the account (discarded, or already in the editor) is not opened, and that is said', p.ctx.__started === 'new' &&
    p.log.toasts.some(function (t) { return t.msg === 'That draft is no longer in your Drafts: it was discarded, or already opened in the editor. This is a new event.'; }) &&
    !p.store['revamp.createEvent.draft.v2.' + their.draftId], p.log.toasts);

  /* this browser's other drafts: sent if they never were, let go once the account has them and a week has passed */
  A = account();
  var now = Date.now(), ago = function (ms) { return new Date(now - ms).toISOString(); };
  var unsent = { draftId: 'draft-mtid01-ccc333', savedAt: ago(1000), owner: 'u-asha', basics: { name: 'Unsent' }, brief: {}, sections: [] };
  var oldSynced = { draftId: 'draft-mtid02-ddd444', savedAt: ago(8 * 864e5), syncedAt: ago(8 * 864e5), rev: 2, owner: 'u-asha', basics: { name: 'Old' }, brief: {}, sections: [] };
  var empty = { draftId: 'draft-mtid03-eee555', savedAt: ago(2 * 3600e3), basics: { name: '' }, brief: {}, sections: [] };
  var others = { draftId: 'draft-mtid04-fff666', savedAt: ago(1000), owner: 'u-other', basics: { name: 'Theirs' }, brief: {}, sections: [] };
  var storage = {};
  [unsent, oldSynced, empty, others].forEach(function (d) { storage['revamp.createEvent.draft.v2.' + d.draftId] = JSON.stringify(d); });
  oldSynced.syncedAt = oldSynced.savedAt;
  storage['revamp.createEvent.draft.v2.' + oldSynced.draftId] = JSON.stringify(oldSynced);
  p = acctPage(A, { storage: storage });
  p.ce('tidyLocalDrafts()');
  await sleep(20); await tick();
  check('UX-048 an unsent draft of this person\'s goes to the account', !!A.store[unsent.draftId] && JSON.parse(p.store['revamp.createEvent.draft.v2.' + unsent.draftId]).rev === 1, A.calls);
  check('UX-048 a week-old one the account holds, and an old empty one, are let go here', !p.store['revamp.createEvent.draft.v2.' + oldSynced.draftId] && !p.store['revamp.createEvent.draft.v2.' + empty.draftId]);
  check('UX-048 another person\'s is neither sent nor removed', !A.store[others.draftId] && !!p.store['revamp.createEvent.draft.v2.' + others.draftId]);

  /* the one draft an older page kept for the whole browser moves to its own key */
  p = acctPage(account(), { storage: { 'revamp.createEvent.draft.v1': JSON.stringify({ draftId: 'draft-mleg01-ggg777', savedAt: '2026-11-01T10:00:00.000Z', basics: { name: 'Legacy' } }) } });
  p.ce('migrateLegacyDraft()');
  check('UX-048 an older browser\'s single draft is moved to its own key and resumed', !p.store['revamp.createEvent.draft.v1'] && !!p.store['revamp.createEvent.draft.v2.draft-mleg01-ggg777'] &&
    p.store['revamp.createEvent.current.v2'] === 'draft-mleg01-ggg777' && p.ce('readStoredDraft()').basics.name === 'Legacy');

  /* two tabs: the same draft changed in the other one stops this one; the other tab noting the account's revision does not */
  p = acctPage(account());
  p.ce('S.basics.name = "QA Tabs"; save()');
  await sleep(20); await tick();
  var key = 'revamp.createEvent.draft.v2.' + p.ce('S.draftId');
  p.winFire('storage', { key: key, newValue: JSON.stringify(Object.assign(JSON.parse(p.store[key]), { rev: 7 })) });
  check('UX-048 the other tab only noting the account\'s revision changes nothing here', p.ce('otherTab') === '');
  p.winFire('storage', { key: key, newValue: JSON.stringify(Object.assign(JSON.parse(p.store[key]), { savedAt: '2030-01-01T00:00:00.000Z' })) });
  check('UX-048 typed in the other tab: this one stops saving and says so', p.ce('otherTab') === 'changed' && p.$('draft-warning-act').textContent === 'Reload to continue');
  p.winFire('storage', { key: 'revamp.createEvent.draft.v2.draft-another-1', newValue: '{}' });
  check('UX-048 another draft in another tab is another draft: tabs on different drafts never meet', p.ce('otherTab') === 'changed');

  /* no account on this page (create-drafts.js did not load): said, never claimed */
  p = F.load({ keepSave: true });
  p.ce('S.basics.name = "QA No Account"; save()');
  check('UX-048 without the account the header says "Saved on this computer only", with why', p.$('save-state').innerHTML.indexOf('Saved on this computer only') !== -1 &&
    p.$('save-state').title === 'Your account could not be reached from this page. Reload it to save your draft there.');

  /* =====================================================================================================
     UX-044 the page's pull-content dialog
     ===================================================================================================== */
  p = F.load({ events: LIST });
  vm.runInContext(EDITIONS, p.ctx, { filename: 'create-event-editions.js' });
  await p.ce('loadPortalRoster()');
  p.ce('S.basics.portal = "cio"; S.basics.category = "IP"; S.createdEventId = "cio-own"');
  p.ce('openPullContentModal()');
  await tick();
  var body = p.$('pull-body').innerHTML;
  check('UX-044 the dialog lists this portal\'s real events of the type, past ones first', /<option value="cio-2025">CIO Conclave 2025 — 10 Nov 2025<\/option>/.test(body) &&
    body.indexOf('hr-2025') === -1 && body.indexOf('cio-own') === -1 && body.indexOf('cio-awards') === -1 && body.indexOf('cio-2025') < body.indexOf('cio-2027') && p.log.fetchedEvents === 1, body);
  check('UX-044 …an upcoming one is marked so', body.indexOf('CIO Conclave 2027 — upcoming, 10 Nov 2027') !== -1);
  p = F.load({ events: [] });
  vm.runInContext(EDITIONS, p.ctx, { filename: 'create-event-editions.js' });
  await p.ce('loadPortalRoster()');
  p.ce('S.basics.portal = "cio"; S.basics.category = "IP"; openPullContentModal()');
  await tick();
  check('UX-044 none: said plainly, with no instruction that cannot work', /No other ETCIO IP Event event is in your events yet|No other ETCIO .* event is in your events yet/.test(p.$('pull-body').innerHTML) &&
    p.$('pull-body').innerHTML.indexOf('console') === -1, p.$('pull-body').innerHTML);

  /* =====================================================================================================
     UX-042 / UX-043 the hand-off saves everything on the server
     ===================================================================================================== */
  var up = [], upd = [], made = [], gone = [], subs = {}, failUpload = {}, failCreate = {}, n = 0;
  function handPage() {
    var hp = F.load({ core: {
      uploadImage: function (id, kind, file) {
        if (failUpload[file.name]) { delete failUpload[file.name]; return Promise.reject(new Error('The server could not store it.')); }
        up.push(id + ' ' + kind + ' ' + file.name + ' ' + file.type);
        return Promise.resolve({ url: 'https://storage.googleapis.com/b/events/' + id + '/' + kind + '/' + (++n) + '-' + file.name });
      },
      updateEvent: function (id, patch) { upd.push(id + ' ' + JSON.stringify(patch)); return Promise.resolve({ ok: true }); },
      createSub: function (res, id, rec) {
        var key = res + ':' + (rec.name || rec.question || rec.imageUrl || rec.label);
        if (failCreate[key]) { delete failCreate[key]; return Promise.reject(new Error('Could not save it.')); }
        made.push(res + ' ' + JSON.stringify(rec)); return Promise.resolve({ id: res + '-' + made.length });
      },
      fetchSub: function (res) { return Promise.resolve(subs[res] || []); },
      deleteSub: function (res, id, rid) { gone.push(res + ' ' + rid); return Promise.resolve({ ok: true }); }
    } });
    hp.ctx.Blob = Blob; hp.ctx.File = File;
    hp.ctx.fetch = function (url) {
      if (/^data:/.test(url)) return Promise.resolve({ blob: function () { return Promise.resolve(new Blob(['png'], { type: 'image/png' })); } });
      return Promise.reject(new TypeError('no network in tests'));
    };
    hp.ctx.RevampStore.get = function (key) { return Promise.resolve(/:logo$/.test(key) ? { name: 'logo.png', dataUrl: 'data:image/png;base64,cG5n', savedAt: 7 } : null); };
    return hp;
  }
  p = handPage();
  await p.ce('loadPortalRoster()');
  p.ctx.__tech = TECH;
  p.ce('S.template = "retail-leadership-summit"; S.creationMethod = "template"; S.createdEventId = "qa-ux-b08-t"; S.basics.slug = "qa-ux-b08-t"; S.basics.name = "QA B08";' +
    'S.basics.logo = true; S.basics.logoName = "logo.png"; S.basics.portal = "retail";' +
    'tplInfo["retail-leadership-summit"] = { state: "ready", caps: templateCaps(window.__tech) }; applyTemplate();');
  check('the design is read: its sections are on the draft', p.ce('!!sectionByLib("partners") && !!sectionByLib("faq") && !!sectionByLib("contact") && !!sectionByLib("glimpses")'));
  p.ce('imgFiles[1] = { blob: new Blob(["a"], { type: "image/png" }), name: "acme.png", url: "blob:1" };' +
    'imgFiles[2] = { blob: new Blob(["b"], { type: "image/jpeg" }), name: "day1.jpg", url: "blob:2" };' +
    'bannerFiles.banner = { blob: new Blob(["c"], { type: "image/jpeg" }), name: "banner.jpg", url: "blob:3", savedAt: 5 };' +
    'activeBannerUrl = function(){ return "blob:3"; }; heroSlot = function(){ return "banner"; };' +
    'var _p = sectionByLib("partners"); setSecIncluded(_p, true); _p.data = { tiers: [{ t: "Gold", logos: [{ n: "Acme", url: "acme.com", slot: 1 }, { n: "Beta" }] }, { t: "", logos: [{ n: "Gamma" }] }, { t: "Empty", logos: [] }] };' +
    'var _g = sectionByLib("glimpses"); setSecIncluded(_g, true); _g.data = { items: [{ slot: 2, caption: "Day 1" }] };' +
    'var _f = sectionByLib("faq"); setSecIncluded(_f, true); _f.data = { items: [{ t: "When is it?", d: "In February." }] };' +
    'var _c = sectionByLib("contact"); setSecIncluded(_c, true); _c.data = { blocks: [{ t: "Sponsorship", people: [{ n: "Asha Rao", e: "asha@example.com", p: "+91 98200 00000" }] }] };');
  var steps = p.ce('handoffSteps()');
  check('UX-042 the hand-off\'s rows: create, pictures, records, open', JSON.stringify(steps.map(function (s) { return s.key; })) === '["create","pictures","records","open"]', steps.map(function (s) { return s.key; }));
  check('UX-042 …each named for what it does', steps[1].label === 'Uploading your logo, banner and 2 section pictures' && steps[2].label === 'Saving sponsors, FAQs, contacts and glimpses to the event’s Content', [steps[1].label, steps[2].label]);

  p.ce('busy = { kind: "handoff" }; window.__row = { label: "" };');
  failUpload['day1.jpg'] = true;
  var e1 = await p.ce('sendPictures(busy, window.__row, function(){})').then(function () { return null; }, function (e) { return e; });
  check('UX-043 a picture that cannot be uploaded stops the row, named', !!e1 && e1.message === '“day1.jpg” could not be uploaded: The server could not store it.', e1 && e1.message);
  await p.ce('sendPictures(busy, window.__row, function(){})');
  check('UX-042/043 everything is uploaded once: the logo, the banner, the sponsor logo and the glimpse, each as its kind', up.length === 4 &&
    up.filter(function (x) { return /^qa-ux-b08-t logo logo\.png image\/png$/.test(x); }).length === 1 && up.filter(function (x) { return / banner banner\.jpg image\/jpeg$/.test(x); }).length === 1 &&
    up.filter(function (x) { return / partners acme\.png image\/png$/.test(x); }).length === 1 && up.filter(function (x) { return / gallery day1\.jpg image\/jpeg$/.test(x); }).length === 1, up);
  check('UX-042 the logo is set on the event (logoUrl), once', upd.length === 1 && /^qa-ux-b08-t \{"logoUrl":"https:\/\/storage\.googleapis\.com\/b\/events\/qa-ux-b08-t\/logo\/\d+-logo\.png"\}$/.test(upd[0]), upd);
  check('UX-043 the row says it is done', p.ctx.__row.label === 'Uploaded your logo, banner and 2 section pictures', p.ctx.__row.label);
  await p.ce('sendPictures(busy, window.__row, function(){})');
  check('UX-042 a second run sends nothing again', up.length === 4 && upd.length === 1);

  await p.ce('writeRecords(busy, window.__row)');
  var byRes = function (res) { return made.filter(function (x) { return x.indexOf(res + ' ') === 0; }).map(function (x) { return JSON.parse(x.slice(res.length + 1)); }); };
  var tiers = byRes('partner-tiers'), partners = byRes('partners');
  check('UX-042 sponsors: their tiers (only ones with a sponsor, and named), then each sponsor in its tier with its logo and link', JSON.stringify(tiers) === '[{"order":0,"name":"Gold"}]' &&
    partners.length === 3 && partners[0].name === 'Acme' && partners[0].tierId === 'partner-tiers-1' && partners[0].url === 'https://acme.com' && /\/partners\/\d+-acme\.png$/.test(partners[0].logoUrl) &&
    partners[1].name === 'Beta' && partners[1].tierId === 'partner-tiers-1' && partners[2].name === 'Gamma' && !partners[2].tierId, [tiers, partners]);
  check('UX-042 FAQs, contacts and glimpses into the console\'s records', JSON.stringify(byRes('faqs')) === '[{"order":0,"question":"When is it?","answer":"In February."}]' &&
    JSON.stringify(byRes('contacts')) === '[{"order":0,"label":"Sponsorship","name":"Asha Rao","email":"asha@example.com","phone":"+91 98200 00000"}]' &&
    byRes('gallery').length === 1 && /\/gallery\/\d+-day1\.jpg$/.test(byRes('gallery')[0].imageUrl) && byRes('gallery')[0].caption === 'Day 1', [byRes('faqs'), byRes('contacts'), byRes('gallery')]);
  var count = made.length;
  await p.ce('writeRecords(busy, window.__row)');
  check('UX-042 a second run writes nothing again', made.length === count && gone.length === 0);
  p.ce('sectionByLib("faq").data.items[0].d = "On 12 February."');
  await p.ce('writeRecords(busy, window.__row)');
  check('UX-042 content changed before the editor opened: this draft\'s own FAQs are replaced, nothing else', gone.length === 1 && /^faqs faqs-/.test(gone[0]) &&
    made.length === count + 1 && byRes('faqs').pop().answer === 'On 12 February.', [gone, made.slice(count)]);
  /* stopped part-way: the next run takes this draft's half away and writes it whole */
  p.ce('S.records = null');
  subs = {};
  gone = []; made = [];
  failCreate['partners:Beta'] = true;
  var e2 = await p.ce('writeRecords(busy, window.__row)').then(function () { return null; }, function (e) { return e; });
  check('UX-042 a record that cannot be saved stops the row with the reason', !!e2 && e2.message === 'The event’s Content could not be saved: Could not save it.', e2 && e2.message);
  var half = made.length;
  await p.ce('writeRecords(busy, window.__row)');
  check('UX-042 …and the retry takes away what it half wrote before writing it whole', gone.length === 2 && gone[0].indexOf('partner-tiers ') === 0 && gone[1].indexOf('partners ') === 0 &&
    byRes('partners').filter(function (x) { return x.name === 'Acme'; }).length === 2 && half === 2, [gone, made]);
  /* the event already has records of a kind this draft did not write: kept, not doubled */
  p.ce('S.records = null');
  subs = { contacts: [{ id: 'theirs', name: 'Someone' }] };
  made = []; gone = [];
  await p.ce('writeRecords(busy, window.__row)');
  check('UX-042 records somebody else put in the event are kept, not doubled, and the row says so', byRes('contacts').length === 0 && byRes('faqs').length === 1 &&
    p.ctx.__row.label === 'Saved sponsors, FAQs, contacts and glimpses to the event’s Content (its contacts already there were kept)', p.ctx.__row.label);

  /* regression (B08 verify v9): a kind the draft wrote on an earlier run and no longer has comes out of the Content again */
  p.ce('S.records = null');
  subs = {}; made = []; gone = [];
  await p.ce('writeRecords(busy, window.__row)');
  var faqIds = p.ce('S.records.made.faqs.slice()'), contactIds = p.ce('S.records.made.contacts.slice()');
  p.ce('sectionByLib("faq").data = { items: [] }');
  var rs = p.ce('handoffSteps()').filter(function (s) { return s.key === 'records'; })[0];
  check('regression: with the FAQs taken out, the records row still runs and names what it saves', !!rs && rs.label === 'Saving sponsors, contacts and glimpses to the event’s Content', rs && rs.label);
  gone = [];
  await p.ce('writeRecords(busy, window.__row)');
  check('regression: the FAQ this draft wrote earlier is deleted from the Content, nothing else', gone.length === 1 && gone[0] === 'faqs ' + faqIds[0] &&
    p.ce('S.records.made.faqs.length') === 0 && p.ce('S.records.done.faq') === undefined, gone);
  check('regression: …and the row says so', p.ctx.__row.label === 'Saved sponsors, contacts and glimpses to the event’s Content; the FAQs you removed were taken out', p.ctx.__row.label);
  p.ce('sectionByLib("contact").data = { blocks: [] }; sectionByLib("partners").data = { tiers: [] }; sectionByLib("glimpses").data = { items: [] }');
  rs = p.ce('handoffSteps()').filter(function (s) { return s.key === 'records'; })[0];
  check('regression: every kind taken out: the row runs only to take them out', !!rs && rs.label === 'Taking the sponsors, contacts and glimpses you removed out of the event’s Content', rs && rs.label);
  gone = [];
  await p.ce('writeRecords(busy, window.__row)');
  check('regression: …each of this draft\'s records is deleted', gone.indexOf('contacts ' + contactIds[0]) !== -1 && gone.filter(function (x) { return /^partners /.test(x); }).length === 3 &&
    gone.filter(function (x) { return /^partner-tiers /.test(x); }).length === 1 && gone.filter(function (x) { return /^gallery /.test(x); }).length === 1 &&
    p.ctx.__row.label === 'Took the sponsors, contacts and glimpses you removed out of the event’s Content', [gone, p.ctx.__row.label]);
  check('regression: nothing of this draft\'s is left, so no records row next time', p.ce('staleRecordSources(S.createdEventId, recordPlan(pendingAddress)).length') === 0 &&
    p.ce('handoffSteps()').every(function (s) { return s.key !== 'records'; }));
  /* records somebody else wrote are never this draft's to delete */
  p.ce('S.records = { eventId: "qa-ux-b08-t", done: {}, made: {} }');
  check('regression: a kind this draft never wrote is not "removed"', p.ce('staleRecordSources(S.createdEventId, [])').length === 0);
  p.ce('sectionByLib("faq").data = { items: [{ t: "When is it?", d: "In February." }] }; sectionByLib("contact").data = { blocks: [{ t: "Sponsorship", people: [{ n: "Asha Rao", e: "asha@example.com", p: "" }] }] };' +
    'sectionByLib("partners").data = { tiers: [{ t: "Gold", logos: [{ n: "Acme", url: "acme.com", slot: 1 }, { n: "Beta" }] }] }; sectionByLib("glimpses").data = { items: [{ slot: 2, caption: "Day 1" }] };');

  /* regression (B08 verify v2b): Try again while the failed try's other pictures are still on their way sends none twice */
  var calls = [], hold = null;
  var pp = handPage();
  await pp.ce('loadPortalRoster()');
  pp.ctx.__tech = TECH;
  pp.ce('S.template = "retail-leadership-summit"; S.creationMethod = "template"; S.createdEventId = "qa-ux-b08-u"; S.basics.slug = "qa-ux-b08-u"; S.basics.name = "QA B08";' +
    'S.basics.portal = "retail"; tplInfo["retail-leadership-summit"] = { state: "ready", caps: templateCaps(window.__tech) }; applyTemplate();' +
    'imgFiles[1] = { blob: new Blob(["a"], { type: "image/png" }), name: "slow.png", url: "blob:1" };' +
    'imgFiles[2] = { blob: new Blob(["b"], { type: "image/jpeg" }), name: "bad.jpg", url: "blob:2" };' +
    'var _p = sectionByLib("partners"); setSecIncluded(_p, true); _p.data = { tiers: [{ t: "Gold", logos: [{ n: "Acme", slot: 1 }] }] };' +
    'var _g = sectionByLib("glimpses"); setSecIncluded(_g, true); _g.data = { items: [{ slot: 2 }] };');
  pp.ce('RevampCore.uploadImage = function(id, kind, file){ return window.__upload(id, kind, file); }');
  var badOnce = true;
  pp.ctx.__upload = function (id, kind, file) {
    calls.push(file.name);
    if (file.name === 'bad.jpg' && badOnce) { badOnce = false; return Promise.reject(new Error('The server could not store it.')); }
    if (file.name === 'slow.png') return new Promise(function (r) { hold = function () { r({ url: 'https://storage.googleapis.com/b/events/' + id + '/' + kind + '/slow.png' }); }; });
    return Promise.resolve({ url: 'https://storage.googleapis.com/b/events/' + id + '/' + kind + '/' + file.name });
  };
  pp.ce('busy = { kind: "handoff" }; window.__row = { label: "" };');
  var first = await pp.ce('sendPictures(busy, window.__row, function(){})').then(function () { return null; }, function (e) { return e; });
  check('regression: the try fails on one picture while another is still on its way', !!first && /bad\.jpg/.test(first.message) && typeof hold === 'function' &&
    JSON.stringify(calls.slice().sort()) === '["bad.jpg","slow.png"]', [first && first.message, calls]);
  var second = pp.ce('sendPictures(busy, window.__row, function(){})');
  await tick();
  hold();
  await second;
  check('regression: Try again waits for the picture on its way instead of sending it again', calls.filter(function (x) { return x === 'slow.png'; }).length === 1 &&
    calls.filter(function (x) { return x === 'bad.jpg'; }).length === 2 && pp.ce('S.uploads.files["img:1"]') === 'https://storage.googleapis.com/b/events/qa-ux-b08-u/partners/slow.png' &&
    pp.ce('Object.keys(uploadsUnderWay).length') === 0, calls);
  check('regression: …and the row ends done', pp.ctx.__row.label === 'Uploaded your 2 section pictures', pp.ctx.__row.label);

  /* the editor is handed addresses only */
  await p.ce('openInEditor(busy)');
  var handed = JSON.parse(p.store['revamp.editor.handoff.v1'] || 'null');
  var hero = handed && handed.sections.filter(function (s) { return s.libId === 'hero'; })[0];
  var plog = handed && handed.sections.filter(function (s) { return s.libId === 'partners'; })[0];
  var glim = handed && handed.sections.filter(function (s) { return s.libId === 'glimpses'; })[0];
  check('UX-042 the editor gets the uploaded logo by its address, not this browser\'s copy', !!handed && /\/logo\/\d+-logo\.png$/.test(handed.event.logoUrl) && handed.event.logoKey === null, handed && handed.event);
  check('UX-043 …the banner and the section pictures by theirs', !!hero && /\/banner\/\d+-banner\.jpg$/.test(hero.data.psdBanner.compositeImageData) &&
    /\/partners\/\d+-acme\.png$/.test(plog.data.tiers[0].logos[0].logo) && /\/gallery\/\d+-day1\.jpg$/.test(glim.data.items[0].url), [hero && hero.data.psdBanner, plog && plog.data, glim && glim.data]);
  check('UX-042 no picture travels inside the hand-off', JSON.stringify(handed).indexOf('data:') === -1 && JSON.stringify(handed).indexOf('blob:') === -1);

  /* a sponsor's logo with no name, or a contact with neither name nor heading, is asked for before Continue */
  p.ce('sectionByLib("partners").data = { tiers: [{ t: "Gold", logos: [{ n: "", slot: 1 }] }] }');
  var probs = p.ce('fieldProblems(sectionByLib("partners"))');
  check('UX-042 a sponsor logo with no name stops Continue (the event keeps each sponsor by name)', probs.some(function (x) { return x.kind === 'block' && /Add the partner’s name/.test(x.message); }), probs);
  p.ce('sectionByLib("contact").data = { blocks: [{ t: "", people: [{ n: "", e: "desk@example.com", p: "" }] }] }');
  probs = p.ce('fieldProblems(sectionByLib("contact"))');
  check('UX-042 a contact with no name and no heading stops Continue', probs.some(function (x) { return x.kind === 'block' && /Add the name, or a heading/.test(x.message); }), probs);

  /* a picture given by its address (a previous edition's) goes to the site as it is */
  p.ce('sectionByLib("partners").data = { tiers: [{ t: "Gold", logos: [{ n: "Prev", logoUrl: "https://storage.googleapis.com/b/events/old/partners/p.png" }] }] }');
  var site = p.ce('siteData(sectionByLib("partners"), function(){ return ""; })');
  check('UX-044 a previous edition\'s sponsor logo goes to the site by its own address', site.tiers[0].logos[0].logo === 'https://storage.googleapis.com/b/events/old/partners/p.png', site);
  check('UX-044 …and needs no upload (only the glimpse\'s own file is still to send)', JSON.stringify(p.ce('sitePictureSlots()')) === '[2]', p.ce('sitePictureSlots()'));

  /* =====================================================================================================
     The editor: the Content overlay keeps logos and captions; a Create Event arrival saves version 1
     ===================================================================================================== */
  /* the editor and the server read a real template's records through the same rules (templates/_shared/rv-draw.js) */
  var X = { mapTranslate: require('../../templates/_shared/rv-draw.js').mapTranslate };
  X.translatePartners = X.mapTranslate.partners;
  X.translateGallery = X.mapTranslate.glimpses;
  var tp = X.translatePartners([{ name: 'Acme', tierId: 't1', logoUrl: 'https://x/a.png', url: 'https://acme.com', order: 1 }, { name: 'Loose', order: 2 }], [{ id: 't1', name: 'Gold', order: 1 }]);
  check('UX-042 editor: the Content\'s sponsors keep their logos and links on the page', JSON.stringify(tp) ===
    /* each card also carries its record's id (B05: data-rv-id), '' for a record that has none */
    JSON.stringify({ tiers: [{ t: 'Gold', logos: [{ id: '', n: 'Acme', logo: 'https://x/a.png', url: 'https://acme.com' }] }, { t: '', logos: [{ id: '', n: 'Loose', logo: '', url: '' }] }] }), tp);
  check('UX-042 editor: glimpses keep their captions', JSON.stringify(X.translateGallery([{ imageUrl: 'https://x/1.jpg', caption: 'Day 1' }])) === JSON.stringify({ items: [{ id: '', url: 'https://x/1.jpg', caption: 'Day 1' }] }));
  check('UX-042 editor: the first save comes once the page has its saved-state answer', ED.indexOf('loadSiteInfo().then(saveFirstVersion);') !== -1);
  /* The hand-off screen says "keeps your page as its first saved version" on both of its paths: a gallery design (handed
     over with its sections) and an imported one (handed over with none, being one finished page). The editor's real
     opening path (resolveFromBrowser, then saveFirstVersion) is run for each, not the condition alone: an earlier test
     passed on the condition while the imported path never reached it. Only a generated site, whose page the server
     made, is left out, and nothing is saved without this event's own hand-off in this browser. */
  function arrive(o) {
    var store = {}, L = { saves: 0 };
    if (o.handoff) store['revamp.editor.handoff.v1'] = JSON.stringify(o.handoff);
    var C = {
      L: L, console: { warn: function () {}, error: function () {} }, Promise: Promise, URLSearchParams: URLSearchParams,
      setTimeout: function (f) { f(); }, location: { search: o.search },
      localStorage: { getItem: function (k) { return k in store ? store[k] : null; }, setItem: function (k, v) { store[k] = String(v); }, removeItem: function (k) { delete store[k]; } }
    };
    C.window = C;
    vm.createContext(C);
    vm.runInContext('var HANDOFF_KEY = "revamp.editor.handoff.v1", FILL_LOGIC_VERSION = 2, FIRST_SAVE_DELAY_MS = 0;' +
      'var eventId = "qa-ux-b08-x", templateId = ' + JSON.stringify(o.templateId) + ', storeKey = "k";' +
      'var firstSaveDue = false, pendingAiHero = null, sourceDraftId = null, baseVersion = 0, localEdited = false, undoStack = [], undoPtr = 0;' +
      'var currentEvent = { slug: "qa-ux-b08-x", createdAt: "2026-11-07T10:00:00Z" }, siteInfo = { savedVersion: 0 };' +
      'var canvas = { snapshot: function () { return { page: 1 }; }, restore: function () {} };' +
      'var RevampFill = { fromHandoff: function () { return {}; }, apply: function () { return { skipped: [] }; } };' +
      'function localGet() { return Promise.resolve(undefined); } function localPut() { return Promise.resolve(true); }' +
      'function renderAiProvenanceBadges() {} function showToast() {} function showNotice() {} function applyAiDesignToCanvas() {} function restoreOpts() { return {}; }' +
      'function fetchServerDraft() { return Promise.resolve(null); }' +
      'function markTemplateSamples() { return 0; }' +
      'function saveToStaging() { L.saves++; return Promise.resolve({ version: 1 }); }' +
      ['fromCreate', 'handoffFor', 'readHandoffDraft', 'forgetHandoff', 'applyHandoffDraft', 'handoffLogoAddress', 'seedSnapshot', 'localRecord', 'aiHeroFromEvent',
        'resolveFromBrowser', 'saveFirstVersion'].map(function (n) { return topFn(ED, n); }).join('\n'), C);
    return C.resolveFromBrowser(undefined).then(function () {
      L.due = C.firstSaveDue;
      C.saveFirstVersion();
      return tick();
    }).then(function () { L.handoffLeft = 'revamp.editor.handoff.v1' in store; return L; });
  }
  function handoffOf(slug, tplId, sections) {
    return { v: 1, draftId: 'd1', event: { slug: slug, name: 'QA' }, template: { id: tplId, name: 'QA', site: '/x' }, excluded: [], excludedSections: [], aiHero: null, sections: sections };
  }
  var FROM = '?from=create&eventId=qa-ux-b08-x';
  var I1 = await arrive({ templateId: 'imported-abc123', search: FROM, handoff: handoffOf('qa-ux-b08-x', 'imported-abc123', []) });
  check('regression: an imported design from Create Event (handed over with no sections) is saved as version 1 on the real opening path', I1.due === true && I1.saves === 1, I1);
  check('regression: …and its hand-off has done its job and is forgotten', I1.handoffLeft === false, I1);
  var I2 = await arrive({ templateId: 'retail-leadership-summit', search: FROM, handoff: handoffOf('qa-ux-b08-x', 'retail-leadership-summit', [{ libId: 'hero', name: 'Hero', data: { title: 'QA' } }]) });
  check('UX-042 a gallery design from Create Event is saved as version 1 on the real opening path', I2.due === true && I2.saves === 1 && I2.handoffLeft === false, I2);
  var I3 = await arrive({ templateId: 'imported-abc123', search: FROM });
  var I4 = await arrive({ templateId: 'imported-abc123', search: FROM, handoff: handoffOf('qa-ux-b08-other', 'imported-abc123', []) });
  check('regression: an imported design opened with no hand-off of this event in this browser (another browser, another event\'s) saves nothing',
    I3.saves === 0 && I4.saves === 0 && I4.handoffLeft === true, [I3, I4]);
  var I5 = await arrive({ templateId: 'imported-abc123', search: '?eventId=qa-ux-b08-x', handoff: handoffOf('qa-ux-b08-x', 'imported-abc123', []) });
  var I6 = await arrive({ templateId: 'gen-qa-x', search: FROM, handoff: handoffOf('qa-ux-b08-x', 'gen-qa-x', []) });
  check('UX-042 nothing is saved on a plain open (not from Create Event), nor for a generated site', I5.saves === 0 && I6.saves === 0, [I5, I6]);
  function firstSave(o) {
    var L = { saves: 0, notices: [] };
    var C = { L: L, setTimeout: function (f) { f(); }, Promise: Promise };
    vm.createContext(C);
    vm.runInContext('var firstSaveDue = ' + !!o.due + ', canvas = {}, eventId = "qa-x", siteInfo = ' + JSON.stringify(o.siteInfo) + ', currentEvent = ' + JSON.stringify(o.event || {}) + ';' +
      'function saveToStaging(opts){ L.saves++; L.quiet = opts && opts.quiet; return ' + (o.fail ? 'Promise.reject(new Error("down"))' : 'Promise.resolve({ version: 1 })') + '; }' +
      'function showNotice(id, n){ L.notices.push(id + ": " + n.text); }' +
      'var FIRST_SAVE_DELAY_MS = 0;' + fnSrc(ED, 'saveFirstVersion').replace('var FIRST_SAVE_DELAY_MS = 1700;', ''), C);
    C.saveFirstVersion();
    return tick().then(function () { return L; });
  }
  var L1 = await firstSave({ due: true, siteInfo: { savedVersion: 0 } });
  check('UX-042 editor: a page Create Event filled is saved as the first version, quietly', L1.saves === 1 && L1.quiet === true && L1.notices.length === 0, L1);
  var L2 = await firstSave({ due: true, siteInfo: { savedVersion: 3 } });
  var L3 = await firstSave({ due: true, siteInfo: { savedVersion: 0 }, event: { site: { version: 2 } } });
  var L4 = await firstSave({ due: false, siteInfo: { savedVersion: 0 } });
  check('UX-042 editor: never over a saved version, and only after a Create Event hand-off', L2.saves === 0 && L3.saves === 0 && L4.saves === 0);
  var L5 = await firstSave({ due: true, siteInfo: { savedVersion: 0 }, fail: true });
  check('UX-042 editor: a first save that fails says the page is in this browser only', L5.notices.length === 1 && /^first-save: Your page could not be saved to the server yet, so it is only in this browser\./.test(L5.notices[0]), L5.notices);

  console.log('create-event-saves: ' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exit(1);
}
main().catch(function (e) { console.error(e); process.exit(1); });
