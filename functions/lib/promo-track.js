/* Promotions → Mailers, phase 2: who opened a mailer and who clicked in it. The promotional platform's own
   tracking (app/src/server.ts, /t/o, /t/c and /api/analytics; app/src/analytics/store.ts), on Firestore:

     GET|HEAD /t/o/<id>.gif               PUBLIC — the open pixel. Always a 1x1 GIF; the hit is counted on the way.
     GET|HEAD /t/c/<id>?u=<url>&s=<sig>   PUBLIC — a click. 302 to u when s is Oneworld's signature over (id, u),
                                          otherwise 400 "bad link". Only links Oneworld signed are ever followed:
                                          that, not a list of allowed hosts, is what stops this being an open
                                          redirect (a mail may link any sponsor's own site).
     GET /api/promo/analytics?eventId=    admin — one event's "Mailer performance", read fresh on every load
     GET /api/promo/analytics/all         admin — every live event's, cached 30 s on this instance (?fresh=1 skips it)

   lib/api.js routes all four here (and answers the pixel with its own copy of the GIF should this file fail to
   load). lib/promo-mailer.js asks availableFor() and base() when a mailer is downloaded or copied, and records
   each exported file with recordSends(). server.js calls flushAll() on SIGTERM.

   WHEN TRACKING RUNS — mode(), the only place this is decided:
     TRACK_SECRET (32+ characters) signs click links. There is no fallback: a key made up per instance would
     break clicks across the two instances and on every rollout.
     MAILER_TRACK_BASE is the address every tracked mail carries for good. It must be a bare origin.
     'on'   a deployed instance (K_SERVICE set) with an https base: every event is tracked.
     'qa'   a local or QA server (K_SERVICE unset) with an https base, or http on localhost: only qa- events.
            A local download for a real event would otherwise write production rows, and put a localhost
            address — or links signed with a throwaway key — into a real mail.
     'off'  anything else: downloads are plain, nothing is recorded, the dashboard says so.
   The click route does not depend on the mode: a link already in an inbox keeps working whatever the base is
   set to later. It needs only the key (TRACK_SECRET, or TRACK_SECRET_PREVIOUS while a key is being rotated).

   SENDS: promoSends/{sendId}, one document per exported file (a download, a copy, each file of a zip):
     { eventId, eventCreatedAt, portal, eventName, mailerId, mailerLabel, subject, saveId, saveName, createdAt, by,
       opens, clicks, botOpens, botClicks, days: { 'YYYY-MM-DD' (India day): { o, c } } }
   eventCreatedAt is the event's own createdAt: a discarded draft's address can be taken again by a new event,
   and its old sends must not show up on the new one's dashboard. `by` is who exported it, and is never returned.

   COUNTING (countHit): every hit on a known send counts, as in the source — there is no per-address limit,
   because a mail provider's image proxy fetches for many readers from one address. What is bounded is cost:
     - a send id this instance has not seen yet is checked once (one read, shared by every hit on it), and
       those checks are limited to 20 a second on the instance; an id found missing is remembered for 10 minutes;
     - counts are written at most once a second per send per instance, each write carrying everything since
       the last; only the hit that carries a write waits for it (3 s at most), every other hit is answered at once;
     - counts still in memory are written when the instance is stopped (flushAll).
   Machines (mail gateways, link checkers, scripts — AUTOMATED below — and every HEAD request) are counted apart,
   as botOpens / botClicks, and never in opens, clicks or the day series.

   PRIVACY: nothing about the recipient is stored or used — no address, user agent, cookie, recipient id or
   clicked URL. The user agent is read only to tell a machine from a mail client, and then forgotten. */
'use strict';
const engine = require('./vendor/promo-engine');
const { getFirebase } = require('./firebase');
const { sendJson, isEventId } = require('./http');

var H = null;
/* lib/api.js hands over its helpers (withAdmin, eventIdOr400, loadLiveEvent, sendFailure) on each call, as it does
   for lib/promo.js and lib/promo-mailer.js — requiring that file from here would be a require cycle */
function wire(helpers) { H = helpers; }

/* Every limit in one place. Mutable so the tests can shorten the waits; nothing else changes them. */
var NUMBERS = {
  WRITE_GAP_MS: 1000,       // between the starts of two writes for one send, on one instance
  HIT_WAIT_MS: 3000,        // the longest a hit carrying a write waits for it before it is answered anyway
  PROBES_PER_SEC: 20,       // checks of send ids this instance has not seen yet, for all callers together
  MAX_PENDING: 10000,       // sends with counts held in memory at once
  MAX_KNOWN: 20000,         // send ids remembered as real
  MAX_UNKNOWN: 10000,       // send ids remembered as missing
  UNKNOWN_TTL_MS: 600000,   // for 10 minutes
  MAX_WAITING: 16,          // requests waiting for a write at once on an instance
  TEAM_CACHE_MS: 30000,     // the team view's cache
  LOG_EVERY_MS: 600000      // the same complaint is logged at most once per 10 minutes
};
var N = NUMBERS;

var SEND_ID_RE = /^[A-Za-z0-9_-]{12}$/;          // engine.newSendId(): 9 random bytes, base64url
var MAILER_ID_RE = /^[a-z0-9._-]{1,64}$/;        // registry ids and "mailer.imported"; anything else is stored as ''
var SAVE_ID_RE = /^[A-Za-z0-9_-]{1,60}$/;        // a mailerSaves document id
var DAYS = 30;                                   // the dashboard's window (store.ts)
var COLLECTION = 'promoSends';

/* 1x1 transparent GIF — smaller than a PNG and understood by every client (server.ts). lib/api.js keeps the same
   42 bytes for when this file cannot load; a test checks the two match. */
var PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

/* FieldPath and FieldValue. Read on first use: the SDK is already in memory by then (lib/firebase.js loads it),
   and loading this file stays free of the Firestore client. */
function fsTypes() { return require('firebase-admin').firestore; }

/* ---------- when tracking runs ---------- */

/* Read on every call, never cached, so a rotated key or a test's switch takes effect at once. */
function keyOk() { return String(process.env.TRACK_SECRET || '').trim().length >= 32; }

/* MAILER_TRACK_BASE as a bare origin (no trailing slash), or '' when it is anything more: a path, a query, a
   fragment or a user name would be built into every mail's links. An empty "?" or "#" still leaves URL's
   search and hash empty, so the text itself is checked for them too. */
function baseOrigin() {
  var raw = String(process.env.MAILER_TRACK_BASE || '').trim();
  if (!raw || /[?#]/.test(raw)) return '';
  var u;
  try { u = new URL(raw); } catch (e) { return ''; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return '';
  if (u.pathname !== '/' || u.username || u.password || u.search || u.hash) return '';
  return u.origin;
}

function deployed() { return !!process.env.K_SERVICE; }

function mode() {
  if (!keyOk()) return 'off';
  var origin = baseOrigin();
  if (!origin) return 'off';
  var u = new URL(origin);
  if (deployed()) return u.protocol === 'https:' ? 'on' : 'off';
  if (u.protocol === 'https:') return 'qa';
  return u.hostname === 'localhost' || u.hostname === '127.0.0.1' ? 'qa' : 'off';
}

function isQaEvent(eventId) { return /^qa-/.test(String(eventId || '')); }

/* Is a mailer of this event tracked when it is downloaded or copied here? */
function availableFor(eventId) {
  var m = mode();
  return m === 'on' || (m === 'qa' && isQaEvent(eventId));
}

/* The origin tracked links point at, or '' when tracking is off. */
function base() { return mode() !== 'off' ? baseOrigin() : ''; }

/* Does a hit on a send of this event move its numbers here? A local or QA server only ever moves qa- numbers,
   whatever links reach it. */
function countsFor(eventId) { return deployed() ? true : isQaEvent(eventId); }

/* ---------- machines ---------- */

/** Is this fetch a machine rather than a reader?
 *
 *  Mail security gateways open every message and follow every link in it before
 *  a human ever sees it; link checkers, uptime monitors, previewers and command
 *  line tools do the same. Counting those as opens and clicks is how a campaign
 *  that was never delivered reported an audience.
 *
 *  Deliberately NOT here: GoogleImageProxy, YahooMailProxy and Apple's fetcher.
 *  Those are real mail clients loading the image because a person opened the
 *  mail — Apple's prefetches at delivery, which over-counts, but that is a
 *  documented distortion rather than a robot. */
var AUTOMATED = /bot\b|crawler|spider|slurp|proofpoint|mimecast|barracuda|symantec|forcepoint|messagelabs|trendmicro|fireeye|cloudmark|urldefense|safelinks|linkcheck|uptime|monitor|pingdom|curl\/|wget|python-requests|go-http|axios|node-fetch|okhttp|java\/|libwww|headlesschrome|phantomjs|puppeteer|playwright|scrapy|postman/i;
/* ONEWORLD PORT (owner, 2026-10-28): a HEAD request is never a person's mail client. (In the source, Express ran
   HEAD through the GET handler, so a HEAD with a browser's user agent counted as a real open or click.) */
function isAutomated(req) {
  return req.method === 'HEAD' || AUTOMATED.test(String((req.headers && req.headers['user-agent']) || ''));
}

/* ---------- the redirect's Location ---------- */

/* encodeurl 2.0.0, verbatim (MIT, © 2016 Douglas Christopher Wilson): what Express 4.22.2's res.redirect() runs
   on the source's target, so Location is the same byte for byte. Its output is ASCII, so writeHead cannot throw. */
var ENCODE_CHARS_REGEXP = /(?:[^\x21\x23-\x3B\x3D\x3F-\x5F\x61-\x7A\x7C\x7E]|%(?:[^0-9A-Fa-f]|[0-9A-Fa-f][^0-9A-Fa-f]|$))+/g;
var UNMATCHED_SURROGATE_PAIR_REGEXP = /(^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]|[\uD800-\uDBFF]([^\uDC00-\uDFFF]|$)/g;
var UNMATCHED_SURROGATE_PAIR_REPLACE = '$1�$2';
function encodeUrl(url) {
  return String(url)
    .replace(UNMATCHED_SURROGATE_PAIR_REGEXP, UNMATCHED_SURROGATE_PAIR_REPLACE)
    .replace(ENCODE_CHARS_REGEXP, encodeURI);
}

/* ---------- days ---------- */

/* ONEWORLD PORT: India days, like every other Oneworld report (lib/api-audience.js dayKey) — the source used UTC,
   which put every open before 05:30 on the previous day's bar. Each hit's own arrival time picks its day. */
var IST_OFFSET_MS = 330 * 60 * 1000;
function dayKey(ms) { return new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10); }
/* the window's days, oldest first, ending today */
function windowDays(nowMs) {
  var out = [];
  for (var i = DAYS - 1; i >= 0; i--) out.push(dayKey(nowMs - i * 86400000));
  return out;
}

/* ---------- logs ---------- */

/* The same complaint once per LOG_EVERY_MS: a hit storm during an outage must not flood the logs. */
var loggedAt = {};
function logOnce(key, line) {
  var now = Date.now();
  if (loggedAt[key] && now - loggedAt[key] < N.LOG_EVERY_MS) return;
  loggedAt[key] = now;
  console.error(line);
}
function codeOf(err) { return err && err.code != null ? err.code : 'unknown'; }
/* gRPC 5: the document is not there (QA removed it, or it never existed) — an answer, not a fault */
function isGone(err) { var c = err && err.code; return c === 5 || c === '5' || String(c).toLowerCase() === 'not-found'; }

/* ---------- recording a send ---------- */

/* A string field as stored: text, at most n UTF-16 units, never ending in half a surrogate pair. */
function cap(v, n) {
  var s = String(v == null ? '' : v);
  if (s.length <= n) return s;
  s = s.slice(0, n);
  return /[\uD800-\uDBFF]$/.test(s) ? s.slice(0, -1) : s;
}

/* The document for one exported file, every field normalised here and only here. ONEWORLD PORT: the source
   stored every field as it came. A mailer id that is not a registry-shaped id is stored as '' — the dashboard
   puts mailer ids into its markup, so only plain ids may reach it — and so is one every object already has
   ("constructor", "__proto__"): the dashboards look a mailer's versions up by its id, in a plain object. A save
   id that is not a document id takes its name with it. */
function mailerIdOk(id) { return MAILER_ID_RE.test(id) && !(id in Object.prototype); }
function sendDoc(meta) {
  var m = meta || {};
  var mailerId = String(m.mailerId == null ? '' : m.mailerId);
  var saveId = String(m.saveId == null ? '' : m.saveId);
  if (!SAVE_ID_RE.test(saveId)) saveId = '';
  var createdAt = Number(m.createdAt);
  return {
    eventId: String(m.eventId || ''),
    eventCreatedAt: cap(m.eventCreatedAt, 100),
    portal: cap(m.portal, 100),
    eventName: cap(m.eventName, 300),
    mailerId: mailerIdOk(mailerId) ? mailerId : '',
    mailerLabel: cap(m.mailerLabel, 200),
    subject: cap(m.subject, 1000),
    saveId: saveId,
    saveName: saveId ? cap(m.saveName, 120) : '',
    createdAt: isFinite(createdAt) && createdAt > 0 ? createdAt : Date.now(),
    by: cap(m.by, 200),
    opens: 0, clicks: 0, botOpens: 0, botClicks: 0,
    days: {}
  };
}

function sendsOf(fb) { return fb.db.collection(COLLECTION); }

/* Records the exported files as sends: one batch of create(), so a "Download all" is one write and a send can
   never be overwritten. Rejects when the batch fails, or when a meta has an invalid event id or send id (then
   nothing is written) — lib/promo-mailer.js then hands out the plain file and says it went out untracked. */
function recordSends(fb, metas) {
  return Promise.resolve().then(function () {
    if (!fb || fb.error || !fb.db) throw new Error('promo-track: Firestore is not available — ' + ((fb && fb.error) || 'no client'));
    var list = Array.isArray(metas) ? metas : [];
    var docs = list.map(function (m) {
      if (!m || !isEventId(m.eventId)) throw new Error('promo-track: a send has an invalid eventId — nothing was recorded');
      if (!SEND_ID_RE.test(String(m.id || ''))) throw new Error('promo-track: a send has an invalid id — nothing was recorded');
      return sendDoc(m);
    });
    if (!docs.length) return;
    var batch = fb.db.batch(), col = sendsOf(fb);
    docs.forEach(function (d, i) { batch.create(col.doc(String(list[i].id)), d); });
    return batch.commit().then(function () { forgetTeam(); });
  });
}

/* ---------- counting hits ---------- */
/* Per instance, all in memory (§3f of the phase-2 plan):
     known     send ids confirmed on this instance (oldest forgotten first)
     unknown   send ids found missing, or that this server does not count (qa- rule), until their time is up
     probing   id -> the check in flight; one per id, shared by every hit on it
     pending   id -> its entry: the counts not written yet (delta), whether a write is running (inFlight), whether
               one is asked for (due, with its carrier's settle()), the timer that starts it, when the last began */
var known = new Map(), unknown = new Map(), probing = new Map(), pending = new Map();
var waiting = 0;               // requests now waiting for a write
var tokens = null, tokensAt = 0;   // the check budget: a token bucket refilled at PROBES_PER_SEC
var flushing = 0;              // > 0 while flushAll runs: writes go out at once, ignoring the spacing
var DONE = Promise.resolve();

function emptyDelta() { return { opens: 0, clicks: 0, botOpens: 0, botClicks: 0, days: {} }; }
function isEmptyDelta(d) { return !d.opens && !d.clicks && !d.botOpens && !d.botClicks; }

/* Firestore's update() arguments for a delta: [FieldPath, increment, …], non-zero counts only. A day goes in as
   FieldPath('days', day, 'o' | 'c'), so its dashes are never read as a path. */
function updateArgs(delta) {
  var T = fsTypes(), out = [];
  ['opens', 'clicks', 'botOpens', 'botClicks'].forEach(function (k) {
    if (delta[k]) out.push(new T.FieldPath(k), T.FieldValue.increment(delta[k]));
  });
  Object.keys(delta.days || {}).sort().forEach(function (day) {
    ['o', 'c'].forEach(function (k) {
      var n = delta.days[day][k];
      if (n) out.push(new T.FieldPath('days', day, k), T.FieldValue.increment(n));
    });
  });
  return out;
}

function touchKnown(id) {
  known.delete(id);
  known.set(id, true);
  while (known.size > N.MAX_KNOWN) known.delete(known.keys().next().value);
}
function markUnknown(id) {
  unknown.delete(id);
  unknown.set(id, Date.now() + N.UNKNOWN_TTL_MS);
  while (unknown.size > N.MAX_UNKNOWN) unknown.delete(unknown.keys().next().value);
}
function isUnknown(id) {
  var until = unknown.get(id);
  if (until === undefined) return false;
  if (until > Date.now()) return true;
  unknown.delete(id);
  return false;
}

/* One token per check of an id not seen yet. Keyed by nothing from the request: it bounds what made-up ids can
   cost, and never refuses a recipient of a real mail — a known send is never checked again. */
function takeToken() {
  var now = Date.now(), rate = N.PROBES_PER_SEC;
  if (tokens === null) { tokens = rate; tokensAt = now; }
  tokens = Math.min(rate, tokens + (now - tokensAt) * rate / 1000);
  tokensAt = now;
  if (tokens < 1) return false;
  tokens -= 1;
  return true;
}

/* A hit that carries a write waits for it, but never longer than HIT_WAIT_MS — and when MAX_WAITING requests
   already wait on this instance, it is answered at once (its write still happens). work never rejects. */
function carry(work) {
  if (!work) return DONE;
  if (waiting >= N.MAX_WAITING) return DONE;
  waiting++;
  return new Promise(function (resolve) {
    var done = false, timer = setTimeout(finish, N.HIT_WAIT_MS);
    function finish() {
      if (done) return;
      done = true;
      clearTimeout(timer);
      waiting = Math.max(0, waiting - 1);
      resolve();
    }
    work.then(finish, finish);
  });
}

/* Asks for a write of this send's counts. Returns the promise its carrier waits on (settled when that write
   does), or null when a write with a carrier is already asked for — this hit's counts go with it. */
function wantWrite(id, e) {
  if (e.due) return null;
  e.due = true;
  var settled = new Promise(function (resolve) { e.settle = resolve; });
  if (!e.inFlight) {
    if (e.timer) { clearTimeout(e.timer); e.timer = null; }   // the quiet spell after the last write
    var wait = flushing ? 0 : e.lastWriteAt + N.WRITE_GAP_MS - Date.now();
    if (wait <= 0) startWrite(id, e);
    else e.timer = setTimeout(function () { e.timer = null; startWrite(id, e); }, wait);
  }
  /* a write is running: afterWrite() starts this one once it settles, still spaced from its start */
  return settled;
}

function releaseCarrier(e) {
  var settle = e.settle;
  e.settle = null;
  e.due = false;
  if (settle) settle();
}

/* Swaps the counts out and writes them. Nothing is retried here: the SDK already retries what is worth retrying,
   and a count written twice is worse than one lost. */
function startWrite(id, e) {
  var settle = e.settle;
  e.settle = null;
  e.due = false;
  if (pending.get(id) !== e) { if (settle) settle(); return; }
  var delta = e.delta;
  e.delta = emptyDelta();
  if (isEmptyDelta(delta)) { if (settle) settle(); afterWrite(id, e); return; }
  e.inFlight = true;
  var startedAt = Date.now(), ref = sendsOf(e.fb).doc(id);
  e.writing = Promise.resolve().then(function () {
    return ref.update.apply(ref, updateArgs(delta));
  }).then(function () { /* written */ }, function (err) {
    /* gone (QA cleanup removed it): stop counting it; nothing to log — that is an answer, not a fault */
    if (isGone(err)) { e.gone = true; known.delete(id); markUnknown(id); return; }
    logOnce('write', 'promo-track: counts could not be saved (' + codeOf(err) + ')');
  }).then(function () {
    /* spaced from this write's start even when it failed: a failing Firestore must not be hammered */
    e.inFlight = false;
    e.writing = null;
    e.lastWriteAt = startedAt;
    if (settle) settle();
    afterWrite(id, e);
  });
}

/* After a write: start the one asked for meanwhile (spaced), or keep the entry until the spacing has passed — a
   hit then still waits its turn — and forget it after. */
function afterWrite(id, e) {
  if (pending.get(id) !== e) { releaseCarrier(e); return; }
  if (e.gone) {
    if (e.timer) { clearTimeout(e.timer); e.timer = null; }
    releaseCarrier(e);
    pending.delete(id);
    return;
  }
  var wait = flushing ? 0 : e.lastWriteAt + N.WRITE_GAP_MS - Date.now();
  if (e.due) {
    if (wait <= 0) startWrite(id, e);
    else e.timer = setTimeout(function () { e.timer = null; startWrite(id, e); }, wait);
    return;
  }
  if (flushing) { pending.delete(id); return; }
  e.timer = setTimeout(function () {
    e.timer = null;
    if (pending.get(id) === e && !e.due && !e.inFlight) pending.delete(id);
  }, Math.max(0, wait));
}

/* The first hit on an id this instance has not confirmed: one read of its eventId, shared by every hit on the id
   while it runs. A real send this server counts becomes known and its counts are written (this hit carries that
   write); a missing one — or a send of a non-qa- event seen by a local server — is remembered as unknown and its
   counts dropped. A read that fails drops the counts and remembers nothing, so the next hit checks again. */
function probe(id, e) {
  var ref = sendsOf(e.fb).doc(id);
  var p = Promise.resolve().then(function () {
    return e.fb.db.getAll(ref, { fieldMask: ['eventId'] });
  }).then(function (snaps) {
    probing.delete(id);
    if (pending.get(id) !== e) return null;
    var snap = snaps && snaps[0], d = snap && snap.exists ? (snap.data() || {}) : null;
    if (d && countsFor(d.eventId)) {
      touchKnown(id);
      e.confirmed = true;
      return wantWrite(id, e);
    }
    markUnknown(id);
    pending.delete(id);
    return null;
  }, function (err) {
    probing.delete(id);
    if (pending.get(id) === e) pending.delete(id);
    if (!isGone(err)) logOnce('read', 'promo-track: a mailer could not be checked (' + codeOf(err) + ') — its hits were not counted');
    return null;
  });
  probing.set(id, p);
  return p;
}

function addHit(delta, kind, bot, nowMs) {
  var click = kind === 'click';
  if (bot) { delta[click ? 'botClicks' : 'botOpens'] += 1; return; }
  delta[click ? 'clicks' : 'opens'] += 1;
  var day = dayKey(nowMs), b = delta.days[day] || (delta.days[day] = { o: 0, c: 0 });
  b[click ? 'c' : 'o'] += 1;
}

/* One open or click on send `id`. kind: 'open' | 'click'; bot: isAutomated(); nowMs: the hit's arrival, which
   picks its India day (the spacing, the budget and the expiries run on this instance's own clock). Resolves at
   once unless this hit carries a write, and then within HIT_WAIT_MS. Never rejects, and never refuses anyone:
   the answer to the recipient does not depend on any of this. ONEWORLD PORT: the source awaited every hit's own
   Redis commands (each capped at 3 s) and checked every hit's id; here an id is checked once per instance and
   the writes are coalesced, so a burst on one mail costs about one write a second instead of one per reader. */
function countHit(fb, id, kind, bot, nowMs) {
  try {
    id = String(id || '');
    if (!SEND_ID_RE.test(id) || (kind !== 'open' && kind !== 'click')) return DONE;
    if (!fb || fb.error || !fb.db) return DONE;
    if (isUnknown(id)) return DONE;
    var at = typeof nowMs === 'number' && isFinite(nowMs) ? nowMs : Date.now();
    var e = pending.get(id);
    if (!e) {
      if (pending.size >= N.MAX_PENDING) {
        logOnce('full', 'promo-track: too many mailers counting at once — a hit was dropped');
        return DONE;
      }
      e = { fb: fb, delta: emptyDelta(), confirmed: false, inFlight: false, writing: null, due: false, settle: null,
        timer: null, lastWriteAt: 0, gone: false };
      pending.set(id, e);
    }
    addHit(e.delta, kind, !!bot, at);
    if (known.has(id)) e.confirmed = true;
    if (e.confirmed) { touchKnown(id); return carry(wantWrite(id, e)); }
    if (probing.has(id)) return DONE;            // written when the check confirms it, dropped if it does not
    if (!takeToken()) { pending.delete(id); return DONE; }
    return carry(probe(id, e));
  } catch (err) {
    logOnce('hit', 'promo-track: a hit could not be counted — ' + (err && err.stack || err));
    return DONE;
  }
}

/* Writes every send's counts still in memory at once, ignoring the spacing — Cloud Run allows 10 s between
   SIGTERM and the end of the instance (server.js exits as soon as this resolves). A send whose check is still
   running is waited for: once the check confirms it, its write starts at once (flushing) and is waited for too.
   Hits counted while the flush runs are swept up as well: the entries are gone over again until none is left
   with work to do, or timeoutMs has passed. Never rejects. */
function flushOne(id, e) {
  if (pending.get(id) !== e) return DONE;
  if (e.timer) { clearTimeout(e.timer); e.timer = null; }
  if (e.inFlight) return e.writing.then(function () { return flushOne(id, e); });
  if (!e.confirmed) {
    /* probe() settles only after the write it starts has settled, and afterWrite() then forgets the entry */
    var check = probing.get(id);
    return check ? check.then(function () { return flushOne(id, e); }, function () {}) : DONE;
  }
  if (isEmptyDelta(e.delta)) { releaseCarrier(e); pending.delete(id); return DONE; }
  startWrite(id, e);
  return e.inFlight ? e.writing.then(function () { return flushOne(id, e); }) : flushOne(id, e);
}
/* an entry the flush still has to see to: a send known to be real (counts to write, or a quiet spell to end), a
   write running, or a check running. An entry with none of these has nothing that could ever be written. */
function hasWork(id, e) { return e.confirmed || e.inFlight || probing.has(id); }
function flushAll(timeoutMs) {
  var limit = Number(timeoutMs) > 0 ? Number(timeoutMs) : 8000;
  flushing++;
  return new Promise(function (resolve) {
    var finished = false, timer = setTimeout(finish, limit);
    function finish() {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      flushing = Math.max(0, flushing - 1);
      resolve();
    }
    function sweep() {
      if (finished) return;
      var works = [];
      pending.forEach(function (e, id) {
        if (!hasWork(id, e)) return;
        try { works.push(flushOne(id, e).then(null, function () {})); } catch (err) { /* the others still go */ }
      });
      if (!works.length) return finish();
      /* the next sweep, for what was counted meanwhile, waits a turn of the event loop: the time limit can fire */
      var again = function () { setImmediate(sweep); };
      Promise.all(works).then(again, again);
    }
    sweep();
  });
}

/* ---------- the public routes ---------- */

function firebase() { try { return getFirebase(); } catch (err) { return { error: String(err && err.message || err) }; } }

/* the last path segment, percent-decoded ('' when it cannot be) */
function lastSegment(url) {
  var p = String(url || ''), q = p.indexOf('?');
  if (q !== -1) p = p.slice(0, q);
  try { return decodeURIComponent(p.slice(p.lastIndexOf('/') + 1)); } catch (e) { return ''; }
}
/* everything after the first "?" (a hand-made link may hold more than one) */
function queryOf(req) {
  var u = String(req.url || ''), i = u.indexOf('?');
  return new URLSearchParams(i === -1 ? '' : u.slice(i + 1));
}

/* Never cached: a cached pixel is an open counted once and never again (server.ts). */
function sendPixel(req, res) {
  if (res.headersSent) return;
  res.writeHead(200, { 'Content-Type': 'image/gif', 'Content-Length': PIXEL.length,
    'Cache-Control': 'no-store, no-cache, must-revalidate, private', Pragma: 'no-cache', Expires: '0',
    'X-Content-Type-Options': 'nosniff' });
  res.end(req.method === 'HEAD' ? undefined : PIXEL);
}

/* GET|HEAD /t/o/<id>.gif — always the GIF, whatever happens to the count: a mail must never show a broken image.
   As in the source, the id is also taken without ".gif". */
function handleOpen(req, res) {
  try {
    var id = lastSegment(req.url).replace(/\.gif$/i, '');
    var fb = firebase();
    var counted = fb && !fb.error ? countHit(fb, id, 'open', isAutomated(req), Date.now()) : DONE;
    counted.then(function () { sendPixel(req, res); }, function () { sendPixel(req, res); });
  } catch (err) {
    logOnce('open', 'promo-track: the open pixel failed — ' + (err && err.stack || err));
    try { sendPixel(req, res); } catch (e) { /* the socket is gone */ }
  }
}

function badLink(req, res) {
  if (res.headersSent) return;
  res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(req.method === 'HEAD' ? undefined : 'bad link');
}
function redirect(res, target) {
  if (res.headersSent) return;
  res.writeHead(302, { Location: encodeUrl(target), 'Cache-Control': 'no-store', 'Content-Length': 0 });
  res.end();
}

/* GET|HEAD /t/c/<id>?u=<url>&s=<sig> — the gates, in order; any failure is 400 "bad link", and only a link that
   passes every one is counted (as in the source):
     1. exactly one u                     (ONEWORLD PORT: which of two would be followed is not a question to answer)
     2. engine.safeUrl(u) — trimmed; never javascript:, data: or vbscript:
     3. engine.clickTargetOk — absolute http(s), no control character, a URL that parses: the same test the
        signing side applies, so every link Oneworld signed passes it
     4. an id shaped like a send id
     5. a key to check with (TRACK_SECRET) — not the mode or MAILER_TRACK_BASE: links already sent keep working
     6. the signature (engine.verifyClick: constant time; the current key, then TRACK_SECRET_PREVIOUS)
   A count that fails never changes the 302. ONEWORLD PORT: the body is empty, where Express wrote "Found.
   Redirecting to …"; Location is the same. */
function handleClick(req, res) {
  var target = '';
  try {
    var q = queryOf(req), us = q.getAll('u');
    if (us.length !== 1) return badLink(req, res);
    var t = engine.safeUrl(us[0]) || '';
    if (!t || !engine.clickTargetOk(t)) return badLink(req, res);
    var id = lastSegment(req.url);
    if (!SEND_ID_RE.test(id)) return badLink(req, res);
    if (!keyOk()) {
      logOnce('key', 'promo-track: TRACK_SECRET is not set — tracked links cannot be checked');
      return badLink(req, res);
    }
    if (!engine.verifyClick(id, t, String(q.get('s') || ''))) return badLink(req, res);
    target = t;
    var fb = firebase();
    var counted = fb && !fb.error ? countHit(fb, id, 'click', isAutomated(req), Date.now()) : DONE;
    counted.then(function () { redirect(res, target); }, function () { redirect(res, target); });
  } catch (err) {
    logOnce('click', 'promo-track: a click could not be handled — ' + (err && err.stack || err));
    try {
      if (target) return redirect(res, target);
      if (res.headersSent) return;
      res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Retry-After': '60' });
      res.end(req.method === 'HEAD' ? undefined : 'This link is not available right now. Please try again in a few minutes.');
    } catch (e) { /* the socket is gone */ }
  }
}

/* ---------- the dashboard's numbers ---------- */

/* What both views read: every field the summary needs and the window's days — never `by`. */
var SELECT_FIELDS = ['eventId', 'eventCreatedAt', 'portal', 'eventName', 'mailerId', 'mailerLabel', 'subject', 'saveId',
  'saveName', 'createdAt', 'opens', 'clicks', 'botOpens', 'botClicks'];
function selectFor(nowMs) {
  var FieldPath = fsTypes().FieldPath;
  return SELECT_FIELDS.concat(windowDays(nowMs).map(function (d) { return new FieldPath('days', d); }));
}

function num(v) { var n = Number(v); return isFinite(n) && n > 0 ? n : 0; }
function text(v) { return v == null ? '' : String(v); }
function rowOf(snap) {
  var d = snap.data() || {};
  return {
    id: snap.id, eventId: text(d.eventId), eventCreatedAt: text(d.eventCreatedAt), portal: text(d.portal),
    eventName: text(d.eventName), mailerId: text(d.mailerId), mailerLabel: text(d.mailerLabel), subject: text(d.subject),
    saveId: text(d.saveId), saveName: text(d.saveName), createdAt: num(d.createdAt),
    opens: num(d.opens), clicks: num(d.clicks), botOpens: num(d.botOpens), botClicks: num(d.botClicks),
    days: d.days && typeof d.days === 'object' ? d.days : {}
  };
}

/* store.ts rank(), verbatim: group sends by a key and total their opens/clicks, biggest first — ties go to the
   key with more sends. The rows come newest first, so a key's label is its newest send's. */
function rank(rows, keyOf, labelOf, by, limit) {
  limit = limit || 10;
  var acc = new Map();
  rows.forEach(function (s) {
    var key = keyOf(s);
    if (!key) return;
    var cur = acc.get(key) || { key: key, label: labelOf(s), sends: 0, opens: 0, clicks: 0 };
    cur.sends += 1; cur.opens += s.opens; cur.clicks += s.clicks;
    acc.set(key, cur);
  });
  return Array.from(acc.values()).sort(function (a, b) { return b[by] - a[by] || b.sends - a.sends; }).slice(0, limit);
}

/* store.ts versionsByTemplate(), verbatim: saved versions grouped under their template — the drill-down that
   answers "which version of it did better". Sends made before a version was saved, or straight from the studio,
   group under one honest row rather than being dropped: they are real sends and their numbers must add up.
   ONEWORLD PORT: `out` has no prototype, so a mailer id is only ever an ordinary key ("__proto__" included). */
var AD_HOC = '-';
function versionsByTemplate(rows) {
  var out = Object.create(null), byTemplate = new Map();
  rows.forEach(function (s) {
    if (!s.mailerId) return;
    var list = byTemplate.get(s.mailerId) || [];
    list.push(s);
    byTemplate.set(s.mailerId, list);
  });
  byTemplate.forEach(function (list, mailerId) {
    var ranked = rank(list, function (s) { return s.saveId || AD_HOC; },
      function (s) { return s.saveName || s.saveId || 'Not saved — sent from the studio'; }, 'opens', 20);
    // One row is not a comparison, so there is nothing to drill into.
    if (ranked.length > 1) out[mailerId] = ranked;
  });
  return out;
}

/* store.ts buildSummary(), on rows already read and filtered to the view: the source's Summary shape, so the
   platform's dashboard reads it unchanged. backend: 'firestore' (recording here) or 'none' (the dashboard's
   "aren't being saved" note). The series is 30 India days ending today, each the sum of the rows' human hits. */
function buildSummary(rows, nowMs, backend) {
  var series = windowDays(nowMs).map(function (date) { return { date: date, opens: 0, clicks: 0 }; });
  var byDate = new Map(series.map(function (d) { return [d.date, d]; }));
  rows.forEach(function (r) {
    var days = r.days || {};
    Object.keys(days).forEach(function (day) {
      var p = byDate.get(day), v = days[day] || {};
      if (p) { p.opens += num(v.o); p.clicks += num(v.c); }
    });
  });
  var list = rows.map(function (r) {
    return { id: r.id, portal: r.portal, event: r.eventId, eventName: r.eventName, mailerId: r.mailerId,
      mailerLabel: r.mailerLabel, subject: r.subject, saveId: r.saveId, saveName: r.saveName, createdAt: r.createdAt,
      opens: r.opens, clicks: r.clicks, sends: 1, botOpens: r.botOpens, botClicks: r.botClicks };
  }).sort(function (a, b) { return b.createdAt - a.createdAt; });
  var totals = list.reduce(function (t, s) { return { sends: t.sends + 1, opens: t.opens + s.opens, clicks: t.clicks + s.clicks }; }, { sends: 0, opens: 0, clicks: 0 });
  var filtered = list.reduce(function (t, s) { return { opens: t.opens + (s.botOpens || 0), clicks: t.clicks + (s.botClicks || 0) }; }, { opens: 0, clicks: 0 });
  var template = function (s) { return s.mailerId; }, templateLabel = function (s) { return s.mailerLabel || s.mailerId; };
  var subject = function (s) { return s.subject; };
  return {
    available: backend === 'firestore',
    backend: backend,
    series: series,
    totals: totals,
    filtered: filtered,
    sends: list.slice(0, 200),
    topOpenedTemplates: rank(list, template, templateLabel, 'opens'),
    topOpenedSubjects: rank(list, subject, subject, 'opens'),
    topClickedTemplates: rank(list, template, templateLabel, 'clicks'),
    topClickedSubjects: rank(list, subject, subject, 'clicks'),
    versions: versionsByTemplate(list)
  };
}

var FAILED = 'Mailer performance could not be loaded. Please try again.';

/* GET /api/promo/analytics?eventId= — one event's dashboard. A missing or deleted event answers loadLiveEvent's
   404. Only sends made while this event existed count: a discarded draft's address can be taken again, and its
   sends carry the old event's createdAt. Not cached — one indexed query per load, so the numbers never go
   backwards between the two instances. ONEWORLD PORT: the source had one dashboard for everything, behind no
   sign-in; this one is per event (the owner wants both levels) and, like the team view, for signed-in staff only. */
function handleAnalytics(req, res) {
  H.withAdmin(req, res, function (fb) {
    var eventId = H.eventIdOr400(res, queryOf(req).get('eventId'));
    if (!eventId) return;
    var now = Date.now();
    H.loadLiveEvent(fb, eventId).then(function (ev) {
      var q = sendsOf(fb).where('eventId', '==', eventId);
      return q.select.apply(q, selectFor(now)).get().then(function (snap) {
        var createdAt = text(ev && ev.createdAt);
        var rows = snap.docs.map(rowOf).filter(function (r) { return r.eventId === eventId && r.eventCreatedAt === createdAt; });
        sendJson(res, 200, buildSummary(rows, now, availableFor(eventId) ? 'firestore' : 'none'));
      });
    }).catch(function (err) { H.sendFailure(res, 'mailer performance', err, FAILED); });
  });
}

/* The team view's rows: every send of a live event, made while that event existed. qa- events are left out (the
   sitemap's rule: they are the QA harness's), and so are deleted events. Cached TEAM_CACHE_MS on this instance;
   a send recorded here clears it, and a read already running when one is recorded is not kept. ONEWORLD PORT:
   the source cached its whole summary for 60 s in Redis, shared by every caller; here each instance keeps 30 s of
   rows, and Refresh / Try again (fresh=1) skip it. */
var team = { rows: null, at: 0, gen: 0, loading: null };
function forgetTeam() { team.gen++; team.rows = null; team.at = 0; team.loading = null; }

function loadTeamRows(fb, nowMs) {
  var col = sendsOf(fb);
  return col.select.apply(col, selectFor(nowMs)).get().then(function (snap) {
    var rows = snap.docs.map(rowOf).filter(function (r) { return isEventId(r.eventId) && !isQaEvent(r.eventId); });
    var ids = Array.from(new Set(rows.map(function (r) { return r.eventId; })));
    var chunks = [];
    for (var i = 0; i < ids.length; i += 300) chunks.push(ids.slice(i, i + 300));
    var events = fb.db.collection('events');
    return Promise.all(chunks.map(function (chunk) {
      var args = chunk.map(function (id) { return events.doc(id); }).concat([{ fieldMask: ['createdAt', 'deletedAt'] }]);
      return fb.db.getAll.apply(fb.db, args);
    })).then(function (parts) {
      var live = {};
      parts.forEach(function (snaps) {
        snaps.forEach(function (s) {
          var d = s && s.exists ? (s.data() || {}) : null;
          if (d && d.createdAt && !d.deletedAt) live[s.id] = text(d.createdAt);
        });
      });
      return rows.filter(function (r) { return live[r.eventId] !== undefined && r.eventCreatedAt === live[r.eventId]; });
    });
  });
}

function teamRows(fb, fresh) {
  var now = Date.now();
  if (!fresh && team.rows && now - team.at < N.TEAM_CACHE_MS) return Promise.resolve(team.rows);
  if (!fresh && team.loading) return team.loading;
  var gen = team.gen;
  var p = loadTeamRows(fb, now).then(function (rows) {
    if (team.gen === gen) { team.rows = rows; team.at = now; }
    return rows;
  });
  team.loading = p;
  var clear = function () { if (team.loading === p) team.loading = null; };
  p.then(clear, clear);
  return p;
}

/* GET /api/promo/analytics/all[?fresh=1] — every event's, for the team page. backend 'firestore' only where every
   event is tracked (mode 'on'): a local or QA server tracks only qa- events, which this view leaves out. */
function handleAnalyticsAll(req, res) {
  H.withAdmin(req, res, function (fb) {
    var fresh = queryOf(req).get('fresh') === '1';
    teamRows(fb, fresh).then(function (rows) {
      sendJson(res, 200, buildSummary(rows, Date.now(), mode() === 'on' ? 'firestore' : 'none'));
    }).catch(function (err) { H.sendFailure(res, 'mailer performance', err, FAILED); });
  });
}

/* ---------- tests ---------- */

/* Forget everything this instance holds (tests only). */
function resetState() {
  pending.forEach(function (e) { if (e.timer) clearTimeout(e.timer); e.timer = null; releaseCarrier(e); });
  pending.clear(); known.clear(); unknown.clear(); probing.clear();
  waiting = 0; tokens = null; tokensAt = 0; flushing = 0; loggedAt = {};
  forgetTeam();
}
function state() { return { known: known, unknown: unknown, probing: probing, pending: pending, waiting: waiting, team: team }; }

module.exports = {
  wire, mode, availableFor, base, countsFor, recordSends,
  handleOpen, handleClick, handleAnalytics, handleAnalyticsAll, flushAll
};
module.exports._test = {
  AUTOMATED, isAutomated, PIXEL, SEND_ID_RE, MAILER_ID_RE, SAVE_ID_RE, encodeUrl, dayKey, buildSummary,
  sendDoc, updateArgs, countHit, NUMBERS, resetState,
  keyOk, baseOrigin, windowDays, rank, versionsByTemplate, SELECT_FIELDS, state
};
