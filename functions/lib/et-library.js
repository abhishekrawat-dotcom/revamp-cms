/* The speaker and sponsor library: EventSphere's own copy of ET's speaker and sponsor records, and the records of
   EventSphere's own events, searched by name so a person types a name and the rest fills in (the owner, 11 Nov 2026:
   "I just put the speaker name and all the details can be autofilled … by fetching … any other but authentic source",
   and "can you store all speakers data from ETAPI to your database? it will help us to execute faster. same for
   sponsors as well").

   WHY ET's OWN RECORDS. They are authentic (ET's teams entered them for ET's own events) and nearly every speaker has a
   photo, a designation and a company (asked in October 2026: 2,095 speakers of 72 past editions on 12 portals; a
   LinkedIn link for about one in seven). LinkedIn itself cannot be read: its API gives no access to other people's
   profiles and reading its pages breaks its terms (it sued the largest seller of such data, which closed in 2025).

   WHAT IS STORED (Firestore, written by this server only; firestore.rules unchanged):
     etLibrary/<portal>   { portal, portalName, builtAt, events: [{ id, title, year, link }],
                            speakers: [{ n, d, c, p, l, b, g, e: [event index, newest first] }],   name, designation,
                                       company, photo, LinkedIn, bio, company logo
                            sponsors: [{ n, g, u, t, e: [..] }],                                      name, logo, website,
                                       tier ("Platinum Partner")
                            counts: { events, speakers, sponsors }, partial }
     etLibrary/_lock      { until }   one builder at a time
   A person who spoke at several editions is one entry while their company stays the same (the newest edition's
   designation and photo); a company that changed is another entry. A sponsor is one entry per name.
   Only ET's own (IP) events that have taken place are read: their pages show these people, so the records are
   public. Awards (their juries) are not read yet.

   KEPT FRESH. POST /api/library/build reads what is missing or more than a day old, a few portals at a time, within a
   time budget, and saves each portal as it finishes, so a build that is cut off loses nothing and the next one goes
   on. The console asks for it, in the background, when a person opens Speakers or Sponsors. Each portal's sessions
   (ET's agendas, by speaker: { portal, builtAt, events: [{ i, id, s: [{ t, a, z, k: [entry key] }] }] }) are kept
   beside it in etLibraryAgenda/<portal>; a sponsor's entry has ts, its tier at each of its editions; an event has its
   start day. After reading, the build keeps the speaker and sponsor pages in step (lib/people.js reconcile) in the
   time it has left, or the next build does (peopleDue on the lock).

   ONE ENTRY PER PERSON. Search answers one entry for each person (lib/people-match.js: the same name and company,
   on every portal, however the company was typed), with the newest edition's details; coverage counts people and
   sponsors that way (speakerRows: what the portals hold between them).

   EVENTSPHERE's OWN RECORDS. The speakers and sponsors of EventSphere's events the person may open (Settings ›
   Access), read through collectionGroup and kept two minutes; a photo saved inside a record (a small picture) is
   read only for the few results shown.

     GET  /api/library/speakers?q=<name>[&eventId=]   -> { items: [ITEM], coverage }                          (viewer)
     GET  /api/library/sponsors?q=<name>[&eventId=]   -> the same for sponsors
     POST /api/library/build { eventId? }             -> { built: [portal], left, busy, coverage }            (editor)
   ITEM (speaker) = { key, name, designation, company, photo, linkedin, bio, logo, from: [{ kind: 'et' | 'event',
                      label: 'ETCISO · CISO Secufest 2025', link }] }
   ITEM (sponsor) = { key, name, logo, url, tier, from: [...] }
   coverage = { portals, built, speakers, sponsors, builtAt, stale }

     normal(s), tokens(s)                the comparison form of a name
     buildPortal(portal, fetchJson, o)   -> Promise<DOC>   one portal's records, read from ET
     search(kind, q, sources, o)         -> [ITEM]        pure: sources = { et: [DOC], own: [OWN] }
     wire / handlers for lib/api.js */
'use strict';

var etEvents = require('./et-events');
var etPrevious = require('./et-previous');
var H = require('./http');
var AC = require('./access-control');
var PM = require('./people-match');

var COL = 'etLibrary', LOCK = '_lock', AGENDA_COL = 'etLibraryAgenda';
var FRESH_MS = 24 * 3600 * 1000;
var LOCK_MS = 90 * 1000;
var BUDGET_MS = 40 * 1000;
var PEOPLE_MS = 20 * 1000;   /* what keeping the speaker and sponsor pages in step may take of a build */
var PORTALS_AT_ONCE = 3, EVENTS_AT_ONCE = 4;
var CAPS = { eventsPerPortal: 80, bio: 400, results: 12, query: 80, docBytes: 900 * 1024, ownMs: 2 * 60 * 1000, etMs: 10 * 60 * 1000,
  inlinePhoto: 160 * 1024, sessionTitle: 240, sessionsPerEvent: 150, sessionAbout: 320, fullBio: 1200 };
/* a group that says only that they spoke: no role to show */
var GENERIC_ROLE = /^(?:speakers?|our speakers|panell?ists?|session speakers?|delegates?|participants?)$/i;

function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }
function normal(s) { return str(s).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9ऀ-ॿ]+/g, ' ').trim(); }
function tokens(s) { return normal(s).split(' ').filter(Boolean); }
/* run fn over items, n at a time; stop starting new ones once stop() says so */
function inTurns(items, n, fn, stop) {
  var i = 0, out = [];
  function lane() {
    if (i >= items.length || (stop && stop())) return Promise.resolve();
    var k = i++;
    return Promise.resolve(fn(items[k], k)).then(function (r) { out[k] = r; }, function () { out[k] = null; }).then(lane);
  }
  var lanes = [];
  for (var j = 0; j < Math.min(n, items.length); j++) lanes.push(lane());
  return Promise.all(lanes).then(function () { return out; });
}

/* ET's API, as lib/api.js reads it (etJson) */
function etJson(u, headers) {
  return require('./safe-fetch').safeFetch(u, { timeoutMs: 15000, maxBytes: 4 * 1024 * 1024, headers: Object.assign({ accept: 'application/json' }, headers || {}) })
    .then(function (r) { return r.status === 200 ? JSON.parse(r.body.toString('utf8')) : null; });
}

/* ---------- reading one portal from ET ---------- */
/* o.agenda: an object given to be filled with the portal's sessions (AGENDA, below) — the build stores it as
   etLibraryAgenda/<portal> beside the portal's records; without it, ET's agendas are not read */
function buildPortal(portal, fetchJson, o) {
  o = o || {};
  var now = o.now || Date.now();
  var agendaOut = o.agenda && typeof o.agenda === 'object' ? o.agenda : null;
  var sessionsByEvent = [], fullBios = {};
  /* an edition's sessions, each with the people who spoke in it: ET's agenda names them by the id its speaker list
     gives them (or by name, where it gives no id), and a person is kept by the key their entry has here */
  function sessionsOfEvent(rawSpeakers, rawAgenda, idx) {
    var keyOfId = {}, keyOfName = {};
    (rawSpeakers || []).forEach(function (raw) {
      var sp = etPrevious.speakerOf(raw);
      if (!sp) return;
      var k = normal(sp.name) + '|' + normal(sp.company);
      if (raw.id != null && str(raw.id) !== '') keyOfId['#' + str(raw.id)] = k;
      keyOfName['#' + normal(sp.name)] = k;
    });
    var list = [];
    (rawAgenda || []).forEach(function (a) {
      var title = a && str(a.agenda_title).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      if (!title || str(a.status) === '0') return;
      var keys = [];
      (Array.isArray(a.speakers) ? a.speakers : []).forEach(function (sp) {
        if (!sp) return;
        var k = (sp.id != null && keyOfId['#' + str(sp.id)]) || keyOfName['#' + normal(sp.speaker_name)];
        if (k && keys.indexOf(k) === -1) keys.push(k);
      });
      if (!keys.length) return;
      var item = { t: title.slice(0, CAPS.sessionTitle), a: str(a.agenda_start_datetime).slice(0, 16), z: str(a.agenda_end_datetime).slice(0, 16), k: keys };
      var about = str(a.agenda_description).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
      if (about) item.d = about.slice(0, CAPS.sessionAbout);
      list.push(item);
    });
    list.sort(function (x, y) { return x.a < y.a ? -1 : x.a > y.a ? 1 : 0; });
    if (list.length) sessionsByEvent.push({ i: idx, s: list.slice(0, CAPS.sessionsPerEvent) });
  }
  /* the portal's awards too (their jury and partners; the owner, 11 Nov 2026: "ET Awards: jury"): an award's
     speaker list is its jury and guests, its sponsor list its partners. A portal whose awards cannot be read is
     read without them. */
  var awardsRead = typeof etEvents.listAwards === 'function' ? etEvents.listAwards(portal, fetchJson).then(null, function () { return []; }) : Promise.resolve([]);
  return Promise.all([etEvents.listIpEvents(portal, fetchJson), awardsRead]).then(function (lists) {
    var events = (lists[0] || []).concat((lists[1] || []).filter(function (a) { return a && a.kind === 'award'; }));
    /* ET writes a start as "2025-11-20T09:30:00" (or nothing): taken place, newest first */
    var past = events.filter(function (e) { return e && e.past && !e.upcoming && (!e.start || !(Date.parse(String(e.start).replace(' ', 'T')) > now)); })
      .sort(function (a, b) { return str(b.start) < str(a.start) ? -1 : str(b.start) > str(a.start) ? 1 : 0; }).slice(0, CAPS.eventsPerPortal);
    var doc = { portal: portal, portalName: etEvents.PORTALS[portal] || portal, builtAt: new Date(now).toISOString(),
      events: past.map(function (e) {
        var ev = { id: e.id, title: str(e.title).slice(0, 200), year: /^\d{4}/.test(str(e.start)) ? str(e.start).slice(0, 4) : '',
          start: /^\d{4}-\d{2}-\d{2}/.test(str(e.start)) ? str(e.start).slice(0, 10) : '', link: str(e.link) };
        if (e.kind === 'award') ev.kind = 'award';
        return ev;
      }),
      speakers: [], sponsors: [], counts: { events: past.length, speakers: 0, sponsors: 0 }, partial: false };
    var byPerson = {}, bySponsor = {};
    return inTurns(past, EVENTS_AT_ONCE, function (e, idx) {
      var award = e.kind === 'award';
      var lists = [e.speakers > 0 || award ? etPrevious.allItems(fetchJson, '/v1/activity/speaker/list', e.id, portal) : Promise.resolve([]),
        etPrevious.allItems(fetchJson, '/v1/activity/sponsor/list', e.id, portal),
        e.speakers > 0 && !award && agendaOut ? etPrevious.allItems(fetchJson, '/v1/activity/agenda/list', e.id, portal) : Promise.resolve([])];
      return Promise.all(lists).then(function (r) {
        if (agendaOut) sessionsOfEvent(r[0], r[2], idx);
        /* newest edition first, so the first seen of a person is their latest designation and photo */
        r[0].forEach(function (raw) {
          var s = etPrevious.speakerOf(raw);
          if (!s) return;
          var key = normal(s.name) + '|' + normal(s.company);
          var have = byPerson[key];
          /* the full text, for the person's page (the entry keeps the first CAPS.bio for the library's search) */
          if (agendaOut && s.bio.length > CAPS.bio && !fullBios[key]) fullBios[key] = s.bio.slice(0, CAPS.fullBio);
          if (!have) {
            byPerson[key] = { n: s.name, d: s.designation, c: s.company, p: s.photo, l: s.linkedin, b: s.bio.slice(0, CAPS.bio), g: s.logo, e: [idx], rs: {} };
            have = null;
          } else {
            if (have.e.indexOf(idx) === -1) have.e.push(idx);
            if (!have.p) have.p = s.photo;
            if (!have.l) have.l = s.linkedin;
            if (!have.b) have.b = s.bio.slice(0, CAPS.bio);
            if (!have.g) have.g = s.logo;
          }
          /* the group ET put them in at this edition: "Keynote Address", "Grand Jury", "Eminent Leaders" */
          var role = str(s.group).trim();
          if (role && !GENERIC_ROLE.test(role) && !byPerson[key].rs[idx]) byPerson[key].rs[idx] = role.slice(0, 80);
        });
        r[1].forEach(function (raw) {
          var s = etPrevious.sponsorOf(raw);
          if (!s) return;
          var key = normal(s.name), have = bySponsor[key];
          if (!have) bySponsor[key] = { n: s.name, g: s.logo, u: s.url, t: s.tier, e: [idx], ts: {} };
          else { if (have.e.indexOf(idx) === -1) have.e.push(idx); if (!have.u) have.u = s.url; if (!have.t) have.t = s.tier; }
          /* the tier at each edition ("Platinum Partner" at one, "Associate Partner" at another) */
          if (s.tier && !bySponsor[key].ts[idx]) bySponsor[key].ts[idx] = s.tier.slice(0, 80);
        });
      });
    }).then(function () {
      /* events were read side by side: each entry's events newest first again */
      Object.keys(byPerson).forEach(function (k) {
        var x = byPerson[k];
        x.e.sort(function (a, b) { return a - b; });
        /* rs: the role at each of e's editions, in e's order ('' where none, or only "Speakers") */
        x.rs = x.e.map(function (i) { return x.rs[i] || ''; });
        if (!x.rs.some(Boolean)) delete x.rs;
        doc.speakers.push(x);
      });
      Object.keys(bySponsor).forEach(function (k) {
        var x = bySponsor[k];
        x.e.sort(function (a, b) { return a - b; });
        /* ts: the tier at each of e's editions, in e's order ('' where none was given) */
        x.ts = x.e.map(function (i) { return x.ts[i] || ''; });
        if (!x.ts.some(Boolean)) delete x.ts;
        doc.sponsors.push(x);
      });
      doc.speakers.sort(function (a, b) { return a.e[0] - b.e[0]; });
      doc.sponsors.sort(function (a, b) { return a.e[0] - b.e[0]; });
      /* a Firestore document holds 1 MiB: bios go first, then the oldest entries */
      if (Buffer.byteLength(JSON.stringify(doc)) > CAPS.docBytes) { doc.speakers.forEach(function (s) { s.b = ''; }); doc.partial = true; }
      while (Buffer.byteLength(JSON.stringify(doc)) > CAPS.docBytes && (doc.speakers.length || doc.sponsors.length)) {
        if (doc.speakers.length >= doc.sponsors.length) doc.speakers.pop(); else doc.sponsors.pop();
      }
      doc.counts.speakers = doc.speakers.length;
      doc.counts.sponsors = doc.sponsors.length;
      if (agendaOut) {
        /* AGENDA = { portal, builtAt, events: [{ i: index in the portal's events, id, s: [{ t: title, a: start, z: end,
           k: [the key of each speaker's entry] }] }] }, newest edition first; the oldest go first past 1 MiB */
        sessionsByEvent.sort(function (x, y) { return x.i - y.i; });
        var agenda = { portal: portal, builtAt: doc.builtAt, events: sessionsByEvent.map(function (x) { return { i: x.i, id: (doc.events[x.i] || {}).id || '', s: x.s }; }), bios: fullBios };
        /* past 1 MiB: the full bios go first (the entries keep their beginning), then the oldest editions' sessions */
        if (Buffer.byteLength(JSON.stringify(agenda)) > CAPS.docBytes) agenda.bios = {};
        while (agenda.events.length && Buffer.byteLength(JSON.stringify(agenda)) > CAPS.docBytes) agenda.events.pop();
        Object.keys(agenda).forEach(function (k) { agendaOut[k] = agenda[k]; });
      }
      return doc;
    });
  });
}

/* ---------- the stored copy ---------- */
var etCache = { db: null, at: 0, docs: null };
function forget() { etCache = { db: null, at: 0, docs: null }; ownCache = {}; }
function storedDocs(fb, fresh) {
  if (!fresh && etCache.db === fb.db && etCache.docs && Date.now() - etCache.at < CAPS.etMs) return Promise.resolve(etCache.docs);
  return fb.db.collection(COL).get().then(function (snap) {
    var docs = snap.docs.filter(function (d) { return d.id !== LOCK; }).map(function (d) { return d.data() || {}; });
    etCache = { db: fb.db, at: Date.now(), docs: docs };
    return docs;
  });
}
/* speakers and sponsors: people and sponsors, each once however many portals and spellings they have
   (lib/people-match.js); rows: what the portals hold between them */
function coverageOf(docs, now) {
  var portals = Object.keys(etEvents.PORTALS).length, built = docs.length, rows = 0, oldest = '';
  docs.forEach(function (d) { rows += ((d.counts && d.counts.speakers) || 0); if (!oldest || str(d.builtAt) < oldest) oldest = str(d.builtAt); });
  var speakers = etCatalog('speakers', docs).count, sponsors = etCatalog('sponsors', docs).count;
  var stale = built < portals || !oldest || (now || Date.now()) - Date.parse(oldest) > FRESH_MS;
  return { portals: portals, built: built, speakers: speakers, sponsors: sponsors, speakerRows: rows, builtAt: oldest || null, stale: stale };
}

/* POST /api/library/build: what is missing or a day old, the event's own portal first, within the time budget */
function build(fb, o) {
  o = o || {};
  var started = Date.now(), fetchJson = o.fetchJson || etJson, budget = o.budgetMs || BUDGET_MS;
  var lockRef = fb.db.collection(COL).doc(LOCK), peopleDue = false;
  return fb.db.runTransaction(function (tx) {
    return tx.get(lockRef).then(function (snap) {
      var until = snap.exists ? +(snap.data() || {}).until || 0 : 0;
      if (until > started) return false;
      peopleDue = snap.exists && (snap.data() || {}).peopleDue === true;
      tx.set(lockRef, { until: started + LOCK_MS, by: str(o.by).slice(0, 200), peopleDue: peopleDue });
      return true;
    });
  }).then(function (got) {
    if (!got) return storedDocs(fb, true).then(function (docs) { return { built: [], left: null, busy: true, coverage: coverageOf(docs) }; });
    return fb.db.collection(COL).select('builtAt').get().then(function (snap) {
      var at = {};
      snap.docs.forEach(function (d) { if (d.id !== LOCK) at[d.id] = Date.parse(str((d.data() || {}).builtAt)) || 0; });
      var todo = Object.keys(etEvents.PORTALS).filter(function (p) { return !at[p] || started - at[p] > FRESH_MS; })
        .sort(function (a, b) { return (a === o.first ? -1 : b === o.first ? 1 : 0) || (at[a] || 0) - (at[b] || 0); });
      var built = [];
      return inTurns(todo, PORTALS_AT_ONCE, function (portal) {
        var agenda = {};
        return buildPortal(portal, fetchJson, { agenda: agenda }).then(function (doc) {
          return fb.db.collection(COL).doc(portal).set(doc).then(function () {
            built.push(portal);
            return fb.db.collection(AGENDA_COL).doc(portal).set(agenda).then(null, function (err) { console.error('library: the sessions of ' + portal + ' could not be kept — ' + (err && err.message)); });
          });
        }, function (err) { console.error('library: ' + portal + ' could not be read from ET — ' + (err && err.message)); });
      }, function () { return Date.now() - started > budget - PEOPLE_MS; }).then(function () {
        /* the speaker and sponsor pages follow what was read (lib/people.js), while this build still holds the lock,
           in the time left; with too little left, the next build does it (peopleDue, kept on the lock) */
        var due = peopleDue || built.length > 0 || !!o.people;
        var room = Date.now() - started < budget || !!o.people;
        var pages = due && room ? storedDocs(fb, true).then(function () { return require('./people').reconcileAll(fb); }).then(function () { due = false; }, function (err) {
          console.error('library: the speaker and sponsor pages could not be kept in step — ' + (err && err.message));
        }) : Promise.resolve();
        return pages.then(function () { return lockRef.set({ until: 0, peopleDue: due }); }).then(null, function () {}).then(function () { return storedDocs(fb, true); }).then(function (docs) {
          if (built.length) console.log('library: ' + built.length + ' portals read from ET (' + built.join(', ') + ')');
          return { built: built, left: Math.max(0, todo.length - built.length), busy: false, coverage: coverageOf(docs) };
        });
      });
    });
  });
}

/* ---------- EventSphere's own records ---------- */
var ownCache = {};
function ownRecords(fb, kind, o) {
  var c = ownCache[kind];
  if (!(o && o.fresh) && c && c.db === fb.db && Date.now() - c.at < CAPS.ownMs) return Promise.resolve(c.list);
  var col = kind === 'sponsors' ? 'partners' : 'speakers';
  var fields = kind === 'sponsors' ? ['name', 'url', 'status', 'tierId'] : ['name', 'desig', 'comp', 'li', 'bio', 'status'];
  var q = fb.db.collectionGroup(col);
  return Promise.all([q.select.apply(q, fields).get(), fb.db.collection('events').select('name', 'portal', 'createdAt', 'createdBy', 'deletedAt', 'discardingAt', 'start', 'category').get()]).then(function (r) {
    var events = {};
    r[1].docs.forEach(function (d) { var v = d.data() || {}; if (v.createdAt && !v.deletedAt && !v.discardingAt && str(v.name).trim()) events[d.id] = Object.assign({ id: d.id }, v); });
    var list = [];
    r[0].docs.forEach(function (d) {
      var ev = d.ref.parent && d.ref.parent.parent, evId = ev && ev.id, v = d.data() || {};
      /* a test event is no one's record (a test server may count its own: PEOPLE_INCLUDE_QA=1, lib/people.js) */
      if (!evId || !events[evId] || !str(v.name).trim() || (/^qa-/.test(evId) && process.env.PEOPLE_INCLUDE_QA !== '1')) return;
      if (v.status && v.status !== 'confirmed') return;
      list.push({ eventId: evId, id: d.id, event: events[evId], v: v });
    });
    ownCache[kind] = { db: fb.db, at: Date.now(), list: list };
    return list;
  });
}

/* ---------- searching ---------- */
/* how well a name answers what was typed: every word typed begins a word of the name (any order); 0 when not */
function scoreOf(q, name) {
  var want = tokens(q), have = tokens(name);
  if (!want.length || !have.length) return 0;
  var all = want.every(function (w) { return have.some(function (h) { return h.indexOf(w) === 0; }); });
  if (!all) return 0;
  var score = 10;
  if (normal(q) === normal(name)) score += 100;
  want.forEach(function (w) { if (have.indexOf(w) !== -1) score += 10; });
  if (normal(name).indexOf(normal(q)) === 0) score += 5;
  return score;
}
/* ---------- one entry per person (lib/people-match.js) ----------
   ET's rows of every portal, and EventSphere's own records, as one list of rows: a person who spoke on four portals,
   or whose company was typed three ways, is one person — the newest row's details, blanks filled from older ones.

   ROW (speaker) = { src: 'et' | 'own', name, designation, company, photo, linkedin, bio, logo, at,
                     portal, doc, x (ET: the portal's entry)  |  eventId, recordId, event (own) }
   ROW (sponsor) = { src, name, logo, url, tier, at, … the same }
   at: the row's newest edition as 'YYYY-MM-DD' (or 'YYYY' where ET gave only a year). An own record is the team's
   word now: its event's start, else when the event was made. */
function etRows(kind, docs) {
  var rows = [];
  (docs || []).forEach(function (doc) {
    var list = kind === 'sponsors' ? doc.sponsors : doc.speakers;
    (list || []).forEach(function (x) {
      var ev = (doc.events || [])[(x.e || [])[0]] || {};
      var row = { src: 'et', portal: doc.portal, doc: doc, x: x, name: str(x.n), at: str(ev.start) || str(ev.year) };
      if (kind === 'sponsors') { row.logo = str(x.g); row.url = str(x.u); row.tier = str(x.t); }
      else { row.designation = str(x.d); row.company = str(x.c); row.photo = str(x.p); row.linkedin = str(x.l); row.bio = str(x.b); row.logo = str(x.g); }
      rows.push(row);
    });
  });
  return rows;
}
function ownRow(kind, r) {
  var v = r.v || {}, ev = r.event || {};
  var at = /^\d{4}-\d{2}-\d{2}/.test(str(ev.start)) ? str(ev.start).slice(0, 10) : /^\d{4}-\d{2}-\d{2}/.test(str(ev.createdAt)) ? str(ev.createdAt).slice(0, 10) : '';
  var row = { src: 'own', eventId: r.eventId, recordId: r.id, event: ev, name: str(v.name).trim(), at: at };
  if (kind === 'sponsors') { row.url = str(v.url); }
  else { row.designation = str(v.desig); row.company = str(v.comp); row.linkedin = str(v.li); row.bio = str(v.bio).slice(0, CAPS.bio); }
  return row;
}
/* ET's rows grouped once per stored copy (a few tens of milliseconds for every portal) */
var catalogCache = { docs: null, speakers: null, sponsors: null };
function etCatalog(kind, docs) {
  if (catalogCache.docs !== docs) catalogCache = { docs: docs, speakers: null, sponsors: null };
  if (!catalogCache[kind]) {
    var rows = etRows(kind, docs), byName = {};
    rows.forEach(function (r) {
      var k = kind === 'sponsors' ? PM.sponsorKey(r.name).replace(/ /g, '') : PM.nameKey(r.name);
      if (!k) return;
      (byName[k] || (byName[k] = [])).push(r);
    });
    var count = 0;
    if (kind === 'sponsors') count = PM.sponsorsOf(rows).length;
    else Object.keys(byName).forEach(function (k) { count += PM.groupPeople(byName[k]).length; });
    catalogCache[kind] = { byName: byName, names: Object.keys(byName), count: count };
  }
  return catalogCache[kind];
}
function fromOf(row) {
  if (row.src === 'own') {
    return { kind: 'event', label: (etEvents.PORTALS[row.event.portal] ? etEvents.PORTALS[row.event.portal] + ' · ' : '') + str(row.event.name).trim(), eventId: row.eventId, recordId: row.recordId };
  }
  var ev = (row.doc.events || [])[(row.x.e || [])[0]] || {};
  return { kind: 'et', label: str(row.doc.portalName) + (ev.title ? ' · ' + ev.title : '') + (ev.year && str(ev.title).indexOf(ev.year) === -1 ? ' ' + ev.year : ''), link: str(ev.link) };
}
/* one person's (or sponsor's) entry from their rows, newest first */
function itemOf(kind, rows) {
  var fields = kind === 'sponsors' ? ['name', 'logo', 'url', 'tier'] : ['name', 'designation', 'company', 'photo', 'linkedin', 'bio', 'logo'];
  var it = {};
  fields.forEach(function (f) {
    for (var i = 0; i < rows.length; i++) { if (str(rows[i][f])) { it[f] = str(rows[i][f]); break; } }
    if (!it[f]) it[f] = '';
  });
  /* the newest row's company and designation go together: an older row's company is not put under a new title */
  if (kind !== 'sponsors') { it.designation = str(rows[0].designation) || it.designation; it.company = str(rows[0].company) || it.company; }
  it.key = kind === 'sponsors' ? PM.sponsorKey(it.name) : PM.nameKey(it.name) + '|' + PM.companyForm(it.company).t.join(' ');
  it.from = rows.slice(0, 6).map(fromOf);
  return it;
}

/* -> [ITEM], best first. sources = { et: [DOC], own: [{ eventId, id, event, v }] }; o = { portal, access } */
function search(kind, q, sources, o) {
  o = o || {};
  q = str(q).slice(0, CAPS.query);
  if (tokens(q).length === 0 || normal(q).replace(/ /g, '').length < 2) return [];
  var cat = etCatalog(kind, sources.et || []);
  var keyOf = kind === 'sponsors' ? function (n) { return PM.sponsorKey(n).replace(/ /g, ''); } : PM.nameKey;
  /* the names that answer what was typed, with every row of each: ET's, and the own records the person may open */
  var hit = {}, order = [];
  function take(k, row, score) {
    if (!k) return;
    if (!hit[k]) { hit[k] = { rows: (cat.byName[k] || []).slice(), score: 0 }; order.push(k); }
    if (row) hit[k].rows.push(row);
    hit[k].score = Math.max(hit[k].score, score);
  }
  cat.names.forEach(function (k) {
    var rows = cat.byName[k], best = 0;
    rows.forEach(function (r) { var sc = scoreOf(q, r.name); if (sc && o.portal && r.portal === o.portal) sc += 4; if (sc > best) best = sc; });
    if (best) take(k, null, best);
  });
  (sources.own || []).forEach(function (r) {
    if (o.access && !AC.eventOk(o.access, r.event)) return;
    var row = ownRow(kind, r);
    if (!row.name) return;
    var sc = scoreOf(q, row.name);
    var k = keyOf(row.name);
    /* the team's own record joins its person even when the name typed matched them through ET's spelling only */
    if (sc) take(k, row, sc + 3);
    else if (hit[k]) hit[k].rows.push(row);
  });
  var items = [];
  order.forEach(function (k) {
    var h = hit[k];
    var groups = kind === 'sponsors' ? PM.sponsorsOf(h.rows) : PM.groupPeople(h.rows);
    groups.forEach(function (rows) {
      var mine = rows.some(function (r) { return r.src === 'own'; });
      var portalBonus = o.portal && rows.some(function (r) { return r.portal === o.portal; }) ? 4 : 0;
      var best = 0;
      rows.forEach(function (r) { var sc = scoreOf(q, r.name); if (sc > best) best = sc; });
      if (!best) return;
      var it = itemOf(kind, rows);
      it.score = best + (mine ? 3 : 0) + portalBonus;
      items.push(it);
    });
  });
  return items.sort(function (a, b) { return b.score - a.score; }).slice(0, CAPS.results).map(function (it) { delete it.score; return it; });
}

/* a photo or logo kept inside an EventSphere record, for the few results shown (a small picture only) */
function withOwnPictures(fb, kind, items) {
  var want = [];
  items.forEach(function (it) {
    if (kind === 'sponsors' ? it.logo : it.photo) return;
    var own = it.from.filter(function (f) { return f.kind === 'event'; })[0];
    if (own) want.push({ it: it, ref: fb.db.collection('events').doc(own.eventId).collection(kind === 'sponsors' ? 'partners' : 'speakers').doc(own.recordId) });
  });
  if (!want.length || typeof fb.db.getAll !== 'function') return Promise.resolve(items);
  return fb.db.getAll.apply(fb.db, want.map(function (w) { return w.ref; })).then(function (snaps) {
    snaps.forEach(function (snap, i) {
      var v = snap && snap.exists ? snap.data() || {} : {}, pic = str(kind === 'sponsors' ? v.logoUrl : v.photoUrl);
      if (pic && pic.length <= CAPS.inlinePhoto) want[i].it[kind === 'sponsors' ? 'logo' : 'photo'] = pic;
    });
    return items;
  }, function () { return items; });
}

/* ---------- routes ---------- */
function handleSearch(kind) {
  return function (req, res) {
    H.requireAdmin(req, res, function (fb, decoded) {
      var qs = new URLSearchParams(String(req.url || '').split('?')[1] || '');
      var q = str(qs.get('q')).trim().slice(0, CAPS.query), eventId = str(qs.get('eventId')).trim();
      var evRead = H.isEventId(eventId) ? fb.db.collection('events').doc(eventId).get().then(function (s) { return s.exists ? (s.data() || {}).portal || '' : ''; }, function () { return ''; }) : Promise.resolve('');
      Promise.all([storedDocs(fb), ownRecords(fb, kind).then(null, function (err) { console.error('library: own ' + kind + ' — ' + (err && err.message)); return []; }), evRead]).then(function (r) {
        var items = search(kind, q, { et: r[0], own: r[1] }, { portal: r[2], access: decoded.access });
        return withOwnPictures(fb, kind, items).then(function (out) {
          out.forEach(function (it) { it.from.forEach(function (f) { delete f.recordId; }); });
          H.sendJson(res, 200, { items: out, coverage: coverageOf(r[0]) });
        });
      }).catch(function (err) {
        console.error('library: search failed — ' + (err && err.stack || err));
        H.sendJson(res, 500, { error: 'The library could not be searched just now. Please try again.' });
      });
    });
  };
}
function handleBuild(req, res) {
  H.requireAdmin(req, res, function (fb, decoded) {
    H.parseJsonBody(req, res, function (body) {
      var eventId = str(body.eventId).trim();
      var portalRead = H.isEventId(eventId) ? fb.db.collection('events').doc(eventId).get().then(function (s) { return s.exists ? (s.data() || {}).portal || '' : ''; }, function () { return ''; }) : Promise.resolve('');
      portalRead.then(function (first) { return build(fb, { first: first, by: decoded.access && decoded.access.email }); }).then(function (out) {
        H.sendJson(res, 200, out);
      }).catch(function (err) {
        console.error('library: build failed — ' + (err && err.stack || err));
        H.sendJson(res, 500, { error: 'ETB2B’s records could not be read just now. The library keeps what it has.' });
      });
    }, 16 * 1024);
  });
}

module.exports = {
  handleSpeakers: handleSearch('speakers'), handleSponsors: handleSearch('sponsors'), handleBuild: handleBuild,
  /* for lib/people.js: the same rows and the same stored copy */
  storedDocs: storedDocs, ownRecords: ownRecords, etRows: etRows, ownRow: ownRow, AGENDA_COL: AGENDA_COL, COL: COL,
  _test: { normal: normal, tokens: tokens, scoreOf: scoreOf, search: search, buildPortal: buildPortal, build: build, coverageOf: coverageOf, forget: forget,
    ownRecords: ownRecords, storedDocs: storedDocs, CAPS: CAPS, COL: COL }
};
