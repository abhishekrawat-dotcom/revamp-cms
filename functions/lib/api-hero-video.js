// The banner video: a looping, silent video behind the top of an event's site, under an overlay that keeps the
// banner's words readable. Set in the event console (Content › Basics › Banner video) and in the site editor
// (Design › Banner video); both use hero-video-ui.js and these routes. lib/api.js's router sends them here.
//
//   GET    /api/event/hero-video?eventId=        handleHeroVideoGet     what is set, and whether this site has a place for it
//   POST   /api/event/hero-video/upload          handleHeroVideoUpload  { eventId, fileName, mimeType, size } -> { uploadUrl, path }
//   POST   /api/event/hero-video/check           handleHeroVideoCheck   { eventId, path } -> the video as read from its bytes
//   PUT    /api/event/hero-video                 handleHeroVideoSave    { eventId, video?: { path }, poster?: { url } | null,
//                                                                        posterAuto?, overlay?: { mode, color, opacity }, enabled? }
//   DELETE /api/event/hero-video?eventId=        handleHeroVideoRemove
//
// THE FILE never passes through this server: a video is up to 30 MB, more than a request here may carry. The
// browser sends it straight to Cloud Storage over a resumable upload session this server opens (at a name it
// chooses, for exactly the number of bytes announced, private). Then /check reads the object's own bytes
// (lib/video-probe.js): only an MP4 or WebM with a picture track browsers play, at most 60 seconds long, is kept
// and made public; anything else is deleted and refused with a reason the owner can act on. Only a checked
// object can be saved as the banner video (PUT reads what it is from the object's metadata, which only /check
// writes). The poster — the video's still picture — is an ordinary image upload (POST /api/event/upload).
//
// What is stored on events/<id>: heroVideo (see templates/_shared/rv-hero-video-core.js). The page shows it as it
// is served (lib/api.js applyHeroVideo), so a change here is on the live site within a minute, without a publish.
//
// Every handler answers the request on every path, and nothing may throw inside a stream or promise callback
// (see lib/api-events.js for why).
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { sendJson, parseJsonBody, requireAdmin, isEventId, str } = require('./http');
const { logActivity, actorOf } = require('./activity');
const { probe } = require('./video-probe');
const core = require('../../templates/_shared/rv-hero-video-core.js');

const LIMITS = core.LIMITS;
const CACHE = 'public, max-age=31536000, immutable';
const PENDING_TTL_MS = 24 * 3600 * 1000;

function guard(res, where, fn) {
  try { return fn(); } catch (err) { fail(res, where, err); }
}
function fail(res, where, err, message) {
  if (err && err.status) return sendJson(res, err.status, Object.assign({ error: err.message }, err.extra || {}));
  console.error('api-hero-video: ' + where + ' failed — ' + ((err && err.stack) || err));
  sendJson(res, 500, { error: message || 'Something went wrong on the server. Please try again.' });
}
function reject(status, message, extra) { return Object.assign(new Error(message), { status: status, extra: extra || null }); }
function queryOf(req) { return new URLSearchParams(String(req.url || '').split('?')[1] || ''); }
function eventRef(fb, id) { return fb.db.collection('events').doc(id); }

/* a live event (created, not deleted) or a 404 */
function liveEvent(fb, eventId) {
  return eventRef(fb, eventId).get().then(function (snap) {
    var d = snap.exists ? snap.data() || {} : null;
    if (!d || !d.createdAt) throw reject(404, 'No event found for "' + eventId + '".');
    if (d.deletedAt) throw reject(404, 'This event has been deleted. Restore it before changing its banner.');
    return d;
  });
}

function publicUrl(fb, storagePath) {
  return 'https://storage.googleapis.com/' + fb.bucket.name + '/' + storagePath.split('/').map(encodeURIComponent).join('/');
}
/* the object a public address of ours names, under this event — or '' */
function ownPath(fb, eventId, url) {
  var prefix = 'https://storage.googleapis.com/' + fb.bucket.name + '/';
  var u = String(url || '').trim();
  if (u.indexOf(prefix) !== 0) return '';
  var p;
  try { p = u.slice(prefix.length).split('/').map(decodeURIComponent).join('/'); } catch (e) { return ''; }
  return p.indexOf('events/' + eventId + '/') === 0 && p.indexOf('..') === -1 && !/[?#]/.test(p) ? p : '';
}
function mediaPathOk(eventId, p) {
  return typeof p === 'string' && new RegExp('^events/' + eventId + '/media/[a-z0-9-]{1,90}\\.(mp4|webm)$').test(p);
}

function storedName(fileName, ext) {
  var base = String(fileName == null ? '' : fileName).split(/[\\/]/).pop().replace(/\.[A-Za-z0-9]{1,5}$/, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
  return Date.now().toString(36) + '-' + crypto.randomBytes(6).toString('hex') + '-' + (base || 'video') + '.' + ext;
}

function typeOf(mime, fileName) {
  var m = String(mime || '').toLowerCase().split(';')[0].trim();
  if (core.TYPES[m]) return m;
  if (!m || m === 'application/octet-stream') {
    var ext = (/\.([a-z0-9]+)$/i.exec(String(fileName || '')) || [])[1];
    if (ext && /^(mp4|m4v)$/i.test(ext)) return 'video/mp4';
    if (ext && /^webm$/i.test(ext)) return 'video/webm';
  }
  return '';
}

function mb(n) { return (n / 1048576).toFixed(n >= 10 * 1048576 ? 0 : 1) + ' MB'; }

/* ---------- which kind of banner this site has ----------
   From the page as last saved (it says what the site really is); before the first save, from the event:
   an AI-designed site has its hero, a real template its ET banner (its own section file), an import nothing. */
function readSaved(fb, eventId) {
  return fb.bucket.file('events/' + eventId + '/site/page.html').download().then(function (r) { return r[0].toString('utf8'); }, function (err) {
    if (err && (err.code === 404 || err.code === '404')) return null;
    throw err;
  });
}
var TEMPLATES_DIR = path.join(__dirname, '..', '..', 'templates');
function lookOfEvent(fb, eventId, ev) {
  var tpl = String((ev.site && ev.site.templateId) || ev.templateId || '');
  return readSaved(fb, eventId).then(function (html) {
    if (html) return core.looksAt(html);
    if (/^imported-/.test(tpl)) return { host: 'none', tone: 'dark', scrim: '' };
    if (/^gen-/.test(tpl) || ev.generatedAt) {
      var mode = ev.designPlan && ev.designPlan.design && ev.designPlan.design.mode;
      return { host: 'hero', tone: mode === 'light' ? 'light' : 'dark', scrim: '' };
    }
    if (/^[a-z0-9][a-z0-9-]{0,80}$/.test(tpl)) {
      try {
        var dir = path.join(TEMPLATES_DIR, tpl, 'sections', 'banner');
        var look = core.looksAt(fs.readFileSync(path.join(dir, 'index.html'), 'utf8') + fs.readFileSync(path.join(dir, 'style.css'), 'utf8'));
        if (look.host !== 'none') return look;
      } catch (e) { /* not a template with an ET banner */ }
    }
    return { host: 'unknown', tone: 'dark', scrim: '' };
  });
}

/* what the console and the editor are given */
function forClient(hv) {
  if (!hv || typeof hv !== 'object' || !hv.url) return null;
  var o = hv.overlay || {};
  return {
    enabled: hv.enabled !== false, url: hv.url, path: hv.path, contentType: hv.contentType, size: +hv.size || 0,
    duration: +hv.duration || 0, width: +hv.width || 0, height: +hv.height || 0, codec: hv.codec || '', hasAudio: !!hv.hasAudio,
    fastStart: hv.fastStart !== false, posterUrl: hv.posterUrl || '', posterAuto: !!hv.posterAuto,
    overlay: { mode: o.mode === 'custom' ? 'custom' : 'auto', color: o.color || '', opacity: o.opacity == null ? null : +o.opacity },
    updatedAt: hv.updatedAt || '', updatedBy: hv.updatedBy || ''
  };
}

/* ---------- GET ---------- */
function handleHeroVideoGet(req, res) {
  requireAdmin(req, res, function (fb) {
    guard(res, 'get', function () {
      var eventId = str(queryOf(req).get('eventId'), 100);
      if (!isEventId(eventId)) return sendJson(res, 400, { error: 'A valid eventId is required.' });
      liveEvent(fb, eventId).then(function (ev) {
        return lookOfEvent(fb, eventId, ev).then(function (look) {
          sendJson(res, 200, {
            heroVideo: forClient(ev.heroVideo), site: look,
            auto: core.overlayFor({ mode: 'auto' }, look), limits: LIMITS, types: Object.keys(core.TYPES)
          });
        });
      }).catch(function (err) { fail(res, 'get', err, 'The banner video could not be loaded. Please try again.'); });
    });
  });
}

/* ---------- POST upload: a session to send the file to ---------- */
function cleanOrigin(v) {
  var s = String(v || '').trim();
  return /^https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?$/.test(s) ? s : '';
}

/* uploads that were sent but never checked (a closed tab, a refused file whose delete failed): gone after a day */
function sweepPending(fb, eventId) {
  return fb.bucket.getFiles({ prefix: 'events/' + eventId + '/media/', autoPaginate: false, maxResults: 200 }).then(function (r) {
    var now = Date.now();
    return Promise.all((r[0] || []).filter(function (f) {
      var m = f.metadata || {}, own = m.metadata || {};
      return own.rvPending === '1' && now - Date.parse(m.timeCreated || 0) > PENDING_TTL_MS;
    }).map(function (f) { return f.delete().catch(function () { /* next time */ }); }));
  }).catch(function (err) { console.error('api-hero-video: sweep of ' + eventId + ' failed — ' + ((err && err.message) || err)); });
}

function handleHeroVideoUpload(req, res) {
  requireAdmin(req, res, function (fb, decoded) {
    parseJsonBody(req, res, function (body) {
      guard(res, 'upload', function () {
        var eventId = typeof body.eventId === 'string' ? body.eventId.trim() : '';
        if (!isEventId(eventId)) return sendJson(res, 400, { error: 'A valid eventId is required.' });
        var fileName = str(body.fileName, 200) || 'video';
        var shown = '"' + fileName.slice(0, 80) + '"';
        var type = typeOf(body.mimeType, fileName);
        if (!type) return sendJson(res, 415, { error: shown + ' is not a video we can use. Upload an MP4 (H.264) or a WebM file.' });
        var size = body.size;
        if (typeof size !== 'number' || !isFinite(size) || size < 1 || Math.floor(size) !== size) return sendJson(res, 400, { error: 'The size of the file is missing.' });
        if (size > LIMITS.maxBytes) {
          return sendJson(res, 413, { error: shown + ' is ' + mb(size) + '. A banner video can be up to ' + mb(LIMITS.maxBytes) + ' — export it shorter or at a lower quality.' });
        }
        var origin = cleanOrigin(req.headers && req.headers.origin) || cleanOrigin(body.origin);
        if (!origin) return sendJson(res, 400, { error: 'The upload could not be started from this page. Reload it and try again.' });
        var storagePath = 'events/' + eventId + '/media/' + storedName(fileName, core.TYPES[type]);
        var file = fb.bucket.file(storagePath);
        liveEvent(fb, eventId).then(function () {
          sweepPending(fb, eventId);
          return file.createResumableUpload({
            origin: origin,
            metadata: {
              contentType: type, contentLength: size, cacheControl: CACHE,
              metadata: { uploadedBy: actorOf(decoded), originalName: fileName.replace(/[^\x20-\x7E]/g, '_').slice(0, 120), rvPending: '1', rvKind: 'hero-video' }
            }
          });
        }).then(function (r) {
          sendJson(res, 200, { uploadUrl: r[0], path: storagePath, contentType: type, maxBytes: LIMITS.maxBytes });
        }).catch(function (err) { fail(res, 'upload', err, 'The upload could not be started. Please try again.'); });
      });
    }, 64 * 1024);
  });
}

/* ---------- POST check: what the uploaded file really is ---------- */
function infoFromMetadata(fb, storagePath, m) {
  var own = m.metadata || {};
  return {
    url: publicUrl(fb, storagePath), path: storagePath, contentType: m.contentType, size: +m.size || 0,
    duration: +own.rvDuration || 0, width: +own.rvWidth || 0, height: +own.rvHeight || 0, codec: own.rvCodec || '',
    hasAudio: own.rvAudio === '1', fastStart: own.rvFastStart !== '0'
  };
}

function handleHeroVideoCheck(req, res) {
  requireAdmin(req, res, function (fb) {
    parseJsonBody(req, res, function (body) {
      guard(res, 'check', function () {
        var eventId = typeof body.eventId === 'string' ? body.eventId.trim() : '';
        if (!isEventId(eventId)) return sendJson(res, 400, { error: 'A valid eventId is required.' });
        var storagePath = String(body.path || '');
        if (!mediaPathOk(eventId, storagePath)) return sendJson(res, 400, { error: 'That is not an upload of this event.' });
        var file = fb.bucket.file(storagePath);
        function gone() { return file.delete().catch(function () { /* the sweep takes it */ }); }
        liveEvent(fb, eventId).then(function () {
          return file.getMetadata().then(function (r) { return r[0]; }, function (err) {
            if (err && (err.code === 404 || err.code === '404')) throw reject(404, 'The video did not arrive. Please upload it again.');
            throw err;
          });
        }).then(function (m) {
          var own = m.metadata || {};
          if (own.rvChecked === '1') return infoFromMetadata(fb, storagePath, m);       // checked already: same answer
          if (own.rvPending !== '1') throw reject(400, 'That is not an upload of this event.');
          var size = +m.size || 0;
          if (size > LIMITS.maxBytes) return gone().then(function () { throw reject(413, 'The video is ' + mb(size) + '. A banner video can be up to ' + mb(LIMITS.maxBytes) + '.'); });
          var read = function (start, end) {
            return file.download({ start: start, end: Math.min(end, size - 1), validation: false }).then(function (b) { return b[0]; });
          };
          return probe(read, size).then(function (info) {
            if (info.duration > LIMITS.maxSeconds) {
              var e = new Error('The video is ' + Math.round(info.duration) + ' seconds long. A banner video can be up to ' + LIMITS.maxSeconds + ' seconds — a short loop of 10 to 20 seconds works best.');
              e.reason = 'too-long';
              throw e;
            }
            return file.setMetadata({
              contentType: info.type, cacheControl: CACHE,
              metadata: {
                rvPending: null, rvChecked: '1', rvDuration: String(info.duration), rvWidth: String(info.width || 0), rvHeight: String(info.height || 0),
                rvCodec: info.codec || '', rvAudio: info.hasAudio ? '1' : '0', rvFastStart: info.fastStart ? '1' : '0'
              }
            }).then(function () { return file.makePublic(); }).then(function () { return file.getMetadata(); }).then(function (r) {
              return infoFromMetadata(fb, storagePath, r[0]);
            });
          }, function (err) {
            if (!err || !err.reason) throw err;
            return gone().then(function () { throw reject(415, err.message, { reason: err.reason }); });
          }).catch(function (err) {
            if (err && err.reason === 'too-long') return gone().then(function () { throw reject(415, err.message, { reason: err.reason }); });
            throw err;
          });
        }).then(function (info) {
          sendJson(res, 200, info);
        }).catch(function (err) { fail(res, 'check', err, 'The video could not be checked. Please try again.'); });
      });
    }, 64 * 1024);
  });
}

/* ---------- PUT: the banner video's settings ---------- */
function cleanOverlay(v) {
  if (v == null) return { value: null };
  if (typeof v !== 'object' || Array.isArray(v)) return { error: 'The overlay must be an object.' };
  var mode = v.mode === 'custom' ? 'custom' : v.mode === 'auto' || v.mode == null ? 'auto' : null;
  if (!mode) return { error: 'The overlay is "auto" or "custom".' };
  var c = core.parseColour(v.color);
  if (mode === 'custom' && !c) return { error: 'Choose a colour for the overlay.' };
  var op = v.opacity;
  if (mode === 'custom' && !(typeof op === 'number' && isFinite(op) && op >= 0 && op <= LIMITS.maxOpacity)) {
    return { error: 'The overlay\'s strength must be between 0% and ' + Math.round(LIMITS.maxOpacity * 100) + '%.' };
  }
  return { value: { mode: mode, color: c ? core.hexOf(c) : '', opacity: mode === 'custom' ? Math.round(op * 100) / 100 : null } };
}

function handleHeroVideoSave(req, res) {
  requireAdmin(req, res, function (fb, decoded) {
    parseJsonBody(req, res, function (body) {
      guard(res, 'save', function () {
        var eventId = typeof body.eventId === 'string' ? body.eventId.trim() : '';
        if (!isEventId(eventId)) return sendJson(res, 400, { error: 'A valid eventId is required.' });
        var wantVideo = body.video && typeof body.video === 'object' ? String(body.video.path || '') : '';
        if (wantVideo && !mediaPathOk(eventId, wantVideo)) return sendJson(res, 400, { error: 'That video is not an upload of this event.' });
        var poster = body.poster;
        var posterGiven = Object.prototype.hasOwnProperty.call(body, 'poster');
        var posterPath = '';
        if (posterGiven && poster != null) {
          posterPath = ownPath(fb, eventId, poster && poster.url);
          if (!posterPath || !/\.(jpe?g|png|webp)$/i.test(posterPath)) return sendJson(res, 400, { error: 'The still picture must be a JPG, PNG or WebP uploaded to this event.' });
        }
        var ov = Object.prototype.hasOwnProperty.call(body, 'overlay') ? cleanOverlay(body.overlay) : null;
        if (ov && ov.error) return sendJson(res, 400, { error: ov.error });
        if (Object.prototype.hasOwnProperty.call(body, 'enabled') && typeof body.enabled !== 'boolean') return sendJson(res, 400, { error: '"enabled" must be true or false.' });

        var ref = eventRef(fb, eventId), before = null, after = null;
        var newVideo = function () { return wantVideo ? fb.bucket.file(wantVideo).getMetadata().then(function (r) {
          var m = r[0], own = m.metadata || {};
          if (own.rvChecked !== '1') throw reject(400, 'That video has not been checked yet. Upload it again.');
          return infoFromMetadata(fb, wantVideo, m);
        }, function (err) {
          if (err && (err.code === 404 || err.code === '404')) throw reject(404, 'That video is no longer there. Upload it again.');
          throw err;
        }) : Promise.resolve(null); };

        /* a colour the owner chose must still leave the banner's words readable over any frame (4.5:1): the
           console and the editor do not offer one that does not, and this holds whatever sent the request */
        var readable = ov && ov.value && ov.value.mode === 'custom' ? liveEvent(fb, eventId).then(function (ev) {
          return lookOfEvent(fb, eventId, ev).then(function (look) {
            var o = core.overlayFor(ov.value, look), words = o.ink === 'dark' ? 'Dark words' : 'White words';
            if (o.readable) return;
            if (o.needed == null) throw reject(400, words + ' on this banner are hard to read on this colour at any strength. Choose a ' + (o.ink === 'dark' ? 'lighter' : 'darker') + ' colour.', { field: 'overlay' });
            throw reject(400, words + ' on this banner would be hard to read: make the overlay at least ' + Math.round(o.needed * 100) + '% strong.', { field: 'overlay', needed: o.needed });
          });
        }) : Promise.resolve();

        readable.then(newVideo).then(function (video) {
          return fb.db.runTransaction(function (tx) {
            return tx.get(ref).then(function (snap) {
              var d = snap.exists ? snap.data() || {} : null;
              if (!d || !d.createdAt) throw reject(404, 'No event found for "' + eventId + '".');
              if (d.deletedAt) throw reject(404, 'This event has been deleted. Restore it before changing its banner.');
              before = d.heroVideo && d.heroVideo.url ? d.heroVideo : null;
              var hv = Object.assign({}, before || {});
              if (video) {
                ['url', 'path', 'contentType', 'size', 'duration', 'width', 'height', 'codec', 'hasAudio', 'fastStart'].forEach(function (k) { hv[k] = video[k]; });
                if (!before) hv.enabled = true;
              }
              if (!hv.url) throw reject(400, 'Upload a video first.');
              if (posterGiven) {
                hv.posterUrl = poster ? publicUrl(fb, posterPath) : '';
                hv.posterPath = poster ? posterPath : '';
                hv.posterAuto = !!(poster && body.posterAuto === true);
              }
              if (ov) hv.overlay = ov.value || { mode: 'auto', color: '', opacity: null };
              if (!hv.overlay) hv.overlay = { mode: 'auto', color: '', opacity: null };
              if (typeof body.enabled === 'boolean') hv.enabled = body.enabled;
              if (hv.enabled == null) hv.enabled = true;
              var now = new Date().toISOString();
              hv.updatedAt = now;
              hv.updatedBy = actorOf(decoded);
              after = hv;
              tx.update(ref, { heroVideo: hv, updatedAt: now, updatedBy: actorOf(decoded) });
            });
          });
        }).then(function () {
          sendJson(res, 200, { heroVideo: forClient(after) });
          /* a replaced video goes (it is ours: only /check marks a file as one). A replaced still is an ordinary image
             upload that something else may also show, and small: it stays. */
          if (before && before.path && before.path !== after.path && mediaPathOk(eventId, before.path)) fb.bucket.file(before.path).delete().catch(function () { /* kept */ });
          var what = !before ? 'Banner video added' : before.path !== after.path ? 'Banner video replaced'
            : before.enabled !== after.enabled ? (after.enabled ? 'Banner video turned on' : 'Banner video turned off') : 'Banner video settings changed';
          logActivity(fb, eventId, decoded, 'banner-video-changed', what, { area: 'design' });
        }).catch(function (err) { fail(res, 'save', err, 'The banner video could not be saved. Please try again.'); });
      });
    }, 64 * 1024);
  });
}

/* ---------- DELETE ---------- */
function handleHeroVideoRemove(req, res) {
  requireAdmin(req, res, function (fb, decoded) {
    guard(res, 'remove', function () {
      var eventId = str(queryOf(req).get('eventId'), 100);
      if (!isEventId(eventId)) return sendJson(res, 400, { error: 'A valid eventId is required.' });
      var ref = eventRef(fb, eventId), before = null;
      fb.db.runTransaction(function (tx) {
        return tx.get(ref).then(function (snap) {
          var d = snap.exists ? snap.data() || {} : null;
          if (!d || !d.createdAt) throw reject(404, 'No event found for "' + eventId + '".');
          if (d.deletedAt) throw reject(404, 'This event has been deleted. Restore it before changing its banner.');
          before = d.heroVideo || null;
          if (!before) return;
          tx.update(ref, { heroVideo: require('firebase-admin').firestore.FieldValue.delete(), updatedAt: new Date().toISOString(), updatedBy: actorOf(decoded) });
        });
      }).then(function () {
        sendJson(res, 200, { heroVideo: null });
        if (!before) return;
        /* the video goes; its still is an ordinary image upload and stays (see handleHeroVideoSave) */
        if (mediaPathOk(eventId, before.path)) fb.bucket.file(before.path).delete().catch(function () { /* kept */ });
        logActivity(fb, eventId, decoded, 'banner-video-changed', 'Banner video removed', { area: 'design' });
      }).catch(function (err) { fail(res, 'remove', err, 'The banner video could not be removed. Please try again.'); });
    });
  });
}

module.exports = {
  handleHeroVideoGet, handleHeroVideoUpload, handleHeroVideoCheck, handleHeroVideoSave, handleHeroVideoRemove,
  _test: { typeOf, cleanOverlay, mediaPathOk, forClient, cleanOrigin }
};
