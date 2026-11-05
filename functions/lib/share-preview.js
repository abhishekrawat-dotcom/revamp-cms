// Shareable preview links: a site that is not live yet, shown to people without an ET account (clients,
// sponsors, speakers) through an address that cannot be guessed and stops working by itself.
//
// Why this exists: /preview/<eventId> is signed-in only, on purpose. Until October previews were public objects
// at addresses anyone could guess, and unreleased sites leaked; lib/access.js now turns a signed-out visitor
// away from /preview/. The owner decided (3 Nov 2026) to add a separate link a team member can hand out:
//
//   POST /api/event/share-preview        { eventId, label?, origin? }  -> { url, link, warnings }   (admin)
//   GET  /api/event/share-preview?eventId=                             -> { links, maxActive, days } (admin)
//   POST /api/event/share-preview/stop   { eventId, id }               -> { ok, id, changed }      (admin)
//   GET  /s/<token>[/<slug>]             PUBLIC: the site as last saved, through the preview transform
//
// The rules:
//   - the token is 256 random bits (lib/share-token.js); only its SHA-256 is stored, as the document id of
//     sharePreviews/<hash>. The token is sent once, in the create answer, and is never stored, logged or
//     written into History (that shows "…" and its last four characters).
//   - a link works for 7 days from when it was made, never longer. "Stop sharing" ends it at once; deleting
//     or discarding the event ends all of its links (api-events.js calls revokeAllForEvent). Every request
//     reads the link and the event afresh, so a stop is seen by the very next request on every instance.
//   - the page is the latest SAVED site (events/<id>/site/page.html): never someone's unsaved draft, a staged
//     copy or an older version; a query string on /s/ is ignored entirely. It goes through the same
//     publishTransform as /preview/ in preview mode, with opts.shareView: the ribbon reads "Preview — not
//     live yet", forms check answers but send nothing (templates/_shared/rv-forms.js "shared" mode), no visit is
//     counted, it is noindex, and the editor's tools (the theme switcher, "Edit with AI") are left out.
//     A link often shows the coming changes of a site that is already live: then (opts.shareLive) the ribbon
//     reads "Preview — changes not live yet" (or "this version is live" when nothing was saved since it was
//     published), and a form's "nothing was sent" note points the guest to the live site, where it works.
//   - every way a link can fail (malformed, unknown, expired, stopped, event deleted, missing or made again
//     at the same address, page missing) answers the same 404 page, byte for byte: it never says which event
//     it was, or why.
//   - anyone who can edit the event (any allowed company account: the CMS has no per-event roles) may make
//     or stop a link; each make and each stop is a line in the event's History (lib/activity.js).
//
// lib/api.js hands this module its helpers (wire()) on every call, as it does for lib/promo.js, instead of
// this file requiring lib/api.js (a require cycle). revokeAllForEvent() needs none of them: lib/api-events.js
// calls it without wiring.
const shareToken = require('./share-token');
const { sendJson, clientIp, rateLimit, isEventId } = require('./http');
const activity = require('./activity');
const { getFirebase } = require('./firebase');

var H = null;
function wire(helpers) { H = helpers; }

var COLLECTION = 'sharePreviews';
var DAYS = 7, DAY_MS = 24 * 60 * 60 * 1000, LIFETIME_MS = DAYS * DAY_MS;
/* The most links of one event that may work at once. Counted in Firestore when a link is made, so it holds
   across instances (two makes at the same moment on two instances could reach 21: accepted). */
var MAX_ACTIVE = 20;
var LABEL_MAX = 60;
/* A link that stopped or ran out more than this long ago is deleted the next time the event's links are made
   or listed (at most HOUSEKEEP_MAX at a time). History keeps the lasting record, so the collection cannot
   grow without bound and no scheduled job is needed. */
var KEEP_DEAD_MS = 30 * DAY_MS, HOUSEKEEP_MAX = 50;
/* In-memory, per instance (lib/http.js rateLimit). Every window is at most 10 minutes: rateLimit forgets a key
   idle for 10 minutes, so a longer window would silently become "10 minutes since the last try". The cap
   of MAX_ACTIVE above is the real bound across instances. */
var LIMITS = {
  createByPerson: { max: 10, ms: 10 * 60 * 1000 },
  createByEvent: { max: 20, ms: 10 * 60 * 1000 },
  stopByPerson: { max: 60, ms: 10 * 60 * 1000 },
  /* tokens cannot be guessed: this only bounds what a flood of junk requests costs */
  viewByIp: { max: 120, ms: 60 * 1000 }
};
var REASONS = { stopped: 1, 'event-deleted': 1, 'event-discarded': 1 };
var LINK_ID_RE = /^[0-9a-f]{64}$/;

var GONE_TITLE = 'This preview link has expired or was switched off';
var GONE_TEXT = 'Ask the person who sent it for a new link.';

/* ---------- small pieces ---------- */
function linkRef(fb, id) { return fb.db.collection(COLLECTION).doc(id); }
function nowIso() { return new Date().toISOString(); }
function queryOf(req) { return new URLSearchParams(String(req.url || '').split('?')[1] || ''); }
function planned(status, message, code) {
  var err = new Error(message);
  err.status = status;
  err.body = { error: message, code: code };
  return err;
}
/* "…k3Qz": how a link is named to people and in our own log lines */
function tagOf(last4) { return '…' + String(last4 || ''); }
/* text that may be logged, with the token (if it got in somehow) replaced by its tag */
function scrub(text, token) {
  var s = String(text == null ? '' : text);
  return token ? s.split(token).join(tagOf(shareToken.last4(token))) : s;
}
/* The event's createdAt as text, whichever way it was stored (an ISO string; a Firestore Timestamp on a
   record written by hand), so the link and the event can be compared. */
function stampOf(v) {
  if (typeof v === 'string') return v;
  if (v && typeof v.toDate === 'function') { try { return v.toDate().toISOString(); } catch (e) { return ''; } }
  return '';
}
/* the optional "who is it for": one line of plain text, at most 60 characters */
function cleanLabel(v) {
  if (typeof v !== 'string') return '';
  return v.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, LABEL_MAX).trim();
}

/* India time, written the way the console writes dates ("10 Nov 2026, 4:20 pm IST"). IST has no summer time,
   so it is a fixed +05:30 and needs nothing from the server's locale data. */
var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function ist(ms) {
  var d = new Date(ms + 330 * 60000);
  return { day: d.getUTCDate(), month: MONTHS[d.getUTCMonth()], year: d.getUTCFullYear(), h: d.getUTCHours(), m: d.getUTCMinutes() };
}
function istDateTime(iso) {
  var ms = Date.parse(iso);
  if (!(ms > 0)) return '';
  var t = ist(ms), h12 = t.h % 12 || 12;
  return t.day + ' ' + t.month + ' ' + t.year + ', ' + h12 + ':' + (t.m < 10 ? '0' : '') + t.m + ' ' + (t.h < 12 ? 'am' : 'pm') + ' IST';
}
function istDay(iso) {
  var ms = Date.parse(iso);
  if (!(ms > 0)) return '';
  var t = ist(ms);
  return t.day + ' ' + t.month;
}

/* ---------- a link's state ---------- */
function isActive(link, now) {
  return !!link && !link.revokedAt && now < Date.parse(link.expiresAt);
}
/* stopped or ran out more than 30 days ago */
function isStale(link, now) {
  if (!link) return true;
  var ended = link.revokedAt ? Date.parse(link.revokedAt) : Date.parse(link.expiresAt);
  return !(ended > 0) || now - ended > KEEP_DEAD_MS;
}
/* what a signed-in team member is shown of a link: never the token (it is not stored); the id is its hash */
function publicLink(id, link) {
  return { id: id, last4: link.last4 || '', label: link.label || '', createdBy: link.createdBy || '', createdAt: link.createdAt || '',
    expiresAt: link.expiresAt || '', madeAtVersion: +link.madeAtVersion || 0 };
}

/* Every link document of one event: [{ id, ref, link }]. The equality query needs only Firestore's automatic
   single-field index; the eventId is checked again here so that nothing of another event can slip in. */
function linksOfEvent(fb, eventId) {
  return fb.db.collection(COLLECTION).where('eventId', '==', eventId).get().then(function (snap) {
    var out = [];
    (snap.docs || []).forEach(function (d) {
      var link = (d.data && d.data()) || null;
      if (link && link.eventId === eventId) out.push({ id: d.id, ref: d.ref || linkRef(fb, d.id), link: link });
    });
    return out;
  });
}

/* Deletes up to HOUSEKEEP_MAX of the event's links that ended long ago. Never rejects: tidying up must not be
   the reason a make or a list fails. */
function housekeep(fb, all, now) {
  try {
    var old = all.filter(function (x) { return !isActive(x.link, now) && isStale(x.link, now); }).slice(0, HOUSEKEEP_MAX);
    if (!old.length) return Promise.resolve(0);
    var batch = fb.db.batch();
    old.forEach(function (x) { batch.delete(x.ref); });
    return batch.commit().then(function () { return old.length; }, function (err) {
      console.error('share-preview: old links could not be tidied away — ' + (err && err.message));
      return 0;
    });
  } catch (err) {
    console.error('share-preview: old links could not be tidied away — ' + (err && err.message));
    return Promise.resolve(0);
  }
}

/* The event behind a team member's request: its data when it is a live event, else the 404 to answer. */
function liveEventOr404(fb, eventId) {
  return H.eventDocRef(fb, eventId).get().then(function (snap) {
    var state = H.eventStateOf(snap);
    if (state === 'deleted') throw planned(404, 'This event has been deleted.', 'event-not-found');
    if (state !== 'live') throw planned(404, 'No event found for "' + eventId + '".', 'event-not-found');
    return snap.data();
  });
}

/* =====================================================================================================
   POST /api/event/share-preview   { eventId, label?, origin? }
     200 { url, link: { id, last4, label, createdBy, createdAt, expiresAt, madeAtVersion }, warnings: [{ code, message }] }
     400 a bad eventId · 404 event-not-found · 409 site-not-saved | too-many-links · 429 rate-limited
   The answer is the ONLY place the token is ever sent (sendJson answers no-store).
   ===================================================================================================== */
function handleCreate(req, res) {
  H.withAdminBody(req, res, H.BODY_LIMITS.small, function (fb, decoded, body) {
    var eventId = H.eventIdOr400(res, body.eventId);
    if (!eventId) return;
    var by = activity.actorOf(decoded);
    if (!rateLimit('share-create:' + by, LIMITS.createByPerson.max, LIMITS.createByPerson.ms) ||
        !rateLimit('share-create-event:' + eventId, LIMITS.createByEvent.max, LIMITS.createByEvent.ms)) {
      return sendJson(res, 429, { error: 'Many links have been made in the last few minutes. Please wait a few minutes and try again.', code: 'rate-limited' },
        { 'Retry-After': String(LIMITS.createByPerson.ms / 1000) });
    }
    var label = cleanLabel(body.label);
    var data, version, now = Date.now();
    liveEventOr404(fb, eventId).then(function (d) {
      data = d;
      version = H.siteVersionOf(data);
      if (!version) throw planned(409, 'Save the site first: a shared link shows the site as last saved.', 'site-not-saved');
      return linksOfEvent(fb, eventId);
    }).then(function (all) {
      var eventStamp = stampOf(data.createdAt);
      var active = all.filter(function (x) { return isActive(x.link, now) && x.link.eventCreatedAt === eventStamp; });
      if (active.length >= MAX_ACTIVE) {
        throw planned(409, 'This event already has ' + MAX_ACTIVE + ' links that work. Stop one you no longer need, then make a new one.', 'too-many-links');
      }
      var token = shareToken.newToken(), id = shareToken.hashToken(token);
      var link = {
        v: 1, eventId: eventId, eventCreatedAt: eventStamp, createdBy: by,
        createdAt: new Date(now).toISOString(), expiresAt: new Date(now + LIFETIME_MS).toISOString(),
        revokedAt: null, revokedBy: null, revokeReason: null,
        last4: shareToken.last4(token), label: label, madeAtVersion: version
      };
      /* create() fails rather than overwrite: two equal 256-bit tokens will not happen, and if they did the
         first link must not be taken over */
      return linkRef(fb, id).create(link).then(function () {
        /* a share is not a publish, so an unanswered note on the logo unit only warns (it blocks going live) */
        return H.readObject(fb, H.sitePath(eventId, 'page.html')).then(function (html) { return html; }, function () { return null; });
      }).then(function (html) {
        var warnings = [];
        if (html != null && H.unansweredLogoNote(html) != null) {
          warnings.push({ code: 'logo-note', message: 'The logo unit at the top of this site still has a note to check in the site editor. The link works, and shows the logo as it is now.' });
        }
        return housekeep(fb, all, now).then(function () {
          var detail = 'Shared preview link ' + tagOf(link.last4) + ' made' + (label ? ' for “' + activity.maskEmail(label) + '”' : '') +
            ' — works until ' + istDateTime(link.expiresAt) + ' (version ' + version + ')';
          return activity.logActivity(fb, eventId, decoded, 'preview-link-shared', detail, { area: 'publishing', version: version });
        }).then(function () {
          sendJson(res, 200, { url: H.publicBaseFor(req, body.origin) + '/s/' + token, link: publicLink(id, link), warnings: warnings });
        });
      });
    }).catch(function (err) {
      H.sendFailure(res, 'share-preview: making a link for ' + eventId, err, 'The link could not be made. Please try again.');
    });
  });
}

/* =====================================================================================================
   GET /api/event/share-preview?eventId=   -> 200 { links: [the links that work now, newest first], maxActive, days }
   ===================================================================================================== */
function handleList(req, res) {
  H.withAdmin(req, res, function (fb) {
    var eventId = H.eventIdOr400(res, queryOf(req).get('eventId'));
    if (!eventId) return;
    var now = Date.now(), data;
    liveEventOr404(fb, eventId).then(function (d) {
      data = d;
      return linksOfEvent(fb, eventId);
    }).then(function (all) {
      var eventStamp = stampOf(data.createdAt);
      var links = all.filter(function (x) { return isActive(x.link, now) && x.link.eventCreatedAt === eventStamp; })
        .map(function (x) { return publicLink(x.id, x.link); })
        .sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0; });
      return housekeep(fb, all, now).then(function () {
        sendJson(res, 200, { links: links, maxActive: MAX_ACTIVE, days: DAYS });
      });
    }).catch(function (err) {
      H.sendFailure(res, 'share-preview: listing the links of ' + eventId, err, 'The shared links could not be loaded. Please try again.');
    });
  });
}

/* =====================================================================================================
   POST /api/event/share-preview/stop   { eventId, id }   -> 200 { ok, id, changed }
   changed:false when the link had already stopped or run out (and no History line is written then).
   404 when there is no such link OR it belongs to another event: one event's page can never stop another's.
   ===================================================================================================== */
function handleStop(req, res) {
  H.withAdminBody(req, res, H.BODY_LIMITS.tiny, function (fb, decoded, body) {
    var eventId = H.eventIdOr400(res, body.eventId);
    if (!eventId) return;
    var id = typeof body.id === 'string' ? body.id.trim() : '';
    if (!LINK_ID_RE.test(id)) return sendJson(res, 400, { error: 'Invalid link id.', code: 'bad-link-id' });
    var by = activity.actorOf(decoded);
    if (!rateLimit('share-stop:' + by, LIMITS.stopByPerson.max, LIMITS.stopByPerson.ms)) {
      return sendJson(res, 429, { error: 'Many links have been stopped in the last few minutes. Please wait a few minutes and try again.', code: 'rate-limited' },
        { 'Retry-After': String(LIMITS.stopByPerson.ms / 1000) });
    }
    var ref = linkRef(fb, id), link = null, changed = false, at = nowIso();
    /* in a transaction, so two people pressing Stop at the same moment write one History line, not two */
    fb.db.runTransaction(function (tx) {
      changed = false;
      return tx.get(ref).then(function (snap) {
        link = snap.exists ? snap.data() : null;
        if (!link || link.eventId !== eventId) throw planned(404, 'That link was not found for this event.', 'link-not-found');
        if (!isActive(link, Date.now())) return;
        tx.update(ref, { revokedAt: at, revokedBy: by, revokeReason: 'stopped' });
        changed = true;
      });
    }).then(function () {
      if (!changed) return;
      var detail = 'Shared preview link ' + tagOf(link.last4) + ' switched off (made by ' + (link.createdBy || 'someone') + ' on ' + istDay(link.createdAt) + ')';
      return activity.logActivity(fb, eventId, decoded, 'preview-link-stopped', detail, { area: 'publishing' });
    }).then(function () {
      sendJson(res, 200, { ok: true, id: id, changed: changed });
    }).catch(function (err) {
      H.sendFailure(res, 'share-preview: stopping a link of ' + eventId, err, 'The link could not be stopped. Please try again.');
    });
  });
}

/* =====================================================================================================
   Stopping every link of an event that is being deleted or discarded (lib/api-events.js, after the change).
     'event-deleted'    the links are marked stopped, and one History line says how many (only when there were
                        any). Restoring the event does not bring them back: a restore leaves no marker, so the
                        event being live again would otherwise make an old link work again.
     'event-discarded'  the event and its history are gone and its address is free for a new event: the link
                        documents are deleted.
   by: the person (a decoded token or an email). -> Promise<number of links that were working>, or -1 when it
   failed. Never rejects and never throws: it must not be the reason a delete or a discard fails.
   ===================================================================================================== */
function revokeAllForEvent(fb, eventId, by, reason) {
  try {
    if (!REASONS[reason] || reason === 'stopped') reason = 'event-deleted';
    if (!fb || !fb.db || !isEventId(eventId)) return Promise.resolve(0);
    var now = Date.now(), at = new Date(now).toISOString(), who = activity.actorOf(by);
    return linksOfEvent(fb, eventId).then(function (all) {
      var active = all.filter(function (x) { return isActive(x.link, now); });
      var touched = reason === 'event-discarded' ? all : active;
      if (!touched.length) return 0;
      /* a batch holds at most 500 writes */
      var chunks = [];
      for (var i = 0; i < touched.length; i += 400) chunks.push(touched.slice(i, i + 400));
      return chunks.reduce(function (p, chunk) {
        return p.then(function () {
          var batch = fb.db.batch();
          chunk.forEach(function (x) {
            if (reason === 'event-discarded') batch.delete(x.ref);
            else batch.update(x.ref, { revokedAt: at, revokedBy: who, revokeReason: reason });
          });
          return batch.commit();
        });
      }, Promise.resolve()).then(function () {
        if (reason === 'event-discarded' || !active.length) return active.length;
        var n = active.length;
        return activity.logActivity(fb, eventId, by, 'preview-link-stopped',
          n + ' shared preview link' + (n === 1 ? '' : 's') + ' switched off because the event was deleted', { area: 'publishing' })
          .then(function () { return n; });
      });
    }).catch(function (err) {
      console.error('share-preview: the shared links of ' + eventId + ' could not be stopped (' + reason + ') — ' + (err && err.message));
      return -1;
    });
  } catch (err) {
    console.error('share-preview: the shared links of ' + eventId + ' could not be stopped (' + reason + ') — ' + (err && err.message));
    return Promise.resolve(-1);
  }
}

/* =====================================================================================================
   GET / HEAD /s/<token>[/<slug>][/]   PUBLIC — the shared site
   ===================================================================================================== */
/* Every /s/ answer goes out here, with shareToken.shareHeaders(): no-store, noindex, Referrer-Policy:
   strict-origin (lib/api.js sendHtml's strict-origin-when-cross-origin would hand the full /s/<token> address
   to our own host as the Referer of every request the page makes), and no framing. No cookie is ever set. */
function sendPage(req, res, status, html, extra) {
  if (res.headersSent) { try { res.end(); } catch (e) { /* socket already gone */ } return; }
  var raw = Buffer.from(String(html || ''), 'utf8'), body = raw, encoding = '';
  if (html && raw.length > 1024 && H) {
    encoding = H.acceptedEncoding(req);
    if (encoding) { try { body = H.compressHtml(raw, encoding, false); } catch (e) { body = raw; } }
  }
  if (body === raw) encoding = '';
  var headers = shareToken.shareHeaders();
  headers['Content-Type'] = 'text/html; charset=utf-8';
  headers['Content-Length'] = body.length;
  if (encoding) headers['Content-Encoding'] = encoding;
  if (extra) Object.keys(extra).forEach(function (k) { headers[k] = extra[k]; });
  res.writeHead(status, headers);
  res.end(req.method === 'HEAD' ? undefined : body);
}
/* the one page for every link that does not work: the same bytes whatever the reason, naming no event */
var gonePage = null;
function sendGone(req, res) {
  if (!gonePage) gonePage = H.messagePage(GONE_TITLE, GONE_TEXT);
  sendPage(req, res, 404, gonePage);
}
/* the link of an event that was deleted but whose links the delete could not stop: stopped now, so that a
   later restore does not bring it back. Never fails the request. */
function stopForDeletedEvent(fb, id, tag, eventId) {
  try {
    linkRef(fb, id).update({ revokedAt: nowIso(), revokedBy: 'system', revokeReason: 'event-deleted' }).catch(function (err) {
      console.error('share-preview: link ' + tag + ' of deleted event ' + eventId + ' could not be stopped — ' + (err && err.message));
    });
  } catch (err) {
    console.error('share-preview: link ' + tag + ' of deleted event ' + eventId + ' could not be stopped — ' + (err && err.message));
  }
}

/* Whether the event's site is already live, for the shared page's ribbon and forms (api.js publishTransform
   opts.shareLive): '' when it is not published; 'same' when the saved site is the published one (as /api/event/
   publish decides "nothing to publish"); else 'changed'. A page published by the previous version of the CMS
   has no publishedVersion: 'changed', which never claims the guest is seeing exactly what is live. */
function liveStateOf(data) {
  if (!data || data.published !== true) return '';
  var live = +data.publishedVersion || 0, saved = H.siteVersionOf(data);
  return live && live === saved ? 'same' : 'changed';
}

function handleSharedPage(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return sendPage(req, res, 405, '', { Allow: 'GET, HEAD' });
  var urlPath = String(req.url || '').split('?')[0];
  /* the query string is never read: ?draft=1, ?staged=1 and ?version=N mean nothing here */
  var parsed = shareToken.parseSharePath(urlPath);
  if (!parsed) return sendGone(req, res);
  if (!rateLimit('share-view:' + clientIp(req), LIMITS.viewByIp.max, LIMITS.viewByIp.ms)) {
    return sendPage(req, res, 429, H.messagePage('Too many requests', 'Please wait a minute and try again.'), { 'Retry-After': String(LIMITS.viewByIp.ms / 1000) });
  }
  var token = parsed.token, tag = tagOf(shareToken.last4(token)), id = shareToken.hashToken(token);
  var fb = getFirebase();
  if (fb.error) {
    console.error('share-preview: link ' + tag + ' — ' + fb.error);
    return sendPage(req, res, 503, H.messagePage('This preview is temporarily unavailable', 'Please try again in a few minutes.'), { 'Retry-After': '60' });
  }
  var eventId = '';
  linkRef(fb, id).get().then(function (lsnap) {
    var link = lsnap && lsnap.exists ? (lsnap.data() || {}) : null;
    if (!link || !isActive(link, Date.now()) || !isEventId(link.eventId)) return sendGone(req, res);
    eventId = link.eventId;
    return H.eventDocRef(fb, eventId).get().then(function (esnap) {
      var state = H.eventStateOf(esnap);
      if (state === 'deleted') { stopForDeletedEvent(fb, id, tag, eventId); return sendGone(req, res); }
      if (state !== 'live') return sendGone(req, res);
      var data = esnap.data();
      /* a discarded event frees its address: a NEW event made there must never show through an old link */
      if (!link.eventCreatedAt || stampOf(data.createdAt) !== link.eventCreatedAt) return sendGone(req, res);
      if (!H.siteVersionOf(data)) return sendGone(req, res);
      var formsRead = H.publicFormsFor(fb, eventId, data);      // alongside the page (never rejects)
      return H.readObject(fb, H.sitePath(eventId, 'page.html')).then(function (html) {
        if (html == null) return sendGone(req, res);
        return Promise.all([formsRead, H.preparePictures(fb, html)]).then(function (got) {
          /* /preview/'s own pipeline (lib/api.js handlePreviewPage, no query), with shareView: the ribbon says
             "not live yet", no editor tools, the page links under /s/<token>, and #rv-site-config says shared */
          return H.withHeroVideo(fb, H.publishTransform(html, {
            eventId: eventId, event: data, mode: 'preview', publicBase: '', editButton: false, shareView: true,
            shareLive: liveStateOf(data), pageBase: '/s/' + token, forms: got[0], pictures: got[1],
            templateId: (data.site && data.site.templateId) || data.templateId
          }), data);
        }).then(function (page) {
          if (parsed.slug) {
            var chosen = H.selectSitePage(page, parsed.slug);
            if (!chosen.found) return sendPage(req, res, 404, H.messagePage('This page is not part of the site', 'The site has no page at this address. It may have been renamed or removed.'));
            page = chosen.html;
          }
          sendPage(req, res, 200, H.deliverPage(page));
        });
      });
    });
  }).catch(function (err) {
    console.error('share-preview: link ' + tag + (eventId ? ' of ' + eventId : '') + ' failed — ' + scrub((err && err.stack) || err, token));
    sendPage(req, res, 502, H.messagePage('This preview is temporarily unavailable', 'Please try again in a few minutes.'));
  });
}

module.exports = {
  wire, handleCreate, handleList, handleStop, handleSharedPage, revokeAllForEvent,
  MAX_ACTIVE, DAYS, COLLECTION,
  /* for the tests */
  _test: { cleanLabel, istDateTime, istDay, isActive, isStale, stampOf, scrub, liveStateOf, LIMITS, GONE_TITLE, GONE_TEXT }
};
