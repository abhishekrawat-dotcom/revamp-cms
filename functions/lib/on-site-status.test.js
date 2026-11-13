/* node functions/lib/on-site-status.test.js — only Confirmed speakers and sponsors are on the site (CON-036, CON-037).
   The console tags an Invited or Tentative speaker or sponsor "Not on the site" and counts "N on site"; everything that
   draws a site now shows exactly those, by one rule (templates/_shared/rv-records.js isOnSite):
     1. the rule itself, as the console has it (no status, or Confirmed);
     2. the shared lists (rv-records.js): speakers, sponsors, and a session's speaker names;
     3. the server's drawing of a saved page (lib/site-records.js renderRecords — the staged copy, every save, every
        request for approval, hence the preview, the live page and "Copy for another website", which copies the page
        as drawn): Invited and Tentative ones are not drawn, and ones drawn before this rule are taken off;
     4. the site editor (its own code, run here on stand-ins): a real template's speakers and sponsors, an AI-designed
        page's lists, the sections it adds, and the notice over a list with none on the site;
     5. the console asks the same rule, and the other readers (public site data, search, speaker and sponsor pages)
        do too.
   No network, no Firebase. Exits 1 listing every failure. */
'use strict';

var fs = require('fs'), path = require('path');
var failures = [], checks = 0;
function check(label, cond, detail) { checks++; if (!cond) failures.push(label + (detail !== undefined ? '\n      ' + String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 600) : '')); }
function count(text, needle) { return String(text).split(needle).length - 1; }

var RR = require('../../templates/_shared/rv-records.js');
var SR = require('./site-records');
var ROOT = path.join(__dirname, '..', '..');
function src(file) { return fs.readFileSync(path.join(ROOT, file), 'utf8'); }

/* ===================== 1. the rule ===================== */
(function () {
  /* the console's rule before it asked the shared one (edit-event.html isConfirmed) */
  function consoleRule(r) { return !r.status || r.status === 'confirmed'; }
  var cases = [{}, { status: '' }, { status: null }, { status: 'confirmed' }, { status: 'invited' }, { status: 'tentative' }];
  check('1.1 no status and Confirmed are on the site; Invited and Tentative are not',
    cases.map(RR.isOnSite).join() === 'true,true,true,true,false,false', cases.map(RR.isOnSite));
  check('1.2 the same answer as the console gave, for every status the console stores', cases.every(function (c) { return RR.isOnSite(c) === consoleRule(c); }));
  var H = require('./http');
  check('1.3 every status the console may store is answered (http.js CONTENT_STATUSES)', H.CONTENT_STATUSES.join() === 'confirmed,invited,tentative' &&
    H.CONTENT_STATUSES.filter(function (s) { return RR.isOnSite({ status: s }); }).join() === 'confirmed');
  check('1.4 onSite: speakers and sponsors filtered, every other kind as it is', RR.onSite('speakers', [{ id: 'a' }, { id: 'b', status: 'invited' }]).length === 1 &&
    RR.onSite('partners', [{ id: 'a', status: 'tentative' }]).length === 0 && RR.onSite('faq', [{ id: 'q', status: 'invited' }]).length === 1 && RR.onSite('speakers', null).length === 0);
})();

/* ===================== 2. the shared lists ===================== */
var SPEAKERS = [
  { id: 's1', name: 'Asha Rao', desig: 'CTO', comp: 'Acme', status: 'confirmed', order: 0 },
  { id: 's2', name: 'Meera Iyer', desig: 'CIO', comp: 'Beta', status: 'invited', order: 1 },
  { id: 's3', name: 'Kavya Nair', desig: 'CISO', comp: 'Gamma', status: 'tentative', order: 2 },
  { id: 's4', name: 'Divya Menon', desig: 'CFO', comp: 'Delta', order: 3 }
];
var PARTNERS = [
  { id: 'p1', name: 'Acme', logoUrl: 'https://x/acme.png', status: 'confirmed', order: 0 },
  { id: 'p2', name: 'Initech', logoUrl: 'https://x/initech.png', status: 'invited', order: 1 },
  { id: 'p3', name: 'Hooli', logoUrl: 'https://x/hooli.png', status: 'tentative', order: 2 },
  { id: 'p4', name: 'Globex', logoUrl: 'https://x/globex.png', order: 3 }
];
var DAYS = [{ id: 'd1', name: 'Day 1', date: '2027-06-22', order: 0 }];
var SESSIONS = [{ id: 'x1', title: 'Opening panel', start: '09:30', end: '10:15', groupId: 'd1', speakerIds: ['s1', 's2', 's3', 's4'] },
  { id: 'x2', title: 'Fireside chat', start: '11:00', end: '11:30', groupId: 'd1', speakerIds: ['s2'] }];
(function () {
  var sp = RR.translate.speakers(SPEAKERS, SESSIONS, DAYS);
  check('2.1 speakers: the Confirmed one and the one with no status, in their order; never the Invited or Tentative',
    sp && sp.map(function (s) { return s.id; }).join() === 's1,s4', sp);
  check('2.2 …with their sessions in the profile', sp && sp[0].profile.sessions.length === 1 && sp[0].profile.sessions[0].title === 'Opening panel', sp && sp[0].profile);
  check('2.3 speakers, none of them on the site: none to show (as with no records)',
    RR.translate.speakers(SPEAKERS.filter(function (s) { return s.status === 'invited' || s.status === 'tentative'; }), [], []) === null && RR.translate.speakers([], [], []) === null);
  var pt = RR.translate.partners(PARTNERS);
  check('2.4 sponsors: the Confirmed one and the one with no status, never the Invited or Tentative', pt && pt.map(function (p) { return p.id; }).join() === 'p1,p4', pt);
  check('2.5 sponsors, none of them on the site: none to show', RR.translate.partners([PARTNERS[1], PARTNERS[2]]) === null);
  var ss = RR.translate.sessions(SESSIONS, DAYS, SPEAKERS);
  check('2.6 a session names only its speakers who are on the site; one whose only speaker is Invited names nobody (every session is still listed)',
    ss && ss.length === 2 && ss[0].speakers === 'Asha Rao, Divya Menon' && ss[1].speakers === '', ss);
})();

/* ===================== 3. the server's drawing (staged copy, saves, approval; preview, live, the copy view) ===================== */
var SPEAKER_MODEL = '<div class="spk" data-rv-repeat-template="speakers"><img data-rv-field="photo" alt=""><h3 data-rv-field="n">Speaker Name</h3><p data-rv-field="r">Role</p></div>';
var PARTNER_MODEL = '<div class="logo" data-rv-repeat-template="partners"><img data-rv-field="logo" alt=""><span data-rv-field="name">Partner</span></div>';
var SESSION_MODEL = '<article class="row" data-rv-repeat-template="sessions"><h3 data-rv-field="title">Session title</h3><p data-rv-field="speakers">Speaker names</p></article>';
/* an award's jury is the event's Speakers records, drawn into the same convention (award-sections.js boundPersonCard) */
var JUROR_MODEL = '<article class="aw-jury-card" data-rv-repeat-template="speakers"><div class="aw-jury-ph"><img data-rv-field="photo" alt="" loading="lazy"></div><h3 class="aw-jury-name" data-rv-field="n">Juror name</h3></article>';
function page(speakers, partners, sessions, jury) {
  return '<!DOCTYPE html>\n<html lang="en"><head><meta charset="utf-8"><title>Site</title></head><body>' +
    '<nav data-rv-section="nav"><a href="#speakers">Speakers</a><a href="#partners">Partners</a></nav>' +
    '<section data-rv-section="speakers" id="speakers"><h2>Speakers</h2><div class="grid">' + speakers + '</div></section>' +
    '<section data-rv-section="agenda" id="agenda"><h2>Agenda</h2><div class="timeline">' + sessions + '</div></section>' +
    (jury ? '<section data-rv-section="award-jury" id="jury"><h2>Jury</h2><div class="aw-jury-grid">' + jury + '</div></section>' : '') +
    '<section data-rv-section="partners" id="partners"><h2>Partners</h2><div class="logos">' + partners + '</div></section>' +
    '<footer data-rv-section="footer"><p>© 2027</p></footer></body></html>';
}
function rows(extra) { return Object.assign({ speakers: [], sessions: [], 'agenda-groups': [], faqs: [], partners: [], contacts: [], gallery: [] }, extra || {}); }
(function () {
  var all = rows({ speakers: SPEAKERS, partners: PARTNERS, sessions: SESSIONS, 'agenda-groups': DAYS });
  var r = SR.renderRecords(page(SPEAKER_MODEL, PARTNER_MODEL, SESSION_MODEL), all);
  check('3.1 the page shows the Confirmed speakers and the one with no status, never the Invited or Tentative',
    count(r.html, 'data-rv-repeat-template="speakers"') === 2 && /data-rv-id="s1"/.test(r.html) && /data-rv-id="s4"/.test(r.html) &&
    !/Meera Iyer|Kavya Nair|data-rv-id="s2"|data-rv-id="s3"/.test(r.html), r.html);
  check('3.2 …and the Confirmed sponsors and the one with no status, never the Invited or Tentative',
    count(r.html, 'data-rv-repeat-template="partners"') === 2 && /Acme/.test(r.html) && /Globex/.test(r.html) && !/Initech|Hooli|initech\.png|hooli\.png/.test(r.html), r.html);
  check('3.3 a session does not name an Invited or Tentative speaker; one with only an Invited speaker shows no names',
    r.html.indexOf('<p data-rv-field="speakers">Asha Rao, Divya Menon</p>') !== -1 && r.html.indexOf('<p data-rv-field="speakers" hidden=""></p>') !== -1, r.html);
  var again = SR.renderRecords(r.html, all);
  check('3.4 drawing the same records again changes nothing', !again.changed && again.html === r.html);

  /* a page drawn before this rule, an Invited speaker and sponsor on it: the next draw (the next Content change, save
     or request for approval) takes them off */
  var before = page(
    SPEAKER_MODEL.replace('data-rv-repeat-template="speakers"', 'data-rv-repeat-template="speakers" data-rv-filled="" data-rv-id="s1"').replace('Speaker Name', 'Asha Rao') +
    SPEAKER_MODEL.replace('data-rv-repeat-template="speakers"', 'data-rv-repeat-template="speakers" data-rv-filled="" data-rv-id="s2"').replace('Speaker Name', 'Meera Iyer'),
    PARTNER_MODEL.replace('data-rv-repeat-template="partners"', 'data-rv-repeat-template="partners" data-rv-filled="" data-rv-id="p2"').replace('>Partner<', '>Initech<'),
    SESSION_MODEL);
  var fixed = SR.renderRecords(before, all);
  check('3.5 an Invited speaker and sponsor drawn before this rule are taken off the page', fixed.changed && !/Meera Iyer|Initech/.test(fixed.html) && /data-rv-id="s4"/.test(fixed.html), fixed.html);

  /* every speaker and sponsor Invited or Tentative: the lists are empty, as with no records (hidden on the page, with
     their menu links), and no section is asked for */
  var none = rows({ speakers: [SPEAKERS[1], SPEAKERS[2]], partners: [PARTNERS[1], PARTNERS[2]], sessions: [], 'agenda-groups': [] });
  var e = SR.renderRecords(before, none);
  check('3.6 none of them on the site: the speakers\' and the sponsors\' places are marked empty (the live page hides them)',
    e.emptied.indexOf('speakers') !== -1 && e.emptied.indexOf('partners') !== -1 && /id="speakers" data-rv-empty="speakers"/.test(e.html) &&
    /data-rv-empty="partners"/.test(e.html) && /<a href="#speakers" data-rv-nav-empty="">Speakers<\/a>/.test(e.html), { emptied: e.emptied, html: e.html });
  var noList = SR.renderRecords('<!DOCTYPE html><html><body><section data-rv-section="hero"><h1>Hi</h1></section></body></html>', none);
  check('3.7 records, none on the site, and no list for them on the page: not reported as needing a section', noList.unplaced.indexOf('speakers') === -1 && noList.unplaced.indexOf('partners') === -1, noList);
  var oneOn = SR.renderRecords('<!DOCTYPE html><html><body><section data-rv-section="hero"><h1>Hi</h1></section></body></html>', rows({ speakers: SPEAKERS }));
  check('3.8 …while a Confirmed one with no list is', oneOn.unplaced.indexOf('speakers') !== -1);

  /* an award's jury is drawn from the Speakers records */
  var jury = SR.renderRecords(page('', '', '', JUROR_MODEL), rows({ speakers: [{ id: 'j1', name: 'Rohit Shah' }, { id: 'j2', name: 'Neha Gupta', status: 'invited' }] }));
  check('3.9 an award\'s jury shows only jurors on the site', /Rohit Shah/.test(jury.html) && !/Neha Gupta/.test(jury.html) && count(jury.html, 'aw-jury-card') === 1, jury.html);
})();

/* ===================== 4. the site editor (its own code, on stand-ins) ===================== */
var ED = src('editor-template-ui.js');
function body(name) {
  var i = ED.indexOf('function ' + name + '(');
  if (i === -1) return '';
  var open = ED.indexOf('{', i), depth = 0;
  for (var j = open; j < ED.length; j++) { if (ED[j] === '{') depth++; else if (ED[j] === '}' && --depth === 0) return ED.slice(i, j + 1); }
  return '';
}
function fakeDoc() {
  function el(tag) {
    var attrs = {}, kids = [];
    return { tagName: String(tag).toUpperCase(), textContent: '', children: kids,
      setAttribute: function (k, v) { attrs[k] = String(v); }, getAttribute: function (k) { return k in attrs ? attrs[k] : null; },
      hasAttribute: function (k) { return k in attrs; }, removeAttribute: function (k) { delete attrs[k]; },
      appendChild: function (c) { kids.push(c); return c; }, ownerDocument: doc };
  }
  var doc = { createElement: el };
  return doc;
}
(async function () {
  var names = ['byOrder', 'recId', 'translateSpeakers', 'translatePartners', 'fetchGenericRepeatOverlay', 'fillEmptyNote', 'recordPill'];
  var missing = names.filter(function (n) { return !body(n); });
  check('4.0 the editor\'s functions are found', !missing.length, missing);
  var fetched = {};
  var run = new Function('RevampRecords', 'RevampCore', 'kinds', 'escHtml', 'eventId',
    'var canvas = { doc: {} };\n' +
    'function findRepeatKindsInDom() { return kinds; }\n' +
    'function contentHref() { return "/edit-event.html#x"; }\n' +
    'var GENERIC_REPEAT_SOURCES = {};\n' +
    'RevampRecords.KINDS.forEach(function (kind) { GENERIC_REPEAT_SOURCES[kind] = { resources: RevampRecords.SOURCES[kind], translate: RevampRecords.translate[kind] }; });\n' +
    names.map(body).join('\n') + '\n' +
    'return { translateSpeakers: translateSpeakers, translatePartners: translatePartners, fetchGenericRepeatOverlay: fetchGenericRepeatOverlay, fillEmptyNote: fillEmptyNote, recordPill: recordPill };');
  function editor(data, kinds) {
    return run(RR, { fetchSub: function (r) { fetched[r] = true; return Promise.resolve(data[r] || []); } }, kinds,
      function (s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }, 'qa-x');
  }
  var E = editor({}, []);

  /* a real template (content.map: cx-leaders-forum, making-ai-work speakers; retail-leadership-summit partners) */
  var ts = E.translateSpeakers(SPEAKERS);
  check('4.1 a real template\'s speakers: only those on the site', ts && ts.items.map(function (i) { return i.id; }).join() === 's1,s4', ts);
  var none = E.translateSpeakers([SPEAKERS[1], SPEAKERS[2]]);
  check('4.2 …none on the site: an empty list, which the template\'s "empty":"hide" rule clears (no Invited card stays from an earlier open)', none && Array.isArray(none.items) && none.items.length === 0, none);
  check('4.3 …no records at all: left alone, as before (TPL-007 is its own item)', E.translateSpeakers([]) === null);
  var tp = E.translatePartners(PARTNERS, [{ id: 't1', name: 'Gold', order: 0 }]);
  var logos = tp && tp.tiers.reduce(function (a, t) { return a.concat(t.logos); }, []);
  check('4.4 a real template\'s sponsors: only those on the site', logos && logos.map(function (l) { return l.id; }).join() === 'p1,p4', tp);
  var tpNone = E.translatePartners([PARTNERS[1], PARTNERS[2]], []);
  check('4.5 …none on the site: no tiers, so the cards go', tpNone && Array.isArray(tpNone.tiers) && tpNone.tiers.length === 0, tpNone);
  var rules = JSON.parse(src('templates/cx-leaders-forum/template.json')).content.map.filter(function (m) { return m.from === 'speakers'; })[0];
  var rules2 = JSON.parse(src('templates/retail-leadership-summit/template.json')).content.map.filter(function (m) { return m.from === 'partners'; })[0];
  check('4.6 the real templates\' lists clear on an empty list ("empty":"hide")', rules && rules.fill[0].empty === 'hide' && rules2 && rules2.fill[0].empty === 'hide');

  /* an AI-designed page's lists */
  var ov = await editor({ speakers: SPEAKERS, partners: PARTNERS, sessions: SESSIONS, 'agenda-groups': DAYS }, ['speakers', 'partners', 'sessions']).fetchGenericRepeatOverlay();
  check('4.7 an AI-designed page: the editor draws the same speakers, sponsors and session names as the server',
    ov && ov.speakers.map(function (i) { return i.id; }).join() === 's1,s4' && ov.partners.map(function (i) { return i.id; }).join() === 'p1,p4' && ov.sessions[0].speakers === 'Asha Rao, Divya Menon', ov);
  var ov2 = await editor({ speakers: [SPEAKERS[1], SPEAKERS[2]], partners: [PARTNERS[2]] }, ['speakers', 'partners']).fetchGenericRepeatOverlay();
  check('4.8 …none on the site: empty lists (marked empty, as the server marks them), with how many are waiting to be confirmed',
    ov2 && Array.isArray(ov2.speakers) && ov2.speakers.length === 0 && ov2.speakers.waiting === 2 && ov2.partners.length === 0 && ov2.partners.waiting === 1, ov2);
  var ov3 = await editor({ speakers: [] }, ['speakers']).fetchGenericRepeatOverlay();
  check('4.9 …no records at all: empty, nothing waiting', ov3 && ov3.speakers.length === 0 && !ov3.speakers.waiting, ov3);

  /* the notice over an empty list */
  var doc = fakeDoc(), note = doc.createElement('div');
  note.setAttribute('data-rv-empty-waiting', '2');
  E.fillEmptyNote(note, 'speakers', true);
  var link = note.children[0];
  check('4.10 the notice says none is confirmed, how many are waiting, and that only Confirmed ones are on the site',
    /^No confirmed speakers yet: only Confirmed speakers are on the site, and the 2 speakers in Content › Speakers are Invited or Tentative\. Visitors do not see this section until one is confirmed\. $/.test(note.textContent) &&
    link && link.textContent === 'Confirm speakers in Content › Speakers ↗', [note.textContent, link && link.textContent]);
  var one = doc.createElement('div');
  one.setAttribute('data-rv-empty-waiting', '1');
  E.fillEmptyNote(one, 'partners', false);
  check('4.11 …one sponsor waiting', /the sponsor in Content › Sponsors is Invited or Tentative\. Visitors do not see this list until one is confirmed\./.test(one.textContent), one.textContent);
  var plain = doc.createElement('div');
  E.fillEmptyNote(plain, 'speakers', true);
  check('4.12 …with no records at all, the notice is as it was', /^No speakers yet: visitors do not see this section until there are some\. $/.test(plain.textContent) && plain.children[0].textContent === 'Add speakers in Content › Speakers ↗', plain.textContent);
  var pill = E.recordPill({ state: 'empty', kind: 'speakers', tab: RR.TABS.speakers, el: Object.assign(note, { closest: function () { return null; } }) });
  check('4.13 the toolbar over that notice says the same', /No confirmed speakers yet · hidden on the live site/.test(pill) && /Confirm speakers in Content/.test(pill), pill);

  /* the sections the editor adds for records, and the server's word for a real template */
  var ensure = body('ensureAutoSections');
  check('4.14 a section is added only for records the site shows (an Invited speaker brings none)', /RevampRecords\.onSite\(kind, rows\)\.length \? kind : ''/.test(ensure), ensure.slice(0, 400));
  var fill = body('markEmpty');
  check('4.15 the notice over a list already marked empty is said again with today\'s count', /had\.setAttribute\('data-rv-empty-waiting'/.test(fill) && /fillEmptyNote\(had, kind/.test(fill));
  check('4.16 applyGenericRepeat passes the count to the notice', /markEmpty\(canvas\.doc, kind, items\.waiting \|\| 0\)/.test(body('applyGenericRepeat')));
  var api = src('functions/lib/api.js');
  check('4.17 a real template with speakers or sponsors, none on the site, still tells the console to open the editor (it takes their cards away)',
    /function editorDrawnKinds[\s\S]{0,900}siteRecords\.SOURCES\[kind\]\[0\][\s\S]{0,300}own\.length/.test(api));

  /* ===================== 5. the console and the other readers ===================== */
  var CON = src('edit-event.html');
  check('5.1 the console\'s "Not on the site" and "N on site" ask the site\'s own rule', /function isConfirmed\(r\)\{ return RevampRecords\.isOnSite\(r\); \}/.test(CON) &&
    CON.indexOf('<script src="templates/_shared/rv-records.js"></script>') !== -1 && CON.indexOf('<script src="templates/_shared/rv-records.js"></script>') < CON.indexOf('function isConfirmed('));
  check('5.2 the editor page loads the rule before the editor', (function (h) {
    var a = h.indexOf('<script src="templates/_shared/rv-records.js"></script>'), b = h.indexOf('<script src="editor-template-ui.js"></script>');
    return a !== -1 && b !== -1 && a < b;
  })(src('custom_editor.html')));
  var seo = require('./seo-fields');
  var picked = seo.pickRecords({}, SPEAKERS, []);
  check('5.3 search counts only the speakers on the site', picked.speakers.map(function (s) { return s.id; }).join() === 's1,s4', picked);
  var aud = src('functions/lib/api-audience.js'), apiSeo = src('functions/lib/api-seo.js'), lib = src('functions/lib/et-library.js'), people = src('functions/lib/people.js');
  check('5.4 the public site data, the SEO section, the people index and the people pages ask the same rule',
    /function isPublicStatus\(s\) \{ return RR\.isOnSite\(\{ status: s \}\); \}/.test(aud) && /var confirmed = RR\.isOnSite\(s\);/.test(apiSeo) &&
    /if \(!RR\.isOnSite\(v\)\) return;/.test(lib) && /RR\.isOnSite\(v\) \? '' : 'Invited or Tentative in Content: not on the event\\'s site'/.test(people) &&
    /sn\.exists && RR\.isOnSite\(sn\.data\(\) \|\| \{\}\)/.test(people));
  /* (api-audience.js keeps its registrations' own 'confirmed', which is another thing) */
  var stray = ['functions/lib/seo-fields.js', 'functions/lib/api-seo.js', 'functions/lib/et-library.js', 'edit-event.html']
    .filter(function (f) { return /status\s*===\s*'confirmed'|status\s*!==\s*'confirmed'/.test(src(f)); });
  check('5.5 no other copy of the rule is left in those files', !stray.length && !/s === 'confirmed'; \}/.test(aud), stray);

  if (failures.length) { console.error('on-site-status: ' + failures.length + ' of ' + checks + ' checks failed:\n  - ' + failures.join('\n  - ')); process.exit(1); }
  console.log('on-site-status: all ' + checks + ' checks passed');
})().catch(function (e) { console.error(e); process.exit(1); });
