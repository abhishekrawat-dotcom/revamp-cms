// Reading an event's activity log (events/<id>/activity) a page at a time, with filters — for the console's
// "Activity log" (GET /api/event/history) and GET /api/event/activity.
//
// Only `at` is ordered or ranged in Firestore (the single-field index every collection has), so no new
// index is needed. The person, area, action and free-text filters are applied while reading, a batch at a
// time, until a page is full or SCAN_CAP entries have been looked at; the answer's `next` cursor then lets
// the next page carry on exactly where this one stopped.
//
// Entries keep the shape { at, by, action, detail, area?, version?, changeId?, approvalId?, requestedBy?,
// fields? }. `area` is written on newer entries; older ones get theirs from the action (areaOf()).
'use strict';

const AREAS = ['site', 'content', 'forms', 'design', 'publishing', 'registrations', 'promotions', 'settings', 'event'];

/* the area of an action that was recorded before entries carried their own. ONE table for the whole log:
   lib/activity.js's AREA_OF (the writer's), plus two registration actions older entries may still carry */
const ACTION_AREA = Object.assign({ 'registration-approved': 'registrations', 'registration-declined': 'registrations' },
  require('./activity').AREA_OF);

function areaOf(entry) {
  var a = entry && entry.area;
  if (typeof a === 'string' && AREAS.indexOf(a) !== -1) return a;
  var action = String((entry && entry.action) || '');
  if (ACTION_AREA[action]) return ACTION_AREA[action];
  /* actions added later follow the same naming: "<thing>-<verb>" */
  var head = action.split('-')[0];
  if (/^(theme|design|look|logo|font|colou?r)/.test(head)) return 'design';
  if (/^(promo|promotion|campaign|banner)/.test(head)) return 'promotions';
  if (/^(form)/.test(head)) return 'forms';
  if (/^(content|speaker|agenda|sponsor|faq|gallery|contact)/.test(head)) return 'content';
  if (/^(registration|lead|attendee)/.test(head)) return 'registrations';
  if (/^(site|section|hero|picture|chat)/.test(head)) return 'site';
  if (/^(publish|approval)/.test(head)) return 'publishing';
  return 'event';
}

const PAGE_DEFAULT = 50, PAGE_MAX = 200, BATCH = 200, SCAN_CAP = 2000, PEOPLE_CAP = 3000;
const EMAIL_RE = /([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;

function isoOrNull(v) {
  v = String(v == null ? '' : v).trim();
  if (!v) return null;
  var d = new Date(v);
  return isNaN(d) ? null : d.toISOString();
}

/* URLSearchParams (or anything with get()) -> the options queryPage() takes. `legacyLimit` is the size of
   the one page a caller that sends no paging parameters has always been given. */
function parseQuery(qs, legacyLimit) {
  function g(k) { var v = qs && qs.get ? qs.get(k) : null; return v == null ? '' : String(v); }
  var paged = ['limit', 'before', 'from', 'to', 'by', 'area', 'action', 'q'].some(function (k) { return g(k) !== ''; });
  var limit = parseInt(g('limit'), 10);
  if (!(limit > 0)) limit = paged ? PAGE_DEFAULT : (legacyLimit || PAGE_DEFAULT);
  limit = Math.min(limit, paged ? PAGE_MAX : Math.max(PAGE_MAX, legacyLimit || 0));
  /* the cursor is "<at>|<id>" (what `next` answers) or, for a hand-made one, just "<at>" */
  var before = g('before').slice(0, 200), cursor = null;
  if (before) {
    var bar = before.lastIndexOf('|');
    var at = isoOrNull(bar === -1 ? before : before.slice(0, bar));
    if (at) cursor = { at: at, id: bar === -1 ? '' : before.slice(bar + 1).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) };
  }
  var area = g('area').trim().toLowerCase();
  return {
    limit: limit,
    before: cursor,
    from: isoOrNull(g('from')),
    to: isoOrNull(g('to')),
    by: g('by').trim().toLowerCase().slice(0, 200),
    area: AREAS.indexOf(area) !== -1 ? area : '',
    action: g('action').trim().slice(0, 60),
    q: g('q').trim().toLowerCase().slice(0, 200),
    firstPage: !cursor
  };
}

function textOf(e) {
  var parts = [e.detail, e.by, e.action, e.area, e.version != null ? 'version ' + e.version : ''];
  (Array.isArray(e.fields) ? e.fields : []).forEach(function (f) { if (f) parts.push(f.field, f.before, f.after); });
  return parts.map(function (p) { return p == null ? '' : String(p); }).join(' \n ').toLowerCase();
}

function matches(e, opts) {
  if (opts.by && String(e.by || '').toLowerCase() !== opts.by) return false;
  if (opts.area && e.area !== opts.area) return false;
  if (opts.action && e.action !== opts.action) return false;
  if (opts.q && textOf(e).indexOf(opts.q) === -1) return false;
  return true;
}

/* A registrant's address is never shown in full, whatever the entry: "a…@example.com". Company addresses
   (staff, who make the changes) are shown as they are — that is the point of the log. A changed value whose
   name looks like a secret is never sent. The same rule as GET /api/activity/all (lib/api-activity.js). */
const STAFF_DOMAIN = require('./access').ALLOWED_DOMAIN;
const SECRET_NAME = /pass(word)?|secret|token|api[-_ ]?key|private[-_ ]?key|credential/i;
function maskEmails(s) {
  if (typeof s !== 'string') return s;
  return s.replace(EMAIL_RE, function (m, first, domain) { return domain.toLowerCase() === STAFF_DOMAIN ? m : first + '…@' + domain; });
}
function privacy(e) {
  e.detail = maskEmails(e.detail);
  if (Array.isArray(e.fields)) e.fields = e.fields.filter(function (f) {
    return !(f && typeof f === 'object' && SECRET_NAME.test(String(f.field || f.name || '')));
  }).map(function (f) {
    return f && typeof f === 'object' ? Object.assign({}, f, { before: maskEmails(f.before), after: maskEmails(f.after) }) : f;
  });
  return e;
}

/* one stored document -> one entry, with its area */
function entryOf(id, a) {
  a = a || {};
  var out = { id: id, at: a.at || null, by: a.by || '', action: a.action || '', detail: a.detail || '' };
  ['version', 'changeId', 'approvalId', 'requestedBy', 'fields'].forEach(function (k) { if (a[k] != null && a[k] !== '') out[k] = a[k]; });
  out.area = areaOf(a);
  return privacy(out);
}

/* col: the events/<id>/activity collection reference. -> Promise<{ items, next, scanned, people? }>
   `next` is the cursor for the following page, or null when there is nothing older that could match. */
function queryPage(col, opts) {
  var base = col.orderBy('at', 'desc');
  if (opts.from) base = base.where('at', '>=', opts.from);
  if (opts.to) base = base.where('at', '<=', opts.to);
  var items = [], scanned = 0, filtered = !!(opts.by || opts.area || opts.action || opts.q);

  function start() {
    if (!opts.before) return Promise.resolve(base);
    var c = opts.before;
    /* resuming after the very document the last page ended on is exact even when two entries share a time */
    var exact = c.id ? col.doc(c.id).get().then(function (snap) {
      return snap && snap.exists && (snap.data() || {}).at === c.at ? base.startAfter(snap) : null;
    }, function () { return null; }) : Promise.resolve(null);
    return exact.then(function (q) { return q || base.where('at', '<', c.at); });
  }

  function step(q, lastSnap) {
    var want = filtered ? BATCH : Math.min(BATCH, opts.limit - items.length + 1);
    var page = (lastSnap ? q.startAfter(lastSnap) : q).limit(want);
    return page.get().then(function (snap) {
      var docs = snap.docs || [];
      for (var i = 0; i < docs.length; i++) {
        scanned++;
        var e = entryOf(docs[i].id, docs[i].data());
        if (!matches(e, opts)) continue;
        if (items.length === opts.limit) {
          /* one more match than the page holds: there is a next page, starting after the last one shown */
          var last = items[items.length - 1];
          return { more: true, cursor: last.at + '|' + last.id };
        }
        items.push(e);
      }
      var exhausted = docs.length < want;
      if (exhausted) return { more: false };
      if (scanned >= SCAN_CAP) {
        /* stop reading; the next page carries on after the last entry looked at */
        var d = docs[docs.length - 1], at = (d.data() || {}).at;
        if (items.length === opts.limit) { var l = items[items.length - 1]; return { more: true, cursor: l.at + '|' + l.id }; }
        return { more: true, cursor: (at || '') + '|' + d.id };
      }
      return step(q, docs[docs.length - 1]);
    });
  }

  return start().then(function (q) { return step(q, null); }).then(function (r) {
    var out = { items: items, next: r.more ? r.cursor : null, scanned: scanned };
    if (!opts.firstPage) return out;
    /* who appears in this log at all, for the "person" filter — read once, with the first page */
    return col.select('by').limit(PEOPLE_CAP).get().then(function (snap) {
      var seen = {};
      (snap.docs || []).forEach(function (d) { var b = (d.data() || {}).by; if (b) seen[String(b)] = true; });
      out.people = Object.keys(seen).sort(function (a, b) {
        if (a === 'platform') return 1;
        if (b === 'platform') return -1;
        return a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0;
      });
      return out;
    }, function () { return out; });
  });
}

module.exports = { AREAS, ACTION_AREA, areaOf, parseQuery, queryPage, entryOf, maskEmails, PAGE_DEFAULT, PAGE_MAX, SCAN_CAP };
