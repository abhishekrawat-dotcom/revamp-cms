/* What a site shows of the event console's Content tabs, read off its page (UX-066, UX-067, UX-071).

   WHY (the UX sweep of 3 Nov 2026). On brand-world-summit-2026 the console's Speakers tab said "No speakers yet — Add
   the people on stage" while the live site listed 49 speakers of the previous edition; its Sponsors, Agenda and FAQ
   sections were in the design but hidden, because those tabs were empty; and the Event logo tile showed the upload
   (with another edition's sponsor marks in it) where the site's banner shows the logo cut from it. Nothing in the
   console tied the tabs to the site. This file reads a page for those facts, so the console can say them
   (GET /api/event/site-outline in lib/api.js, edit-event-site-notes.js in the browser).

     outline(html, kit, contentMap, opts) -> {
       places:   { speakers: [{ key, name, hides, stands? }], sessions: [...], partners: [...], faq: [...], glimpses: [...], contact: [...] }
                 the sections of the page that list records of that kind (templates/_shared/rv-data.js), and what the
                 published and previewed page does with them, which is what the page is marked with:
                   hides: true    the section is marked empty (data-rv-empty on it): it leaves the page whole;
                   hides: false   only its list is marked empty, or nothing is and the list has nothing in it: the
                                  section stays, with no items;
                   stands: n      nothing is marked and n items stand in its list. They are not the tab's records
                                  when the tab has none: a real template's sample card ("Question" / "Answer"), what
                                  Create Event wrote, or records drawn before they were deleted. A real template's
                                  list is drawn only when the site editor opens (editor-template-ui.js fillRecords),
                                  and with no records it is left as it is (fetchSubcollectionOverlay), so an empty
                                  FAQ tab does not hide tech500's FAQ section: it still shows its sample question.
                 A section the owner hid in the editor is not a place, nor is a previous edition's.
                 opts.redrawn: the page's records are drawn again on every visit (rv-data.js run by rv-live.js, which
                 is not part of this release: api.js LIVE_RUNTIME_PRESENT). Then a section nothing marks is decided
                 by rv-data.js's own rule instead: the whole section leaves the page unless it holds something more
                 than the list (a Register button, a form, another kind of record, one of the event's details —
                 rv-data.js emptyScopeOf) or a template's content.map names a part of it (emptyScope).
       previous: [{ kind: 'speakers' | 'sponsors' | 'agenda' | 'glimpses', key: 'previous-speakers', name, count }]
                 the previous edition's own sections (prev-sections.js), with how many people, logos, sessions or
                 photos each one shows (0 when they cannot be counted: a section reworked in the editor)
       logo:     the address of the picture the banner's logo unit shows ('' for a page that has none)
     }
   How a page says where records go is rv-data.js's: on an AI-designed page, a list's one model item
   (data-rv-repeat-template="<kind>"); on a real template, its content.map (api.js contentMapFor) names the sections;
   and the editor marks every section it has filled (data-rv-bound) or found empty (data-rv-empty).

   kit: lib/api.js's tokenizer (TOKEN_KIT). Plain Node, no network, no Firebase: see site-outline.test.js. */
'use strict';

var prevSections = require('./prev-sections');
var siteChecks = require('./site-checks');

/* the Content tabs' records, by the names a page uses for them (rv-data.js KINDS) */
var KINDS = ['speakers', 'sessions', 'partners', 'faq', 'glimpses', 'contact'];
function kindOf(v) {
  var k = String(v == null ? '' : v).split(':')[0].trim();
  if (k === 'agenda') k = 'sessions';                 // a content.map's "from" may say agenda
  return KINDS.indexOf(k) === -1 ? '' : k;
}
/* the marks that tie a section to a kind of record */
var KIND_MARKS = ['data-rv-repeat-template', 'data-rv-bound', 'data-rv-empty', 'data-rv-item', 'data-rv-pristine'];

/* a previous edition's section by its id, and the class each of its people, logos, sessions or photos carries
   (prev-sections.js builds them; site-outline.test.js checks these against what it builds) */
var PREVIOUS = {};
Object.keys(prevSections.IDS).forEach(function (kind) { PREVIOUS[prevSections.IDS[kind]] = kind; });
var ITEM_CLASS = { speakers: 'pe-spk-card', sponsors: 'pe-spn-tile', agenda: 'pe-agd-row', glimpses: 'pe-glm-ph' };

var VOID = { area: 1, base: 1, br: 1, col: 1, embed: 1, hr: 1, img: 1, input: 1, link: 1, meta: 1, param: 1, source: 1, track: 1, wbr: 1 };

/* the token that ends each element: one pass with a stack (as site-checks.js reads a page) */
function matchEnds(tokens) {
  var ends = new Array(tokens.length), stack = [];
  for (var i = 0; i < tokens.length; i++) {
    var t = tokens[i];
    if (t.t === 'open') {
      if (VOID[t.name] || t.selfClosing) ends[i] = i;
      else stack.push(i);
    } else if (t.t === 'close') {
      var k = stack.length - 1;
      while (k >= 0 && tokens[stack[k]].name !== t.name) k--;
      if (k < 0) continue;
      while (stack.length > k) ends[stack.pop()] = i;
    }
  }
  while (stack.length) ends[stack.pop()] = tokens.length - 1;
  return ends;
}

/* A section's name as the owner knows it: the name the site editor lists it by (kit.names: a real template's
   template.json names, an AI-designed site's plan — NU-002), else its id in words — never the section's heading,
   which on an AI-designed site is a line of copy ("The brands powering the South's big stage"). */
function nameOf(s, kit) {
  if (typeof s === 'string') s = { key: s, id: s };
  var names = kit && kit.names;
  var named = names && Object.prototype.hasOwnProperty.call(names, s.key) && names[s.key] ? String(names[s.key]) : siteChecks.sectionName(s.id || s.key, names);
  return named.replace(/\bfaq(s?)\b/gi, function (m, x) { return 'FAQ' + x; });
}

/* the sections each kind of record goes into, by a real template's content.map: { sectionId: [{ kind, scoped }] } —
   scoped: the entry names the part of the section that leaves the page when there are no records (emptyScope) */
function mappedSections(contentMap) {
  var out = {};
  (Array.isArray(contentMap) ? contentMap : []).forEach(function (m) {
    var kind = m && kindOf(m.from);
    var lists = m && Array.isArray(m.fill) ? m.fill.filter(function (r) { return r && r.list; }) : [];
    if (!kind || !lists.length || !m.section) return;
    (out[m.section] = out[m.section] || []).push({ kind: kind, scoped: !!m.emptyScope });
  });
  return out;
}

/* What the page does with a section's list of a kind (see places above). Only data-rv-empty hides anything on a
   published or previewed page (templates/_shared/rv-live.css), so that mark is the answer; without it the section
   shows what stands in its list. Only when a runtime draws the records on every visit (opts.redrawn) does an
   unmarked section follow rv-data.js's rule: what a template's content.map says, else the whole section unless it
   holds something more than the list. */
function placeState(s, kind, redrawn) {
  if (s.selfEmpty[kind]) return { hides: true };
  if (s.innerEmpty[kind]) return { hides: false };
  if (!redrawn) return s.items[kind] ? { hides: false, stands: s.items[kind] } : { hides: false };
  if (s.mapped[kind] != null) return { hides: !s.mapped[kind] };
  return { hides: !s.chrome && !s.others && Object.keys(s.kinds).length === 1 };
}

function outline(html, kit, contentMap, opts) {
  var redrawn = !!(opts && opts.redrawn);
  var out = { places: {}, previous: [], logo: '' };
  KINDS.forEach(function (k) { out.places[k] = []; });
  html = String(html == null ? '' : html);
  if (!html) return out;
  var tokens = kit.tokenizeHtml(html), ends = matchEnds(tokens), A = kit.attrValue;
  var mapped = mappedSections(contentMap);
  var sections = [], cur = null, unitEnd = -1, unitSeen = false, unitInHero = false, logo = '', inertEnd = -1;

  for (var i = 0; i < tokens.length; i++) {
    var t = tokens[i];
    if (cur && i > cur.end) cur = null;
    if (t.t !== 'open') continue;

    /* a section of the page (the outermost one: sections are not nested, an internal page holds several) */
    var secId = A(t, 'data-rv-section');
    if (secId != null && !cur) {
      cur = { id: secId, key: A(t, 'data-rv-key') || secId, start: i, end: ends[i], kinds: {}, count: 0,
        selfEmpty: {}, innerEmpty: {}, mapped: {}, items: {}, itemEnd: {}, others: false, chrome: /^(?:header|nav|footer)$/.test(t.name),
        /* hidden by the owner in the editor: the published page leaves it out, a saved one keeps it marked */
        ownerHidden: kit.classListOf(t).indexOf('is-hidden-sec') !== -1 };
      (mapped[secId] || []).forEach(function (x) { cur.kinds[x.kind] = 1; cur.mapped[x.kind] = cur.mapped[x.kind] || x.scoped; });
      sections.push(cur);
    }
    if (cur) {
      for (var m = 0; m < KIND_MARKS.length; m++) {
        var kind = kindOf(A(t, KIND_MARKS[m]));
        if (kind) cur.kinds[kind] = 1;
      }
      var empty = kindOf(A(t, 'data-rv-empty'));
      if (empty) (i === cur.start ? cur.selfEmpty : cur.innerEmpty)[empty] = 1;
      /* the items standing in its lists: a drawn card (data-rv-item), an AI-designed list's model or its clones
         (data-rv-repeat-template), or a real template's sample card, which the editor marks data-rv-item="" — that
         is the kind its content.map names, when it names one. Never what is kept inside a <template> (the list's
         untouched models: inert, nothing in them shows), nor a card inside another card of the same kind. */
      if (t.name === 'template' && i > inertEnd) inertEnd = ends[i];
      if (i > inertEnd && i !== cur.start) {
        var itemMark = A(t, 'data-rv-item'), own = mapped[cur.id] || [];
        var itemKind = kindOf(itemMark) || kindOf(A(t, 'data-rv-repeat-template')) ||
          (itemMark === '' && own.length && own.every(function (x) { return x.kind === own[0].kind; }) ? own[0].kind : '');
        if (itemKind && !(i <= cur.itemEnd[itemKind])) {
          cur.items[itemKind] = (cur.items[itemKind] || 0) + 1;
          cur.itemEnd[itemKind] = ends[i];
        }
      }
      /* what keeps a section on the page without its list (rv-data.js emptyScopeOf) */
      if (i !== cur.start && (t.name === 'nav' || t.name === 'footer' || A(t, 'data-register-cta') != null || A(t, 'data-rv-form') != null ||
          A(t, 'data-rv-form-embed') != null || A(t, 'data-rv-bind') != null)) cur.others = true;
      var prevKind = PREVIOUS[cur.key] || PREVIOUS[cur.id];
      if (prevKind && kit.classListOf(t).indexOf(ITEM_CLASS[prevKind]) !== -1) cur.count++;
    }

    /* the banner's logo unit: its picture, never the copy kept for a dark background (rv-lu-dark). The first unit
       counts, unless a later one is the hero's and the first was not. */
    if (A(t, 'data-rv-logo-unit') != null) {
      var inHero = !!(cur && cur.id === 'hero');
      if (!unitSeen || (inHero && !unitInHero)) { unitSeen = true; unitInHero = inHero; unitEnd = ends[i]; logo = ''; }
    } else if (t.name === 'img' && i < unitEnd && !logo && kit.classListOf(t).indexOf('rv-lu-dark') === -1) {
      var src = String(A(t, 'src') || '').trim();
      if (/^https:\/\/[^\s"'<>]+$/i.test(src) || /^\/(?!\/)[^\s"'<>]*$/.test(src)) logo = src;
    }
  }

  sections.forEach(function (s) {
    if (s.ownerHidden) return;
    var prevKind = PREVIOUS[s.key] || PREVIOUS[s.id];
    if (prevKind) {
      out.previous.push({ kind: prevKind, key: s.key, name: prevSections.LABELS[prevKind], count: s.count });
      return;
    }
    Object.keys(s.kinds).forEach(function (k) {
      if (out.places[k].some(function (p) { return p.key === s.key; })) return;
      var st = placeState(s, k, redrawn), place = { key: s.key, name: nameOf(s, kit), hides: st.hides };
      if (st.stands) place.stands = st.stands;
      out.places[k].push(place);
    });
  });
  out.logo = logo;
  return out;
}

module.exports = { outline: outline, nameOf: nameOf, KINDS: KINDS, ITEM_CLASS: ITEM_CLASS };
