// An event's history: who did what, when. One document per action under events/<id>/activity, read back
// by GET /api/event/activity (the console's History). Written by the backend only, as a side effect of
// the real action — so it can never claim something happened that did not.
//
// Recording history must never be the reason the real action fails: logActivity() resolves even when
// the write does not, and logs the reason instead.
const ACTIONS = ['created', 'updated', 'status-changed', 'settings-changed', 'site-saved', 'published', 'unpublished',
  'deleted', 'restored', 'cloned', 'content-seeded', 'registration-updated', 'registration-deleted',
  'leads-imported', 'leads-updated', 'leads-deleted', 'approval-requested', 'approved', 'rejected',
  'content-added', 'content-changed', 'content-removed', 'form-created', 'form-updated', 'form-deleted', 'form-default',
  'forms-reordered', 'theme-changed', 'logo-changed', 'banner-video-changed', 'file-uploaded', 'brief-updated', 'source-added',
  'site-designed', 'site-generated', 'repaired'];

/* Where a line belongs, for the activity log's "area" column and filter. A new entry carries `area`; an
   older one (written before areas existed) is placed by its action through AREA_OF — readers do the same. */
const AREAS = ['site', 'content', 'forms', 'design', 'publishing', 'registrations', 'promotions', 'settings', 'event'];
const AREA_OF = {
  'created': 'event', 'deleted': 'event', 'restored': 'event', 'cloned': 'event',
  'updated': 'settings', 'status-changed': 'settings', 'settings-changed': 'settings',
  'site-saved': 'site', 'site-generated': 'site', 'repaired': 'site',
  'published': 'publishing', 'unpublished': 'publishing', 'approval-requested': 'publishing', 'approved': 'publishing', 'rejected': 'publishing',
  'content-seeded': 'content', 'content-added': 'content', 'content-changed': 'content', 'content-removed': 'content',
  'file-uploaded': 'content', 'brief-updated': 'content', 'source-added': 'content',
  'registration-updated': 'registrations', 'registration-deleted': 'registrations',
  'leads-imported': 'registrations', 'leads-updated': 'registrations', 'leads-deleted': 'registrations',
  'form-created': 'forms', 'form-updated': 'forms', 'form-deleted': 'forms', 'form-default': 'forms', 'forms-reordered': 'forms',
  'theme-changed': 'design', 'logo-changed': 'design', 'banner-video-changed': 'design', 'site-designed': 'design'
};
/* an entry's area: its own when it has a known one, else its action's */
function areaOf(entry) {
  var a = entry && entry.area;
  if (typeof a === 'string' && AREAS.indexOf(a) !== -1) return a;
  return AREA_OF[entry && entry.action] || 'event';
}

/* The log is read by the whole team: a registrant's or contact's address is never written out in full
   ("a***@gmail.com"), nor a phone number ("***10"). Team members' own addresses (who did it) stay whole. */
var EMAIL_RE = /([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;
function maskEmail(text) { return String(text == null ? '' : text).replace(EMAIL_RE, '$1***@$2'); }
function maskPhone(text) {
  var digits = String(text == null ? '' : text).replace(/\D/g, '');
  return digits.length ? '***' + digits.slice(-2) : '';
}
/* a record's before/after list ({ field, before, after }) with contact details masked */
function maskFields(fields) {
  if (!Array.isArray(fields)) return fields;
  return fields.map(function (f) {
    if (!f || typeof f !== 'object') return f;
    var k = String(f.field || '');
    if (/email/i.test(k)) return Object.assign({}, f, { before: maskEmail(f.before), after: maskEmail(f.after) });
    if (/phone|mobile|whatsapp/i.test(k)) return Object.assign({}, f, { before: maskPhone(f.before), after: maskPhone(f.after) });
    return f;
  });
}
/* "Hero, Speakers, Agenda +2": the sections a site save touched, from lib/page-diff.js's items */
function sectionNames(items, max) {
  var seen = {}, names = [];
  (items || []).forEach(function (i) {
    var n = String((i && (i.name || i.section)) || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    if (n && !seen[n]) { seen[n] = 1; names.push(n); }
  });
  max = max || 6;
  return names.slice(0, max).join(', ') + (names.length > max ? ' +' + (names.length - max) : '');
}

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
    entry.area = areaOf({ action: entry.action, area: extra && extra.area });
    /* what the line belongs to (a saved change, an approval request, a version) and, for a record or a
       setting, the fields that changed with their value before and after */
    ['changeId', 'approvalId', 'version', 'requestedBy', 'fields'].forEach(function (k) {
      if (extra && extra[k] != null && extra[k] !== '') entry[k] = extra[k];
    });
    if (entry.fields) entry.fields = maskFields(entry.fields);
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

module.exports = { ACTIONS, AREAS, AREA_OF, areaOf, actorOf, logActivity, listActivity, maskEmail, maskPhone, maskFields, sectionNames };
