// An event's history: who did what, when. One document per action under events/<id>/activity, read back
// by GET /api/event/activity (the console's History). Written by the backend only, as a side effect of
// the real action — so it can never claim something happened that did not.
//
// Recording history must never be the reason the real action fails: logActivity() resolves even when
// the write does not, and logs the reason instead.
const ACTIONS = ['created', 'updated', 'status-changed', 'settings-changed', 'site-saved', 'published', 'unpublished',
  'deleted', 'restored', 'cloned', 'content-seeded', 'registration-updated', 'registration-deleted',
  'leads-imported', 'leads-deleted', 'approval-requested', 'approved', 'rejected',
  'content-added', 'content-changed', 'content-removed'];

function actorOf(decoded) {
  return (decoded && (decoded.email || decoded.uid)) || 'system';
}

/* fb: getFirebase()'s object. by: a decoded ID token, or a plain string. detail: a short human sentence
   fragment ("version 12", "3 speakers, 5 FAQs") — never a payload. */
function logActivity(fb, eventId, by, action, detail, extra) {
  try {
    var entry = {
      at: new Date().toISOString(),
      by: typeof by === 'string' ? by : actorOf(by),
      action: String(action),
      detail: String(detail || '').slice(0, 300)
    };
    /* what the line belongs to (a saved change, an approval request, a version) and, for a record or a
       setting, the fields that changed with their value before and after */
    ['changeId', 'approvalId', 'version', 'requestedBy', 'fields'].forEach(function (k) {
      if (extra && extra[k] != null && extra[k] !== '') entry[k] = extra[k];
    });
    return fb.db.collection('events').doc(eventId).collection('activity').add(entry).then(function () { return true; }, function (err) {
      console.error('activity: could not record "' + action + '" for ' + eventId + ' — ' + err.message);
      return false;
    });
  } catch (err) {
    console.error('activity: could not record "' + action + '" for ' + eventId + ' — ' + err.message);
    return Promise.resolve(false);
  }
}

function listActivity(fb, eventId, limit) {
  return fb.db.collection('events').doc(eventId).collection('activity')
    .orderBy('at', 'desc').limit(limit || 100).get()
    .then(function (snap) { return snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); }); });
}

module.exports = { ACTIONS, actorOf, logActivity, listActivity };
