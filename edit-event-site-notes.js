/* What each Content tab of the event console means on the site, in words: worked out once here from what the site
   shows (GET /api/event/site-outline, functions/lib/site-outline.js), so that the tabs (edit-event.html) and the
   Dashboard's "Ready to publish" (edit-event-dashboard.js) say the same thing, and node can check it
   (functions/lib/site-notes.test.js).

   WHY (the UX sweep of 3 Nov 2026). brand-world-summit-2026's Speakers tab said "No speakers yet — Add the people on
   stage" while its live site listed 49 speakers of the previous edition (UX-067); its Sponsors, Agenda and FAQ
   sections were in the design but hidden because those tabs were empty, and nothing in the console said so
   (UX-066); its Event logo tile showed the upload, with another edition's sponsor marks in it, as what "opens the
   site's hero", while the hero shows the logo cut from it (UX-071); and a "weight" was shown on every row of
   Speakers, Agenda and Sponsors in two different scales, though it changes nothing on the site (UX-068).

     forTab(tab, outline, n, o) -> { where, hidden, none, previous }
        tab       'speakers' | 'agenda' | 'sponsors' | 'gallery' | 'faq' | 'contact'
        outline   GET /api/event/site-outline's answer, or null while it is not known (nothing is then said)
        n         { total: the tab's records, shown: how many of them the site shows (only confirmed speakers and
                  sponsors are shown; leave it out where every record is) }
        o         { award: true } for an award, whose speakers are its jury
        hidden    '' or a sentence: the site has a section for these and it is hidden until one is shown (or, where the
                  section holds more than the list, its list is empty until then)
        none      '' or a sentence: the site has no section that shows these at all
        previous  null or { text, key, name, count }: the previous edition's own section of the same kind, which the
                  tab does not hold (it is part of the site's design; the site editor changes it)
     readiness(tab, shown, outline, o) -> { ok: true | false | 'na', text }
        a "Ready to publish" row of the Dashboard ('speakers', 'agenda', 'sponsors'); 'na': the site has no section
        for them, so the row is not something to get ready
     logoTile(event, outline) -> { url, text, original }
        what the Event logo tile shows: the logo visitors see on the banner, and the upload one click away when that
        is a different picture
     PRIORITIES, priorityOptions(sortable), priorityId(v), priorityLabel(v), isNormal(v), byPriority(list), PRIORITY_FOOT
        one scale, "Priority: Top / High / Normal / Low", for Speakers, Agenda and Sponsors. The four stored values are
        the ones the records always had (keynote, headline, featured, standard), so nothing stored changes.
   Plain ES5 and no DOM: every string returned is plain text, for the caller to escape. */
(function () {
  'use strict';

  /* ---------- the tabs, and the name the site gives their records (templates/_shared/rv-data.js KINDS) ---------- */
  var TABS = {
    speakers: { kind: 'speakers', prev: 'speakers', one: 'speaker', many: 'speakers', need: 'a confirmed speaker', confirms: true,
      jury: { one: 'jury member', many: 'jury members', need: 'a confirmed jury member' } },
    agenda:   { kind: 'sessions', prev: 'agenda',   one: 'session', many: 'sessions', need: 'a session' },
    sponsors: { kind: 'partners', prev: 'sponsors', one: 'sponsor', many: 'sponsors', need: 'a confirmed sponsor', confirms: true },
    gallery:  { kind: 'glimpses', prev: 'glimpses', one: 'photo', many: 'photos', need: 'a photo' },
    faq:      { kind: 'faq',      prev: '',         one: 'question', many: 'questions', need: 'a question' },
    contact:  { kind: 'contact',  prev: '',         one: 'contact desk', many: 'contact desks', need: 'a contact desk' }
  };
  /* what the previous edition's sections show (functions/lib/prev-sections.js) */
  var PREV_WORDS = { speakers: ['speaker', 'speakers'], sponsors: ['sponsor', 'sponsors'], agenda: ['session', 'sessions'], glimpses: ['photo', 'photos'] };

  function comma(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function count(n, one, many) { return comma(n) + ' ' + (n === 1 ? one : many); }
  function wordsOf(T, o) { return o && o.award && T.jury ? T.jury : T; }

  /* only an answer that read a page says anything: none at all while it is loading, failed, or the site was never saved */
  function known(outline) { return !!(outline && outline.places && (outline.of === 'live' || outline.of === 'saved')); }
  function whereOf(outline) { return outline && outline.of === 'live' ? 'Your live site' : 'Your site'; }

  /* [{ name }] -> “A” | “A” and “B” | “A”, “B” and “C” */
  function namesOf(list) {
    var q = list.map(function (p) { return '“' + p.name + '”'; });
    return q.length < 2 ? (q[0] || '') : q.slice(0, -1).join(', ') + ' and ' + q[q.length - 1];
  }
  function sectionsWord(list) { return list.length === 1 ? ' section is' : ' sections are'; }
  function sectionsShow(list) { return list.length === 1 ? ' section shows' : ' sections show'; }
  /* the sections that leave the page whole while there is nothing to list, and those that only lose their list
     (site-outline.js hides) */
  function split(places) {
    return { whole: places.filter(function (p) { return p.hides !== false; }), list: places.filter(function (p) { return p.hides === false; }) };
  }
  function placesOf(outline, T) { return (outline.places[T.kind] || []).filter(function (p) { return p && p.name; }); }
  function previousOf(outline, T) {
    if (!T.prev) return null;
    return (outline.previous || []).filter(function (p) { return p && p.kind === T.prev; })[0] || null;
  }

  function forTab(tab, outline, n, o) {
    var T = TABS[tab], out = { where: whereOf(outline), hidden: '', none: '', previous: null };
    if (!T || !known(outline)) return out;
    var W = wordsOf(T, o);
    var total = Math.max(0, +(n && n.total) || 0);
    var shown = n && n.shown != null ? Math.max(0, +n.shown || 0) : total;
    var places = placesOf(outline, T);
    if (places.length) {
      if (!shown) {
        var until = total && T.confirms ? 'until one of these ' + W.many + ' is confirmed.' : 'until you add ' + W.need + '.';
        var sp = split(places), said = [];
        if (sp.whole.length) said.push(out.where + '’s ' + namesOf(sp.whole) + sectionsWord(sp.whole) + ' hidden ' + until);
        if (sp.list.length) said.push(out.where + '’s ' + namesOf(sp.list) + sectionsShow(sp.list) + ' no ' + W.many + ' ' + until);
        out.hidden = said.join(' ');
      }
    } else {
      out.none = out.where + ' has no section that shows ' + W.many + ', so ' +
        (total ? 'none of these are on it.' : W.many + ' added here do not appear on it.') + ' Sections are added in the site editor.';
    }
    var p = previousOf(outline, T);
    if (p) {
      var c = Math.max(0, +p.count || 0), w = PREV_WORDS[T.prev];
      out.previous = { key: String(p.key || ''), name: String(p.name || ''), count: c,
        text: out.where + ' also shows ' + (c ? count(c, w[0], w[1]) : w[1]) + ' from the previous edition, in its “' + p.name +
          '” section. They are part of the site’s design, not of this list: change or remove them in the site editor.' };
    }
    return out;
  }

  function readiness(tab, shown, outline, o) {
    var T = TABS[tab];
    if (!T) return { ok: null, text: '' };
    var W = wordsOf(T, o);
    shown = Math.max(0, +shown || 0);
    var have = shown ? count(shown, W.one, W.many) : '';
    if (!known(outline)) return { ok: shown > 0, text: shown ? have + ' on the site' : 'None on the site yet' };
    var places = placesOf(outline, T);
    if (places.length) {
      if (shown) return { ok: true, text: have + ' on the site' };
      var sp = split(places);
      return { ok: false, text: 'None yet: the site’s ' + (sp.whole.length ? namesOf(sp.whole) + sectionsWord(sp.whole) + ' hidden'
        : namesOf(sp.list) + sectionsShow(sp.list) + ' none') + ' until one is added' };
    }
    if (shown) return { ok: false, text: have + ', but the site has no section that shows them' };
    var p = previousOf(outline, T), c = p ? Math.max(0, +p.count || 0) : 0;
    return { ok: 'na', text: 'The site has no section for ' + W.many +
      (p ? '; it shows ' + (c ? count(c, PREV_WORDS[T.prev][0], PREV_WORDS[T.prev][1]) : PREV_WORDS[T.prev][1]) + ' from the previous edition' : '') };
  }

  /* ---------- the Event logo tile (UX-071) ---------- */
  function picture(u) {
    u = String(u == null ? '' : u).trim();
    return /^https:\/\/[^\s"'<>]+$/i.test(u) || /^\/(?!\/)[^\s"'<>]*$/.test(u) ? u : '';
  }
  var AS_UPLOADED = 'Opens the site’s hero.';
  var NO_LOGO = 'No logo yet — the site shows the event’s name in its place.';
  /* The logo visitors see is the banner's logo unit: read off the page once the outline is in, the design's own
     until then (an AI-designed site); a site with no unit shows the upload where its template has a logo. */
  function logoTile(ev, outline) {
    ev = ev || {};
    var upload = picture(ev.logoUrl);
    var design = ev.designPlan && ev.designPlan.design && typeof ev.designPlan.design === 'object' ? ev.designPlan.design : null;
    var unit = picture(design && design.logoUnitUrl);
    var site = known(outline) ? picture(outline.logo) : unit;
    if (!site || site === upload) return { url: upload, original: '', text: upload ? AS_UPLOADED : NO_LOGO };
    if (!upload) {
      return { url: site, original: '', text: 'No logo uploaded: the site’s banner shows this one, made for it. Upload your own to replace it.' };
    }
    /* The banner shows the design's own unit (the same address, or the same stored file: the server's logoIsUnit), and
       that unit was made from this very upload (its year brought to this edition's, another edition's marks cut out:
       functions/lib/api.js ownerLogoUnit — the note under the tile says what changed). Otherwise the upload is not
       what the banner shows, which the site editor offers to put right (ownerLogoOffer). */
    var isUnit = site === unit || !!(known(outline) && outline.logoIsUnit === true);
    var fromUpload = !!(design && String(design.logoUnitSource || '') === 'owner' && isUnit &&
      (design.logoUnitFrom === upload || unit === upload || !design.logoUnitFrom));
    return { url: site, original: upload, text: fromUpload ? 'On the site’s banner, made from your upload.'
      : 'On the site’s banner. Your latest upload is not in it yet: open the site editor to put it in.' };
  }

  /* ---------- one priority scale (UX-068) ---------- */
  var PRIORITIES = [
    { id: 'keynote',  label: 'Top' },
    { id: 'headline', label: 'High' },
    { id: 'featured', label: 'Normal' },
    { id: 'standard', label: 'Low' }
  ];
  var NORMAL = 'featured';
  /* the notes of the menu, where the list can be sorted by priority (Speakers, Sponsors) */
  var SORT_NOTES = { keynote: 'First when sorted by priority', headline: 'After Top', featured: 'Where every new one starts', standard: 'Last when sorted by priority' };
  var PRIORITY_FOOT = {
    speakers: 'Sort by priority puts a group in this order. Priority does not change how a speaker looks on the site.',
    agenda: 'Priority is your own mark of how important a session is. It does not change the agenda on the site.',
    sponsors: 'Sort by priority puts a tier in this order. Priority does not change the size of a logo on the site.'
  };
  function priorityId(v) {
    for (var i = 0; i < PRIORITIES.length; i++) if (PRIORITIES[i].id === v) return v;
    return NORMAL;                       // a missing or unknown value reads as Normal, as it always has
  }
  function priorityLabel(v) {
    var id = priorityId(v);
    for (var i = 0; i < PRIORITIES.length; i++) if (PRIORITIES[i].id === id) return PRIORITIES[i].label;
    return 'Normal';
  }
  function isNormal(v) { return priorityId(v) === NORMAL; }
  function priorityOptions(sortable) {
    return PRIORITIES.map(function (p) { return { id: p.id, label: p.label, note: sortable ? SORT_NOTES[p.id] : '' }; });
  }
  /* highest first; records of the same priority keep the order they had */
  function byPriority(list) {
    var rank = {};
    PRIORITIES.forEach(function (p, i) { rank[p.id] = i; });
    return (list || []).map(function (x, i) { return { x: x, i: i }; }).sort(function (a, b) {
      return (rank[priorityId(a.x && a.x.weight)] - rank[priorityId(b.x && b.x.weight)]) || (a.i - b.i);
    }).map(function (p) { return p.x; });
  }

  var api = {
    TABS: TABS, forTab: forTab, readiness: readiness, logoTile: logoTile,
    PRIORITIES: PRIORITIES, PRIORITY_FOOT: PRIORITY_FOOT, priorityOptions: priorityOptions, priorityId: priorityId,
    priorityLabel: priorityLabel, isNormal: isNormal, byPriority: byPriority
  };
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.RevampSiteNotes = api;
})();
