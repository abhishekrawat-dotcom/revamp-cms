/* The portal a person works on. The owner's decision of 3 Nov 2026: the dashboard works one ET portal at a time,
   and the choice is "remembered for the person" — so it is kept on the server, one small document per person,
   and follows them to another browser or machine. The dashboard keeps a copy in that browser's localStorage only
   so that it can paint at once (portal-picker.js); when the server answers, the server's choice wins.

     GET /api/me/working-portal   any admin -> { workingPortal: '<slug>' | 'all' | null }
                                  null: this person has never chosen, or what is stored is no longer on the roster
     PUT /api/me/working-portal   { workingPortal: '<slug>' | 'all' } -> { ok: true, workingPortal }
                                  anything else is 400 unknown-portal; 'all' is a choice too ("All portals")

   STORE: userPrefs/{keyOf(uid)} = { uid, email, workingPortal, updatedAt }. Only this file reads or writes it, with
   the Admin SDK (Firestore's rules deny every client, so a new collection needs no rules change). It is one small
   document per person and is never deleted.

     PREFS       'userPrefs'
     keyOf(uid)  the uid made safe for a document id, as the editor chat's per-person store does it (lib/api.js
                 chatUserRef: anything outside A-Z a-z 0-9 _ @ . - becomes _, at most 120 characters)
     wire(helpers)  lib/api.js hands over its helpers on each call (withAdmin, withAdminBody, sendJson, sendFailure,
                 BODY_LIMITS among them); requiring that file from here would be a require cycle */
'use strict';
const etEvents = require('./et-events');

var H = null;
function wire(helpers) { H = helpers; }

var PREFS = 'userPrefs';
var ALL = 'all';

function str(v) { return v == null ? '' : String(v); }
/* chatUserRef's rule. Firebase uids never come out as ".", ".." or "__x__", which Firestore keeps for itself; the
   guard is only so that no id at all can ever be turned into a path it refuses. */
function keyOf(uid) {
  var k = str(uid).replace(/[^A-Za-z0-9_@.-]/g, '_').slice(0, 120);
  if (!k) return '';
  if (k === '.' || k === '..' || /^__.*__$/.test(k)) k = ('u' + k).slice(0, 120);
  return k;
}
function isChoice(v) { return v === ALL || etEvents.isPortal(v); }

/* a route reached before lib/api.js handed its helpers over: answered as inModule() answers a missing module */
function unwired(res) {
  try {
    res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ error: 'This part of the service is not available right now. Please try again shortly.', code: 'module-unavailable' }));
  } catch (e) { /* the socket is already gone */ }
}
/* the person's document, or null (answered 401 here) for a sign-in that carries no uid */
function prefRef(res, fb, decoded) {
  var key = keyOf(decoded && decoded.uid);
  if (!key) { H.sendJson(res, 401, { error: 'Please sign in again.' }); return null; }
  return fb.db.collection(PREFS).doc(key);
}

function handleGet(req, res) {
  if (!H) return unwired(res);
  H.withAdmin(req, res, function (fb, decoded) {
    var ref = prefRef(res, fb, decoded);
    if (!ref) return;
    ref.get().then(function (snap) {
      var v = snap.exists ? (snap.data() || {}).workingPortal : null;
      /* a portal taken off the roster since it was chosen is no choice: the dashboard asks again */
      H.sendJson(res, 200, { workingPortal: isChoice(v) ? v : null });
    }).catch(function (err) { H.sendFailure(res, 'working portal', err, 'Your portal could not be read. Please try again.'); });
  });
}

function handlePut(req, res) {
  if (!H) return unwired(res);
  H.withAdminBody(req, res, H.BODY_LIMITS.tiny, function (fb, decoded, body) {
    var v = body.workingPortal;
    if (!isChoice(v)) {
      return H.sendJson(res, 400, { error: v == null || v === '' ? 'Choose a portal, or All portals.' : 'Unknown portal "' + str(v).slice(0, 40) + '".',
        code: 'unknown-portal', field: 'workingPortal' });
    }
    var ref = prefRef(res, fb, decoded);
    if (!ref) return;
    ref.set({ uid: str(decoded.uid), email: str(decoded.email), workingPortal: v, updatedAt: new Date().toISOString() }, { merge: true })
      .then(function () { H.sendJson(res, 200, { ok: true, workingPortal: v }); })
      .catch(function (err) { H.sendFailure(res, 'working portal', err, 'Your portal could not be saved. Please try again.'); });
  });
}

module.exports = { wire, handleGet, handlePut, PREFS, keyOf };
module.exports._test = { isChoice, ALL };
