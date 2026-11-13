/* The event's records (Content › Speakers, Agenda, Sponsors, Gallery, FAQ and Contact) in the words a site's lists
   use. Shared by the site editor (editor-template-ui.js, which draws them into an AI-designed site's lists when it
   opens a site) and the server (functions/lib/site-records.js, which draws them into the saved site as soon as
   Content changes, so the staged copy shows the change at once and it goes live through approval like any edit).
   One copy of these rules, so the editor and the server always show a record the same way.

     KINDS                      the kinds of record a list can show, in the order the editor adds their sections
     TABS[kind]                 where the console manages it: { tab, route, label, one, many }
                                (route is the console's address fragment: /edit-event.html?event=<id>#<route>)
     SOURCES[kind]              the console resources (GET /api/event/<resource>) its list is made from, its own first
     translate[kind](lists…)    the records, one argument per SOURCES entry, as list items -> [item] | null
                                (null when the kind has nothing to show — no records, or no speaker or sponsor on
                                the site: the caller decides what an empty list shows)
     isOnSite(record)           whether a speaker or a sponsor is on the site (below): THE rule, asked by every place
                                that shows them — the console's "Not on the site" and "N on site", this file's lists,
                                the editor, the public site data, search, and the speaker and sponsor pages
     onSite(kind, rows)         the rows of a kind that the site shows (speakers and sponsors: isOnSite; others: all)
     isImageField(field), isLinkField(kind, field)    how an item's field is shown (a picture; a link's address)
     EMPTY_PLACE_CHARS          an empty list takes its section off the page when the rest of the section has at most
                                this many characters of text (a heading and a line or two)
     LABEL_LINE_CHARS           a line left holding only a label ("Speakers" over nothing) goes when it has at most this

   Items (the data-rv-field names of an AI-designed list item, plus the record's id):
     speakers  { id, n, r, c, photo, bio, li, profile: { name, bio, li, sessions: [{ when, title }] } }
     faq       { id, t, d }
     partners  { id, name, url, logo }
     contact   { id, label, name, email, phone }
     glimpses  { id, imageUrl, caption }
     sessions  { id, title, time, desc, room, speakers, dayKey, dayName, dayDate }

   A plain script, ES5, no dependencies: window.RevampRecords in a browser, module.exports in Node. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RevampRecords = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var KINDS = ['speakers', 'sessions', 'partners', 'glimpses', 'faq', 'contact'];
  var TABS = {
    speakers: { tab: 'speakers', route: 'content/speakers', label: 'Content › Speakers', one: 'speaker', many: 'speakers' },
    sessions: { tab: 'agenda', route: 'content/agenda', label: 'Content › Agenda', one: 'session', many: 'sessions' },
    partners: { tab: 'sponsors', route: 'content/sponsors', label: 'Content › Sponsors', one: 'sponsor', many: 'sponsors' },
    glimpses: { tab: 'gallery', route: 'content/gallery', label: 'Content › Gallery', one: 'gallery picture', many: 'gallery pictures' },
    faq: { tab: 'faq', route: 'content/faq', label: 'Content › FAQ', one: 'FAQ', many: 'FAQs' },
    contact: { tab: 'contact', route: 'content/contact', label: 'Content › Contact', one: 'contact', many: 'contacts' }
  };
  var SOURCES = {
    sessions: ['sessions', 'agenda-groups', 'speakers'],
    speakers: ['speakers', 'sessions', 'agenda-groups'],
    faq: ['faqs'],
    partners: ['partners'],
    contact: ['contacts'],
    glimpses: ['gallery']
  };
  var EMPTY_PLACE_CHARS = 600;
  var LABEL_LINE_CHARS = 30;

  /* A speaker or a sponsor is on the site only when it is Confirmed. One with no status at all (made before the
     field existed; an award's jury as it is first filled in) counts as Confirmed. Invited and Tentative ones are
     the organiser's working list: the console tags them "Not on the site", and nothing that draws a site — the
     server (site-records.js), the site editor, a session's speaker names, a juror's card, the public site data,
     search, the speaker and sponsor pages — shows them. (The console stores only '', confirmed, invited or
     tentative: functions/lib/http.js CONTENT_STATUSES.) */
  function isOnSite(r) {
    var s = r && r.status;
    return s == null || s === '' || s === 'confirmed';
  }
  var STATUS_KINDS = { speakers: 1, partners: 1 };
  function onSite(kind, rows) {
    if (!rows || !rows.length) return rows || [];
    return STATUS_KINDS[kind] ? rows.filter(isOnSite) : rows;
  }

  function isImageField(field) { return field === 'photo' || field === 'logo' || field === 'imageUrl'; }
  function isLinkField(kind, field) { return (kind === 'partners' && field === 'url') || (kind === 'speakers' && field === 'li'); }

  function idOf(r) { return r && r.id != null ? String(r.id) : ''; }
  function byOrder(a, b) { return (a.order || 0) - (b.order || 0); }

  /* agenda: in day order, then by start time; time as "9:30 AM – 10:15 AM"; speakers by name */
  function clockLabel(v) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(v || '').trim());
    if (!m || +m[1] > 23) return String(v || '').trim();
    return ((+m[1] % 12) || 12) + ':' + m[2] + (+m[1] < 12 ? ' AM' : ' PM');
  }
  var MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  /* "2027-06-22" -> "22 June 2027" ('' for anything else) */
  function dayDateLabel(v) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || ''));
    if (!m) return '';
    return (+m[3]) + ' ' + MONTH_NAMES[+m[2] - 1] + ' ' + m[1];
  }
  /* a day as a speaker's pop-up names it: its date in words, else its name */
  function dayLabelOf(d) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String((d && d.date) || ''));
    return m && +m[2] >= 1 && +m[2] <= 12 ? +m[3] + ' ' + MONTH_NAMES[+m[2] - 1] + ' ' + m[1] : String((d && d.name) || '').trim();
  }
  function sessionOrder(dayAt) {
    return function (a, b) {
      var da = a.groupId in dayAt ? dayAt[a.groupId] : 999, db = b.groupId in dayAt ? dayAt[b.groupId] : 999;
      return (da - db) || String(a.start || '').localeCompare(String(b.start || '')) || byOrder(a, b);
    };
  }

  /* each speaker's sessions (Content › Agenda), as the pop-up lists them: { when: "26 November 2026 · 9:30 AM – 10:15 AM", title } */
  function speakerSessionsOf(sessions, days) {
    var dayById = {}, dayAt = {}, out = {};
    (days || []).slice().sort(byOrder).forEach(function (d, i) { dayById[d.id] = dayLabelOf(d); dayAt[d.id] = i; });
    (sessions || []).slice().sort(sessionOrder(dayAt)).forEach(function (s) {
      var title = String(s.title || '').trim();
      if (!title) return;
      var time = [clockLabel(s.start), clockLabel(s.end)].filter(Boolean).join(' – ');
      var when = [dayById[s.groupId] || '', time].filter(Boolean).join(' · ');
      (s.speakerIds || []).forEach(function (id) {
        var list = out[id] || (out[id] = []);
        if (list.length < 6) list.push({ when: when, title: title });
      });
    });
    return out;
  }

  /* A speaker's card and the profile a visitor opens from it (templates/_shared/rv-popups.js): their text,
     LinkedIn and sessions. Never the speaker's e-mail or phone. Only the speakers on the site (isOnSite): null
     when there are none, as when there are no records at all. */
  function speakers(items, sessions, days) {
    items = onSite('speakers', items);
    if (!items.length) return null;
    var talks = speakerSessionsOf(sessions, days);
    return items.map(function (p) {
      var li = /^https:\/\/[^\s"'<>\\]+$/i.test(String(p.li || '').trim()) ? String(p.li).trim() : '';
      return { id: idOf(p), n: p.name || '', r: p.desig || '', c: p.comp || '', photo: p.photoUrl || '', bio: String(p.bio || '').trim(), li: li,
        profile: { name: String(p.name || '').trim(), bio: String(p.bio || '').trim(), li: li, sessions: talks[p.id] || [] } };
    });
  }
  function faq(items) {
    if (!items || !items.length) return null;
    return items.map(function (f) { return { id: idOf(f), t: f.question || '', d: f.answer || '' }; });
  }
  function glimpses(items) {
    if (!items || !items.length) return null;
    return items.map(function (g) { return { id: idOf(g), imageUrl: g.imageUrl || '', caption: g.caption || '' }; });
  }
  function contact(items) {
    if (!items || !items.length) return null;
    return items.map(function (c) { return { id: idOf(c), label: c.label || '', name: c.name || '', email: c.email || '', phone: c.phone || '' }; });
  }
  /* no tier grouping in a flat list: one item per partner, in the flat display order; only the sponsors on the
     site (isOnSite) */
  function partners(items) {
    items = onSite('partners', items);
    if (!items.length) return null;
    return items.slice().sort(byOrder).map(function (p) { return { id: idOf(p), name: p.name || '', url: p.url || '', logo: p.logoUrl || '' }; });
  }
  /* every session; its speakers named only when they are on the site (an Invited speaker of a session is not
     named on it) */
  function sessions(items, days, people) {
    if (!items || !items.length) return null;
    var dayAt = {}, nameOf = {}, dayOf = {};
    (days || []).slice().sort(byOrder).forEach(function (d, i) { dayAt[d.id] = i; dayOf[d.id] = d; });
    onSite('speakers', people).forEach(function (s) { nameOf[s.id] = s.name || ''; });
    return items.slice().sort(sessionOrder(dayAt)).map(function (s) {
      var time = [clockLabel(s.start), clockLabel(s.end)].filter(Boolean).join(' – ');
      var day = dayOf[s.groupId] || null;
      return { id: idOf(s), title: s.title || '', time: time, desc: s.desc || '', room: s.room || '',
        speakers: (s.speakerIds || []).map(function (id) { return nameOf[id]; }).filter(Boolean).join(', '),
        /* the session's day, for the page's day tabs (et-runtime.js sessionDays) */
        dayKey: String(s.groupId || ''), dayName: day ? String(day.name || '') : '', dayDate: day ? dayDateLabel(day.date) : '' };
    });
  }

  return {
    KINDS: KINDS, TABS: TABS, SOURCES: SOURCES, EMPTY_PLACE_CHARS: EMPTY_PLACE_CHARS, LABEL_LINE_CHARS: LABEL_LINE_CHARS,
    isOnSite: isOnSite, onSite: onSite, isImageField: isImageField, isLinkField: isLinkField, clockLabel: clockLabel,
    translate: { speakers: speakers, sessions: sessions, partners: partners, glimpses: glimpses, faq: faq, contact: contact }
  };
});
