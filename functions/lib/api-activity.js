// The activity log across ALL events — the "Activity log" page reached from the events listing.
//
//   GET /api/activity/all   admin
//     ?event=<eventId>     one event only
//     &user=<email|platform>  one person (or the platform's own changes) only
//     &area=<area>         site | content | forms | design | publishing | registrations | promotions | settings | event
//     &from=<ISO>&to=<ISO> at >= from, at < to (the page sends whole IST days)
//     &cursor=<path>       the `next` of the previous answer: the page after it
//     &limit=<1..100>      default 50
//   -> { items: [{ id, eventId, eventName, eventDeleted, at, by, byLabel, action, area, detail, version?, fields? }],
//        next: <cursor> | null, scanned }
//
// WHERE IT READS. Every event's history is events/<id>/activity/<entry> (lib/activity.js writes it). All of
// them at once is a collection-group query on 'activity', newest first; one event is that event's own
// collection. Firestore filters on `by` and on the date range; `area` is worked out per entry (older entries
// have no area field, so it comes from the action) and is filtered here, over a bounded scan.
//
// INDEXES (firestore.indexes.json has them; the commands for the owner are in the commit message):
//   - 'at' descending with COLLECTION_GROUP scope (a single-field override) — the plain all-events list and
//     the date range;
//   - by ASC + at DESC, COLLECTION_GROUP — one person across all events; and COLLECTION — one person in one
//     event.
// Until an index exists or while it is building, Firestore refuses the query (FAILED_PRECONDITION); the page
// is told so in plain words (code 'index-building' / 'index-missing'), never a raw error.
//
// WHO SEES WHAT. mayView() is the one rule. Today every signed-in company account may open every event in
// the events listing (live or deleted; GET /api/events), so the log shows exactly those events' entries.
// Entries of anything else — a half-created event, an event being removed for good, an import record, a
// collection called 'activity' somewhere that is not an event's — are never sent.
//
// PRIVACY. A registrant's email address is never shown in full: any address outside the company domain in
// an entry's detail or before/after values is masked (r***@example.com). A changed value whose name looks
// like a secret (password, token, key, secret) is never sent at all.
'use strict';
const { sendJson, requireAdmin, str } = require('./http');
const { ALLOWED_DOMAIN } = require('./access');

var DEFAULT_LIMIT = 50, MAX_LIMIT = 100;
var BATCH = 100;          // documents read per Firestore round trip while filtering in memory
var MAX_SCAN = 600;       // documents read for one answer at most; the rest is the next page
var EVENTS_LIMIT = 1000;  // the same ceiling as GET /api/events
var EVENTS_TTL_MS = 30000;

var AREAS = ['site', 'content', 'forms', 'design', 'publishing', 'registrations', 'promotions', 'settings', 'event'];

/* the area an entry belongs to: its own 'area' when it has one (entries written from now on), else from the
   action (every entry written before) */
var ACTION_AREA = {
  'created': 'event', 'deleted': 'event', 'restored': 'event', 'cloned': 'event',
  'updated': 'settings', 'status-changed': 'settings', 'settings-changed': 'settings',
  'site-saved': 'site',
  'approval-requested': 'publishing', 'approved': 'publishing', 'rejected': 'publishing',
  'published': 'publishing', 'unpublished': 'publishing',
  'content-seeded': 'content', 'content-added': 'content', 'content-changed': 'content', 'content-removed': 'content',
  'registration-updated': 'registrations', 'registration-deleted': 'registrations',
  'registration-approved': 'registrations', 'registration-declined': 'registrations',
  'leads-imported': 'registrations', 'leads-deleted': 'registrations',
  'form-created': 'forms', 'form-updated': 'forms', 'form-deleted': 'forms', 'form-default': 'forms', 'forms-ordered': 'forms'
};
function areaOf(entry) {
  var a = entry && typeof entry.area === 'string' ? entry.area : '';
  if (AREAS.indexOf(a) !== -1) return a;
  var action = String((entry && entry.action) || '');
  if (ACTION_AREA[action]) return ACTION_AREA[action];
  if (/^(form|forms)-/.test(action)) return 'forms';
  if (/^(registration|registrations|leads)-/.test(action)) return 'registrations';
  if (/^content-/.test(action)) return 'content';
  if (/^(promo|promotion)/.test(action)) return 'promotions';
  if (/^(theme|logo|design|hero|look|font|colou?r)/.test(action)) return 'design';
  if (/^(site|section|page)/.test(action)) return 'site';
  if (/^(publish|unpublish|approv|reject)/.test(action)) return 'publishing';
  if (/^settings?/.test(action)) return 'settings';
  return 'event';
}

function byLabel(by) {
  var b = String(by || '');
  if (!b || b === 'platform' || b === 'system') return 'Platform (automated)';
  return b;
}

/* ---------- privacy ---------- */
var EMAIL_IN_TEXT = /([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;
function maskEmails(text) {
  return String(text == null ? '' : text).replace(EMAIL_IN_TEXT, function (all, first, domain) {
    return domain.toLowerCase() === ALLOWED_DOMAIN ? all : first + '***@' + domain;
  });
}
var SECRET_NAME = /pass(word)?|secret|token|api[-_ ]?key|private[-_ ]?key|credential/i;
function cleanValue(v) {
  if (v == null) return '';
  if (typeof v === 'object') { try { v = JSON.stringify(v); } catch (e) { v = ''; } }
  return maskEmails(String(v)).slice(0, 300);
}
function cleanFields(fields) {
  if (!Array.isArray(fields)) return undefined;
  var out = [];
  fields.slice(0, 30).forEach(function (f) {
    if (!f || typeof f !== 'object') return;
    var name = String(f.field || f.name || f.label || '').slice(0, 120);
    if (SECRET_NAME.test(name)) return;
    out.push({ field: maskEmails(name), before: cleanValue(f.before), after: cleanValue(f.after) });
  });
  return out.length ? out : undefined;
}

/* ---------- which events ---------- */
/* d: an event document's data. The one rule for whose history this log may show (see the header). `user`
   is the signed-in account; it is part of the signature so a per-person rule has one place to go. */
function mayView(user, d) {
  void user;
  if (!d || typeof d.name !== 'string' || !d.name.trim()) return false;
  if (!d.createdAt || d.discardingAt) return false;
  return true;
}

var eventsCache = { at: 0, fb: null, map: null };
/* Resolves { <eventId>: { name, deleted, data } } for every event document (name and state only). Kept for
   30 s, so paging through the log does not re-read the events list on every page. */
function loadEvents(fb, now) {
  now = now || Date.now();
  if (eventsCache.map && eventsCache.fb === fb && now - eventsCache.at < EVENTS_TTL_MS) return Promise.resolve(eventsCache.map);
  var q = fb.db.collection('events');
  return q.select('name', 'createdAt', 'deletedAt', 'discardingAt').limit(EVENTS_LIMIT).get().then(function (snap) {
    var map = {};
    snap.docs.forEach(function (d) {
      if (d.id.indexOf('import-') === 0) return;
      var data = d.data() || {};
      map[d.id] = { name: String(data.name || '').trim(), deleted: !!data.deletedAt, data: data };
    });
    eventsCache = { at: now, fb: fb, map: map };
    return map;
  });
}
function resetEventsCache() { eventsCache = { at: 0, fb: null, map: null }; }

/* the event an activity document belongs to, or '' when it is not events/<id>/activity/<x> */
function eventIdOfDoc(doc) {
  var col = doc && doc.ref && doc.ref.parent;
  var ev = col && col.parent;
  if (!col || col.id !== 'activity' || !ev || !ev.parent || ev.parent.id !== 'events') return '';
  if (ev.parent.parent) return '';   // a nested "events" collection, not the top-level one
  return ev.id;
}
var CURSOR_RE = /^events\/([a-z0-9][a-z0-9-]{0,79})\/activity\/([A-Za-z0-9_-]{1,128})$/;

/* ---------- the request ---------- */
function isoOrNull(v) {
  v = str(v, 40);
  if (!v) return null;
  var t = Date.parse(v);
  return isNaN(t) ? undefined : new Date(t).toISOString();
}
function bad(msg) { var e = new Error(msg); e.status = 400; e.expose = true; return e; }

/* qs: URLSearchParams -> the filters, or throws a 400 */
function parseParams(qs) {
  var p = {
    eventId: str(qs.get('event'), 100),
    user: str(qs.get('user'), 200),
    area: str(qs.get('area'), 40).toLowerCase(),
    cursor: str(qs.get('cursor'), 300),
    limit: parseInt(qs.get('limit'), 10)
  };
  if (p.eventId && !/^[a-z0-9][a-z0-9-]{0,79}$/.test(p.eventId)) throw bad('That is not an event this log knows.');
  if (p.area && AREAS.indexOf(p.area) === -1) throw bad('Unknown area "' + p.area + '".');
  if (p.user && p.user !== 'platform' && !/^[^\s@]+@[^\s@]+$/.test(p.user)) throw bad('Choose a person by their email address.');
  if (p.cursor && !CURSOR_RE.test(p.cursor)) throw bad('This page of the log can no longer be continued. Please reload.');
  p.from = isoOrNull(qs.get('from'));
  p.to = isoOrNull(qs.get('to'));
  if (p.from === undefined || p.to === undefined) throw bad('Choose the dates again: one of them is not a date.');
  if (p.from && p.to && p.from >= p.to) throw bad('The "from" date must be before the "to" date.');
  p.limit = isNaN(p.limit) ? DEFAULT_LIMIT : Math.max(1, Math.min(MAX_LIMIT, p.limit));
  return p;
}

function baseQuery(fb, p) {
  var q = p.eventId ? fb.db.collection('events').doc(p.eventId).collection('activity') : fb.db.collectionGroup('activity');
  if (p.user) q = q.where('by', '==', p.user);
  if (p.from) q = q.where('at', '>=', p.from);
  if (p.to) q = q.where('at', '<', p.to);
  return q.orderBy('at', 'desc');
}

function itemOf(doc, eventId, ev) {
  var a = doc.data() || {};
  var item = {
    id: doc.id, eventId: eventId, eventName: ev.name, eventDeleted: ev.deleted,
    at: typeof a.at === 'string' ? a.at : null, by: String(a.by || ''), byLabel: byLabel(a.by),
    action: String(a.action || ''), area: areaOf(a), detail: maskEmails(String(a.detail || '').slice(0, 300))
  };
  if (a.version != null && a.version !== '') item.version = a.version;
  var fields = cleanFields(a.fields);
  if (fields) item.fields = fields;
  return item;
}

/* The one answer: { items, next, scanned }. user: the decoded ID token. Rejects with err.status/err.expose
   for anything the person should read. */
function listAll(fb, user, p) {
  return loadEvents(fb).then(function (events) {
    if (p.eventId && !(events[p.eventId] && mayView(user, events[p.eventId].data))) {
      var e = new Error('No event found for "' + p.eventId + '".'); e.status = 404; e.expose = true; throw e;
    }
    var start = Promise.resolve(null);
    if (p.cursor) {
      var m = CURSOR_RE.exec(p.cursor);
      if (p.eventId && m[1] !== p.eventId) throw bad('This page of the log can no longer be continued. Please reload.');
      start = fb.db.doc(p.cursor).get().then(function (snap) {
        if (!snap.exists) throw bad('The log changed while you were reading it. Please reload.');
        return snap;
      });
    }
    return start.then(function (after) {
      var items = [], scanned = 0, last = after;
      function round() {
        var q = baseQuery(fb, p);
        if (last) q = q.startAfter(last);
        return q.limit(BATCH).get().then(function (snap) {
          var docs = snap.docs;
          for (var i = 0; i < docs.length; i++) {
            var d = docs[i];
            scanned++;
            last = d;
            var eventId = eventIdOfDoc(d);
            var ev = eventId && events[eventId];
            if (ev && mayView(user, ev.data)) {
              var item = itemOf(d, eventId, ev);
              if (!p.area || item.area === p.area) items.push(item);
            }
            if (items.length >= p.limit) {
              /* full: more may follow (the rest of this batch, or the next) */
              return { items: items, next: (i < docs.length - 1 || docs.length === BATCH) ? d.ref.path : null, scanned: scanned };
            }
          }
          if (docs.length < BATCH) return { items: items, next: null, scanned: scanned };
          if (scanned >= MAX_SCAN) return { items: items, next: last.ref.path, scanned: scanned };
          return round();
        });
      }
      return round();
    });
  });
}

/* Firestore's "needs an index" refusal, in words the owner can act on */
function indexProblem(err) {
  var msg = String((err && (err.details || err.message)) || '');
  if (!(err && (err.code === 9 || err.code === 'failed-precondition' || /FAILED_PRECONDITION/.test(msg)))) return null;
  if (!/index/i.test(msg)) return null;
  var building = /currently building|is building|not ready/i.test(msg);
  return {
    code: building ? 'index-building' : 'index-missing',
    error: building
      ? 'The activity log is still being set up (its database index is building). This usually takes a few minutes — please try again shortly.'
      : 'The activity log needs a database index that has not been created yet. Please ask the administrator to create the activity-log indexes (see firestore.indexes.json).'
  };
}

function handleActivityAll(req, res) {
  requireAdmin(req, res, function (fb, user) {
    var p;
    try { p = parseParams(new URLSearchParams(String(req.url || '').split('?')[1] || '')); }
    catch (err) { return sendJson(res, err.status || 400, { error: err.message }); }
    listAll(fb, user, p).then(function (out) { sendJson(res, 200, out); }, function (err) {
      if (err && err.expose) return sendJson(res, err.status, { error: err.message });
      var ix = indexProblem(err);
      if (ix) { console.error('activity log: ' + ix.code + ' — ' + ((err && err.message) || err)); return sendJson(res, 503, ix); }
      console.error('activity log: could not load — ' + ((err && err.stack) || err));
      sendJson(res, 500, { error: 'We could not load the activity log just now. Please try again.' });
    });
  });
}

module.exports = {
  handleActivityAll,
  /* for the tests */
  listAll, parseParams, areaOf, byLabel, maskEmails, cleanFields, mayView, indexProblem, eventIdOfDoc, resetEventsCache,
  AREAS, ACTION_AREA
};
