// Everything an event's AUDIENCE touches, and everything the console reads back about that audience:
//
//   GET    /api/public/site-data        handlePublicSiteData      public — what a published site shows
//   POST   /api/event/seed              handleSeed                admin  — the wizard's content -> real records
//   POST   /api/register                handleRegister            public — the one route the internet writes through
//   GET    /api/event/registrations     handleRegistrationsList   admin
//   PATCH  /api/event/registrations     handleRegistrationUpdate  admin
//   DELETE /api/event/registrations     handleRegistrationDelete  admin
//   GET    /api/event/registrations/export  handleRegistrationsExport  admin — CSV
//   POST   /api/track                   handleTrack               public — one page view
//   GET    /api/event/dashboard-stats   handleDashboardStats      admin
//   GET    /api/insights                handleInsights            admin
//   GET    /api/event/activity          handleActivity            admin
//   OPTIONS (any public route)          handlePublicOptions
//
// Routing lives in lib/api.js; this module only exports the handlers (each `(req, res)`) and
// publicSiteData(), which the preview page calls in-process.
//
// HOW THE NUMBERS ARE KEPT. An event can collect tens of thousands of registrations, and the Dashboard,
// Reporting and the events listing all ask "how many?" on every open. Counting documents on every read
// would get slower and dearer with every sign-up, so nothing here counts on read. Every write that changes
// a number changes the stored totals in the SAME transaction as the registration itself:
//
//   events/<id>.counters                    registrations, confirmed, waitlist, pending, rejected,
//                                           cancelled, checkedIn                       (all-time, counted forms only)
//                                           submissions                                (all-time, every form)
//                                           forms: { <formId>: { n, pending } }        (all-time, per form)
//                                           views, uniques, mobile, desktop            (all-time)
//                                           audienceV: 2   — "the registration totals above are maintained"
//   events/<id>/stats/<YYYY-MM-DD>          views, uniques, mobile, desktop, registrations (counted forms),
//                                           submissions (every form), ref{...}         (that day)
//   events/<id>/aggregates/registrations    company / designation / city / source / device (counted forms):
//                                           { <key>: { l: label, c: count } }
//
// A site has several FORMS (lib/forms.js, lib/api-forms.js): "Register now", "Express interest", "Join as
// partner", "VIP delegates"… Every response to every form is a document under events/<id>/registrations
// with its formId. Only the responses to a form that "counts as a registration" (its countsAsRegistration,
// snapshotted on the response as `counts`) are registrations: they alone are in the registration totals,
// the capacity and the breakdowns. Every response is a "submission". A form that "needs approval" stores
// its responses as `pending` until the organiser approves (confirmed) or declines (rejected) them.
//
// so a stats request is the event document, one small aggregates document and at most `days` daily
// documents, however many people registered. Days are India days (see dayKey).
//
// Events that collected registrations before these totals existed (no `audienceV` marker, or the first
// version's 1, which had no forms) have their totals worked out from the registrations themselves: in
// memory for a read (a GET never writes), and written down once — rebuildAudience() — just before the
// first write that needs them.
//
// Nothing in here may throw into a stream or promise callback: an exception nobody catches ends the
// server process. Every handler body runs inside guard(), every promise chain ends in a catch that
// answers the request, and what a failure tells the caller is a sentence about what did not happen —
// the underlying Firestore text goes to the log only.
const crypto = require('crypto');
const ownerBrief = require('./owner-brief');
const admin = require('firebase-admin');
const { getFirebase } = require('./firebase');
const {
  sendJson, parseJsonBody, parseJsonObject, readBody, requireAdmin, adminFromRequest, sendPublicJson,
  sendPublicNoContent, clientIp, rateLimit, isEventId, isEmail, CONTENT_STATUSES, str
} = require('./http');
const { logActivity, listActivity, actorOf } = require('./activity');
const forms = require('./forms');
const phone = require('./phone');
const pictures = require('./pictures');

const FieldValue = admin.firestore.FieldValue;
const FieldPath = admin.firestore.FieldPath;

var NOT_AVAILABLE = 'This event is not available.';
var UNAVAILABLE = 'The service is temporarily unavailable. Please try again in a moment.';
var REG_STATUSES = ['confirmed', 'waitlist', 'pending', 'rejected', 'cancelled'];
var AUDIENCE_V = 2;
var DEFAULT_FORM_ID = forms.DEFAULT_FORM_ID;

/* ---------- small shared pieces ---------- */

function httpError(status, message, extra) {
  var e = new Error(message);
  e.status = status; e.expose = true; e.extra = extra || null;
  return e;
}

/* The one place a failure becomes a response. An error made by httpError() is ours and is worded for
   the person reading it; anything else is a fault, which is logged in full and reported plainly. */
function answerError(res, send, err, what) {
  if (err && err.expose) {
    var body = { error: err.message };
    if (err.extra) Object.keys(err.extra).forEach(function (k) { body[k] = err.extra[k]; });
    return send(res, err.status, body);
  }
  console.error('audience: could not ' + what + ' — ' + ((err && err.stack) || err));
  send(res, 500, { error: 'We could not ' + what + ' just now. Please try again.' });
}

/* requireAdmin and the body readers call back from inside a promise or a stream event, where a throw is
   caught by nothing. Every handler body is run through this. */
function guard(res, send, what, fn) {
  try { return fn(); } catch (err) { answerError(res, send, err, what); }
}

function query(req) { return new URLSearchParams(String(req.url || '').split('?')[1] || ''); }

/* An id that can be a real event. `import-…` documents live in the same collection but are the Lovable
   import pipeline's staging records, never events. */
function validEventId(v) { return isEventId(v) && v.indexOf('import-') !== 0; }

function eventDoc(fb, eventId) { return fb.db.collection('events').doc(eventId); }

/* lib/api-forms.js (an event's forms) builds on this module's helpers, so it is required where it is used,
   never at the top: the two load in either order. */
function formsApi() { return require('./api-forms'); }

/* The event's data, or null when there is no such event as far as anybody outside is concerned — the
   same rule lib/api.js (eventStateOf) and lib/api-events.js (isTaken) use. A deleted event keeps its
   document (so its address stays reserved) but behaves as if it did not exist; a document without
   `createdAt` was never created as an event at all (an AI step or an old stray write left it there). */
function liveEvent(snap) {
  if (!snap || !snap.exists) return null;
  var d = snap.data() || {};
  return d.deletedAt || !d.createdAt ? null : d;
}

/* Registration ids are Firestore document ids taken from a URL or a body: checked before use, because
   .doc() throws on "..", "" and anything with a slash, and "__name__" is a form Firestore keeps for itself. */
function isDocId(v) { return typeof v === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(v) && !/^__.*__$/.test(v); }

/* An event id out of a JSON body: text or nothing. (String() would turn ["x"] into "x".) */
function bodyId(v) { return typeof v === 'string' ? str(v, 100) : ''; }

function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }

/* One line of text somebody typed: control characters out, runs of white space to one space. Anything
   that is not text (an object, an array, true) is nothing, not "[object Object]". */
function line(v, max) {
  if (typeof v === 'number' && isFinite(v)) v = String(v);
  if (typeof v !== 'string') return '';
  return v.replace(/[\u0000-\u001F\u007F]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max || 300);
}
/* The same for text that may run over several lines (a biography, an answer, a note). */
function multiline(v, max) {
  if (typeof v === 'number' && isFinite(v)) v = String(v);
  if (typeof v !== 'string') return '';
  return v.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max || 4000);
}

/* Seven to fifteen digits, with the punctuation people really type around them. */
function isPhone(v) { return /^\+?[\d\s().-]{7,24}$/.test(v) && v.replace(/\D/g, '').length >= 7 && v.replace(/\D/g, '').length <= 15; }

/* An image address that is safe to put in a public page's src: a web address or a path on this host.
   `legacyInline` also lets through a picture stored inline in the record itself — nothing stores
   pictures that way any more (uploads go to Storage), but records made before that still hold them and
   their events should not lose their photos. Never a script or any other scheme. */
function imageUrl(v, legacyInline) {
  var s = typeof v === 'string' ? v.trim() : '';
  if (!s) return '';
  if (/^https?:\/\/[^\s]+$/i.test(s)) return s;
  if (s.charAt(0) === '/' && s.charAt(1) !== '/' && !/\s/.test(s)) return s;
  if (legacyInline && /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/i.test(s)) return s;
  return '';
}
/* A link somebody typed ("acme.com", "www.acme.com/in", "https://…") as a link a browser will follow to
   the web; '' for anything that is not one. */
function linkUrl(v) {
  var s = typeof v === 'string' ? v.trim() : '';
  if (!s || /\s/.test(s) || s.length > 2000) return '';
  if (/^https?:\/\/[^/]+/i.test(s)) return s;
  if (/^[a-z][a-z0-9+.-]*:/i.test(s) || s.charAt(0) === '/') return '';     // some other scheme, or not a web address
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+([/?#].*)?$/i.test(s) ? 'https://' + s : '';
}

/* Reporting days are India days: the product's users and their events are in India, and a server clock
   in UTC would put every registration made before 05:30 on the previous day's bar. */
var IST_OFFSET_MS = 330 * 60 * 1000;
function dayKey(ms) { return new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10); }
function dayOfIso(iso) { var t = Date.parse(iso); return isNaN(t) ? '' : dayKey(t); }
function lastDays(n) {
  var out = [], now = Date.now();
  for (var i = n - 1; i >= 0; i--) out.push(dayKey(now - i * 86400000));
  return out;
}

function intParam(v, dflt, min, max) {
  var n = parseInt(v, 10);
  if (isNaN(n)) return dflt;
  return Math.max(min, Math.min(max, n));
}

function byOrder(a, b) {
  var d = (Number(a.order) || 0) - (Number(b.order) || 0);
  if (d) return d;
  return String(a.createdAt || '') < String(b.createdAt || '') ? -1 : String(a.createdAt || '') > String(b.createdAt || '') ? 1 : 0;
}

/* Runs fn over items, at most `limit` at a time; resolves the results in order. */
function mapLimit(items, limit, fn) {
  var out = new Array(items.length), next = 0;
  function worker() {
    if (next >= items.length) return Promise.resolve();
    var i = next++;
    return Promise.resolve().then(function () { return fn(items[i], i); }).then(function (v) { out[i] = v; return worker(); });
  }
  var workers = [];
  for (var w = 0; w < Math.min(limit, items.length); w++) workers.push(worker());
  return Promise.all(workers).then(function () { return out; });
}

/* ---------- one write at a time per event ----------
   Every registration and every page view changes the SAME documents (the event's totals, the day's
   document). Firestore serialises writers of one document, and under a burst — the minute after an
   invitation e-mail goes out — independent transactions spend their time colliding and retrying until
   most of them give up (measured: 80 sign-ups at once, 71 failures). So writes that share a key take
   turns, and whatever arrived while the previous write was in flight goes out together as the next ONE
   write. Nothing waits on a timer and nothing is held after its request is answered: an idle key writes
   at once, and each caller's promise settles only when the write that carried it has committed.

   run(items) resolves an array, one { value } or { error } per item, or rejects for all of them. */
var queues = new Map();
var MAX_QUEUED = 5000;
function enqueue(key, item, maxBatch, run) {
  return new Promise(function (resolve, reject) {
    var q = queues.get(key);
    if (!q) { q = { items: [], busy: false }; queues.set(key, q); }
    if (q.items.length >= MAX_QUEUED) return reject(httpError(503, 'This event is very busy right now. Please try again in a moment.', { code: 'busy' }));
    q.items.push({ item: item, resolve: resolve, reject: reject });
    if (!q.busy) drain(key, q, maxBatch, run);
  });
}
function drain(key, q, maxBatch, run) {
  if (!q.items.length) { q.busy = false; queues.delete(key); return; }
  q.busy = true;
  var batch = q.items.splice(0, maxBatch), work;
  try { work = Promise.resolve(run(batch.map(function (b) { return b.item; }))); } catch (err) { work = Promise.reject(err); }
  work.then(function (results) {
    batch.forEach(function (b, i) {
      var r = results && results[i];
      if (!r || r.error) b.reject((r && r.error) || new Error('no result for a queued write'));
      else b.resolve(r.value);
    });
  }, function (err) {
    batch.forEach(function (b) { b.reject(err); });
  }).then(function () { drain(key, q, maxBatch, run); });
}

/* ---------- the event's date, as its site prints it ----------
   The same wording editor-fill.js's formatDate() gives the templates ("27th November, 2026",
   "27th – 28th November, 2026"), so the date a visitor sees is the same whether the page was filled in
   the editor or refreshed from here. An event with no date picked has no label ('') — the site decides
   what to show in its place. Dates are read as the calendar date that was typed, never shifted by a
   time zone. */
var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function ordinal(n) {
  var s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
function ymd(v) {
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(typeof v === 'string' ? v : '');
  if (!m || +m[2] < 1 || +m[2] > 12 || +m[3] < 1 || +m[3] > 31) return null;
  return { y: +m[1], m: +m[2] - 1, d: +m[3] };
}
function dateLabel(ev) {
  var s = ymd(ev.start), e = ymd(ev.end);
  // no exact date: the wording the organiser chose for it ("November 2026", "Q1 2027", "To be announced")
  if (!s) return line(ev.dateLabel, 120);
  var one = function (x) { return ordinal(x.d) + ' ' + MONTHS[x.m] + ', ' + x.y; };
  if (!e || (e.y === s.y && e.m === s.m && e.d === s.d)) return one(s);
  if (s.y !== e.y) return one(s) + ' – ' + one(e);
  if (s.m !== e.m) return ordinal(s.d) + ' ' + MONTHS[s.m] + ' – ' + one(e);
  return ordinal(s.d) + ' – ' + one(e);
}

/* ---------- registration settings ----------
   The event-wide switches every form shares — settings.registration { open, capacity, target,
   defaultFormId } — and the original single form's fields / successMessage / duplicates, which only the
   lazy move to forms still reads (lib/forms.js legacyRegistration). Each form's own questions and
   wording are its form document (lib/forms.js, lib/api-forms.js). */
var DEFAULT_SUCCESS = forms.DEFAULT_SUCCESS;
var WAITLIST_MESSAGE = forms.WAITLIST_MESSAGE;
var CLOSED_MESSAGE = 'Registration for this event is closed.';
var FORM_CLOSED_MESSAGE = 'This form is not taking responses at the moment.';
var FORM_MISSING_MESSAGE = 'This form is no longer available.';
var DUPLICATE_MESSAGE = 'This email has already been used for this form.';
function registrationSettings(ev) { return forms.legacyRegistration(ev || {}); }

/* ---------- counters ---------- */

function hasAudienceCounters(ev) { return isObj(ev.counters) && ev.counters.audienceV === AUDIENCE_V; }
function num(v) { var n = Number(v); return isFinite(n) && n > 0 ? Math.floor(n) : 0; }
function normStatus(s) { return REG_STATUSES.indexOf(s) !== -1 ? s : 'confirmed'; }

/* What one response adds to the event's totals: every response is a submission and one of its form's
   responses; only a response to a counted form (counts !== false — so a response from before forms is
   one) is a registration, in its status, checked in or not. */
var COUNTED_KEYS = ['registrations', 'confirmed', 'waitlist', 'pending', 'rejected', 'cancelled', 'checkedIn'];
function contribution(doc) {
  if (!doc) return null;
  var status = normStatus(doc.status), formId = doc.formId || DEFAULT_FORM_ID;
  var c = { submissions: 1, forms: {} };
  c.forms[formId] = { n: 1, pending: status === 'pending' ? 1 : 0 };
  if (doc.counts !== false) {
    c.registrations = 1;
    c[status] = 1;
    if (doc.checkedInAt) c.checkedIn = 1;
  }
  return c;
}
/* How the totals move when a response goes from oldDoc to newDoc (null: it did not exist / no longer
   does): { registrations, <status>, checkedIn, submissions: ±n, forms: { <formId>: { n, pending: ±n } } },
   leaving out whatever does not move. Create, change and delete all use it, so they cannot disagree. */
function counterDelta(oldDoc, newDoc) {
  var out = { forms: {} };
  addDelta(out, contribution(oldDoc), -1);
  addDelta(out, contribution(newDoc), 1);
  return pruneDelta(out);
}
function addDelta(into, c, sign) {
  if (!c) return into;
  sign = sign || 1;
  Object.keys(c).forEach(function (k) {
    if (k !== 'forms') { into[k] = (into[k] || 0) + sign * c[k]; return; }
    Object.keys(c.forms).forEach(function (id) {
      // an own key only: a form id is never looked up on what every object inherits
      var f = Object.prototype.hasOwnProperty.call(into.forms, id) ? into.forms[id] : (into.forms[id] = { n: 0, pending: 0 });
      f.n += sign * (c.forms[id].n || 0);
      f.pending += sign * (c.forms[id].pending || 0);
    });
  });
  return into;
}
function pruneDelta(d) {
  Object.keys(d).forEach(function (k) { if (k !== 'forms' && !d[k]) delete d[k]; });
  Object.keys(d.forms).forEach(function (id) {
    var f = d.forms[id];
    if (!f.n) delete f.n;
    if (!f.pending) delete f.pending;
    if (!Object.keys(f).length) delete d.forms[id];
  });
  return d;
}
/* A delta as the arguments of a Firestore update: [FieldPath, increment, …]. A form's own counters are
   addressed by FieldPath, never by a dotted string (form ids have hyphens). `extra`: more [path, value]. */
function counterWrites(delta, extra) {
  var out = [];
  Object.keys(delta).forEach(function (k) {
    if (k !== 'forms' && delta[k]) out.push(new FieldPath('counters', k), FieldValue.increment(delta[k]));
  });
  Object.keys(delta.forms || {}).forEach(function (id) {
    ['n', 'pending'].forEach(function (x) {
      if (delta.forms[id][x]) out.push(new FieldPath('counters', 'forms', id, x), FieldValue.increment(delta.forms[id][x]));
    });
  });
  (extra || []).forEach(function (pair) { out.push(pair[0], pair[1]); });
  return out;
}
function applyCounters(tx, ref, delta, extra) {
  var w = counterWrites(delta, extra);
  if (w.length) tx.update.apply(tx, [ref].concat(w));
}

/* The breakdown lists (company, designation, city, source, device) are kept as maps in ONE document, so
   they have to stay well inside Firestore's 1 MiB per document whatever people type. Each list holds at
   most AGG_MAX_KEYS different values; anything newer than that is counted under "Other". A value's key
   is a hash of its lower-cased text ("Tata Motors" and "tata  motors" are one company; no character a
   person can type can break a field path).
   The limits are sized for the worst a stranger can send through the public form, not the typical case:
   800 values of 60 characters in a three-byte script, in each of four lists, is about 0.7 MiB and some
   13,000 index entries (Firestore's ceilings are 1 MiB and 40,000). Past either ceiling every further
   registration for the event would fail. */
var AGG_DIMS = ['company', 'designation', 'city', 'source', 'device'];
var AGG_MAX_KEYS = 800;
var AGG_OTHER = '_other';
function aggKeyOf(value) {
  return 'k' + crypto.createHash('sha1').update(value.toLowerCase().replace(/\s+/g, ' ')).digest('hex').slice(0, 16);
}
/* What a registration counts under in each list. */
function aggValues(reg) {
  var utm = isObj(reg.utm) ? reg.utm : {};
  return {
    company: line(reg.company, 60), designation: line(reg.designation, 60),
    /* a form's City answer, else the city of its Location answer ("Noida" of "Noida, Uttar Pradesh, India") */
    city: line(reg.city, 60) || line(isObj(reg.locationParts) ? reg.locationParts.city : '', 60),
    source: (line(utm.source, 60) || line(reg.source, 60) || 'website').toLowerCase(),
    device: line(reg.device, 20).toLowerCase()
  };
}
/* Where `value` is counted in a list that currently looks like `dim`: its own key, or Other once full. */
function aggSlot(dim, value) {
  if (!value) return null;
  var key = aggKeyOf(value);
  if (isObj(dim) && isObj(dim[key])) return { key: key, label: value };
  if (isObj(dim) && Object.keys(dim).length >= AGG_MAX_KEYS) return { key: AGG_OTHER, label: 'Other' };
  return { key: key, label: value };
}
function topList(dim, n) {
  if (!isObj(dim)) return [];
  return Object.keys(dim).filter(function (k) { return k !== AGG_OTHER && isObj(dim[k]) && num(dim[k].c) > 0; })
    .map(function (k) { return { label: String(dim[k].l || ''), count: num(dim[k].c) }; })
    .sort(function (a, b) { return b.count - a.count || (a.label < b.label ? -1 : 1); })
    .slice(0, n || 10);
}

/* A response made while its form rejects duplicate e-mails is stored under an id derived from the form and
   the e-mail (forms.regDocId: "em-…" for the form "register", which keeps the original single form's ids,
   "fm-…" for every other form), so "has this address answered this form?" is one document read.
   Responses stored any other way — while their form allowed duplicates, or by the route this module
   replaced — have other ids and can only be found by a query; counters.looseIds records that an event has
   (or may have) some, so that only those events pay for the query on every registration. */
var EMAIL_ID_PREFIX = 'em-', FORM_ID_PREFIX = 'fm-';

function audienceRefs(fb, eventId) {
  var e = eventDoc(fb, eventId);
  return { event: e, regs: e.collection('registrations'), stats: e.collection('stats'), agg: e.collection('aggregates').doc('registrations') };
}

/* Totals worked out from the responses themselves — for events from before the totals were kept (or kept
   without forms). Reads only the handful of fields it needs. */
function scanAudience(fb, eventId) {
  return audienceRefs(fb, eventId).regs
    .select('status', 'checkedInAt', 'createdAt', 'company', 'designation', 'city', 'locationParts', 'source', 'utm', 'device', 'formId', 'counts').get()
    .then(function (snap) {
      var counters = { registrations: 0, confirmed: 0, waitlist: 0, pending: 0, rejected: 0, cancelled: 0, checkedIn: 0, submissions: 0, forms: {} };
      var days = {}, subDays = {}, agg = {}, looseIds = false;
      AGG_DIMS.forEach(function (d) { agg[d] = {}; });
      snap.docs.forEach(function (doc) {
        var r = doc.data() || {};
        if (doc.id.indexOf(EMAIL_ID_PREFIX) !== 0 && doc.id.indexOf(FORM_ID_PREFIX) !== 0) looseIds = true;
        addDelta(counters, contribution(r), 1);
        var day = dayOfIso(r.createdAt);
        if (day) subDays[day] = (subDays[day] || 0) + 1;
        if (r.counts === false) return;
        if (day) days[day] = (days[day] || 0) + 1;
        var vals = aggValues(r);
        AGG_DIMS.forEach(function (d) {
          var slot = aggSlot(agg[d], vals[d]);
          if (!slot) return;
          if (!agg[d][slot.key]) agg[d][slot.key] = { l: slot.label, c: 0 };
          agg[d][slot.key].c++;
        });
      });
      return { counters: counters, days: days, subDays: subDays, agg: agg, looseIds: looseIds };
    });
}

/* Writes an older event's totals down, once, so that the write which is about to happen can keep them
   by increments from then on. Safe against two callers at once and against a registration arriving
   meanwhile: every write to an event's registrations first requires the marker this sets, so nothing
   can be added or removed between the scan and the marker; and whoever commits second finds the marker
   and changes nothing. Leaves the visit counters alone. */
function rebuildAudience(fb, eventId) {
  var refs = audienceRefs(fb, eventId);
  return scanAudience(fb, eventId).then(function (scan) {
    return fb.db.runTransaction(function (tx) {
      return tx.get(refs.event).then(function (snap) {
        if (!snap.exists) throw httpError(404, NOT_AVAILABLE);
        if (hasAudienceCounters(snap.data() || {})) return;
        var patch = { 'counters.audienceV': AUDIENCE_V, 'counters.looseIds': scan.looseIds };
        // every total is written, zeros included: a total from the version before must not survive
        COUNTED_KEYS.concat(['submissions']).forEach(function (k) { patch['counters.' + k] = scan.counters[k] || 0; });
        patch['counters.forms'] = scan.counters.forms;
        tx.update(refs.event, patch);
        tx.set(refs.agg, scan.agg);
        // a transaction has a ceiling on writes; an event old enough to have more registration days than
        // this keeps its most recent ones on the chart (its totals are exact either way)
        var dayKeys = Object.keys(scan.subDays);
        Object.keys(scan.days).forEach(function (d) { if (dayKeys.indexOf(d) === -1) dayKeys.push(d); });
        dayKeys.sort().slice(-400).forEach(function (day) {
          tx.set(refs.stats.doc(day), { date: day, registrations: scan.days[day] || 0, submissions: scan.subDays[day] || 0 }, { merge: true });
        });
      });
    });
  });
}

/* Runs `work` (a function returning a promise, usually a transaction) and, if it reports that the
   event's totals have never been written down, writes them and runs it again. */
var NEEDS_COUNTERS = { needsCounters: true };
function withAudienceCounters(fb, eventId, work) {
  return work().catch(function (err) {
    if (err !== NEEDS_COUNTERS) throw err;
    return rebuildAudience(fb, eventId).then(work).catch(function (err2) {
      if (err2 === NEEDS_COUNTERS) throw new Error('registration totals for ' + eventId + ' could not be initialised');
      throw err2;
    });
  });
}

/* =====================================================================================================
   SITE DATA — GET /api/public/site-data?eventId=
   What a published site shows, taken from the event's own records every time it is asked. PUBLIC: this
   is read by anybody on the internet, so it is built field by field from an allow-list — a new field on
   a record is private until somebody adds it here.

   Who is on the site. The console gives every speaker and sponsor a status: Confirmed, Invited or
   Tentative. Only CONFIRMED people and companies are public (a record with no status at all — one made
   before the field existed — counts as confirmed). An organiser who has only invited someone has not
   announced them. Their e-mail, phone, contact person and notes are the organiser's working data and
   never leave the console; the Contacts tab is the opposite — it exists to be published — so a
   contact's e-mail and phone are public.

   The shape is contract section 5 plus: event.logoUrl; `weight` on speakers, sessions and partners (the
   console's size control: "featured" / "standard" / … or a number, '' when never set) so a site can
   show a keynote larger; registration.waitlist. Every list is always present — empty when the event has
   no such records — so a site can tell "nothing to show" from "could not load"; every item has its
   record's id.
   ===================================================================================================== */

var CONTENT = ['speakers', 'speakerGroups', 'sessions', 'agendaGroups', 'partners', 'partnerTiers', 'gallery', 'faqs', 'contacts'];
var SOCIAL_KINDS = ['linkedin', 'x', 'facebook', 'instagram', 'youtube', 'website'];

function isPublicStatus(s) { return s == null || s === '' || s === 'confirmed'; }
function weightOf(v) { return typeof v === 'number' && isFinite(v) ? v : line(v, 40); }

function buildSiteData(fb, eventId, ev) {
  var ref = eventDoc(fb, eventId);
  /* the event's default form, for the registration block below (its shape is the one from before forms;
     the forms themselves are GET /api/public/forms). A failure there costs that block, never the page. */
  var defaultForm = formsApi().loadForms(fb, eventId, ev).then(function (r) {
    return r.forms.filter(function (f) { return f.id === r.defaultFormId; })[0] || r.forms[0];
  }).catch(function (err) {
    console.error('audience: the forms of ' + eventId + ' could not be read for its site data — ' + (err && err.message));
    return forms.legacyDefaultForm(ev);
  });
  return Promise.all(CONTENT.map(function (name) { return ref.collection(name).get(); }).concat([defaultForm])).then(function (snaps) {
    var mainForm = snaps[CONTENT.length] || forms.legacyDefaultForm(ev);
    var rec = {}, updatedAt = String(ev.updatedAt || ev.createdAt || '');
    CONTENT.forEach(function (name, i) {
      rec[name] = snaps[i].docs.map(function (d) {
        var data = d.data() || {};
        if (typeof data.updatedAt === 'string' && data.updatedAt > updatedAt) updatedAt = data.updatedAt;
        data.id = d.id;
        return data;
      }).sort(byOrder);
    });
    var order = function (r) { return Number(r.order) || 0; };

    var speakers = rec.speakers.filter(function (s) { return isPublicStatus(s.status) && line(s.name, 200); }).map(function (s) {
      return { id: s.id, name: line(s.name, 200), desig: line(s.desig, 200), comp: line(s.comp, 200),
        photoUrl: imageUrl(s.photoUrl, true), bio: multiline(s.bio, 4000), li: linkUrl(s.li),
        groupId: line(s.groupId, 100), weight: weightOf(s.weight), order: order(s) };
    });
    var visibleSpeaker = {};
    speakers.forEach(function (s) { visibleSpeaker[s.id] = true; });

    var settings = registrationSettings(ev);
    var social = (isObj(ev.settings) && Array.isArray(ev.settings.social) ? ev.settings.social : []).map(function (s) {
      return isObj(s) ? { kind: line(s.kind, 20).toLowerCase(), url: linkUrl(s.url) } : null;
    }).filter(function (s) { return s && s.url && SOCIAL_KINDS.indexOf(s.kind) !== -1; });

    var siteData = {
      eventId: eventId,
      updatedAt: updatedAt,
      event: {
        name: line(ev.name, 300), category: line(ev.category, 60), start: line(ev.start, 40), end: line(ev.end, 40),
        dateLabel: dateLabel(ev), venue: line(ev.venue, 300), city: line(ev.city, 120),
        /* the description's headings are the owner's brief for the AI, never shown (owner-brief.js) */
        description: multiline(ownerBrief.withoutHeadings(ev.description), 8000), logoUrl: imageUrl(ev.logoUrl, false)
      },
      /* kept in the shape it had before forms (nothing reads it now): the event's default form */
      registration: {
        open: settings.open && mainForm.open !== false,
        paid: false,                 // online payment is not available; every event registers free
        // true once the confirmed places are all taken: the form still works, and says "waitlist"
        waitlist: forms.isFull(ev),
        fields: mainForm.fields.map(function (f) { return { key: f.id, label: f.label, type: f.type, required: !!f.required }; }),
        successMessage: mainForm.successMessage
      },
      speakers: speakers,
      speakerGroups: rec.speakerGroups.map(function (g) { return { id: g.id, name: line(g.name, 200), order: order(g) }; }),
      sessions: rec.sessions.filter(function (s) { return line(s.title, 300); }).map(function (s) {
        return { id: s.id, title: line(s.title, 300), start: line(s.start, 40), end: line(s.end, 40), kind: line(s.kind, 40),
          // a session must not name (or count) a speaker the site does not show
          speakerIds: (Array.isArray(s.speakerIds) ? s.speakerIds : []).filter(function (id) { return typeof id === 'string' && visibleSpeaker[id]; }),
          desc: multiline(s.desc, 4000), room: line(s.room, 200), groupId: line(s.groupId, 100), weight: weightOf(s.weight), order: order(s) };
      }),
      agendaGroups: rec.agendaGroups.map(function (g) { return { id: g.id, name: line(g.name, 200), date: line(g.date, 40), order: order(g) }; }),
      partners: rec.partners.filter(function (p) { return isPublicStatus(p.status) && (line(p.name, 200) || imageUrl(p.logoUrl, true)); }).map(function (p) {
        return { id: p.id, name: line(p.name, 200), url: linkUrl(p.url), logoUrl: imageUrl(p.logoUrl, true),
          tierId: line(p.tierId, 100), weight: weightOf(p.weight), order: order(p) };
      }),
      partnerTiers: rec.partnerTiers.map(function (t) { return { id: t.id, name: line(t.name, 200), order: order(t) }; }),
      gallery: rec.gallery.filter(function (g) { return imageUrl(g.imageUrl, true); }).map(function (g) {
        return { id: g.id, imageUrl: imageUrl(g.imageUrl, true), caption: line(g.caption, 300), order: order(g) };
      }),
      faqs: rec.faqs.filter(function (f) { return line(f.question, 500); }).map(function (f) {
        return { id: f.id, question: line(f.question, 500), answer: multiline(f.answer, 8000), order: order(f) };
      }),
      contacts: rec.contacts.filter(function (c) { return line(c.name, 200) || line(c.email, 200) || line(c.phone, 40); }).map(function (c) {
        return { id: c.id, label: line(c.label, 120), name: line(c.name, 200), email: line(c.email, 200), phone: line(c.phone, 40), order: order(c) };
      }),
      social: social
    };
    /* the WebP copies of the records' pictures that have them (lib/pictures.js), for rv-data.js to offer
       the visitor's browser: { url: 'hash.WxH:640,1280' }. Present only when there are some. */
    var urls = [].concat(
      siteData.speakers.map(function (x) { return x.photoUrl; }),
      siteData.partners.map(function (x) { return x.logoUrl; }),
      siteData.gallery.map(function (x) { return x.imageUrl; }));
    return pictures.lookupUrls(fb, urls.filter(Boolean)).then(function (index) {
      var map = pictures.siteDataMap(index);
      if (Object.keys(map).length) siteData.pictures = map;
      return siteData;
    }, function () { return siteData; });
  });
}

/* The site data for an event, or null when it must not be shown: no such event, a deleted one, or one
   that is not published and the caller is not a signed-in admin (opts.admin). Rejects only on a fault. */
function publicSiteData(fb, eventId, opts) {
  if (!fb || fb.error || !validEventId(eventId)) return Promise.resolve(null);
  return eventDoc(fb, eventId).get().then(function (snap) {
    var ev = liveEvent(snap);
    if (!ev) return null;
    if (ev.published !== true && !(opts && opts.admin)) return null;
    return buildSiteData(fb, eventId, ev);
  });
}

function handlePublicSiteData(req, res) {
  guard(res, sendPublicJson, 'load this event', function () {
    var eventId = str(query(req).get('eventId'), 100);
    // one answer for "no such event", "deleted" and "not published": the public cannot tell a draft exists
    if (!validEventId(eventId)) return sendPublicJson(res, 404, { error: NOT_AVAILABLE });
    if (!rateLimit('site:' + clientIp(req), 300, 60000)) {
      return sendPublicJson(res, 429, { error: 'Too many requests. Please try again in a minute.' }, { 'Retry-After': '60' });
    }
    var fb = getFirebase();
    if (fb.error) return sendPublicJson(res, 503, { error: UNAVAILABLE });

    eventDoc(fb, eventId).get().then(function (snap) {
      var ev = liveEvent(snap);
      if (!ev) return sendPublicJson(res, 404, { error: NOT_AVAILABLE });
      if (ev.published === true) {
        // the public answer is the same for everybody, so a visitor's token is never even looked at
        return buildSiteData(fb, eventId, ev).then(function (data) {
          sendPublicJson(res, 200, data, { 'Cache-Control': 'public, max-age=30' });
        });
      }
      return adminFromRequest(req).then(function (who) {
        if (!who) return sendPublicJson(res, 404, { error: NOT_AVAILABLE });
        return buildSiteData(fb, eventId, ev).then(function (data) { sendPublicJson(res, 200, data); });   // no-store
      });
    }).catch(function (err) { answerError(res, sendPublicJson, err, 'load this event'); });
  });
}

function handlePublicOptions(req, res) { sendPublicNoContent(res); }

/* =====================================================================================================
   SEED — POST /api/event/seed
   The wizard's speakers, FAQs, sponsors, contacts and gallery become the same records the console's
   Content tabs edit. Rules:
     - a collection is filled only while it is EMPTY. Seeding never adds to, or touches, records that
       are already there (a second click, a retry, or re-running the wizard over an event creates nothing);
     - records keep the order they were sent in (`order` is the position in the array);
     - it is all or nothing: the whole request is checked first and written in one transaction;
     - a speaker / session / partner always ends up in a group the console can show it under.

   THE PAYLOAD CONVENTION (for the wizard). Each array holds objects with that resource's own field
   names (RESOURCES in lib/api.js). Because nothing has a real id yet, records refer to each other in
   either of two ways, whichever the caller has:
     - by a TEMPORARY id: give the target any `id` string ("g1", a uid — it is never stored) and point at
       it with the normal field: speaker.groupId, session.groupId, partner.tierId, session.speakerIds[];
     - by NAME: speaker.group, session.group, partner.tier, session.speakers[] (matched without regard
       to case or spacing).
   A reference that matches nothing in the request is an error (nothing is created). A record with no
   group goes into the first group sent — or the first existing one — or, when there is none at all,
   into a default one created for it ("Speakers", "Day 1", "Partners"), exactly as the console would.
   Pictures must already be uploaded: photoUrl / logoUrl / imageUrl take a URL, never image data.
   Entirely empty rows are ignored.
   ===================================================================================================== */

var MAX_SEED_BODY = 2 * 1024 * 1024;
var MAX_SEED_RECORDS = 450;          // one transaction; far beyond anything a wizard collects

function T(max) { return function (v) { return { value: line(v, max) }; }; }
function M(max) { return function (v) { return { value: multiline(v, max) }; }; }
function IMG(what) {
  return function (v) {
    if (v == null || v === '') return { value: '' };
    var url = imageUrl(v, false);
    if (url) return { value: url };
    if (typeof v === 'string' && /^data:/i.test(v.trim())) return { error: 'the ' + what + ' has not been uploaded yet — upload it first, then try again' };
    return { error: 'the ' + what + ' is not a valid image address' };
  };
}
function LINK(what) {
  return function (v) {
    if (v == null || v === '') return { value: '' };
    var url = linkUrl(v);
    return url ? { value: url } : { error: 'the ' + what + ' is not a valid web address' };
  };
}
function EMAIL(v) {
  var s = line(v, 200);
  return !s || isEmail(s) ? { value: s } : { error: 'the email address is not valid' };
}
function STATUS(v) {
  if (v == null || v === '') return { value: 'confirmed' };          // what the wizard collects is meant to be shown
  return CONTENT_STATUSES.indexOf(v) !== -1 ? { value: v } : { error: 'the status must be confirmed, invited or tentative' };
}
function DEFAULTED(max, dflt) { return function (v) { return { value: line(v, max) || dflt }; }; }

/* In dependency order: a kind's parent comes before it. `title` is the field a record cannot do
   without; `content` are the fields that make a row "not empty" (defaults do not count). */
var SEED_KINDS = [
  { key: 'speakerGroups', noun: 'Speaker group', title: 'name', need: 'a name', content: ['name'],
    fields: { name: T(120) } },
  { key: 'speakers', noun: 'Speaker', title: 'name', need: 'a name',
    content: ['name', 'desig', 'comp', 'photoUrl', 'logoUrl', 'email', 'phone', 'li', 'bio'],
    fields: { name: T(160), desig: T(200), comp: T(200), photoUrl: IMG('photo'), logoUrl: IMG('company logo'), colour: T(40),
      weight: DEFAULTED(40, 'featured'), status: STATUS, email: EMAIL, phone: T(40), li: LINK('LinkedIn link'), bio: M(4000) },
    parent: { kind: 'speakerGroups', idField: 'groupId', nameField: 'group', fallback: { name: 'Speakers' } } },
  { key: 'agendaGroups', noun: 'Agenda day', title: 'name', need: 'a name', content: ['name', 'date'],
    fields: { name: T(120), date: T(40) } },
  { key: 'sessions', noun: 'Session', title: 'title', need: 'a title', content: ['title', 'start', 'end', 'desc', 'room'],
    fields: { title: T(300), start: T(40), end: T(40), kind: DEFAULTED(40, 'session'), desc: M(4000), room: T(160), weight: T(40) },
    parent: { kind: 'agendaGroups', idField: 'groupId', nameField: 'group', fallback: { name: 'Day 1' } } },
  { key: 'partnerTiers', noun: 'Partner tier', title: 'name', need: 'a name', content: ['name'],
    fields: { name: T(120), weight: DEFAULTED(40, 'standard') } },
  { key: 'partners', noun: 'Partner', title: 'name', need: 'a name', content: ['name', 'url', 'logoUrl', 'email', 'phone', 'contact', 'note'],
    fields: { name: T(160), url: LINK('website'), logoUrl: IMG('logo'), weight: DEFAULTED(40, 'standard'), status: STATUS,
      email: EMAIL, phone: T(40), contact: T(160), note: M(2000) },
    parent: { kind: 'partnerTiers', idField: 'tierId', nameField: 'tier', fallback: { name: 'Partners', weight: 'standard' } } },
  { key: 'gallery', noun: 'Gallery image', title: 'imageUrl', need: 'an image', content: ['imageUrl', 'caption'],
    fields: { imageUrl: IMG('image'), caption: T(300) } },
  { key: 'faqs', noun: 'FAQ', title: 'question', need: 'a question', content: ['question', 'answer'],
    fields: { question: T(500), answer: M(8000) } },
  { key: 'contacts', noun: 'Contact', title: 'name', need: 'a name, an email address or a phone number', content: ['label', 'name', 'email', 'phone'],
    fields: { label: T(120), name: T(160), email: EMAIL, phone: T(40) } }
];
var SEED_BY_KEY = {};
SEED_KINDS.forEach(function (k) { SEED_BY_KEY[k.key] = k; });
/* Kinds other records point at: their existing records are read in full (to match by name). */
var SEED_TARGETS = { speakerGroups: true, agendaGroups: true, partnerTiers: true, speakers: true };

function sameName(a, b) {
  return !!a && !!b && String(a).toLowerCase().replace(/\s+/g, ' ').trim() === String(b).toLowerCase().replace(/\s+/g, ' ').trim();
}
function refList(v) {
  return (Array.isArray(v) ? v : []).map(function (x) { return line(x, 200); }).filter(Boolean);
}

/* Checks and cleans the whole request. Returns { kind: [ item ] } or throws the first problem as a 400. */
function readSeedPayload(body) {
  var payload = {}, total = 0;
  SEED_KINDS.forEach(function (k) {
    var raw = body[k.key], seen = {};
    payload[k.key] = [];
    if (raw == null) return;
    if (!Array.isArray(raw)) throw httpError(400, '"' + k.key + '" must be a list.');
    raw.forEach(function (item, i) {
      var label = k.noun + ' ' + (i + 1);
      if (!isObj(item)) throw httpError(400, label + ' is not a valid record.');
      var data = {}, empty = true;
      Object.keys(k.fields).forEach(function (f) {
        var r = k.fields[f](item[f]);
        if (r.error) throw httpError(400, label + (line(item[k.title], 60) ? ' (' + line(item[k.title], 60) + ')' : '') + ': ' + r.error + '.');
        data[f] = r.value;
        if (r.value && k.content.indexOf(f) !== -1) empty = false;
      });
      if (empty) return;                                   // a row the user left blank
      var titled = k.key === 'contacts' ? (data.name || data.email || data.phone) : data[k.title];
      if (!titled) throw httpError(400, label + ' needs ' + k.need + '.');
      var out = { n: i + 1, tmpId: line(item.id, 200), title: k.key === 'contacts' ? '' : data[k.title], data: data };
      if (out.tmpId) {
        if (seen[out.tmpId]) throw httpError(400, label + ' has the same id ("' + out.tmpId + '") as another ' + k.noun.toLowerCase() + ' in this request.');
        seen[out.tmpId] = true;
      }
      if (k.parent) {
        out.parentId = line(item[k.parent.idField], 200);
        out.parentName = line(item[k.parent.nameField], 200);
      }
      if (k.key === 'sessions') {
        out.speakerIds = refList(item.speakerIds);
        out.speakerNames = refList(item.speakers);
      }
      payload[k.key].push(out);
      total++;
    });
  });
  if (total > MAX_SEED_RECORDS) throw httpError(400, 'That is too much content to add in one go (' + total + ' records; the limit is ' + MAX_SEED_RECORDS + ').');
  return payload;
}

function seedTransaction(fb, eventId, decoded, payload) {
  var eRef = eventDoc(fb, eventId);
  return fb.db.runTransaction(function (tx) {
    var reads = [tx.get(eRef)].concat(SEED_KINDS.map(function (k) {
      var col = eRef.collection(k.key);
      return tx.get(SEED_TARGETS[k.key] ? col.select('name', 'order', 'createdAt') : col.select().limit(1));
    }));
    return Promise.all(reads).then(function (r) {
      var ev = liveEvent(r[0]);
      if (!ev) throw httpError(404, 'No event found for "' + eventId + '".');

      var existing = {}, fill = {}, newIds = {}, created = {}, skipped = [], autoParent = {}, writes = [];
      var now = new Date().toISOString(), by = actorOf(decoded);
      SEED_KINDS.forEach(function (k, i) {
        existing[k.key] = r[i + 1].docs.map(function (d) {
          return { id: d.id, name: d.get('name') || '', order: d.get('order') || 0, createdAt: d.get('createdAt') || '' };
        }).sort(byOrder);
        fill[k.key] = payload[k.key].length > 0 && existing[k.key].length === 0;
        if (payload[k.key].length > 0 && !fill[k.key]) skipped.push(k.key);
        newIds[k.key] = fill[k.key] ? payload[k.key].map(function () { return eRef.collection(k.key).doc().id; }) : [];
        created[k.key] = 0;
      });

      /* The real id a reference means: an id being created now, an existing record's id, null when it
         points at nothing that will exist, or undefined when it names something this very request was
         supposed to contain and does not (the caller's mistake). */
      function resolve(kind, tmpId, name) {
        var items = payload[kind], i;
        if (fill[kind]) {
          if (tmpId) for (i = 0; i < items.length; i++) if (items[i].tmpId === tmpId) return newIds[kind][i];
          if (name) for (i = 0; i < items.length; i++) if (sameName(items[i].title, name)) return newIds[kind][i];
          return (tmpId || name) ? undefined : null;
        }
        // the target is not being created (the event already has its own): find the real record it means
        var wanted = name;
        if (!wanted && tmpId) for (i = 0; i < items.length; i++) if (items[i].tmpId === tmpId) wanted = items[i].title;
        for (i = 0; i < existing[kind].length; i++) {
          if ((tmpId && existing[kind][i].id === tmpId) || sameName(existing[kind][i].name, wanted)) return existing[kind][i].id;
        }
        // sent but not created (the event keeps its own): the record falls back to a default. Never sent
        // at all: the request points at something it does not contain.
        return items.length || !(tmpId || name) ? null : undefined;
      }
      function defaultParent(k) {
        var pk = k.parent.kind;
        if (fill[pk]) return newIds[pk][0];
        if (existing[pk].length) return existing[pk][0].id;
        if (!autoParent[pk]) {
          var ref = eRef.collection(pk).doc(), data = Object.assign({}, k.parent.fallback);
          if (pk === 'agendaGroups') data.date = ymd(ev.start) ? String(ev.start).slice(0, 10) : '';
          data.order = 0; data.createdAt = now; data.updatedAt = now; data.createdBy = by;
          writes.push({ ref: ref, data: data });
          created[pk]++;
          autoParent[pk] = ref.id;
        }
        return autoParent[pk];
      }

      SEED_KINDS.forEach(function (k) {
        if (!fill[k.key]) return;
        payload[k.key].forEach(function (item, i) {
          var data = Object.assign({}, item.data), label = k.noun + ' ' + item.n + (item.title ? ' (' + item.title.slice(0, 60) + ')' : '');
          if (k.parent) {
            var pid = resolve(k.parent.kind, item.parentId, item.parentName);
            if (pid === undefined) {
              throw httpError(400, label + ' refers to a ' + SEED_BY_KEY[k.parent.kind].noun.toLowerCase() + ' ("' + (item.parentName || item.parentId) + '") that is not in this request.');
            }
            data[k.parent.idField] = pid || defaultParent(k);
          }
          if (k.key === 'sessions') {
            var ids = [];
            item.speakerIds.map(function (id) { return { id: id, name: '' }; })
              .concat(item.speakerNames.map(function (n) { return { id: '', name: n }; }))
              .forEach(function (refd) {
                var sid = resolve('speakers', refd.id, refd.name);
                if (sid === undefined) throw httpError(400, label + ' refers to a speaker ("' + (refd.name || refd.id) + '") that is not in this request.');
                if (sid && ids.indexOf(sid) === -1) ids.push(sid);
              });
            data.speakerIds = ids;
          }
          data.order = i; data.createdAt = now; data.updatedAt = now; data.createdBy = by;
          writes.push({ ref: eRef.collection(k.key).doc(newIds[k.key][i]), data: data });
          created[k.key]++;
        });
      });

      if (writes.length) {
        writes.forEach(function (w) { tx.set(w.ref, w.data); });
        // Also what makes two seeds sent at the same moment (a double click) safe: both read the event
        // and both write it, so Firestore runs them one after the other and the second finds the
        // collections already filled.
        tx.update(eRef, { contentSeededAt: now });
      }
      return { created: created, skipped: skipped };
    });
  });
}

/* The same thing as a plain function, for a backend module that has content to add without a request of
   its own (generation from a brief). `body` is the route's payload; resolves { created, skipped } and
   rejects with the route's own errors (err.status, err.message). */
function seedContent(fb, eventId, body, decoded) {
  return Promise.resolve().then(function () {
    if (!validEventId(eventId)) throw httpError(400, 'A valid eventId is required.');
    return seedTransaction(fb, eventId, decoded, readSeedPayload(isObj(body) ? body : {}));
  });
}

function handleSeed(req, res) {
  requireAdmin(req, res, function (fb, decoded) {
    guard(res, sendJson, 'add this content', function () {
      parseJsonBody(req, res, function (body) {
        guard(res, sendJson, 'add this content', function () {
          var eventId = bodyId(body.eventId);
          if (!validEventId(eventId)) return sendJson(res, 400, { error: 'A valid eventId is required.' });
          var payload = readSeedPayload(body);
          seedTransaction(fb, eventId, decoded, payload).then(function (result) {
            var parts = SEED_KINDS.filter(function (k) { return result.created[k.key] > 0; }).map(function (k) {
              var n = result.created[k.key];
              return n + ' ' + k.noun.toLowerCase() + (n === 1 ? '' : 's');
            });
            var logged = parts.length ? logActivity(fb, eventId, decoded, 'content-seeded', parts.join(', ')) : Promise.resolve();
            return logged.then(function () { sendJson(res, 200, result); });
          }).catch(function (err) { answerError(res, sendJson, err, 'add this content'); });
        });
      }, MAX_SEED_BODY);
    });
  });
}

/* =====================================================================================================
   REGISTER — POST /api/register
   The one route anybody on the internet can write through. Body { eventId, formId?, answers: { fieldId:
   value }, website, source?, utm?, ref?, preview? }: a response to one of the event's forms (no formId: its
   default form). A page from before forms sends name / email / phone / company / designation / city at the
   top level and no `answers`; that is read as the answers it is. In order, cheapest check first, so that
   a request that is going to be refused costs as little as possible:
     per-address rate limit -> 32 KB body cap -> a JSON object -> honeypot -> per-event-and-address limit
     -> the event exists and is published (or this is an admin's test from the preview) -> registration is
     open -> the form exists and takes responses -> the answers are what the form asks for -> then ONE
     transaction that decides duplicate / approval / capacity and stores the response together with every
     total it changes.
   Errors are read by visitors, in the form, next to the field: { error, code, fields: { fieldId: message } }.
   ===================================================================================================== */

var MAX_REGISTER_BODY = 32 * 1024;
var REGISTER_LIMIT = 30, REGISTER_WINDOW_MS = 5 * 60 * 1000;     // per address; an office behind one address can still sign up
var REGISTER_EVENT_LIMIT = 10;                                    // per address and event, in the same window

function deviceClass(req) {
  var ua = String((req.headers && req.headers['user-agent']) || '');
  if (/iPad|Tablet|PlayBook|Silk|(Android(?!.*Mobile))/i.test(ua)) return 'tablet';
  if (/Mobi|Android|iPhone|iPod|Windows Phone|BlackBerry/i.test(ua)) return 'mobile';
  return ua ? 'desktop' : '';
}
/* The host of a web address (or of something that is already a host), lower-cased; '' if neither. */
function hostOf(v) {
  var s = line(v, 500).toLowerCase();
  if (!s) return '';
  var m = /^(?:[a-z][a-z0-9+.-]*:\/\/)?([a-z0-9.-]+)(?::\d+)?(?:[/?#].*)?$/.exec(s);
  return m && m[1].indexOf('.') !== -1 ? m[1].replace(/^www\./, '').slice(0, 120) : '';
}
/* Where the visitor came from, never this site itself (a page's own address is not a source). */
function referrerHost(req, given) {
  var own = hostOf(String((req.headers && req.headers.host) || ''));
  var h = hostOf(given) || hostOf(req.headers && req.headers.referer);
  return h && h !== own ? h : '';
}

function registerError(status, message, code, fields) {
  var extra = { code: code };
  if (fields) extra.fields = fields;
  return httpError(status, message, extra);
}
function duplicateError() {
  return registerError(409, DUPLICATE_MESSAGE, 'duplicate', { email: DUPLICATE_MESSAGE });
}

/* The transaction, for every response that was waiting for this event (see enqueue). Everything it
   decides, it decides on what it has just read inside the transaction — the event's settings and totals
   and each form as they are at that instant, not as they were when each request arrived — and one
   response's refusal (a duplicate, a form closed meanwhile) never affects the others in the same write.
   Resolves one { value } or { error } per item; rejects (for all of them) when the event itself takes no
   registrations. An item is { reg, formId, answers, answerLabels }. */
var REGISTER_BATCH = 50;
function storeRegistrations(fb, eventId, items) {
  var refs = audienceRefs(fb, eventId), formsCol = refs.event.collection('forms');
  var formIds = [];
  items.forEach(function (it) { if (formIds.indexOf(it.formId) === -1) formIds.push(it.formId); });
  return fb.db.runTransaction(function (tx) {
    var reads = [tx.get(refs.event), tx.get(refs.agg)].concat(formIds.map(function (id) { return tx.get(formsCol.doc(id)); }));
    return Promise.all(reads).then(function (first) {
      var ev = liveEvent(first[0]);
      if (!ev || ev.published !== true) throw registerError(404, NOT_AVAILABLE, 'unavailable');
      var settings = registrationSettings(ev);
      if (!settings.open) throw registerError(403, CLOSED_MESSAGE, 'closed');
      if (!hasAudienceCounters(ev)) throw NEEDS_COUNTERS;

      var formsById = Object.create(null), lazy = false;
      formIds.forEach(function (id, i) {
        var snap = first[2 + i];
        if (snap.exists) formsById[id] = forms.storedForm(id, snap.data());
        else if (id === DEFAULT_FORM_ID) lazy = true;
      });
      /* an event that never saved a form answers with the form its original settings describe */
      var empty = lazy ? tx.get(formsCol.limit(1)).then(function (s) { return s.empty; }) : Promise.resolve(false);
      return empty.then(function (isEmpty) {
        if (isEmpty) formsById[DEFAULT_FORM_ID] = forms.legacyDefaultForm(ev);
        // One response per e-mail and form is the document's own id, which covers every response made
        // while its form rejected duplicates; the query covers the rest, for the events that have any (see
        // EMAIL_ID_PREFIX).
        var loose = ev.counters.looseIds === true;
        var plans = items.map(function (it) {
          var form = formsById[it.formId];
          if (!form) return { error: registerError(404, FORM_MISSING_MESSAGE, 'form-missing') };
          if (form.open === false) return { error: registerError(403, FORM_CLOSED_MESSAGE, 'form-closed') };
          var reject = form.duplicates !== 'allow';
          return { it: it, form: form, reject: reject, ref: reject ? refs.regs.doc(forms.regDocId(form.id, it.reg.email)) : refs.regs.doc() };
        });
        return Promise.all(plans.map(function (p) {
          if (p.error || !p.reject) return null;
          return Promise.all([tx.get(p.ref), loose ? tx.get(refs.regs.where('email', '==', p.it.reg.email).limit(50)) : null]);
        })).then(function (dups) {
          var now = new Date(), nowIso = now.toISOString(), day = dayKey(now.getTime());
          var confirmed = num(ev.counters.confirmed), delta = { forms: {} }, counted = 0, submitted = 0, newLoose = false;
          var stored = first[1].exists ? (first[1].data() || {}) : {}, agg = {}, aggAdded = {}, seen = Object.create(null);
          AGG_DIMS.forEach(function (d) { agg[d] = Object.assign({}, isObj(stored[d]) ? stored[d] : {}); });

          var results = plans.map(function (p, i) {
            if (p.error) return { error: p.error };
            var key = p.form.id + '\n' + p.it.reg.email;
            if (p.reject) {
              var sameForm = function (d) { return (d.get('formId') || DEFAULT_FORM_ID) === p.form.id; };
              if (seen[key] || dups[i][0].exists || (dups[i][1] && dups[i][1].docs.some(sameForm))) return { error: duplicateError() };
            }
            seen[key] = true;
            var counts = p.form.countsAsRegistration === true;
            var status = forms.planStatus({ counts: counts, needsApproval: p.form.needsApproval === true, capacity: settings.capacity, confirmed: confirmed });
            if (counts && status === 'confirmed') confirmed++;
            var doc = Object.assign({}, p.it.reg, {
              formId: p.form.id, formName: p.form.name, counts: counts,
              answers: p.it.answers, answerLabels: p.it.answerLabels,
              status: status, notes: '',
              // online payment is not available; kept so that older readers of this record find the field
              payment: { required: false, status: 'n/a', amount: 0, txnId: null },
              createdAt: nowIso, checkedInAt: null, decidedAt: null, decidedBy: null
            });
            tx.set(p.ref, doc);
            addDelta(delta, contribution(doc), 1);
            submitted++;
            if (!p.reject) newLoose = true;
            if (counts) {
              counted++;
              var vals = aggValues(doc);
              AGG_DIMS.forEach(function (d) {
                var slot = aggSlot(agg[d], vals[d]);
                if (!slot) return;
                if (!agg[d][slot.key]) agg[d][slot.key] = { l: slot.label, c: 0 };      // so the list's size limit sees it
                if (!aggAdded[d]) aggAdded[d] = {};
                if (!aggAdded[d][slot.key]) aggAdded[d][slot.key] = { l: slot.label, n: 0 };
                aggAdded[d][slot.key].n++;
              });
            }
            return { value: { id: p.ref.id, status: status, formId: p.form.id, successMessage: p.form.successMessage } };
          });

          if (submitted) {
            applyCounters(tx, refs.event, pruneDelta(delta), newLoose && !loose ? [[new FieldPath('counters', 'looseIds'), true]] : null);
            var daily = { date: day, submissions: FieldValue.increment(submitted) };
            if (counted) daily.registrations = FieldValue.increment(counted);
            tx.set(refs.stats.doc(day), daily, { merge: true });
            var aggPatch = {};
            Object.keys(aggAdded).forEach(function (d) {
              aggPatch[d] = {};
              Object.keys(aggAdded[d]).forEach(function (k) { aggPatch[d][k] = { l: aggAdded[d][k].l, c: FieldValue.increment(aggAdded[d][k].n) }; });
            });
            if (Object.keys(aggPatch).length) tx.set(refs.agg, aggPatch, { merge: true });
          }
          return results;
        });
      });
    });
  }, { maxAttempts: 8 });
}
function storeRegistration(fb, eventId, item) {
  return enqueue('register:' + eventId, item, REGISTER_BATCH, function (batch) {
    return withAudienceCounters(fb, eventId, function () { return storeRegistrations(fb, eventId, batch); });
  });
}

function handleRegister(req, res) {
  guard(res, sendPublicJson, 'complete your registration', function () {
    if (!rateLimit('register:' + clientIp(req), REGISTER_LIMIT, REGISTER_WINDOW_MS)) {
      // the body is never read: drain it so the connection closes cleanly
      try { req.resume(); } catch (e) { /* already consumed */ }
      return sendPublicJson(res, 429, { error: 'Too many registrations from this network. Please try again in a few minutes.', code: 'rate-limited' },
        { 'Retry-After': String(REGISTER_WINDOW_MS / 1000) });
    }
    readBody(req, res, function (raw) {
      guard(res, sendPublicJson, 'complete your registration', function () {
        var body;
        try { body = parseJsonObject(raw); }
        catch (e) { return sendPublicJson(res, 400, { error: 'We could not read that registration. Please reload the page and try again.', code: 'invalid' }); }

        var eventId = bodyId(body.eventId);
        if (!validEventId(eventId)) {
          return sendPublicJson(res, 400, { error: 'This registration form is not linked to an event. Please reload the page and try again.', code: 'invalid' });
        }
        var formId = body.formId == null || body.formId === '' ? '' : body.formId;
        if (formId && (typeof formId !== 'string' || !forms.FORM_ID_RE.test(formId))) {
          return sendPublicJson(res, 400, { error: 'This form is not linked correctly. Please reload the page and try again.', code: 'invalid' });
        }
        // A person never sees, so never fills, the "website" field; a form-filling script does. It is told
        // what a person would be told and nothing is stored — or even looked up.
        if (line(body.website, 500)) {
          return sendPublicJson(res, 200, { ok: true, id: 'r' + crypto.randomBytes(10).toString('hex'), status: 'confirmed', formId: formId || DEFAULT_FORM_ID, message: DEFAULT_SUCCESS });
        }
        if (!rateLimit('register-ev:' + eventId + ':' + clientIp(req), REGISTER_EVENT_LIMIT, REGISTER_WINDOW_MS)) {
          return sendPublicJson(res, 429, { error: 'Too many registrations from this network. Please try again in a few minutes.', code: 'rate-limited' },
            { 'Retry-After': String(REGISTER_WINDOW_MS / 1000) });
        }
        var preview = body.preview === true;

        var fb = getFirebase();
        if (fb.error) return sendPublicJson(res, 503, { error: UNAVAILABLE, code: 'unavailable' });

        eventDoc(fb, eventId).get().then(function (snap) {
          var ev = liveEvent(snap);
          if (!ev) throw registerError(404, NOT_AVAILABLE, 'unavailable');
          // a test from the preview is an admin's privilege; a draft takes no registrations from anyone else
          var allowed = preview ? adminFromRequest(req) : Promise.resolve(null);
          return allowed.then(function (who) {
            if (preview && !who) throw registerError(401, 'Sign in to test registration from the preview.', 'sign-in');
            if (!preview && ev.published !== true) throw registerError(404, NOT_AVAILABLE, 'unavailable');
            var settings = registrationSettings(ev);
            if (!settings.open) throw registerError(403, CLOSED_MESSAGE, 'closed');
            return formsApi().loadForm(fb, eventId, ev, formId).then(function (form) {
              if (!form) throw registerError(404, FORM_MISSING_MESSAGE, 'form-missing');
              if (form.open === false) throw registerError(403, FORM_CLOSED_MESSAGE, 'form-closed');

              // only what this form asks for is kept; what it requires must be there
              var read = forms.validateAnswers(form, body);
              var first = forms.firstFieldError(form, read.errors);
              if (first) throw registerError(400, first.message, 'invalid', first.fields);
              if (read.tooLong) throw registerError(400, 'Your answers are too long.', 'invalid');

              if (preview) {
                var counts = form.countsAsRegistration === true;
                var status = forms.planStatus({ counts: counts, needsApproval: form.needsApproval === true, capacity: settings.capacity,
                  confirmed: num(isObj(ev.counters) ? ev.counters.confirmed : 0) });
                return sendPublicJson(res, 200, { ok: true, preview: true, id: null, status: status, formId: form.id,
                  message: form.successMessage + forms.PREVIEW_NOTE });
              }
              var reg = read.reg;
              reg.device = deviceClass(req);
              reg.referrer = referrerHost(req, body.ref);
              return storeRegistration(fb, eventId, { reg: reg, formId: form.id, answers: read.answers, answerLabels: read.answerLabels }).then(function (stored) {
                sendPublicJson(res, 200, { ok: true, id: stored.id, status: stored.status, formId: stored.formId,
                  message: stored.status === 'waitlist' ? WAITLIST_MESSAGE : stored.successMessage });
              });
            });
          });
        }).catch(function (err) { answerError(res, sendPublicJson, err, 'complete your registration'); });
      });
    }, MAX_REGISTER_BODY);
  });
}

/* =====================================================================================================
   REGISTRATIONS — list / update / delete / export (admin)
   Every response to every form. A response stored before forms existed has no formId, counts or answers:
   it is read as a response to the form "register" that counts, with no further answers, and the list's
   first page writes that down on it (repairFormIds) so that a query by form finds it.
   ===================================================================================================== */

/* A response as Reporting gets it. A response from before first and last names has only `name` (firstName and
   lastName are ''); one from before the Mobile and Location fields has its phone as typed (phoneDisplay is
   that, phoneCountry '') and no location. */
function publicRegistration(id, r) {
  r = r || {};
  var utm = isObj(r.utm) ? r.utm : {}, lp = isObj(r.locationParts) ? r.locationParts : null;
  return {
    id: id, name: r.name || '', firstName: r.firstName || '', lastName: r.lastName || '', email: r.email || '',
    phone: r.phone || '', phoneCountry: r.phoneCountry || '', phoneDisplay: phone.formatPhone(r.phone || ''),
    company: r.company || '', designation: r.designation || '', city: r.city || '',
    location: r.location || '',
    locationParts: lp ? { city: lp.city || '', state: lp.state || '', country: lp.country || '', countryCode: lp.countryCode || '', verified: lp.verified === true } : null,
    source: r.source || '',
    utm: { source: utm.source || '', medium: utm.medium || '', campaign: utm.campaign || '' },
    device: r.device || '', referrer: r.referrer || '',
    formId: typeof r.formId === 'string' && r.formId ? r.formId : DEFAULT_FORM_ID,
    formName: typeof r.formName === 'string' ? r.formName : '',
    counts: r.counts !== false,
    answers: isObj(r.answers) ? r.answers : {}, answerLabels: isObj(r.answerLabels) ? r.answerLabels : {},
    status: normStatus(r.status), notes: r.notes || '',
    tags: Array.isArray(r.tags) ? r.tags.filter(function (t) { return typeof t === 'string'; }) : [],
    createdAt: r.createdAt || null, checkedInAt: r.checkedInAt || null, updatedAt: r.updatedAt || null,
    decidedAt: r.decidedAt || null, decidedBy: r.decidedBy || null
  };
}

/* The list is ordered by createdAt, and Firestore leaves a document that has no such field out of an
   ordered query altogether — so a registration written by anything other than POST /api/register (an
   import, a hand edit in the console) would be missing from the list while the totals counted it, or the
   other way round. Two counts say whether the event has any; if it does, each one is given the time
   Firestore itself recorded for its creation, and the event's totals are worked out again from the
   registrations, so the list, the total and the report agree. Resolves true when something was changed. */
function dateUndatedRegistrations(fb, eventId) {
  var refs = audienceRefs(fb, eventId);
  return Promise.all([refs.regs.count().get(), refs.regs.orderBy('createdAt').count().get()]).then(function (counts) {
    if (counts[0].data().count === counts[1].data().count) return false;
    return refs.regs.select('createdAt').get().then(function (snap) {
      var undated = snap.docs.filter(function (d) { return d.get('createdAt') === undefined; });
      var writes = [];
      for (var i = 0; i < undated.length; i += 400) {
        var batch = fb.db.batch();
        undated.slice(i, i + 400).forEach(function (d) {
          batch.update(d.ref, { createdAt: d.createTime ? d.createTime.toDate().toISOString() : new Date().toISOString() });
        });
        writes.push(batch.commit());
      }
      return Promise.all(writes);
    }).then(function () {
      /* without the marker the next step (and any registration arriving meanwhile) recounts from scratch */
      return refs.event.update({ 'counters.audienceV': FieldValue.delete() });
    }).then(function () { return rebuildAudience(fb, eventId); }).then(function () { return true; });
  });
}

/* Responses stored before forms have no formId, and a query by form would never find them. The same two-
   count test as above says whether there are any (an ordered query leaves out a document without the
   field); up to `max` of them are then given formId "register", that form's name and counts: true — what
   every reader already took them to be, so no total moves. Resolves how many were written. */
var LEGACY_REPAIR_MAX = 500;
function repairFormIds(fb, eventId, max) {
  var refs = audienceRefs(fb, eventId);
  return Promise.all([refs.regs.count().get(), refs.regs.orderBy('formId').count().get()]).then(function (counts) {
    if (counts[0].data().count === counts[1].data().count) return 0;
    return Promise.all([refs.regs.select('formId').get(), refs.event.collection('forms').doc(DEFAULT_FORM_ID).get()]).then(function (r) {
      var missing = r[0].docs.filter(function (d) { return d.get('formId') === undefined; }).slice(0, max || LEGACY_REPAIR_MAX);
      var name = (r[1].exists && line(r[1].get('name'), 80)) || 'Register now';
      var writes = [];
      for (var i = 0; i < missing.length; i += 400) {
        var batch = fb.db.batch();
        missing.slice(i, i + 400).forEach(function (d) { batch.update(d.ref, { formId: DEFAULT_FORM_ID, formName: name, counts: true }); });
        writes.push(batch.commit());
      }
      return Promise.all(writes).then(function () { return missing.length; });
    });
  });
}

/* Firestore answers FAILED_PRECONDITION while a composite index (firestore.indexes.json: registrations by
   formId, newest first) has not been built yet. */
function isMissingIndex(err) { return !!err && (err.code === 9 || err.code === 'failed-precondition' || /FAILED_PRECONDITION|requires an index/i.test(String(err.message || ''))); }
function formOf(r) { return (r && typeof r.formId === 'string' && r.formId) || DEFAULT_FORM_ID; }

/* One page of one form's responses, newest first, after the document `after` (a snapshot, or null):
   -> { docs, more, partial, next }. By the index when it is there; otherwise by reading the event's
   responses in order and keeping that form's, at most SCAN_MAX of them per page — `partial` then says the
   page stopped early and `next` is where the next page starts reading. */
var SCAN_CHUNK = 500, SCAN_MAX = 5000;
function formPage(refs, formId, after, limit) {
  var q = refs.regs.where('formId', '==', formId).orderBy('createdAt', 'desc');
  if (after) q = q.startAfter(after);
  return q.limit(limit + 1).get().then(function (snap) {
    var docs = snap.docs, more = docs.length > limit;
    if (more) docs = docs.slice(0, limit);
    return { docs: docs, more: more, partial: false, next: more ? docs[docs.length - 1].id : null };
  }, function (err) {
    if (!isMissingIndex(err)) throw err;
    console.warn('audience: the registrations-by-form index is not built yet; scanning instead');
    var kept = [], scanned = 0, last = after, done = false;
    function step() {
      var sq = refs.regs.orderBy('createdAt', 'desc');
      if (last) sq = sq.startAfter(last);
      return sq.limit(SCAN_CHUNK).get().then(function (snap) {
        snap.docs.forEach(function (d) {
          if (kept.length > limit) return;
          scanned++;
          last = d;
          if (formOf(d.data()) === formId) kept.push(d);
        });
        if (snap.docs.length < SCAN_CHUNK) done = true;
        if (done || kept.length > limit || scanned >= SCAN_MAX) return null;
        return step();
      });
    }
    return step().then(function () {
      var more = kept.length > limit, docs = more ? kept.slice(0, limit) : kept;
      var partial = !more && !done;
      return { docs: docs, more: more || partial, partial: partial, next: more ? docs[docs.length - 1].id : partial && last ? last.id : null };
    });
  });
}

/* Newest first. `limit` (default 1000, at most 5000) and `cursor` (the nextCursor of the page before)
   page through an event of any size; `total` is the event's real number of responses (to the form
   `formId`, when one is given). */
function handleRegistrationsList(req, res) {
  requireAdmin(req, res, function (fb) {
    guard(res, sendJson, 'load the registrations', function () {
      var qs = query(req), eventId = str(qs.get('eventId'), 100);
      if (!validEventId(eventId)) return sendJson(res, 400, { error: 'A valid eventId is required.' });
      var limit = intParam(qs.get('limit'), 1000, 1, 5000), cursor = str(qs.get('cursor'), 200), formId = str(qs.get('formId'), 60);
      var refs = audienceRefs(fb, eventId);
      if (cursor && !isDocId(cursor)) return sendJson(res, 400, { error: 'That page of registrations could not be found. Reload the list.' });
      if (formId && !forms.FORM_ID_RE.test(formId)) return sendJson(res, 400, { error: 'That form could not be found.' });

      Promise.all([refs.event.get(), cursor ? refs.regs.doc(cursor).get() : null]).then(function (r) {
        var ev = liveEvent(r[0]);
        if (!ev) throw httpError(404, 'No event found for "' + eventId + '".');
        if (cursor && !r[1].exists) throw httpError(400, 'That page of registrations could not be found. Reload the list.');
        /* checked when the list is opened (its first page), not on every page of it */
        var ready = cursor ? Promise.resolve(ev) : Promise.all([dateUndatedRegistrations(fb, eventId), repairFormIds(fb, eventId)]).then(function (changed) {
          return changed[0] ? refs.event.get().then(function (snap) { return liveEvent(snap) || ev; }) : ev;
        });
        return ready.then(function (ev) {
          var page;
          if (formId) page = formPage(refs, formId, cursor ? r[1] : null, limit);
          else {
            var q = refs.regs.orderBy('createdAt', 'desc');
            if (cursor) q = q.startAfter(r[1]);
            page = q.limit(limit + 1).get().then(function (snap) {
              var docs = snap.docs, more = docs.length > limit;
              if (more) docs = docs.slice(0, limit);
              return { docs: docs, more: more, partial: false, next: more ? docs[docs.length - 1].id : null };
            });
          }
          var total;
          if (hasAudienceCounters(ev)) {
            var c = ev.counters;
            total = Promise.resolve(formId ? num(isObj(c.forms) && isObj(c.forms[formId]) ? c.forms[formId].n : 0) : num(c.submissions));
          } else {
            total = (formId ? refs.regs.where('formId', '==', formId) : refs.regs).count().get().then(function (x) { return x.data().count; });
          }
          return Promise.all([page, total]).then(function (out) {
            var body = {
              items: out[0].docs.map(function (d) { return publicRegistration(d.id, d.data()); }),
              total: out[1],
              nextCursor: out[0].next
            };
            if (out[0].partial) body.partial = true;
            sendJson(res, 200, body);
          });
        });
      }).catch(function (err) { answerError(res, sendJson, err, 'load the registrations'); });
    });
  });
}

/* PATCH { eventId, id, status?, checkedIn?, notes?, tags? } -> 200 { ok, registration } — the record as it
   now is, so the row can be redrawn from the answer. For the pages that use it:
     status      confirmed | waitlist | pending | rejected | cancelled
                 (waitlist only for a form that counts as a registration; moving a response out of
                 "pending" is approving or declining it, and records who did it and when)
     checkedIn   true / false -> checkedInAt (ISO) / null
     notes       text, at most 2,000 characters
     tags        at most 20 labels of at most 40 characters; trimmed, repeats dropped
   404 for an id that is not there. */
function cleanTags(v) {
  if (!Array.isArray(v) || v.length > 20) return null;
  var out = [];
  for (var i = 0; i < v.length; i++) {
    if (typeof v[i] !== 'string') return null;
    var t = line(v[i], 200);
    if (!t || t.length > 40) return null;
    if (out.indexOf(t) === -1) out.push(t);
  }
  return out;
}

function handleRegistrationUpdate(req, res) {
  requireAdmin(req, res, function (fb, decoded) {
    guard(res, sendJson, 'update this registration', function () {
      parseJsonBody(req, res, function (body) {
        guard(res, sendJson, 'update this registration', function () {
          var eventId = bodyId(body.eventId), id = typeof body.id === 'string' ? body.id.trim() : '';
          if (!validEventId(eventId)) return sendJson(res, 400, { error: 'A valid eventId is required.' });
          if (!isDocId(id)) return sendJson(res, 400, { error: 'A valid registration id is required.' });
          var has = function (k) { return Object.prototype.hasOwnProperty.call(body, k) && body[k] !== undefined; };
          if (!has('status') && !has('checkedIn') && !has('notes') && !has('tags')) {
            return sendJson(res, 400, { error: 'Nothing to change — send status, checkedIn, notes or tags.' });
          }
          var tags = has('tags') ? cleanTags(body.tags) : null;
          if (has('tags') && !tags) return sendJson(res, 400, { error: 'Tags must be a list of at most 20 labels, each up to 40 characters.', field: 'tags' });
          if (has('status') && REG_STATUSES.indexOf(body.status) === -1) {
            return sendJson(res, 400, { error: 'Status must be one of: ' + REG_STATUSES.join(', ') + '.' });
          }
          if (has('checkedIn') && typeof body.checkedIn !== 'boolean') {
            return sendJson(res, 400, { error: 'checkedIn must be true or false.' });
          }
          if (has('notes') && typeof body.notes !== 'string') return sendJson(res, 400, { error: 'Notes must be text.' });
          if (has('notes') && body.notes.length > 2000) return sendJson(res, 400, { error: 'Notes can be at most 2,000 characters.' });

          var refs = audienceRefs(fb, eventId), regRef = refs.regs.doc(id);
          withAudienceCounters(fb, eventId, function () {
            return fb.db.runTransaction(function (tx) {
              return Promise.all([tx.get(refs.event), tx.get(regRef)]).then(function (r) {
                var ev = liveEvent(r[0]);
                if (!ev) throw httpError(404, 'No event found for "' + eventId + '".');
                if (!r[1].exists) throw httpError(404, 'That registration no longer exists.');
                if (!hasAudienceCounters(ev)) throw NEEDS_COUNTERS;
                var old = r[1].data() || {}, oldStatus = normStatus(old.status);
                var status = has('status') ? body.status : oldStatus;
                if (status === 'waitlist' && oldStatus !== 'waitlist' && old.counts === false) {
                  throw httpError(400, 'Only forms that count as registrations have a waitlist.', { field: 'status' });
                }
                var checkedInAt = old.checkedInAt || null;
                if (has('checkedIn')) checkedInAt = body.checkedIn ? (old.checkedInAt || new Date().toISOString()) : null;
                if ((status === 'cancelled' || status === 'rejected') && has('checkedIn') && body.checkedIn) {
                  throw httpError(409, 'A ' + (status === 'rejected' ? 'declined' : 'cancelled') + ' registration cannot be checked in. Change its status first.');
                }
                var nowIso = new Date().toISOString(), actor = actorOf(decoded);
                var patch = { status: status, checkedInAt: checkedInAt, updatedAt: nowIso, updatedBy: actor };
                if (oldStatus === 'pending' && status !== 'pending') { patch.decidedAt = nowIso; patch.decidedBy = actor; }
                if (has('notes')) patch.notes = multiline(body.notes, 2000);
                if (tags) patch.tags = tags;
                tx.update(regRef, patch);
                var now = Object.assign({}, old, patch);
                applyCounters(tx, refs.event, counterDelta(old, now));

                var changes = [];
                if (status !== oldStatus) {
                  changes.push(oldStatus === 'pending' && status === 'confirmed' ? 'approved'
                    : status === 'rejected' ? 'declined' : 'marked ' + status);
                }
                if (!!checkedInAt !== !!old.checkedInAt) changes.push(checkedInAt ? 'checked in' : 'check-in undone');
                if (has('notes') && patch.notes !== (old.notes || '')) changes.push('note edited');
                if (tags && JSON.stringify(tags) !== JSON.stringify(Array.isArray(old.tags) ? old.tags : [])) changes.push(tags.length ? 'tagged ' + tags.join(', ') : 'tags removed');
                return { registration: publicRegistration(id, now), changes: changes, name: old.name || old.email || id };
              });
            });
          }).then(function (out) {
            var logged = out.changes.length
              ? logActivity(fb, eventId, decoded, 'registration-updated', out.name + ' — ' + out.changes.join(', '))
              : Promise.resolve();
            return logged.then(function () { sendJson(res, 200, { ok: true, registration: out.registration }); });
          }).catch(function (err) { answerError(res, sendJson, err, 'update this registration'); });
        });
      }, 64 * 1024);
    });
  });
}

function handleRegistrationDelete(req, res) {
  requireAdmin(req, res, function (fb, decoded) {
    guard(res, sendJson, 'delete this registration', function () {
      var qs = query(req), eventId = str(qs.get('eventId'), 100), id = str(qs.get('id'), 200);
      if (!validEventId(eventId)) return sendJson(res, 400, { error: 'A valid eventId is required.' });
      if (!isDocId(id)) return sendJson(res, 400, { error: 'A valid registration id is required.' });
      var refs = audienceRefs(fb, eventId), regRef = refs.regs.doc(id);

      withAudienceCounters(fb, eventId, function () {
        return fb.db.runTransaction(function (tx) {
          return Promise.all([tx.get(refs.event), tx.get(regRef), tx.get(refs.agg)]).then(function (r) {
            var ev = liveEvent(r[0]);
            if (!ev) throw httpError(404, 'No event found for "' + eventId + '".');
            if (!r[1].exists) throw httpError(404, 'That registration no longer exists.');
            if (!hasAudienceCounters(ev)) throw NEEDS_COUNTERS;
            var old = r[1].data() || {}, counted = old.counts !== false;
            tx.delete(regRef);

            // every total this response was counted in gives it back
            applyCounters(tx, refs.event, counterDelta(old, null));
            var day = dayOfIso(old.createdAt);
            if (day) {
              var daily = { date: day, submissions: FieldValue.increment(-1) };
              if (counted) daily.registrations = FieldValue.increment(-1);
              tx.set(refs.stats.doc(day), daily, { merge: true });
            }
            if (counted) {
              var agg = r[2].exists ? (r[2].data() || {}) : {}, vals = aggValues(old), aggPatch = {};
              AGG_DIMS.forEach(function (d) {
                if (!vals[d] || !isObj(agg[d])) return;
                var key = aggKeyOf(vals[d]);
                if (!isObj(agg[d][key])) key = AGG_OTHER;
                if (!isObj(agg[d][key]) || num(agg[d][key].c) < 1) return;
                aggPatch[d] = {};
                aggPatch[d][key] = { c: FieldValue.increment(-1) };
              });
              if (Object.keys(aggPatch).length) tx.set(refs.agg, aggPatch, { merge: true });
            }
            return old.name || old.email || id;
          });
        });
      }).then(function (name) {
        return logActivity(fb, eventId, decoded, 'registration-deleted', name).then(function () { sendJson(res, 200, { ok: true }); });
      }).catch(function (err) { answerError(res, sendJson, err, 'delete this registration'); });
    });
  });
}

/* GET /api/event/registrations/export?eventId=&formId=&status= — the responses as a CSV file a spreadsheet
   opens (UTF-8 with a byte-order mark, every cell quoted, nothing a spreadsheet would run as a formula),
   newest first, at most EXPORT_MAX rows. The columns every response has, then one per answer: with a form,
   that form's questions in its current order (and any answer to a question it no longer has); for every
   form, each question in the order it is first met, headed by its label. */
var EXPORT_MAX = 50000, EXPORT_SCAN_MAX = 200000, EXPORT_CHUNK = 1000;
function istStamp(iso) {
  var t = Date.parse(iso);
  return isNaN(t) ? '' : new Date(t + IST_OFFSET_MS).toISOString().slice(0, 16).replace('T', ' ');
}
function exportCell(v) {
  if (v == null) return '';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (Array.isArray(v)) return v.map(function (x) { return x == null ? '' : String(x); }).join('; ');
  if (typeof v === 'object') return '';
  return String(v);
}
/* the event's responses, newest first, filtered — by the form index when it is there, else in memory */
function exportRows(refs, formId, status) {
  var rows = [];
  function keep(d) {
    var r = d.data() || {};
    if (formId && formOf(r) !== formId) return;
    if (status && normStatus(r.status) !== status) return;
    if (rows.length < EXPORT_MAX) rows.push({ id: d.id, r: r });
  }
  function walk(base) {
    var scanned = 0, last = null;
    function step() {
      var q = base;
      if (last) q = q.startAfter(last);
      return q.limit(EXPORT_CHUNK).get().then(function (snap) {
        snap.docs.forEach(function (d) { scanned++; last = d; keep(d); });
        if (snap.docs.length < EXPORT_CHUNK || rows.length >= EXPORT_MAX || scanned >= EXPORT_SCAN_MAX) return rows;
        return step();
      });
    }
    return step();
  }
  if (!formId) return walk(refs.regs.orderBy('createdAt', 'desc'));
  return walk(refs.regs.where('formId', '==', formId).orderBy('createdAt', 'desc')).catch(function (err) {
    if (!isMissingIndex(err)) throw err;
    rows = [];
    return walk(refs.regs.orderBy('createdAt', 'desc'));
  });
}
function handleRegistrationsExport(req, res) {
  requireAdmin(req, res, function (fb) {
    guard(res, sendJson, 'export the registrations', function () {
      var qs = query(req), eventId = str(qs.get('eventId'), 100), formId = str(qs.get('formId'), 60), status = str(qs.get('status'), 20);
      if (!validEventId(eventId)) return sendJson(res, 400, { error: 'A valid eventId is required.' });
      if (formId && !forms.FORM_ID_RE.test(formId)) return sendJson(res, 400, { error: 'That form could not be found.' });
      if (status && REG_STATUSES.indexOf(status) === -1) return sendJson(res, 400, { error: 'Status must be one of: ' + REG_STATUSES.join(', ') + '.' });
      var refs = audienceRefs(fb, eventId);

      refs.event.get().then(function (snap) {
        var ev = liveEvent(snap);
        if (!ev) throw httpError(404, 'No event found for "' + eventId + '".');
        return Promise.all([dateUndatedRegistrations(fb, eventId), repairFormIds(fb, eventId)]).then(function () {
          return Promise.all([formsApi().loadForms(fb, eventId, ev), exportRows(refs, formId, status)]);
        }).then(function (r) {
          var formList = r[0].forms, rows = r[1], byId = {};
          formList.forEach(function (f) { byId[f.id] = f; });
          /* the answer columns */
          var cols = [], colIndex = {};
          function addCol(key, label) { if (colIndex[key] == null) { colIndex[key] = cols.length; cols.push({ key: key, label: label || key }); } }
          if (formId && byId[formId]) {
            byId[formId].fields.forEach(function (f) { if (forms.MAPPED_FIELDS.indexOf(f.id) === -1) addCol(f.id, f.label); });
          }
          rows.forEach(function (row) {
            var labels = isObj(row.r.answerLabels) ? row.r.answerLabels : {}, answers = isObj(row.r.answers) ? row.r.answers : {};
            Object.keys(answers).forEach(function (k) { addCol(k, line(labels[k], 200) || k); });
          });
          var head = ['Submitted', 'Form', 'Status', 'Name', 'First name', 'Last name', 'Email', 'Phone', 'Phone country', 'Company', 'Designation',
            'Location', 'Location verified', 'City', 'State', 'Country', 'Source',
            'UTM source', 'UTM medium', 'UTM campaign', 'Device', 'Referrer', 'Checked in', 'Notes', 'Tags']
            .concat(cols.map(function (c) { return c.label; }));
          var lines = [head.map(forms.csvEscape).join(',')];
          rows.forEach(function (row) {
            var d = row.r, utm = isObj(d.utm) ? d.utm : {}, fid = formOf(d), answers = isObj(d.answers) ? d.answers : {};
            var lp = isObj(d.locationParts) ? d.locationParts : {};
            var cells = [istStamp(d.createdAt), d.formName || (byId[fid] && byId[fid].name) || fid,
              forms.statusLabel({ status: normStatus(d.status), counts: d.counts, decidedAt: d.decidedAt }),
              d.name, d.firstName, d.lastName, d.email, phone.formatPhone(d.phone || ''), d.phoneCountry, d.company, d.designation,
              d.location, d.location ? (lp.verified === true ? 'Yes' : 'No') : '', d.city || lp.city, lp.state, lp.country,
              d.source, utm.source, utm.medium, utm.campaign,
              d.device, d.referrer, d.checkedInAt ? istStamp(d.checkedInAt) : '', d.notes,
              Array.isArray(d.tags) ? d.tags.join('; ') : ''];
            cols.forEach(function (c) { cells.push(answers[c.key]); });
            lines.push(cells.map(function (v) { return forms.csvEscape(exportCell(v)); }).join(','));
          });
          var name = eventId + '-registrations' + (formId ? '-' + formId : '') + '.csv';
          if (res.headersSent) return;
          res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="' + name + '"',
            'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
          res.end('\ufeff' + lines.join('\r\n') + '\r\n');
        });
      }).catch(function (err) { answerError(res, sendJson, err, 'export the registrations'); });
    });
  });
}

/* =====================================================================================================
   TRACK — POST /api/track
   Called once by every page view of every published site, so it is built to cost one write and to be
   incapable of bothering the visitor: it answers 204 whatever happens — a bad body, an event that is
   not published, a rate limit, a database fault. (The body may arrive as text/plain: navigator.
   sendBeacon cannot send application/json without a preflight.)

   Whether an event is published is remembered for a minute per event, so the steady state is no read at
   all and one atomic write: the day's document and the event's running totals, in one batch. A page
   that was unpublished stops being counted within that minute; an id that is not an event is remembered
   too, so a script inventing ids cannot turn each request into a database read.
   ===================================================================================================== */

var MAX_TRACK_BODY = 2048;
var PUBLISHED_TTL_MS = 60 * 1000;
var publishedCache = new Map();

function isPublishedCached(fb, eventId) {
  var hit = publishedCache.get(eventId), now = Date.now();
  if (hit && now - hit.at < PUBLISHED_TTL_MS) return Promise.resolve(hit.ok);
  return eventDoc(fb, eventId).get().then(function (snap) {
    var ev = liveEvent(snap), ok = !!ev && ev.published === true;
    if (publishedCache.size > 2000) publishedCache.clear();
    publishedCache.set(eventId, { ok: ok, at: now });
    return ok;
  });
}

/* A body reader that cannot answer the request (http.readBody answers 413 itself, and this route has
   only one answer): cb(text), or cb(null) when the body is too large or unreadable. */
function readSmallBody(req, max, cb) {
  if (req.rawBody) return cb(req.rawBody.length > max ? null : req.rawBody.toString('utf8'));
  var chunks = [], size = 0, done = false;
  req.on('data', function (c) {
    if (done) return;
    size += c.length;
    if (size > max) { done = true; req.resume(); return cb(null); }
    chunks.push(c);
  });
  req.on('end', function () { if (!done) { done = true; cb(Buffer.concat(chunks).toString('utf8')); } });
  req.on('error', function () { if (!done) { done = true; cb(null); } });
}

/* Where a visit came from, as one of a fixed handful of classes — a referrer is free text from the
   visitor's browser, and a counter per distinct value would be a document anybody could grow. */
function referrerClass(host) {
  if (!host) return 'direct';
  if (/(^|\.)(google|bing|duckduckgo|yahoo|baidu|yandex)\./.test(host)) return 'search';
  if (/(^|\.)(linkedin\.com|lnkd\.in|facebook\.com|fb\.com|fb\.me|instagram\.com|twitter\.com|x\.com|t\.co|youtube\.com|youtu\.be|whatsapp\.com|wa\.me|telegram\.org|t\.me)$/.test(host)) return 'social';
  if (/(^|\.)(mail\.|outlook\.|gmail\.)/.test(host) || /^mail\./.test(host)) return 'email';
  return 'referral';
}

/* The page views that were waiting for this event (see enqueue; a quiet event's view is a list of
   one), as ONE atomic write: the day's document and the event's running totals move together. */
function writeViews(fb, eventId, views) {
  var day = dayKey(Date.now()), n = { views: views.length, uniques: 0, mobile: 0, desktop: 0 }, refs = {};
  views.forEach(function (v) {
    n.uniques += v.unique;
    n[v.device]++;
    refs[v.ref] = (refs[v.ref] || 0) + 1;
  });
  var daily = { date: day, ref: {} }, totals = {};
  Object.keys(n).forEach(function (k) {
    daily[k] = FieldValue.increment(n[k]);
    totals['counters.' + k] = FieldValue.increment(n[k]);
  });
  Object.keys(refs).forEach(function (k) { daily.ref[k] = FieldValue.increment(refs[k]); });
  var batch = fb.db.batch();
  batch.set(eventDoc(fb, eventId).collection('stats').doc(day), daily, { merge: true });
  batch.update(eventDoc(fb, eventId), totals);
  return batch.commit().then(function () { return views.map(function () { return { value: true }; }); });
}

function handleTrack(req, res) {
  var done = function () { sendPublicNoContent(res); };
  try {
    var allowed = rateLimit('track:' + clientIp(req), 120, 60000);
    readSmallBody(req, MAX_TRACK_BODY, function (raw) {
      try {
        if (!allowed || raw == null) return done();
        var body;
        try { body = parseJsonObject(raw); } catch (e) { return done(); }
        var eventId = bodyId(body.eventId);
        if (!validEventId(eventId)) return done();
        var fb = getFirebase();
        if (fb.error) return done();

        isPublishedCached(fb, eventId).then(function (published) {
          if (!published) return;
          var device = body.device === 'mobile' || body.device === 'desktop' ? body.device
            : (deviceClass(req) === 'desktop' || !deviceClass(req) ? 'desktop' : 'mobile');
          var unique = body.unique === true || body.unique === 1 || body.unique === '1' ? 1 : 0;
          var ref = referrerClass(referrerHost(req, body.ref));
          return enqueue('track:' + eventId, { device: device, unique: unique, ref: ref }, 1000, function (views) {
            return writeViews(fb, eventId, views);
          });
        }).catch(function (err) {
          console.error('audience: a page view for ' + eventId + ' was not counted — ' + (err && err.message));
        }).then(done, done);
      } catch (err) {
        console.error('audience: track failed — ' + ((err && err.stack) || err));
        done();
      }
    });
  } catch (err) {
    console.error('audience: track failed — ' + ((err && err.stack) || err));
    done();
  }
}

/* =====================================================================================================
   STATS, INSIGHTS, ACTIVITY (admin)
   Real numbers only; zero where there is nothing. The headline totals (registrations, confirmed,
   waitlist, cancelled, checkedIn, visitors, uniques) are ALL-TIME and are the event's own counters — the
   same numbers GET /api/events hands the listing — so the Dashboard, Reporting and the listing cannot
   disagree. `days` only sets how far back the day-by-day series (and the visit-source split) goes.
   `conversion` is registrations as a PERCENTAGE of page views (all-time registrations / all-time
   views x 100), to one decimal place, never above 100, and 0 with no views — print it with a % sign.
   `byDay` has one entry for every day of the window, oldest first, zeros included; its `date` keys are
   India days (YYYY-MM-DD, Asia/Kolkata).
   ===================================================================================================== */

var REF_CLASSES = [['direct', 'Direct'], ['search', 'Search'], ['social', 'Social'], ['email', 'Email'], ['referral', 'Other sites']];

function conversionOf(registrations, visitors) {
  if (!visitors || !registrations) return 0;
  return Math.min(100, Math.round((registrations / visitors) * 1000) / 10);
}

/* The day documents for the window, by day. */
function readDays(fb, eventId, days) {
  return audienceRefs(fb, eventId).stats.where(FieldPath.documentId(), '>=', days[0]).get().then(function (snap) {
    var out = {};
    snap.docs.forEach(function (d) { out[d.id] = d.data() || {}; });
    return out;
  });
}

/* An event's totals: its counters when they are maintained, a scan of its registrations when it predates
   them. Never writes. */
/* The registration totals out of a counters object (stored or scanned). `pending` counts the counted forms'
   responses awaiting approval, as every other total here does; `awaitingApproval` is every form's. */
function totalsOf(c) {
  var t = {};
  COUNTED_KEYS.concat(['submissions']).forEach(function (k) { t[k] = num(c[k]); });
  var waiting = 0;
  if (isObj(c.forms)) Object.keys(c.forms).forEach(function (id) { if (isObj(c.forms[id])) waiting += num(c.forms[id].pending); });
  t.awaitingApproval = waiting;
  return t;
}
function audienceTotals(fb, eventId, ev, wantBreakdown) {
  var c = isObj(ev.counters) ? ev.counters : {};
  var visits = { visitors: num(c.views), uniques: num(c.uniques), mobile: num(c.mobile), desktop: num(c.desktop) };
  if (hasAudienceCounters(ev)) {
    var totals = totalsOf(c);
    var agg = wantBreakdown ? audienceRefs(fb, eventId).agg.get().then(function (s) { return s.exists ? (s.data() || {}) : {}; }) : Promise.resolve({});
    return agg.then(function (a) { return { totals: totals, visits: visits, agg: a, legacyDays: null }; });
  }
  return scanAudience(fb, eventId).then(function (scan) {
    return { totals: totalsOf(scan.counters), visits: visits, agg: scan.agg, legacyDays: scan.days };
  });
}

function handleDashboardStats(req, res) {
  requireAdmin(req, res, function (fb) {
    guard(res, sendJson, 'load these numbers', function () {
      var qs = query(req), eventId = str(qs.get('eventId'), 100);
      if (!validEventId(eventId)) return sendJson(res, 400, { error: 'A valid eventId is required.' });
      var nDays = intParam(qs.get('days'), 30, 1, 365), days = lastDays(nDays);

      eventDoc(fb, eventId).get().then(function (snap) {
        var ev = liveEvent(snap);
        if (!ev) throw httpError(404, 'No event found for "' + eventId + '".');
        return Promise.all([audienceTotals(fb, eventId, ev, true), readDays(fb, eventId, days)]).then(function (r) {
          var a = r[0], daily = r[1], settings = registrationSettings(ev), refTotals = {};
          var byDay = days.map(function (day) {
            var d = daily[day] || {};
            if (isObj(d.ref)) Object.keys(d.ref).forEach(function (k) { refTotals[k] = (refTotals[k] || 0) + num(d.ref[k]); });
            return { date: day, views: num(d.views), uniques: num(d.uniques),
              registrations: a.legacyDays ? num(a.legacyDays[day]) : num(d.registrations) };
          });
          var list = function (pairs, counts) {
            return pairs.map(function (p) { return { label: p[1], count: num(counts[p[0]]) }; })
              .filter(function (x) { return x.count > 0; }).sort(function (x, y) { return y.count - x.count; });
          };
          sendJson(res, 200, {
            eventId: eventId, days: nDays, generatedAt: new Date().toISOString(),
            registrations: a.totals.registrations, confirmed: a.totals.confirmed, waitlist: a.totals.waitlist,
            cancelled: a.totals.cancelled, checkedIn: a.totals.checkedIn,
            // every form's responses, and those waiting for an organiser's approval (counted forms / all forms)
            submissions: a.totals.submissions, pending: a.totals.pending, awaitingApproval: a.totals.awaitingApproval,
            visitors: a.visits.visitors, uniques: a.visits.uniques,
            conversion: conversionOf(a.totals.registrations, a.visits.visitors),
            capacity: settings.capacity, target: settings.target,
            byDay: byDay,
            byCompany: topList(a.agg.company), byDesignation: topList(a.agg.designation), byCity: topList(a.agg.city),
            bySource: topList(a.agg.source),
            // page views by the kind of device they came from (all-time)
            byDevice: list([['desktop', 'Desktop'], ['mobile', 'Mobile']], a.visits),
            // registrations by device, and page views in the window by where the visitor came from
            byRegistrationDevice: topList(a.agg.device).map(function (x) { return { label: x.label.charAt(0).toUpperCase() + x.label.slice(1), count: x.count }; }),
            byReferrer: list(REF_CLASSES, refTotals)
          });
        });
      }).catch(function (err) { answerError(res, sendJson, err, 'load these numbers'); });
    });
  });
}

/* Across every event, for the listing and the cross-event Reporting. The same events GET /api/events
   lists (not deleted, not nameless, not a shell — which is what an import's staging record is), each
   with its own totals; the totals at the top are their sums. Reads one slim projection of the events,
   and day documents only for events that have had any visit or registration. Like that list, the query
   is not ordered: an ordered query leaves out every document that lacks the field. */
var INSIGHTS_EVENT_LIMIT = 1000;

/* An event whose totals are not maintained yet costs a query to total. Across a whole listing that is
   one query per such event on every load, so here (and only here) the answer is remembered for a
   minute. It cannot go stale in a way that matters: the first registration, update or delete on such
   an event writes its totals down, and from then on this is not used for it at all. */
var LEGACY_TTL_MS = 60 * 1000;
var legacyTotals = new Map();
function insightTotals(fb, eventId, ev) {
  if (hasAudienceCounters(ev)) { legacyTotals.delete(eventId); return audienceTotals(fb, eventId, ev, false); }
  var hit = legacyTotals.get(eventId), now = Date.now();
  var scan = hit && now - hit.at < LEGACY_TTL_MS ? Promise.resolve(hit.scan) : scanAudience(fb, eventId).then(function (s) {
    if (legacyTotals.size > 2000) legacyTotals.clear();
    legacyTotals.set(eventId, { at: now, scan: s });
    return s;
  });
  var c = isObj(ev.counters) ? ev.counters : {};
  return scan.then(function (s) {
    return { totals: totalsOf(s.counters), agg: s.agg, legacyDays: s.days,
      visits: { visitors: num(c.views), uniques: num(c.uniques), mobile: num(c.mobile), desktop: num(c.desktop) } };
  });
}

function handleInsights(req, res) {
  requireAdmin(req, res, function (fb) {
    guard(res, sendJson, 'load these numbers', function () {
      var nDays = intParam(query(req).get('days'), 30, 1, 365), days = lastDays(nDays);

      fb.db.collection('events').limit(INSIGHTS_EVENT_LIMIT)
        .select('name', 'counters', 'createdAt', 'deletedAt', 'published', 'updatedAt').get().then(function (snap) {
          var events = snap.docs.filter(function (d) { return liveEvent(d) && line(d.get('name'), 300); });
          return mapLimit(events, 25, function (d) {
            var ev = d.data() || {};
            return insightTotals(fb, d.id, ev).then(function (a) {
              var active = a.totals.registrations > 0 || a.visits.visitors > 0;
              return (active ? readDays(fb, d.id, days) : Promise.resolve({})).then(function (daily) {
                return { id: d.id, ev: ev, a: a, daily: daily };
              });
            });
          });
        }).then(function (rows) {
          var sum = { registrations: 0, confirmed: 0, waitlist: 0, cancelled: 0, checkedIn: 0, visitors: 0, uniques: 0 };
          var perDay = {};
          days.forEach(function (day) { perDay[day] = { date: day, views: 0, uniques: 0, registrations: 0 }; });
          // most recently changed first, as the events list has them
          rows.sort(function (a, b) {
            var x = String(a.ev.updatedAt || a.ev.createdAt || ''), y = String(b.ev.updatedAt || b.ev.createdAt || '');
            return x === y ? (a.id < b.id ? -1 : 1) : (x < y ? 1 : -1);
          });
          var events = rows.map(function (row) {
            var t = row.a.totals, v = row.a.visits;
            ['registrations', 'confirmed', 'waitlist', 'cancelled', 'checkedIn'].forEach(function (k) { sum[k] += t[k]; });
            sum.visitors += v.visitors; sum.uniques += v.uniques;
            days.forEach(function (day) {
              var d = row.daily[day] || {};
              perDay[day].views += num(d.views);
              perDay[day].uniques += num(d.uniques);
              perDay[day].registrations += row.a.legacyDays ? num(row.a.legacyDays[day]) : num(d.registrations);
            });
            return { eventId: row.id, name: line(row.ev.name, 300), published: row.ev.published === true,
              visitors: v.visitors, uniques: v.uniques, registrations: t.registrations, confirmed: t.confirmed,
              waitlist: t.waitlist, cancelled: t.cancelled, checkedIn: t.checkedIn,
              conversion: conversionOf(t.registrations, v.visitors) };
          });
          sendJson(res, 200, {
            days: nDays, generatedAt: new Date().toISOString(),
            registrations: sum.registrations, confirmed: sum.confirmed, waitlist: sum.waitlist, cancelled: sum.cancelled,
            checkedIn: sum.checkedIn, visitors: sum.visitors, uniques: sum.uniques,
            conversion: conversionOf(sum.registrations, sum.visitors),
            byDay: days.map(function (day) { return perDay[day]; }),
            events: events
          });
        }).catch(function (err) { answerError(res, sendJson, err, 'load these numbers'); });
    });
  });
}

/* The event's history, newest first. Still answered for a deleted event — "deleted" and "restored" are
   part of the history, and the person restoring an event is exactly who wants to read it. */
function handleActivity(req, res) {
  requireAdmin(req, res, function (fb) {
    guard(res, sendJson, 'load the history', function () {
      var qs = query(req), eventId = str(qs.get('eventId'), 100);
      if (!validEventId(eventId)) return sendJson(res, 400, { error: 'A valid eventId is required.' });
      /* a page at a time with ?before=<next>, filtered like GET /api/event/history (lib/activity-query.js);
         without paging parameters, the newest 100 as before */
      var AQ = require('./activity-query'), opts = AQ.parseQuery(qs, 100);
      eventDoc(fb, eventId).get().then(function (snap) {
        if (!snap.exists) throw httpError(404, 'No event found for "' + eventId + '".');
        return AQ.queryPage(eventDoc(fb, eventId).collection('activity'), opts).then(function (page) {
          sendJson(res, 200, { next: page.next, people: page.people || null, items: page.items.map(function (a) {
            return { id: a.id, at: a.at || null, by: a.by || '', action: a.action || '', detail: a.detail || '', area: a.area };
          }) });
        });
      }).catch(function (err) { answerError(res, sendJson, err, 'load the history'); });
    });
  });
}

module.exports = {
  handlePublicSiteData, handleSeed, handleRegister, handleRegistrationsList, handleRegistrationUpdate,
  handleRegistrationDelete, handleRegistrationsExport, handleTrack, handleDashboardStats, handleInsights, handleActivity,
  handlePublicOptions, publicSiteData, seedContent,
  /* for tools/migrate-forms.js and the tests */
  counterDelta, rebuildAudience, scanAudience, repairFormIds, hasAudienceCounters, AUDIENCE_V, REG_STATUSES
};
/* the small helpers lib/api-forms.js shares with this module, so the two answer alike */
module.exports._shared = {
  httpError, answerError, guard, query, validEventId, bodyId, liveEvent, eventDoc, isObj, num, line, multiline,
  hasAudienceCounters, scanAudience, NOT_AVAILABLE, UNAVAILABLE
};
