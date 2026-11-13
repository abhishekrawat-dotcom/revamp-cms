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

   "Start from a previous edition" (create-event.html openCloneDesignModal) brings those four into the new event as
   records of its own, below (carryOver).

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
  /* whether a speaker or a sponsor was on the event's site: Confirmed, or with no status at all — THE rule, as
     templates/_shared/rv-records.js isOnSite says it (that file is not loaded on this page); an Invited or Tentative
     one was only on the organiser's working list, so it is not a previous edition's speaker or sponsor */
  function onSite(r) { var s = r && r.status; return s == null || s === '' || s === 'confirmed'; }

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
    var speakers = (r.speakers || []).filter(function (p) { return p && str(p.name) && onSite(p); }).slice().sort(byOrder);
    if (speakers.length) {
      content.speakers = { items: speakers.map(function (p) {
        return { n: str(p.name), r: str(p.desig), c: str(p.comp), photoUrl: webUrl(p.photoUrl) };
      }) };
    }
    var names = {};
    (r.speakers || []).forEach(function (p) { if (p && p.id && onSite(p)) names[p.id] = str(p.name); });
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
    var partners = (r.partners || []).filter(function (p) { return p && (str(p.name) || webUrl(p.logoUrl)) && onSite(p); }).slice().sort(byOrder);
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

  /* ---------- "Start from a previous edition": its records, brought into the new event ----------
     The owner's rule: from a previous edition only its speakers, sponsors, agenda and glimpses are taken over; its
     words, colours, pictures and page changes are not (the design is the template's, made afresh). Chosen in Create
     Event (openCloneDesignModal), they come into the new event as records of its own — new ids, made through the
     console's own Content routes (RevampCore.createSub) — so the console, the editor and the site hold them like
     any other. The previous edition is only ever read.
     Taken: what its site showed of them (onSite), as the console holds it — names, roles, companies, pictures and
     logos by their address, LinkedIn, bios, tiers and groups, days, times, rooms and order. Not taken: the
     organiser's own notes and contact details for them (email, phone, a sponsor's contact and note), and an agenda
     day's date, which was the previous edition's. A session keeps its speakers by name: they are matched with the
     new event's own speakers, which are in by the time the agenda comes (the wizard's sections write theirs first).

     RevampEditions.recordsOf(eventId)        -> Promise<records>: its lists ({ speakers, speakerGroups, sessions,
                                                 agendaGroups, partners, partnerTiers, gallery }), as the server has them
     RevampEditions.carryCounts(records)      -> { speakers, partners, glimpses, agenda }: how many of each would come
     RevampEditions.carryPlan(records, kind)  -> [{ resource, rows: [{ key, body, ref?, speakers? }] }] for one kind,
                                                 in the order they are made (a tier before its sponsors)
     RevampEditions.carryOver(o)              -> Promise<{ copied: { <kind>: n }, kept: [kind] }>
         o: { from, to (event ids), kinds, state: { done: {}, made: {} } (kept by the caller between runs),
              going() (false: stop; the promise rejects with "stopped"), save() (state changed) }
         A kind the new event already has records of is kept as it is, never doubled ('kept'). A kind a run left
         part-made is taken out and made again; once begun, a kind is always finished, whatever the caller now asks.
     RevampEditions.unfinished(state)         -> the kinds a run began and did not finish */
  var CARRY_ORDER = ['speakers', 'partners', 'glimpses', 'agenda'];       // the agenda last: its sessions name speakers
  var CARRY = {
    speakers: { groups: ['speaker-groups', 'speakerGroups'], items: ['speakers', 'speakers'], link: 'groupId' },
    partners: { groups: ['partner-tiers', 'partnerTiers'], items: ['partners', 'partners'], link: 'tierId' },
    glimpses: { items: ['gallery', 'gallery'] },
    agenda: { groups: ['agenda-groups', 'agendaGroups'], items: ['sessions', 'sessions'], link: 'groupId' }
  };
  var CARRY_FIELDS = {
    'speaker-groups': ['name'],
    speakers: ['name', 'desig', 'comp', 'photoUrl', 'logoUrl', 'colour', 'weight', 'status', 'li', 'bio'],
    'partner-tiers': ['name', 'weight'],
    partners: ['name', 'url', 'logoUrl', 'weight', 'status'],
    'agenda-groups': ['name'],
    sessions: ['title', 'start', 'end', 'kind', 'desc', 'room', 'weight'],
    gallery: ['imageUrl', 'caption']
  };
  var URL_FIELDS = { photoUrl: 1, logoUrl: 1, li: 1, url: 1, imageUrl: 1 };
  var KIND_WORDS = { speakers: 'speakers', partners: 'sponsors', glimpses: 'glimpses', agenda: 'agenda' };
  var CARRY_LANES = 3;                 // records made at once: quicker than one by one, gentle on the server

  function linkUrl(v) { v = str(v); return /^https?:\/\/[^\s"'<>]+$/i.test(v) ? v : ''; }
  /* a record's fields the new event takes, without the empty ones; its place in the list (order) always */
  function pick(rec, fields, at) {
    var body = {};
    fields.forEach(function (f) {
      var v = rec[f];
      if (typeof v === 'string') v = URL_FIELDS[f] ? linkUrl(v) : v.trim();
      if (v === undefined || v === null || v === '') return;
      body[f] = v;
    });
    body.order = typeof rec.order === 'number' && isFinite(rec.order) ? rec.order : at;
    return body;
  }
  /* the items of a kind that come: what the previous edition's site showed */
  function itemsOf(r, kind) {
    var list = ((r || {})[CARRY[kind].items[1]] || []).filter(function (x) { return x && typeof x === 'object'; });
    if (kind === 'speakers' || kind === 'partners') return list.filter(function (p) { return str(p.name) && onSite(p); });
    if (kind === 'agenda') return list.filter(function (s) { return str(s.title); });
    return list.filter(function (g) { return linkUrl(g.imageUrl); });
  }
  function carryCounts(r) {
    var out = {};
    CARRY_ORDER.forEach(function (kind) { out[kind] = itemsOf(r, kind).length; });
    return out;
  }
  function carryPlan(r, kind) {
    var c = own(CARRY, kind) ? CARRY[kind] : null;
    if (!c) return [];
    r = r || {};
    var items = itemsOf(r, kind).slice().sort(byOrder);
    if (!items.length) return [];
    var steps = [], kept = {};
    if (c.groups) {
      var used = {};
      items.forEach(function (it) { if (it[c.link] != null && it[c.link] !== '') used[String(it[c.link])] = 1; });
      var groups = (r[c.groups[1]] || []).filter(function (g) { return g && g.id != null && own(used, String(g.id)) && str(g.name); }).slice().sort(byOrder);
      if (groups.length) {
        steps.push({ resource: c.groups[0], rows: groups.map(function (g, i) { kept[String(g.id)] = 1; return { key: String(g.id), body: pick(g, CARRY_FIELDS[c.groups[0]], i) }; }) });
      }
    }
    var names = {};
    if (kind === 'agenda') (r.speakers || []).forEach(function (p) { if (p && p.id != null && str(p.name) && onSite(p)) names[String(p.id)] = str(p.name); });
    steps.push({ resource: c.items[0], rows: items.map(function (it, i) {
      var row = { key: it.id != null ? String(it.id) : '#' + i, body: pick(it, CARRY_FIELDS[c.items[0]], i) };
      if (c.groups && it[c.link] != null && own(kept, String(it[c.link]))) row.ref = { field: c.link, resource: c.groups[0], key: String(it[c.link]) };
      if (kind === 'agenda') {
        row.speakers = [];
        (Array.isArray(it.speakerIds) ? it.speakerIds : []).forEach(function (id) {
          var n = own(names, String(id)) ? names[String(id)] : '';
          if (n && row.speakers.indexOf(n) === -1) row.speakers.push(n);
        });
      }
      return row;
    }) });
    return steps;
  }

  /* its lists, read at once; one that cannot be read fails the read (never half taken over) */
  var RECORD_READS = READS.concat([['speakerGroups', 'speaker-groups']]);
  function recordsOf(eventId) {
    var C = window.RevampCore;
    if (!C || typeof C.fetchSub !== 'function') return Promise.reject(new Error('This page did not load completely. Reload it and try again.'));
    return Promise.all(RECORD_READS.map(function (pair) { return C.fetchSub(pair[1], eventId); })).then(function (lists) {
      var records = {};
      RECORD_READS.forEach(function (pair, i) { records[pair[0]] = lists[i] || []; });
      return records;
    });
  }

  /* the resources a kind is made of, its items first */
  function resourcesOf(kind) { var c = CARRY[kind]; return c.groups ? [c.items[0], c.groups[0]] : [c.items[0]]; }
  /* the kinds a run began making and did not finish (state: carryOver's) */
  function unfinished(state) {
    if (!state || typeof state !== 'object' || !state.made || typeof state.made !== 'object') return [];
    var done = state.done && typeof state.done === 'object' ? state.done : {};
    return CARRY_ORDER.filter(function (kind) {
      return !done[kind] && resourcesOf(kind).some(function (res) { return Array.isArray(state.made[res]) && state.made[res].length > 0; });
    });
  }

  /* fn over the list, n at a time; the first failure fails it all, and no more are started */
  function lanes(list, n, fn) {
    var at = 0, failed = false;
    function next() {
      if (failed || at >= list.length) return Promise.resolve();
      var item = list[at++];
      return Promise.resolve().then(function () { return fn(item); }).then(next, function (err) { failed = true; throw err; });
    }
    var runs = [];
    for (var i = 0; i < Math.min(n, list.length); i++) runs.push(next());
    return Promise.all(runs);
  }

  function carryOver(o) {
    var C = window.RevampCore;
    if (!C || typeof C.fetchSub !== 'function' || typeof C.createSub !== 'function' || typeof C.deleteSub !== 'function') {
      return Promise.reject(new Error('This page did not load completely. Reload it and try again.'));
    }
    var state = o.state;
    if (!state.done || typeof state.done !== 'object') state.done = {};
    if (!state.made || typeof state.made !== 'object') state.made = {};
    var going = typeof o.going === 'function' ? o.going : function () { return true; };
    var save = typeof o.save === 'function' ? o.save : function () {};
    var asked = Array.isArray(o.kinds) ? o.kinds : [];
    /* the kinds asked for, and any a run began and did not finish; in their order, each once */
    var left = unfinished(state);
    var kinds = CARRY_ORDER.filter(function (kind) { return !state.done[kind] && (asked.indexOf(kind) !== -1 || left.indexOf(kind) !== -1); });
    var result = { copied: {}, kept: [] };
    function stillGoing() { if (!going()) throw new Error('stopped'); }
    /* what an earlier run of this kind made, taken out again (one already gone counts as taken out); never anything else */
    function removeMine(kind) {
      return resourcesOf(kind).reduce(function (p, res) {
        return p.then(function () {
          return (state.made[res] || []).slice().reduce(function (q, id) {
            return q.then(function () {
              stillGoing();
              return C.deleteSub(res, o.to, id).then(null, function (err) { if (!err || err.status !== 404) throw err; });
            }).then(function () {
              state.made[res] = (state.made[res] || []).filter(function (x) { return x !== id; });
              save();
            });
          }, Promise.resolve());
        });
      }, Promise.resolve());
    }
    if (!kinds.length) return Promise.resolve(result);
    return recordsOf(o.from).then(function (r) {
      return kinds.reduce(function (p, kind) {
        return p.then(function () {
          stillGoing();
          return removeMine(kind).then(function () {
            return C.fetchSub(CARRY[kind].items[0], o.to);
          }).then(function (have) {
            stillGoing();
            if (have && have.length) { state.done[kind] = 'kept'; save(); result.kept.push(kind); return; }
            var plan = carryPlan(r, kind);
            if (!plan.length) { state.done[kind] = 'none'; save(); return; }
            return (kind === 'agenda' ? C.fetchSub('speakers', o.to) : Promise.resolve([])).then(function (people) {
              var byName = {}, ids = {};
              (people || []).forEach(function (p) {
                var k = p && p.id != null ? str(p.name).toLowerCase() : '';
                if (k && !own(byName, k)) byName[k] = String(p.id);
              });
              return plan.reduce(function (q, step) {
                return q.then(function () {
                  ids[step.resource] = {};
                  return lanes(step.rows, CARRY_LANES, function (row) {
                    stillGoing();
                    var body = JSON.parse(JSON.stringify(row.body));
                    if (row.ref && ids[row.ref.resource] && own(ids[row.ref.resource], row.ref.key)) body[row.ref.field] = ids[row.ref.resource][row.ref.key];
                    if (row.speakers) {
                      var sp = [];
                      row.speakers.forEach(function (n) {
                        var k = n.toLowerCase(), id = own(byName, k) ? byName[k] : '';
                        if (id && sp.indexOf(id) === -1) sp.push(id);
                      });
                      if (sp.length) body.speakerIds = sp;
                    }
                    return C.createSub(step.resource, o.to, body).then(function (made) {
                      var id = made && made.id != null ? String(made.id) : '';
                      if (!id) return;
                      ids[step.resource][row.key] = id;
                      (state.made[step.resource] = state.made[step.resource] || []).push(id);
                      save();
                    });
                  });
                });
              }, Promise.resolve()).then(function () {
                state.done[kind] = 'copied';
                save();
                result.copied[kind] = plan[plan.length - 1].rows.length;
              });
            });
          });
        });
      }, Promise.resolve());
    }).then(function () { return result; });
  }

  window.RevampEditions = { editions: editions, toContent: toContent, contentFor: contentFor, CAT_OF_EVENT: CAT_OF_EVENT,
    recordsOf: recordsOf, carryCounts: carryCounts, carryPlan: carryPlan, carryOver: carryOver, unfinished: unfinished,
    KIND_WORDS: KIND_WORDS, onSite: onSite };
})();
