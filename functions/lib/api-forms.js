// An event's registration FORMS, as stored and as routed:
//
//   GET    /api/event/forms?eventId=                 handleFormsList     admin — the forms, and everything a
//                                                                         builder needs (templates, field types,
//                                                                         presets, countries, limits)
//   POST   /api/event/forms                          handleFormsCreate   admin — { eventId, form | template | duplicateOf }
//   PUT    /api/event/forms                          handleFormsUpdate   admin — { eventId, formId, form, ifUpdatedAt }
//   DELETE /api/event/forms?eventId=&formId=[&force=1]  handleFormsDelete admin
//   POST   /api/event/forms/default                  handleFormsDefault  admin — { eventId, formId }
//   POST   /api/event/forms/order                    handleFormsOrder    admin — { eventId, ids }
//   GET    /api/public/forms?eventId=                handlePublicForms   PUBLIC — what a visitor's page is told
//   GET    /api/public/places?q=&cc=                 handlePublicPlaces  PUBLIC — a Location field's suggestions
//
//   createAwardForms(fb, eventId, opts)  (no route of its own: the award set-up calls it) — an award event's
//                                        "Nomination" and "Express Interest" forms, made once and reused
//
// Both builders — the event console's Settings › Registration forms and the site editor's Forms panel —
// use these routes and nothing else, so a form made in one is the same form in the other.
//
// WHERE A FORM LIVES. One document per form, events/<eventId>/forms/<formId> (lib/forms.js has its shape):
// each form is saved, and checked for a newer copy (ifUpdatedAt), on its own, so two people editing two
// forms never overwrite each other; the event document stays small; registering reads exactly one form.
// An event that has never saved a form has none stored: it has the one form its original settings
// describe (forms.legacyDefaultForm, id "register"), and the first write to its forms stores that form
// first (ensureMaterialized), in the same transaction, so nothing an organiser set up is lost.
//
// Form definitions are live data: a saved change reaches the published page within the 30 s the public
// answer is cached, without a republish. Which buttons open which form, and where a form is placed on the
// page, is the page's markup and is published with the site as before.
'use strict';
const forms = require('./forms');
const phone = require('./phone');
const places = require('./places');
const { sendJson, parseJsonBody, requireAdmin, adminFromRequest, sendPublicJson, clientIp, rateLimit, str } = require('./http');
const { getFirebase } = require('./firebase');
const { logActivity, actorOf } = require('./activity');
const shared = require('./api-audience')._shared;

var httpError = shared.httpError, answerError = shared.answerError, guard = shared.guard, query = shared.query;
var validEventId = shared.validEventId, bodyId = shared.bodyId, liveEvent = shared.liveEvent, eventDoc = shared.eventDoc;
var isObj = shared.isObj, num = shared.num;

var LIMITS = forms.LIMITS;
var MAX_FORMS_BODY = 256 * 1024;

function formsCol(fb, eventId) { return eventDoc(fb, eventId).collection('forms'); }
function sortForms(list) { return list.sort(forms.byOrder); }
function fieldsWord(n) { return n + ' field' + (n === 1 ? '' : 's'); }
/* the organiser's own questions are counted (not the consent box every form ends with) */
function describe(form) { return '“' + form.name + '” — ' + fieldsWord(form.fields.filter(function (f) { return !forms.isConsentField(f); }).length); }

/* what a form edit changed, for the activity log: { what: ['name', 'fields added: Company', ...], fields: [{ field, before, after }] } */
var FORM_SETTINGS = ['name', 'title', 'intro', 'submitLabel', 'successMessage', 'countsAsRegistration', 'needsApproval', 'open', 'duplicates', 'purpose'];
function formChanges(was, now) {
  var what = [], fields = [];
  if (!was || !now) return { what: what, fields: fields };
  FORM_SETTINGS.forEach(function (k) {
    if (String(was[k]) === String(now[k])) return;
    what.push(k);
    fields.push({ field: k, before: String(was[k] == null ? '' : was[k]).slice(0, 200), after: String(now[k] == null ? '' : now[k]).slice(0, 200) });
  });
  function labels(list) { return (list || []).map(function (f) { return f.label || f.id; }); }
  var before = labels(was.fields), after = labels(now.fields);
  var added = after.filter(function (l) { return before.indexOf(l) === -1; }), removed = before.filter(function (l) { return after.indexOf(l) === -1; });
  if (added.length) what.push('fields added: ' + added.slice(0, 5).join(', '));
  if (removed.length) what.push('fields removed: ' + removed.slice(0, 5).join(', '));
  var wasSig = JSON.stringify(was.fields || []), nowSig = JSON.stringify(now.fields || []);
  if (!added.length && !removed.length && wasSig !== nowSig) what.push('fields edited');
  if (before.join('|') !== after.join('|')) fields.push({ field: 'fields', before: before.join(', ').slice(0, 300), after: after.join(', ').slice(0, 300) });
  return { what: what, fields: fields };
}

/* ---------- reading ---------- */

/* The event's forms, in their order -> { forms, materialized, defaultFormId }. An event with none stored has
   the one its original settings describe (materialized: false). */
function formsFromSnap(snap, ev) {
  var list = snap.docs.map(function (d) { return forms.storedForm(d.id, d.data()); });
  if (!list.length) return { forms: [forms.legacyDefaultForm(ev)], materialized: false };
  return { forms: sortForms(list), materialized: true };
}
function loadForms(fb, eventId, ev) {
  return formsCol(fb, eventId).limit(LIMITS.maxForms + 1).get().then(function (snap) {
    var r = formsFromSnap(snap, ev);
    r.defaultFormId = forms.resolveDefaultFormId(ev, r.forms);
    return r;
  });
}
/* One form, for a response to it: the form `formId`, or the event's default form when formId is ''.
   Resolves null when there is no such form. */
function loadForm(fb, eventId, ev, formId) {
  if (!formId) {
    return loadForms(fb, eventId, ev).then(function (r) {
      return r.forms.filter(function (f) { return f.id === r.defaultFormId; })[0] || null;
    });
  }
  return formsCol(fb, eventId).doc(formId).get().then(function (snap) {
    if (snap.exists) return forms.storedForm(formId, snap.data());
    if (formId !== forms.DEFAULT_FORM_ID) return null;
    return formsCol(fb, eventId).limit(1).get().then(function (s) { return s.empty ? forms.legacyDefaultForm(ev) : null; });
  });
}
/* The consent box of the event's forms (forms.consentFor): its links are the pages of the ET portal the event
   belongs to — the one its previous edition (or this edition's own page) was read from, as the site's footer
   says — else ETCIO's. Read from the event's sources (only the four fields that say it), kept a few minutes
   per event, so a busy registration page reads them once in a while, not per visitor. Never rejects: the
   sources not being readable gives ETCIO's links. */
var CONSENT_TTL_MS = 5 * 60 * 1000, CONSENT_KEEP = 2000;
var consentCache = new Map();
function loadConsent(fb, eventId) {
  var hit = consentCache.get(eventId);
  if (hit && Date.now() - hit.at < CONSENT_TTL_MS) return Promise.resolve(hit.consent);
  return eventDoc(fb, eventId).collection('sources').select('type', 'url', 'previous.portal', 'previous.url').get().then(function (snap) {
    return forms.consentFor(forms.portalOfSources(snap.docs.map(function (d) { return d.data(); })));
  }, function (err) {
    console.warn('forms: the sources of ' + eventId + ' could not be read for the consent links — ' + (err && err.message));
    return null;
  }).then(function (consent) {
    if (!consent) return forms.consentFor('');
    if (consentCache.size >= CONSENT_KEEP) consentCache.delete(consentCache.keys().next().value);
    consentCache.set(eventId, { at: Date.now(), consent: consent });
    return consent;
  });
}
/* The definitions a visitor's page is given (GET /api/public/forms, and the #rv-forms block publishing writes). */
function loadPublicForms(fb, eventId, ev) {
  return Promise.all([loadForms(fb, eventId, ev), loadConsent(fb, eventId)]).then(function (r) {
    return forms.publicFormsPayload(eventId, ev, r[0].forms, r[1]);
  });
}

/* Inside a forms write transaction, after every other read it makes: reads the event's forms and, when it
   has none stored yet, stores the form its original settings describe — and makes it the default — so
   that this write and every later one work on real documents. -> { forms, created }. Nothing may be READ
   in the transaction after this (Firestore: reads before writes). */
function ensureMaterialized(tx, fb, eventId, ev) {
  var col = formsCol(fb, eventId), ref = eventDoc(fb, eventId);
  return tx.get(col.limit(LIMITS.maxForms + 1)).then(function (snap) {
    var r = formsFromSnap(snap, ev);
    if (r.materialized) return { forms: r.forms, created: false };
    var legacy = r.forms[0];
    tx.set(col.doc(legacy.id), legacy);
    var settings = isObj(ev.settings) ? ev.settings : null;
    if (!settings) tx.update(ref, { settings: { registration: { defaultFormId: legacy.id } } });
    else if (!isObj(settings.registration)) tx.update(ref, { 'settings.registration': { defaultFormId: legacy.id } });
    else if (settings.registration.defaultFormId !== legacy.id) tx.update(ref, { 'settings.registration.defaultFormId': legacy.id });
    return { forms: r.forms, created: true };
  });
}

/* Runs work(tx, ev, forms) in one transaction with the event read (it must be a live event) and its forms
   made real. Resolves what work returns. */
function formsWrite(fb, eventId, work) {
  return fb.db.runTransaction(function (tx) {
    return tx.get(eventDoc(fb, eventId)).then(function (snap) {
      var ev = liveEvent(snap);
      if (!ev) throw httpError(404, 'No event found for "' + eventId + '".');
      return ensureMaterialized(tx, fb, eventId, ev).then(function (m) { return work(tx, ev, m.forms, m.created); });
    });
  });
}

/* How many responses each form has (and how many wait for approval): the event's counters when they are
   kept (lib/api-audience.js), counted from the responses otherwise (an event that has taken none since
   forms existed). Never writes. */
function responseCounts(fb, eventId, ev) {
  var c = isObj(ev.counters) ? ev.counters : {};
  if (shared.hasAudienceCounters(ev)) return Promise.resolve(isObj(c.forms) ? c.forms : {});
  return shared.scanAudience(fb, eventId).then(function (scan) { return scan.counters.forms; });
}

/* A form as an organiser's builder sees it. */
function adminForm(f, counts) {
  var out = {
    id: f.id, name: f.name, title: f.title, intro: f.intro, purpose: f.purpose,
    fields: f.fields.map(function (x) {
      var o = { id: x.id, type: x.type, label: x.label, required: x.required, placeholder: x.placeholder, help: x.help };
      if (forms.OPTION_TYPES.indexOf(x.type) !== -1) o.options = (x.options || []).slice();
      if (x.maxWords) o.maxWords = x.maxWords;
      if (x.requiredWhen) o.requiredWhen = { field: x.requiredWhen.field, equals: x.requiredWhen.equals };
      return o;
    }),
    submitLabel: f.submitLabel, successMessage: f.successMessage, countsAsRegistration: f.countsAsRegistration,
    needsApproval: f.needsApproval, open: f.open, duplicates: f.duplicates, order: f.order, template: f.template, rev: f.rev,
    createdAt: f.createdAt, createdBy: f.createdBy, updatedAt: f.updatedAt, updatedBy: f.updatedBy
  };
  if (counts) {
    var n = isObj(counts[f.id]) ? counts[f.id] : {};
    out.submissions = num(n.n);
    out.pending = num(n.pending);
  }
  return out;
}
/* what is stored for a form: its id, what the organiser set, and the server's own bookkeeping */
function storedDoc(id, value, extra) {
  var doc = { id: id };
  ['name', 'title', 'intro', 'purpose', 'fields', 'submitLabel', 'successMessage', 'countsAsRegistration', 'needsApproval',
    'open', 'duplicates', 'template'].forEach(function (k) { doc[k] = value[k]; });
  return Object.assign(doc, extra);
}
/* the FormInput part of a stored form (what a duplicate copies) */
function inputOf(f) {
  var a = adminForm(f);
  ['id', 'order', 'rev', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy'].forEach(function (k) { delete a[k]; });
  return a;
}

function badRequest(res, r) { return sendJson(res, 400, { error: r.error, field: r.field || undefined }); }
function formIdOk(v) { return typeof v === 'string' && forms.FORM_ID_RE.test(v); }

/* ---------- GET /api/event/forms ---------- */

function handleFormsList(req, res) {
  requireAdmin(req, res, function (fb) {
    guard(res, sendJson, 'load the forms', function () {
      var eventId = str(query(req).get('eventId'), 100);
      if (!validEventId(eventId)) return sendJson(res, 400, { error: 'A valid eventId is required.' });
      eventDoc(fb, eventId).get().then(function (snap) {
        var ev = liveEvent(snap);
        if (!ev) throw httpError(404, 'No event found for "' + eventId + '".');
        return Promise.all([loadForms(fb, eventId, ev), responseCounts(fb, eventId, ev), loadConsent(fb, eventId)]).then(function (r) {
          var reg = forms.legacyRegistration(ev);
          sendJson(res, 200, {
            forms: r[0].forms.map(function (f) { return adminForm(f, r[1]); }),
            defaultFormId: r[0].defaultFormId,
            /* the consent box every form ends with (its last field, type "consent"): locked, shown as it is */
            consent: forms.publicConsent(r[2]),
            materialized: r[0].materialized,
            templates: forms.FORM_TEMPLATES,
            fieldTypes: forms.FIELD_TYPES.map(function (t) { return { type: t, label: forms.FIELD_TYPE_LABELS[t] }; }),
            presets: forms.FIELD_PRESETS,
            countries: forms.COUNTRIES,
            limits: { maxForms: LIMITS.maxForms, maxFields: LIMITS.maxFields, maxOptions: LIMITS.maxOptions },
            registration: { open: reg.open, capacity: reg.capacity, target: reg.target },
            published: ev.published === true,
            /* the event's details version: what PATCH /api/event takes as ifUpdatedAt for the
               Registration panel's open / capacity / target */
            updatedAt: forms.isoOf(ev.detailsUpdatedAt) || forms.isoOf(ev.updatedAt) || forms.isoOf(ev.createdAt)
          });
        });
      }).catch(function (err) { answerError(res, sendJson, err, 'load the forms'); });
    });
  });
}

/* ---------- POST /api/event/forms ---------- */

function sameName(a, b) { return String(a || '').replace(/\s+/g, ' ').trim().toLowerCase() === String(b || '').replace(/\s+/g, ' ').trim().toLowerCase(); }
/* a template's name when the event already has a form of that name: "VIP delegates 2" */
function freeName(name, list) {
  if (!list.some(function (f) { return sameName(f.name, name); })) return name;
  for (var n = 2; n < 100; n++) {
    var cand = name.slice(0, 80 - String(n).length - 1) + ' ' + n;
    if (!list.some(function (f) { return sameName(f.name, cand); })) return cand;
  }
  return name;
}

/* Two forms of one event never share a name: "Opens form", the Forms panel, Reporting's Form column and the AI
   all tell forms apart by it. -> an httpError for the form `name` would clash with, or null */
function nameTaken(name, list, exceptId) {
  var other = list.filter(function (f) { return f.id !== exceptId && sameName(f.name, name); })[0];
  return other ? httpError(409, 'This event already has a form called “' + other.name + '”. Give this one a different name.', { code: 'name-taken', field: 'name' }) : null;
}

/* The ids a new form may not be given: the event's forms', "register" (unless mayUseRegister: a form made
   from the "Register now" template while the event has none of that id), and every id a deleted form that
   still has responses had (the event's per-form totals name every form that ever had one): its responses,
   its totals and "one response per email" would carry over to the new form. */
function takenFormIds(ev, ids, mayUseRegister) {
  var taken = mayUseRegister ? ids.slice() : ids.concat([forms.DEFAULT_FORM_ID]);
  var answered = isObj(ev.counters) && isObj(ev.counters.forms) ? Object.keys(ev.counters.forms) : [];
  if (!shared.hasAudienceCounters(ev) && ids.indexOf(forms.DEFAULT_FORM_ID) === -1) answered.push(forms.DEFAULT_FORM_ID);
  answered.forEach(function (k) { if (taken.indexOf(k) === -1) taken.push(k); });
  return taken;
}

function handleFormsCreate(req, res) {
  requireAdmin(req, res, function (fb, decoded) {
    guard(res, sendJson, 'create this form', function () {
      parseJsonBody(req, res, function (body) {
        guard(res, sendJson, 'create this form', function () {
          var eventId = bodyId(body.eventId);
          if (!validEventId(eventId)) return sendJson(res, 400, { error: 'A valid eventId is required.' });
          var modes = ['form', 'template', 'duplicateOf'].filter(function (k) { return body[k] != null && body[k] !== ''; });
          if (modes.length !== 1) return sendJson(res, 400, { error: 'Send exactly one of "form", "template" or "duplicateOf".' });
          var mode = modes[0], given = null;
          if (mode === 'form') {
            var c = forms.cleanFormInput(body.form, { creating: true });
            if (c.error) return badRequest(res, c);
            given = c.value;
          }
          if (mode === 'template' && !forms.TEMPLATE_BY_ID[body.template]) {
            return sendJson(res, 400, { error: 'There is no form template "' + str(body.template, 40) + '".', field: 'template' });
          }
          if (mode === 'duplicateOf' && !formIdOk(body.duplicateOf)) return sendJson(res, 404, { error: 'That form no longer exists.', code: 'form-missing' });

          var now = new Date().toISOString(), actor = actorOf(decoded), madeFrom = '';
          formsWrite(fb, eventId, function (tx, ev, list) {
            if (list.length >= LIMITS.maxForms) {
              throw httpError(409, 'An event can have at most ' + LIMITS.maxForms + ' forms. Delete one you no longer need first.', { code: 'limit' });
            }
            var ids = list.map(function (f) { return f.id; }), value, suggestion, mayUseRegister = false;
            if (mode === 'form') {
              value = given;
              var clash = nameTaken(value.name, list, null);
              if (clash) throw clash;
              suggestion = value.id || forms.slugify(value.name);
            } else if (mode === 'template') {
              var tpl = forms.TEMPLATE_BY_ID[body.template];
              value = JSON.parse(JSON.stringify(tpl.form));
              value.name = freeName(value.name, list);
              if (value.title === tpl.form.name) value.title = value.name;
              mayUseRegister = tpl.id === 'register';
              madeFrom = ' — from the “' + tpl.form.name + '” template';
              suggestion = mayUseRegister && ids.indexOf(forms.DEFAULT_FORM_ID) === -1 ? forms.DEFAULT_FORM_ID : forms.slugify(value.name);
            } else {
              var src = list.filter(function (f) { return f.id === body.duplicateOf; })[0];
              if (!src) throw httpError(404, 'That form no longer exists.', { code: 'form-missing' });
              value = inputOf(src);
              value.name = freeName(src.name.slice(0, 80 - 10).trim() + ' (copy)', list);
              madeFrom = ' — a copy of “' + src.name + '”';
              suggestion = forms.slugify(value.name);
            }
            var checked = forms.cleanFormInput(value, { creating: true });
            if (checked.error) throw httpError(400, checked.error, { field: checked.field || undefined });
            /* "register" is the original form's id: only that form, or one made from its template while the
               event has no form of that id, may have it (takenFormIds) */
            var id = forms.uniqueId(suggestion, takenFormIds(ev, ids, mayUseRegister), '-');
            var order = list.reduce(function (m, f) { return Math.max(m, f.order); }, -1) + 1;
            var doc = storedDoc(id, checked.value, { order: order, rev: 1, createdAt: now, createdBy: actor, updatedAt: now, updatedBy: actor });
            tx.set(formsCol(fb, eventId).doc(id), doc);
            return forms.storedForm(id, doc);
          }).then(function (form) {
            return logActivity(fb, eventId, decoded, 'form-created', describe(form) + madeFrom, { area: 'forms' }).then(function () {
              sendJson(res, 201, { form: adminForm(form, {}) });
            });
          }).catch(function (err) { answerError(res, sendJson, err, 'create this form'); });
        });
      }, MAX_FORMS_BODY);
    });
  });
}

/* ---------- PUT /api/event/forms ---------- */

function handleFormsUpdate(req, res) {
  requireAdmin(req, res, function (fb, decoded) {
    guard(res, sendJson, 'save this form', function () {
      parseJsonBody(req, res, function (body) {
        guard(res, sendJson, 'save this form', function () {
          var eventId = bodyId(body.eventId), formId = body.formId;
          if (!validEventId(eventId)) return sendJson(res, 400, { error: 'A valid eventId is required.' });
          if (!formIdOk(formId)) return sendJson(res, 400, { error: 'A valid formId is required.' });
          if (body.ifUpdatedAt != null && typeof body.ifUpdatedAt !== 'string') return sendJson(res, 400, { error: '"ifUpdatedAt" must be the updatedAt you were given.' });
          var c = forms.cleanFormInput(body.form, { creating: false, formId: formId });
          if (c.error) return badRequest(res, c);

          var now = new Date().toISOString(), actor = actorOf(decoded), was = null;
          formsWrite(fb, eventId, function (tx, ev, list) {
            var current = list.filter(function (f) { return f.id === formId; })[0];
            if (!current) throw httpError(404, 'That form no longer exists. It may have been deleted.', { code: 'form-missing' });
            was = current;
            if (body.ifUpdatedAt != null && body.ifUpdatedAt !== current.updatedAt) {
              throw httpError(409, 'Someone else changed this form. Reload it to see their version.', { code: 'stale', form: adminForm(current) });
            }
            /* a name another form already has is refused, unless this form had it before (an event saved
               before names had to differ keeps working until it is renamed) */
            if (!sameName(c.value.name, current.name)) {
              var clash = nameTaken(c.value.name, list, formId);
              if (clash) throw clash;
            }
            var doc = storedDoc(formId, c.value, { order: current.order, rev: (current.rev || 0) + 1,
              createdAt: current.createdAt || now, createdBy: current.createdBy || actor, updatedAt: now, updatedBy: actor });
            tx.set(formsCol(fb, eventId).doc(formId), doc);
            return forms.storedForm(formId, doc);
          }).then(function (form) {
            var ch = formChanges(was, form);
            return logActivity(fb, eventId, decoded, 'form-updated', describe(form) + (ch.what.length ? ' — ' + ch.what.join(', ') : ''), { area: 'forms', fields: ch.fields }).then(function () {
              sendJson(res, 200, { form: adminForm(form) });
            });
          }).catch(function (err) { answerError(res, sendJson, err, 'save this form'); });
        });
      }, MAX_FORMS_BODY);
    });
  });
}

/* ---------- DELETE /api/event/forms ---------- */

/* the text of a Storage object, or null when there is none (the same rule as lib/api.js readObject) */
function readObject(fb, objectPath) {
  return fb.bucket.file(objectPath).download().then(function (r) { return r[0].toString('utf8'); }, function (err) {
    if (err && (err.code === 404 || err.code === '404')) return null;
    throw err;
  });
}
/* where lib/api.js keeps the saved and the published page */
function savedPagePath(eventId) { return 'events/' + eventId + '/site/page.html'; }
function publishedPagePath(eventId) { return 'events/' + eventId + '/published/index.html'; }

function handleFormsDelete(req, res) {
  requireAdmin(req, res, function (fb, decoded) {
    guard(res, sendJson, 'delete this form', function () {
      var qs = query(req), eventId = str(qs.get('eventId'), 100), formId = str(qs.get('formId'), 60), force = qs.get('force') === '1';
      if (!validEventId(eventId)) return sendJson(res, 400, { error: 'A valid eventId is required.' });
      if (!formIdOk(formId)) return sendJson(res, 400, { error: 'A valid formId is required.' });

      eventDoc(fb, eventId).get().then(function (snap) {
        var ev = liveEvent(snap);
        if (!ev) throw httpError(404, 'No event found for "' + eventId + '".');
        return loadForms(fb, eventId, ev).then(function (r) {
          var form = r.forms.filter(function (f) { return f.id === formId; })[0];
          if (!form) throw httpError(404, 'That form no longer exists.', { code: 'form-missing' });
          if (r.defaultFormId === formId) throw httpError(409, 'This is the default form. Make another form the default first.', { code: 'default-form' });
          if (force) return null;
          /* the saved site and the live one: a button or an embedded copy still using it */
          return Promise.all([readObject(fb, savedPagePath(eventId)), ev.published === true ? readObject(fb, publishedPagePath(eventId)) : null]).then(function (pages) {
            var saved = forms.formUsage(pages[0], formId), published = forms.formUsage(pages[1], formId);
            if (saved + published > 0) {
              var places = Math.max(saved, published);
              throw httpError(409, 'The ' + (saved ? 'saved' : 'published') + ' site uses this form in ' + places + ' place' + (places === 1 ? '' : 's') +
                '. Open the site editor to change those buttons first, or delete anyway.', { code: 'form-in-use', saved: saved, published: published });
            }
          });
        });
      }).then(function () {
        return formsWrite(fb, eventId, function (tx, ev, list) {
          var form = list.filter(function (f) { return f.id === formId; })[0];
          if (!form) throw httpError(404, 'That form no longer exists.', { code: 'form-missing' });
          if (forms.resolveDefaultFormId(ev, list) === formId) throw httpError(409, 'This is the default form. Make another form the default first.', { code: 'default-form' });
          // its responses stay, with the form's id and name on each of them
          tx.delete(formsCol(fb, eventId).doc(formId));
          return form;
        });
      }).then(function (form) {
        return logActivity(fb, eventId, decoded, 'form-deleted', describe(form)).then(function () {
          sendJson(res, 200, { ok: true, formId: formId });
        });
      }).catch(function (err) { answerError(res, sendJson, err, 'delete this form'); });
    });
  });
}

/* ---------- POST /api/event/forms/default and /order ---------- */

function handleFormsDefault(req, res) {
  requireAdmin(req, res, function (fb, decoded) {
    guard(res, sendJson, 'change the default form', function () {
      parseJsonBody(req, res, function (body) {
        guard(res, sendJson, 'change the default form', function () {
          var eventId = bodyId(body.eventId), formId = body.formId;
          if (!validEventId(eventId)) return sendJson(res, 400, { error: 'A valid eventId is required.' });
          if (!formIdOk(formId)) return sendJson(res, 400, { error: 'A valid formId is required.' });
          formsWrite(fb, eventId, function (tx, ev, list) {
            var form = list.filter(function (f) { return f.id === formId; })[0];
            if (!form) throw httpError(404, 'That form no longer exists.', { code: 'form-missing' });
            tx.update(eventDoc(fb, eventId), { 'settings.registration.defaultFormId': formId });
            return form;
          }).then(function (form) {
            return logActivity(fb, eventId, decoded, 'form-default', '“' + form.name + '”').then(function () {
              sendJson(res, 200, { ok: true, defaultFormId: formId });
            });
          }).catch(function (err) { answerError(res, sendJson, err, 'change the default form'); });
        });
      }, 16 * 1024);
    });
  });
}

function handleFormsOrder(req, res) {
  requireAdmin(req, res, function (fb, decoded) {
    guard(res, sendJson, 'reorder the forms', function () {
      parseJsonBody(req, res, function (body) {
        guard(res, sendJson, 'reorder the forms', function () {
          var eventId = bodyId(body.eventId), ids = body.ids, moved = 0;
          if (!validEventId(eventId)) return sendJson(res, 400, { error: 'A valid eventId is required.' });
          if (!Array.isArray(ids) || !ids.length || ids.length > LIMITS.maxForms || !ids.every(formIdOk) ||
              ids.some(function (id, i) { return ids.indexOf(id) !== i; })) {
            return sendJson(res, 400, { error: '"ids" must list each of the event’s forms once.' });
          }
          formsWrite(fb, eventId, function (tx, ev, list) {
            var have = list.map(function (f) { return f.id; });
            if (have.length !== ids.length || have.some(function (id) { return ids.indexOf(id) === -1; })) {
              throw httpError(409, 'The forms have changed since you opened them. Reload and try again.', { code: 'stale' });
            }
            var col = formsCol(fb, eventId);
            moved = 0;
            list.forEach(function (f) {
              var at = ids.indexOf(f.id);
              if (f.order !== at) { tx.update(col.doc(f.id), { order: at }); f.order = at; moved++; }
            });
            return sortForms(list);
          }).then(function (list) {
            sendJson(res, 200, { ok: true, forms: list.map(function (f) { return adminForm(f); }) });
            if (moved) logActivity(fb, eventId, decoded, 'forms-reordered', 'new order: ' + list.map(function (f) { return '“' + f.name + '”'; }).join(', '), { area: 'forms' });
          }).catch(function (err) { answerError(res, sendJson, err, 'reorder the forms'); });
        });
      }, 16 * 1024);
    });
  });
}

/* ---------- an award's forms ---------- */

/* createAwardForms(fb, eventId, { categories, nominateTitle, by })
     -> Promise<{ nominateFormId, interestFormId, created: [formId], updated: [formId], skippedCategories,
                  needsCategories }>
   The two forms an award site's main button opens (templates/_shared/rv-award-cta.js): "Nomination" (the
   award's categories, the nominee, the entry — forms.awardNominationForm) and "Express Interest" (the seven
   standard questions — forms.awardInterestForm). Idempotent: an event that already has a nomination form
   (purpose "nomination") or an interest form (purpose "interest") keeps it and its id is returned; only the
   nomination form's Category options are brought up to date with `categories` (nothing else an organiser
   changed is touched). One transaction, with the same rules as a form made in a builder: the event must be
   live, at most LIMITS.maxForms forms, names never shared (a clash gets "Nomination 2"), ids never reused.
     categories     the award's categories (forms.awardCategoryOptions: "Master › Sub" strings or objects).
                    With none, no nomination form can be made yet: nominateFormId is '' (or the existing one)
                    and needsCategories is true; the interest form is made all the same.
     nominateTitle  the nomination form's heading (default "Submit a nomination"); only for a new form
     by             who is doing it, for the activity log: a decoded ID token or a string (default
                    "system: award setup")
   Rejects with an httpError (status, message, extra.code) as the routes do: 400 a bad id, 404 no such live
   event, 409 'limit'. */
function createAwardForms(fb, eventId, opts) {
  opts = opts || {};
  if (!validEventId(eventId)) return Promise.reject(httpError(400, 'A valid eventId is required.'));
  var cats = forms.awardCategoryOptions(opts.categories);
  var by = opts.by || 'system: award setup';
  var actor = typeof by === 'string' ? by : actorOf(by);
  var now = new Date().toISOString(), log = [];
  return formsWrite(fb, eventId, function (tx, ev, list) {
    log = [];                // a transaction may run more than once: only the last run's changes are logged
    var found = forms.findAwardForms(list);
    var out = { nominateFormId: found.nominate ? found.nominate.id : '', interestFormId: found.interest ? found.interest.id : '',
      created: [], updated: [], skippedCategories: cats.skipped, needsCategories: !found.nominate && !cats.options.length };
    var col = formsCol(fb, eventId);
    var order = list.reduce(function (m, f) { return Math.max(m, f.order); }, -1) + 1;
    function add(value) {
      if (list.length >= LIMITS.maxForms) {
        throw httpError(409, 'An event can have at most ' + LIMITS.maxForms + ' forms. Delete one you no longer need first.', { code: 'limit' });
      }
      value.name = freeName(value.name, list);
      var checked = forms.cleanFormInput(value, { creating: true });
      if (checked.error) throw httpError(500, 'The award form “' + value.name + '” could not be made: ' + checked.error, { field: checked.field || undefined });
      var id = forms.uniqueId(forms.slugify(checked.value.name), takenFormIds(ev, list.map(function (f) { return f.id; }), false), '-');
      var doc = storedDoc(id, checked.value, { order: order++, rev: 1, createdAt: now, createdBy: actor, updatedAt: now, updatedBy: actor });
      tx.set(col.doc(id), doc);
      var form = forms.storedForm(id, doc);
      list.push(form);
      out.created.push(id);
      log.push(['form-created', describe(form) + ' — for the award']);
      return id;
    }
    if (found.nominate) {
      var fields = forms.withCategoryOptions(found.nominate, cats.options);
      if (fields) {
        var f = found.nominate, input = inputOf(f);
        input.fields = fields;
        var checked = forms.cleanFormInput(input, { creating: false, formId: f.id });
        if (checked.error) throw httpError(500, 'The categories of “' + f.name + '” could not be updated: ' + checked.error, { field: checked.field || undefined });
        var doc = storedDoc(f.id, checked.value, { order: f.order, rev: (f.rev || 0) + 1, createdAt: f.createdAt || now, createdBy: f.createdBy || actor, updatedAt: now, updatedBy: actor });
        tx.set(col.doc(f.id), doc);
        out.updated.push(f.id);
        log.push(['form-updated', describe(forms.storedForm(f.id, doc)) + ' — the award’s categories']);
      }
    } else if (cats.options.length) {
      out.nominateFormId = add(forms.awardNominationForm({ options: cats.options, title: opts.nominateTitle }));
    }
    if (!found.interest) out.interestFormId = add(forms.awardInterestForm());
    return out;
  }).then(function (out) {
    return Promise.all(log.map(function (l) { return logActivity(fb, eventId, by, l[0], l[1], { area: 'forms' }); })).then(function () { return out; });
  });
}

/* ---------- GET /api/public/forms ---------- */

/* The visitor's country, when the hosting in front of this server says it in a request header — as Google
   Cloud's load balancer does when it is set up to add one (X-Client-Geo-Location: "<region>,<city>"; the region
   is the ISO country code), App Engine (X-AppEngine-Country) and Cloudflare (CF-IPCountry). Firebase App
   Hosting is not known to add any of them; when none is there this is '' and the visitor's page guesses the
   country itself (its time zone, then its language: templates/_shared/rv-forms.js). Never asked of a third
   party. Only a country the phone table has counts ("XX", "T1" and the like are not countries). */
var GEO_HEADERS = ['x-client-geo-location', 'x-appengine-country', 'cf-ipcountry'];
function geoCountry(req) {
  var h = (req && req.headers) || {};
  for (var i = 0; i < GEO_HEADERS.length; i++) {
    var v = String(h[GEO_HEADERS[i]] || '').split(',')[0].trim().toUpperCase();
    if (/^[A-Z]{2}$/.test(v) && phone.country(v)) return v;
  }
  return '';
}

/* The same gate as GET /api/public/site-data: a published, live event's forms are public (and the same for
   everybody, so cached for 30 s); a draft's only for a signed-in admin (its preview, the editor's live
   view), never cached; anything else is one 404 that gives nothing away.
   With the visitor's country known from the hosting (geoCountry), the answer also says it — `country`, what
   a Mobile field's country code starts on — and is then this visitor's own: cached by their browser only.
   The #rv-forms block publishing writes into a page never has it (it is the same page for everyone). */
function handlePublicForms(req, res) {
  guard(res, sendPublicJson, 'load this form', function () {
    var eventId = str(query(req).get('eventId'), 100);
    if (!validEventId(eventId)) return sendPublicJson(res, 404, { error: shared.NOT_AVAILABLE, code: 'unavailable' });
    if (!rateLimit('forms:' + clientIp(req), 300, 60000)) {
      return sendPublicJson(res, 429, { error: 'Too many requests. Please try again in a minute.', code: 'rate-limited' }, { 'Retry-After': '60' });
    }
    var fb = getFirebase();
    if (fb.error) return sendPublicJson(res, 503, { error: shared.UNAVAILABLE, code: 'unavailable' });
    eventDoc(fb, eventId).get().then(function (snap) {
      var ev = liveEvent(snap);
      if (!ev) return sendPublicJson(res, 404, { error: shared.NOT_AVAILABLE, code: 'unavailable' });
      var country = geoCountry(req);
      if (ev.published === true) {
        return loadPublicForms(fb, eventId, ev).then(function (payload) {
          if (country) payload.country = country;
          sendPublicJson(res, 200, payload, { 'Cache-Control': country ? 'private, max-age=30' : 'public, max-age=30' });
        });
      }
      return adminFromRequest(req).then(function (who) {
        if (!who) return sendPublicJson(res, 404, { error: shared.NOT_AVAILABLE, code: 'unavailable' });
        return loadPublicForms(fb, eventId, ev).then(function (payload) {
          if (country) payload.country = country;
          sendPublicJson(res, 200, payload);    // no-store
        });
      });
    }).catch(function (err) { answerError(res, sendPublicJson, err, 'load this form'); });
  });
}

/* ---------- GET /api/public/places ---------- */

/* What a form's Location field suggests as a visitor types: GET /api/public/places?q=noi&cc=IN ->
   { places: [{ label: "Noida, Uttar Pradesh, India", city, state, country, countryCode }] } — at most 8,
   places in `cc` (the visitor's country, as their page guessed it) first among those alike (lib/places.js).
   Public and the same for everybody, so cached for a day (the list changes only with a deploy). Rate limited
   per address like the forms themselves: a person typing asks a few times a second at most. */
function handlePublicPlaces(req, res) {
  guard(res, sendPublicJson, 'suggest places', function () {
    if (!rateLimit('places:' + clientIp(req), 300, 60000)) {
      return sendPublicJson(res, 429, { error: 'Too many requests. Please try again in a minute.', code: 'rate-limited' }, { 'Retry-After': '60' });
    }
    var qs = query(req), q = str(qs.get('q'), 120), cc = str(qs.get('cc'), 2).toUpperCase();
    var limit = Math.max(1, Math.min(8, parseInt(qs.get('limit'), 10) || 8));
    var list = places.fold(q).length >= 1 ? places.search(q, { country: /^[A-Z]{2}$/.test(cc) ? cc : '', limit: limit }) : [];
    sendPublicJson(res, 200, { places: list }, { 'Cache-Control': 'public, max-age=86400' });
  });
}

module.exports = {
  handleFormsList, handleFormsCreate, handleFormsUpdate, handleFormsDelete, handleFormsDefault, handleFormsOrder, handlePublicForms,
  handlePublicPlaces, loadForms, loadForm, loadPublicForms, loadConsent, ensureMaterialized, geoCountry, createAwardForms
};
