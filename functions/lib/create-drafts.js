/* Create Event's unfinished drafts, kept with the person's account (UX-048, batch B08).

   Before this, a draft lived in one browser's localStorage only: the events dashboard never listed it, another computer
   never saw it, and starting a second event meant throwing the first away. Now every draft is also kept here, one
   document per draft per person, so the dashboard's Drafts view lists them with Resume and Discard, several can exist
   at once, and Resume opens a draft on any computer. The page still keeps a copy in that browser (create-event.html),
   so typing never waits for the network and a lost connection loses nothing; this store is what makes the draft the
   person's rather than the browser's.

     GET    /api/me/create-drafts                -> { drafts: [{ id, rev, savedAt, updatedAt, summary }] }, newest first, at most 50
     GET    /api/me/create-draft?id=<draftId>    -> { draft: { id, rev, savedAt, updatedAt, summary, files, state } }
                                                    404 draft-not-found: never saved here, or discarded since
     PUT    /api/me/create-draft { id, rev, writer, state, force? }
                                                 -> { ok, id, rev, savedAt, updatedAt }
                                                    rev is the revision the page's copy was built on (0: a draft never saved here).
                                                    409 draft-conflict { current: { rev, savedAt, updatedAt, writer } | null } when
                                                    the stored revision is another (saved from another computer since, or
                                                    discarded: current null). force: true saves over it, which the page does only
                                                    when the person chose "Keep this one", or when the other save was its own.
     DELETE /api/me/create-draft?id=<draftId>    -> { ok, removed }   its pictures go with it; repeating it is harmless
     POST   /api/me/create-draft/file { id, slot, fileName, mimeType, dataBase64 }
                                                 -> { ok, slot, size, contentType }   one of the draft's pictures (a slot)
     GET    /api/me/create-draft/file?id=&slot=  -> that picture's bytes, never cached, for the page that resumes the draft

   STORE: createDrafts/{keyOf(uid)}/drafts/{draftId} = { uid, email, id, rev, savedAt, updatedAt, writer, summary, files, state }
     state    the page's draft (create-event.html's S) as JSON text: kept as text so that no shape the page ever stores can
              hit Firestore's limits on nested maps or index entries, and capped (STATE_MAX_BYTES) below its 1 MiB document limit
     summary  what the dashboard lists, worked out here from the state (summaryOf), so the list never reads the states
     files    { <slot>: { name, savedAt } } the pictures the state says this draft has here (the page's S.files)
   FILES: create-drafts/{keyOf(uid)}/{draftId}/{slot}: private objects (no public address), read back only through
   GET .../file by the person who saved them. A PSD is never sent: its flattened banner is.

   Only this file reads or writes either, with the Admin SDK (Firestore's and Storage's rules deny every client, so a new
   collection and folder need no rules change). Each person sees only their own drafts: the document path is theirs.

     wire(helpers)  lib/api.js hands over its helpers on each call (withAdmin, withAdminBody, sendJson, sendFailure); requiring
                    that file from here would be a require cycle */
'use strict';
const { keyOf } = require('./working-portal');
const shared = require('./api-events')._shared;

var H = null;
function wire(helpers) { H = helpers; }

var DRAFTS = 'createDrafts';
var FILES_PREFIX = 'create-drafts/';
var LIST_MAX = 50;
var STATE_MAX_BYTES = 900 * 1024;           // the draft's JSON; Firestore's document limit is 1 MiB, the rest is the summary
var STATE_BODY_MAX = 1200 * 1024;           // the PUT body: the state plus its JSON quoting
var FILE_MAX_BYTES = 8 * 1024 * 1024;       // what a picture may be anywhere in the product (api-events.js MAX_IMAGE_BYTES)
var FILE_BODY_MAX = 12 * 1024 * 1024;       // 8 MB of picture is ~10.7 MB of base64
var ID_RE = /^draft-[a-z0-9]{1,16}-[a-z0-9]{1,16}$/;     // create-event.html draftId(): 'draft-' + base36 time + '-' + base36 random
var SLOT_RE = /^(logo|banner|banner-text|img-[0-9]{1,5})$/;
var IMAGE_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg' };
var CATEGORIES = ['IP', 'Client', 'Awards'];
var METHODS = ['template', 'brief', 'imported'];
var PHASES = ['category', 'method', 'details'];

function str(v) { return v == null ? '' : String(v); }
function clip(v, n) { return str(v).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, n); }
function plain(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
function queryOf(req) { return new URLSearchParams(str(req.url).split('?')[1] || ''); }
function isDraftId(v) { return typeof v === 'string' && ID_RE.test(v); }

/* a route reached before lib/api.js handed its helpers over: answered as inModule() answers a missing module */
function unwired(res) {
  try {
    res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ error: 'This part of the service is not available right now. Please try again shortly.', code: 'module-unavailable' }));
  } catch (e) { /* the socket is already gone */ }
}
/* the person's key, or '' (answered 401 here) for a sign-in that carries no uid */
function personKey(res, decoded) {
  var key = keyOf(decoded && decoded.uid);
  if (!key) H.sendJson(res, 401, { error: 'Please sign in again.' });
  return key;
}
function draftsOf(fb, key) { return fb.db.collection(DRAFTS).doc(key).collection('drafts'); }
function filePath(key, id, slot) { return FILES_PREFIX + key + '/' + id + '/' + (slot || ''); }

/* What the dashboard says about a draft, from the page's own state: its name, type, portal, client, how it is being
   built, where it stopped and the event it has already made. Only known values, each clipped; nothing else of the state. */
function summaryOf(state) {
  var b = plain(state.basics) ? state.basics : {};
  var phase = PHASES.indexOf(state.step1Phase) !== -1 ? state.step1Phase : 'category';
  return {
    name: clip(b.name, 160),
    category: CATEGORIES.indexOf(b.category) !== -1 ? b.category : '',
    portal: /^[a-z0-9-]{1,60}$/.test(str(b.portal)) ? b.portal : '',
    client: clip(b.client, 160),
    method: METHODS.indexOf(state.creationMethod) !== -1 ? state.creationMethod : '',
    phase: phase,
    eventId: typeof state.createdEventId === 'string' && /^[a-z0-9][a-z0-9-]{0,79}$/.test(state.createdEventId) ? state.createdEventId : ''
  };
}
/* the pictures the state lists (S.files): known slots only, each with its name and the version it is */
function filesOf(state) {
  var out = {}, f = plain(state.files) ? state.files : {};
  Object.keys(f).forEach(function (slot) {
    if (!SLOT_RE.test(slot) || !plain(f[slot])) return;
    out[slot] = { name: clip(f[slot].name, 200), savedAt: +f[slot].savedAt || 0 };
  });
  return out;
}
function listItem(id, d) {
  return { id: id, rev: +d.rev || 0, savedAt: str(d.savedAt), updatedAt: str(d.updatedAt), summary: plain(d.summary) ? d.summary : summaryOf({}) };
}
function planned(status, message, extra) { return Object.assign(new Error(message), { status: status, body: Object.assign({ error: message }, extra || {}) }); }

/* ---------- GET /api/me/create-drafts ---------- */
function handleList(req, res) {
  if (!H) return unwired(res);
  H.withAdmin(req, res, function (fb, decoded) {
    var key = personKey(res, decoded);
    if (!key) return;
    /* the list never reads a draft's state: select() fetches only what is listed */
    draftsOf(fb, key).orderBy('updatedAt', 'desc').limit(LIST_MAX).select('rev', 'savedAt', 'updatedAt', 'summary').get().then(function (snap) {
      var drafts = [];
      snap.forEach(function (doc) { if (isDraftId(doc.id)) drafts.push(listItem(doc.id, doc.data() || {})); });
      H.sendJson(res, 200, { drafts: drafts });
    }).catch(function (err) { H.sendFailure(res, 'create drafts list', err, 'Your drafts could not be read. Please try again.'); });
  });
}

/* ---------- GET /api/me/create-draft?id= ---------- */
function handleGet(req, res) {
  if (!H) return unwired(res);
  H.withAdmin(req, res, function (fb, decoded) {
    var key = personKey(res, decoded);
    if (!key) return;
    var id = queryOf(req).get('id') || '';
    if (!isDraftId(id)) return H.sendJson(res, 400, { error: 'That is not a draft.', code: 'bad-draft-id' });
    draftsOf(fb, key).doc(id).get().then(function (snap) {
      if (!snap.exists) return H.sendJson(res, 404, { error: 'This draft is not in your account. It may have been discarded or opened in the editor already.', code: 'draft-not-found' });
      var d = snap.data() || {}, state = null;
      try { state = JSON.parse(str(d.state)); } catch (e) { state = null; }
      if (!plain(state)) return H.sendJson(res, 404, { error: 'This draft could not be read back.', code: 'draft-unreadable' });
      var item = listItem(id, d);
      item.files = plain(d.files) ? d.files : {};
      item.state = state;
      H.sendJson(res, 200, { draft: item });
    }).catch(function (err) { H.sendFailure(res, 'create draft get', err, 'Your draft could not be read. Please try again.'); });
  });
}

/* ---------- PUT /api/me/create-draft ---------- */
function handlePut(req, res) {
  if (!H) return unwired(res);
  H.withAdminBody(req, res, STATE_BODY_MAX, function (fb, decoded, body) {
    var key = personKey(res, decoded);
    if (!key) return;
    var id = body.id, state = body.state, rev = body.rev;
    if (!isDraftId(id)) return H.sendJson(res, 400, { error: 'That is not a draft.', code: 'bad-draft-id' });
    if (!plain(state) || state.draftId !== id) return H.sendJson(res, 400, { error: 'The draft did not arrive whole. Please try again.', code: 'bad-draft' });
    /* a draft handed to the editor is finished: the page removes it here instead of saving it */
    if (state.assembled === true) return H.sendJson(res, 400, { error: 'This draft has already been opened in the editor.', code: 'draft-finished' });
    if (typeof rev !== 'number' || !(rev >= 0) || Math.floor(rev) !== rev) return H.sendJson(res, 400, { error: 'The draft did not arrive whole. Please try again.', code: 'bad-draft' });
    var text = JSON.stringify(state);
    if (Buffer.byteLength(text, 'utf8') > STATE_MAX_BYTES) {
      return H.sendJson(res, 413, { error: 'This draft is too large to save to your account. Take out some of the longer text, then it is saved again.', code: 'draft-too-large' });
    }
    var ref = draftsOf(fb, key).doc(id), now = new Date().toISOString(), savedAt = clip(state.savedAt, 40) || now;
    var writer = /^[a-z0-9]{6,40}$/.test(str(body.writer)) ? body.writer : '';
    fb.db.runTransaction(function (tx) {
      return tx.get(ref).then(function (snap) {
        var cur = snap.exists ? (snap.data() || {}) : null, curRev = cur ? (+cur.rev || 0) : 0;
        /* saved from somewhere else since this copy was read (or discarded: nothing stored, though this copy had been) */
        if (body.force !== true && curRev !== rev) {
          throw planned(409, cur ? 'This draft was changed on another computer since.' : 'This draft was discarded since.', {
            code: 'draft-conflict', current: cur ? { rev: curRev, savedAt: str(cur.savedAt), updatedAt: str(cur.updatedAt), writer: str(cur.writer) } : null });
        }
        var next = curRev + 1;
        tx.set(ref, { uid: str(decoded.uid), email: str(decoded.email), id: id, rev: next, savedAt: savedAt, updatedAt: now, writer: writer,
          summary: summaryOf(state), files: filesOf(state), state: text });
        return next;
      });
    }).then(function (next) {
      H.sendJson(res, 200, { ok: true, id: id, rev: next, savedAt: savedAt, updatedAt: now });
    }).catch(function (err) { H.sendFailure(res, 'create draft save', err, 'Your draft could not be saved to your account. Please try again.'); });
  });
}

/* ---------- DELETE /api/me/create-draft?id= ---------- */
function handleDelete(req, res) {
  if (!H) return unwired(res);
  H.withAdmin(req, res, function (fb, decoded) {
    var key = personKey(res, decoded);
    if (!key) return;
    var id = queryOf(req).get('id') || '';
    if (!isDraftId(id)) return H.sendJson(res, 400, { error: 'That is not a draft.', code: 'bad-draft-id' });
    var ref = draftsOf(fb, key).doc(id), existed = false;
    ref.get().then(function (snap) {
      existed = snap.exists;
      /* the pictures first: a draft whose document is gone is never listed again, so its files would never be found */
      return fb.bucket.deleteFiles({ prefix: filePath(key, id, '') });
    }).then(function () {
      return existed ? ref.delete() : null;
    }).then(function () {
      H.sendJson(res, 200, { ok: true, removed: existed });
    }).catch(function (err) { H.sendFailure(res, 'create draft delete', err, 'Your draft could not be removed from your account. Please try again.'); });
  });
}

/* ---------- POST /api/me/create-draft/file ---------- */
function handleFilePut(req, res) {
  if (!H) return unwired(res);
  H.withAdminBody(req, res, FILE_BODY_MAX, function (fb, decoded, body) {
    var key = personKey(res, decoded);
    if (!key) return;
    var id = body.id, slot = body.slot, name = clip(body.fileName, 200) || 'picture';
    if (!isDraftId(id)) return H.sendJson(res, 400, { error: 'That is not a draft.', code: 'bad-draft-id' });
    if (typeof slot !== 'string' || !SLOT_RE.test(slot)) return H.sendJson(res, 400, { error: 'That is not one of a draft’s pictures.', code: 'bad-slot' });
    if (typeof body.dataBase64 !== 'string' || !body.dataBase64) return H.sendJson(res, 400, { error: 'The picture is empty.' });
    var b64 = body.dataBase64.replace(/^data:[^,]*,/, '').replace(/\s+/g, '');
    if (!/^[A-Za-z0-9+\/]*={0,2}$/.test(b64)) return H.sendJson(res, 400, { error: 'The picture did not arrive intact. Please try again.' });
    var buffer = Buffer.from(b64, 'base64');
    if (!buffer.length) return H.sendJson(res, 400, { error: 'The picture is empty.' });
    if (buffer.length > FILE_MAX_BYTES) return H.sendJson(res, 413, { error: '“' + name.slice(0, 80) + '” is larger than 8 MB.' });
    var type = shared.sniffImage(buffer);
    if (!type) return H.sendJson(res, 415, { error: '“' + name.slice(0, 80) + '” is not a picture that can be kept.' });
    if (type === 'image/svg+xml' && shared.svgIsActive(buffer.toString('utf8'))) {
      return H.sendJson(res, 415, { error: '“' + name.slice(0, 80) + '” contains scripts or embedded content, which is not allowed in an SVG.' });
    }
    /* one object per slot, written over when the slot gets another picture: a draft never collects old ones */
    fb.bucket.file(filePath(key, id, slot)).save(buffer, {
      resumable: false,
      metadata: { contentType: type, cacheControl: 'private, no-store', metadata: { originalName: name.replace(/[^\x20-\x7E]/g, '_').slice(0, 120) } }
    }).then(function () {
      H.sendJson(res, 200, { ok: true, slot: slot, size: buffer.length, contentType: type });
    }).catch(function (err) { H.sendFailure(res, 'create draft file', err, 'The picture could not be saved to your account. Please try again.'); });
  });
}

/* ---------- GET /api/me/create-draft/file?id=&slot= ---------- */
function handleFileGet(req, res) {
  if (!H) return unwired(res);
  H.withAdmin(req, res, function (fb, decoded) {
    var key = personKey(res, decoded);
    if (!key) return;
    var q = queryOf(req), id = q.get('id') || '', slot = q.get('slot') || '';
    if (!isDraftId(id) || !SLOT_RE.test(slot)) return H.sendJson(res, 400, { error: 'That is not one of a draft’s pictures.', code: 'bad-slot' });
    var file = fb.bucket.file(filePath(key, id, slot));
    Promise.all([file.download(), file.getMetadata()]).then(function (got) {
      var buf = got[0][0], meta = got[1][0] || {};
      var type = IMAGE_EXT[meta.contentType] ? meta.contentType : shared.sniffImage(buf);
      if (!type) return H.sendJson(res, 404, { error: 'That picture could not be read back.', code: 'file-not-found' });
      res.writeHead(200, { 'Content-Type': type, 'Content-Length': buf.length, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(buf);
    }).catch(function (err) {
      if (err && (err.code === 404 || err.code === '404')) return H.sendJson(res, 404, { error: 'That picture is no longer in your account.', code: 'file-not-found' });
      H.sendFailure(res, 'create draft file read', err, 'The picture could not be read. Please try again.');
    });
  });
}

module.exports = { wire, handleList, handleGet, handlePut, handleDelete, handleFilePut, handleFileGet, DRAFTS, FILES_PREFIX };
module.exports._test = { summaryOf, filesOf, isDraftId, ID_RE, SLOT_RE, STATE_MAX_BYTES, LIST_MAX };
