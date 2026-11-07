/* "Use a previous edition's content" in Create Event (template path): the speakers, agenda, sponsors and
   glimpses of one of the team's real earlier events, read from the server, so every person and every browser
   sees the same list.

   Which events: the real events list (GET /api/events, RevampCore.fetchEvents) of this draft's own ET portal and
   type, never the draft's own event, past editions first (newest first), then events still to come. The owner's
   rule (2026-11-03): previous editions come from the event's own portal only. What is taken: only the records a
   previous edition really has (the owner's rule: speakers, sponsors, agenda and glimpses are taken over; the
   design and its words are not), read from that event's own Content (RevampCore.fetchSub: speakers,
   sessions + agenda-groups, partners + partner-tiers, gallery). A block it has nothing for is not offered.

     RevampEditions.editions(items, portal, cat, ownId, now) -> [{ id, name, when, past }]   which events to offer
     RevampEditions.toContent(records)  -> { speakers?, agenda?, partners?, glimpses? }        the wizard's shapes
     RevampEditions.contentFor(eventId) -> Promise<that content>                               read from the server

   The wizard's shapes: speakers { items: [{ n, r, c, photoUrl }] }, agenda { items: [{ t, ti, sp }] },
   partners { tiers: [{ t, logos: [{ n, url, logoUrl }] }] }, glimpses { items: [{ url, caption }] } — photoUrl and
   logoUrl are the pictures' own addresses (the wizard's own uploads are files in a slot instead). ES5. */
(function () {
  'use strict';

  /* the type an event in the events list was created as, as Create Event names it */
  var CAT_OF_EVENT = { ip: 'IP', editorial: 'IP', client: 'Client', leadgen: 'Client', roundtable: 'Client', virtual: 'Client', awards: 'Awards' };

  function str(v) { return v == null ? '' : String(v).trim(); }
  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  /* an address a picture can be loaded from, or '' */
  function webUrl(v) { v = str(v); return /^https:\/\/[^\s"'<>]+$/i.test(v) ? v : ''; }
  function byOrder(a, b) { return ((+a.order || 0) - (+b.order || 0)); }
  function time(v) { var t = Date.parse(str(v)); return isNaN(t) ? 0 : t; }

  /* the events offered: this portal's and this type's, not the draft's own, deleted ones never (the list has none) */
  function editions(items, portal, cat, ownId, now) {
    if (!portal || !cat) return [];
    now = now || Date.now();
    var out = [];
    (Array.isArray(items) ? items : []).forEach(function (it) {
      if (!it || typeof it !== 'object' || it.portal !== portal || it.deletedAt) return;
      var type = str(it.category).toLowerCase();
      if (!own(CAT_OF_EVENT, type) || CAT_OF_EVENT[type] !== cat) return;
      var id = str(it.id || it.eventId);
      if (!id || (ownId && id === ownId)) return;
      var when = time(it.end) || time(it.start);
      out.push({ id: id, name: str(it.name) || id, when: when, past: !!when && when < now, updated: time(it.updatedAt) });
    });
    /* past editions first, the latest on top; then the ones still to come or with no date, newest change first */
    return out.sort(function (a, b) {
      if (a.past !== b.past) return a.past ? -1 : 1;
      if (a.past) return b.when - a.when;
      return b.updated - a.updated;
    });
  }

  /* records -> the wizard's content. records: { speakers, sessions, agendaGroups, partners, partnerTiers, gallery },
     each the server's list (or missing). Only blocks with something real in them are returned. */
  function toContent(r) {
    r = r || {};
    var content = {};
    var speakers = (r.speakers || []).filter(function (p) { return p && str(p.name); }).slice().sort(byOrder);
    if (speakers.length) {
      content.speakers = { items: speakers.map(function (p) {
        return { n: str(p.name), r: str(p.desig), c: str(p.comp), photoUrl: webUrl(p.photoUrl) };
      }) };
    }
    var names = {};
    (r.speakers || []).forEach(function (p) { if (p && p.id) names[p.id] = str(p.name); });
    var dayAt = {};
    (r.agendaGroups || []).slice().sort(byOrder).forEach(function (d, i) { if (d && d.id) dayAt[d.id] = i; });
    var sessions = (r.sessions || []).filter(function (s) { return s && str(s.title); }).slice().sort(function (a, b) {
      var da = own(dayAt, a.groupId) ? dayAt[a.groupId] : 999, db = own(dayAt, b.groupId) ? dayAt[b.groupId] : 999;
      return (da - db) || str(a.start).localeCompare(str(b.start)) || byOrder(a, b);
    });
    if (sessions.length) {
      content.agenda = { items: sessions.map(function (s) {
        return { t: str(s.start), ti: str(s.title), sp: (s.speakerIds || []).map(function (id) { return names[id]; }).filter(Boolean).join(', ') };
      }) };
    }
    var partners = (r.partners || []).filter(function (p) { return p && (str(p.name) || webUrl(p.logoUrl)); }).slice().sort(byOrder);
    if (partners.length) {
      var slots = {}, tiers = [];
      (r.partnerTiers || []).slice().sort(byOrder).forEach(function (t) {
        if (!t || !t.id) return;
        slots[t.id] = { t: str(t.name), logos: [] };
        tiers.push(slots[t.id]);
      });
      /* a sponsor with no tier still shows: it is never dropped for a tier that was not set up */
      var loose = { t: '', logos: [] };
      partners.forEach(function (p) {
        (own(slots, p.tierId) ? slots[p.tierId] : loose).logos.push({ n: str(p.name), url: webUrl(p.url), logoUrl: webUrl(p.logoUrl) });
      });
      if (loose.logos.length) tiers.push(loose);
      tiers = tiers.filter(function (t) { return t.logos.length; });
      if (tiers.length) content.partners = { tiers: tiers };
    }
    var photos = (r.gallery || []).filter(function (g) { return g && webUrl(g.imageUrl); }).slice().sort(byOrder);
    if (photos.length) content.glimpses = { items: photos.map(function (g) { return { url: webUrl(g.imageUrl), caption: str(g.caption) }; }) };
    return content;
  }

  /* -> Promise<content> of a real event, read from its own Content. A list that cannot be read fails the whole read:
     content half taken over is worse than none, and the person can try again. */
  var READS = [['speakers', 'speakers'], ['sessions', 'sessions'], ['agendaGroups', 'agenda-groups'], ['partners', 'partners'],
    ['partnerTiers', 'partner-tiers'], ['gallery', 'gallery']];
  function contentFor(eventId) {
    var C = window.RevampCore;
    if (!C || typeof C.fetchSub !== 'function') return Promise.reject(new Error('This page did not load completely. Reload it and try again.'));
    return Promise.all(READS.map(function (pair) { return C.fetchSub(pair[1], eventId); })).then(function (lists) {
      var records = {};
      READS.forEach(function (pair, i) { records[pair[0]] = lists[i] || []; });
      return toContent(records);
    });
  }

  window.RevampEditions = { editions: editions, toContent: toContent, contentFor: contentFor, CAT_OF_EVENT: CAT_OF_EVENT };
})();
