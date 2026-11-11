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
   on. The console asks for it, in the background, when a person opens Speakers or Sponsors.

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

var COL = 'etLibrary', LOCK = '_lock';
var FRESH_MS = 24 * 3600 * 1000;
var LOCK_MS = 90 * 1000;
var BUDGET_MS = 40 * 1000;
var PORTALS_AT_ONCE = 3, EVENTS_AT_ONCE = 4;
var CAPS = { eventsPerPortal: 60, bio: 400, results: 12, query: 80, docBytes: 900 * 1024, ownMs: 2 * 60 * 1000, etMs: 10 * 60 * 1000,
  inlinePhoto: 160 * 1024 };

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
function buildPortal(portal, fetchJson, o) {
  o = o || {};
  var now = o.now || Date.now();
  return etEvents.listIpEvents(portal, fetchJson).then(function (events) {
    /* ET writes a start as "2025-11-20T09:30:00" (or nothing): taken place, newest first */
    var past = (events || []).filter(function (e) { return e && e.past && !e.upcoming && (!e.start || !(Date.parse(e.start) > now)); })
      .sort(function (a, b) { return str(b.start) < str(a.start) ? -1 : str(b.start) > str(a.start) ? 1 : 0; }).slice(0, CAPS.eventsPerPortal);
    var doc = { portal: portal, portalName: etEvents.PORTALS[portal] || portal, builtAt: new Date(now).toISOString(),
      events: past.map(function (e) { return { id: e.id, title: str(e.title).slice(0, 200), year: /^\d{4}/.test(str(e.start)) ? str(e.start).slice(0, 4) : '', link: str(e.link) }; }),
      speakers: [], sponsors: [], counts: { events: past.length, speakers: 0, sponsors: 0 }, partial: false };
    var byPerson = {}, bySponsor = {};
    return inTurns(past, EVENTS_AT_ONCE, function (e, idx) {
      var lists = [e.speakers > 0 ? etPrevious.allItems(fetchJson, '/v1/activity/speaker/list', e.id, portal) : Promise.resolve([]),
        etPrevious.allItems(fetchJson, '/v1/activity/sponsor/list', e.id, portal)];
      return Promise.all(lists).then(function (r) {
        /* newest edition first, so the first seen of a person is their latest designation and photo */
        r[0].forEach(function (raw) {
          var s = etPrevious.speakerOf(raw);
          if (!s) return;
          var key = normal(s.name) + '|' + normal(s.company);
          var have = byPerson[key];
          if (!have) {
            byPerson[key] = { n: s.name, d: s.designation, c: s.company, p: s.photo, l: s.linkedin, b: s.bio.slice(0, CAPS.bio), g: s.logo, e: [idx] };
          } else {
            if (have.e.indexOf(idx) === -1) have.e.push(idx);
            if (!have.p) have.p = s.photo;
            if (!have.l) have.l = s.linkedin;
            if (!have.b) have.b = s.bio.slice(0, CAPS.bio);
            if (!have.g) have.g = s.logo;
          }
        });
        r[1].forEach(function (raw) {
          var s = etPrevious.sponsorOf(raw);
          if (!s) return;
          var key = normal(s.name), have = bySponsor[key];
          if (!have) bySponsor[key] = { n: s.name, g: s.logo, u: s.url, t: s.tier, e: [idx] };
          else { if (have.e.indexOf(idx) === -1) have.e.push(idx); if (!have.u) have.u = s.url; if (!have.t) have.t = s.tier; }
        });
      });
    }).then(function () {
      /* events were read side by side: each entry's events newest first again */
      Object.keys(byPerson).forEach(function (k) { byPerson[k].e.sort(function (a, b) { return a - b; }); doc.speakers.push(byPerson[k]); });
      Object.keys(bySponsor).forEach(function (k) { bySponsor[k].e.sort(function (a, b) { return a - b; }); doc.sponsors.push(bySponsor[k]); });
      doc.speakers.sort(function (a, b) { return a.e[0] - b.e[0]; });
      doc.sponsors.sort(function (a, b) { return a.e[0] - b.e[0]; });
      /* a Firestore document holds 1 MiB: bios go first, then the oldest entries */
      if (Buffer.byteLength(JSON.stringify(doc)) > CAPS.docBytes) { doc.speakers.forEach(function (s) { s.b = ''; }); doc.partial = true; }
      while (Buffer.byteLength(JSON.stringify(doc)) > CAPS.docBytes && (doc.speakers.length || doc.sponsors.length)) {
        if (doc.speakers.length >= doc.sponsors.length) doc.speakers.pop(); else doc.sponsors.pop();
      }
      doc.counts.speakers = doc.speakers.length;
      doc.counts.sponsors = doc.sponsors.length;
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
function coverageOf(docs, now) {
  var portals = Object.keys(etEvents.PORTALS).length, built = docs.length, speakers = 0, sponsors = 0, oldest = '';
  docs.forEach(function (d) { speakers += (d.counts && d.counts.speakers) || 0; sponsors += (d.counts && d.counts.sponsors) || 0; if (!oldest || str(d.builtAt) < oldest) oldest = str(d.builtAt); });
  var stale = built < portals || !oldest || (now || Date.now()) - Date.parse(oldest) > FRESH_MS;
  return { portals: portals, built: built, speakers: speakers, sponsors: sponsors, builtAt: oldest || null, stale: stale };
}

/* POST /api/library/build: what is missing or a day old, the event's own portal first, within the time budget */
function build(fb, o) {
  o = o || {};
  var started = Date.now(), fetchJson = o.fetchJson || etJson, budget = o.budgetMs || BUDGET_MS;
  var lockRef = fb.db.collection(COL).doc(LOCK);
  return fb.db.runTransaction(function (tx) {
    return tx.get(lockRef).then(function (snap) {
      var until = snap.exists ? +(snap.data() || {}).until || 0 : 0;
      if (until > started) return false;
      tx.set(lockRef, { until: started + LOCK_MS, by: str(o.by).slice(0, 200) });
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
        return buildPortal(portal, fetchJson).then(function (doc) {
          return fb.db.collection(COL).doc(portal).set(doc).then(function () { built.push(portal); });
        }, function (err) { console.error('library: ' + portal + ' could not be read from ET — ' + (err && err.message)); });
      }, function () { return Date.now() - started > budget; }).then(function () {
        return lockRef.set({ until: 0 }).then(null, function () {}).then(function () { return storedDocs(fb, true); }).then(function (docs) {
          if (built.length) console.log('library: ' + built.length + ' portals read from ET (' + built.join(', ') + ')');
          return { built: built, left: Math.max(0, todo.length - built.length), busy: false, coverage: coverageOf(docs) };
        });
      });
    });
  });
}

/* ---------- EventSphere's own records ---------- */
var ownCache = {};
function ownRecords(fb, kind) {
  var c = ownCache[kind];
  if (c && c.db === fb.db && Date.now() - c.at < CAPS.ownMs) return Promise.resolve(c.list);
  var col = kind === 'sponsors' ? 'partners' : 'speakers';
  var fields = kind === 'sponsors' ? ['name', 'url', 'status', 'tierId'] : ['name', 'desig', 'comp', 'li', 'bio', 'status'];
  var q = fb.db.collectionGroup(col);
  return Promise.all([q.select.apply(q, fields).get(), fb.db.collection('events').select('name', 'portal', 'createdAt', 'createdBy', 'deletedAt', 'discardingAt', 'start').get()]).then(function (r) {
    var events = {};
    r[1].docs.forEach(function (d) { var v = d.data() || {}; if (v.createdAt && !v.deletedAt && !v.discardingAt && str(v.name).trim()) events[d.id] = Object.assign({ id: d.id }, v); });
    var list = [];
    r[0].docs.forEach(function (d) {
      var ev = d.ref.parent && d.ref.parent.parent, evId = ev && ev.id, v = d.data() || {};
      if (!evId || !events[evId] || !str(v.name).trim() || /^qa-/.test(evId)) return;
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
/* -> [ITEM], best first. sources = { et: [DOC], own: [{ eventId, id, event, v }] }; o = { portal, access } */
function search(kind, q, sources, o) {
  o = o || {};
  q = str(q).slice(0, CAPS.query);
  if (tokens(q).length === 0 || normal(q).replace(/ /g, '').length < 2) return [];
  var found = {}, order = [];
  function add(key, item, score, from) {
    var have = found[key];
    if (!have) { found[key] = Object.assign({ key: key, score: score, from: [] }, item); order.push(key); have = found[key]; }
    else {
      have.score = Math.max(have.score, score);
      Object.keys(item).forEach(function (k) { if (!have[k] && item[k]) have[k] = item[k]; });
    }
    if (from && have.from.length < 6) have.from.push(from);
  }
  /* EventSphere's own first: the team's latest word on a person */
  (sources.own || []).forEach(function (r) {
    if (o.access && !AC.eventOk(o.access, r.event)) return;
    var v = r.v, s = scoreOf(q, v.name);
    if (!s) return;
    var label = (etEvents.PORTALS[r.event.portal] ? etEvents.PORTALS[r.event.portal] + ' · ' : '') + str(r.event.name).trim();
    var from = { kind: 'event', label: label, eventId: r.eventId, recordId: r.id };
    if (kind === 'sponsors') add(normal(v.name), { name: str(v.name).trim(), url: str(v.url) }, s + 3, from);
    else add(normal(v.name) + '|' + normal(v.comp), { name: str(v.name).trim(), designation: str(v.desig), company: str(v.comp), linkedin: str(v.li), bio: str(v.bio).slice(0, CAPS.bio) }, s + 3, from);
  });
  (sources.et || []).forEach(function (doc) {
    var list = kind === 'sponsors' ? doc.sponsors : doc.speakers;
    (list || []).forEach(function (x) {
      var s = scoreOf(q, x.n);
      if (!s) return;
      if (o.portal && doc.portal === o.portal) s += 4;
      var ev = (doc.events || [])[(x.e || [])[0]] || {};
      var from = { kind: 'et', label: str(doc.portalName) + (ev.title ? ' · ' + ev.title : '') + (ev.year && str(ev.title).indexOf(ev.year) === -1 ? ' ' + ev.year : ''), link: str(ev.link) };
      if (kind === 'sponsors') add(normal(x.n), { name: x.n, logo: x.g, url: x.u, tier: x.t }, s, from);
      else add(normal(x.n) + '|' + normal(x.c), { name: x.n, designation: x.d, company: x.c, photo: x.p, linkedin: x.l, bio: x.b, logo: x.g }, s, from);
    });
  });
  return order.map(function (k) { return found[k]; }).sort(function (a, b) { return b.score - a.score; }).slice(0, CAPS.results)
    .map(function (it) { delete it.score; return it; });
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
        H.sendJson(res, 500, { error: 'ET’s records could not be read just now. The library keeps what it has.' });
      });
    }, 16 * 1024);
  });
}

module.exports = {
  handleSpeakers: handleSearch('speakers'), handleSponsors: handleSearch('sponsors'), handleBuild: handleBuild,
  _test: { normal: normal, tokens: tokens, scoreOf: scoreOf, search: search, buildPortal: buildPortal, build: build, coverageOf: coverageOf, forget: forget,
    ownRecords: ownRecords, storedDocs: storedDocs, CAPS: CAPS, COL: COL }
};
