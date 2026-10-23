/* node functions/lib/award-forms.test.js — exits 1 on any failure. No network, no Firebase: a small in-memory
   stand-in for Firestore. An award event's two forms (lib/api-forms.js createAwardForms): made once, with the
   award's categories; reused when called again; the categories brought up to date; the rules every new form
   follows (the event must be live, the forms limit, names and ids never shared). */
'use strict';
const F = require('./forms');
const AF = require('./api-forms');

var failures = [], checks = 0;
function ok(cond, label, detail) { checks++; if (!cond) failures.push(label + (detail ? '\n      ' + detail : '')); }
function clone(v) { return v === undefined ? v : JSON.parse(JSON.stringify(v)); }

/* ---------- an in-memory Firestore: documents by path ---------- */
function fakeFb(seed) {
  var docs = {};
  Object.keys(seed || {}).forEach(function (p) { docs[p] = clone(seed[p]); });
  var addN = 0;
  function snapOf(path) {
    var id = path.split('/').pop();
    return { id: id, exists: Object.prototype.hasOwnProperty.call(docs, path), data: function () { return clone(docs[path]); }, ref: docRef(path) };
  }
  function listOf(path, n) {
    var pre = path + '/';
    var ids = Object.keys(docs).filter(function (p) { return p.indexOf(pre) === 0 && p.slice(pre.length).indexOf('/') === -1; }).sort();
    if (n != null) ids = ids.slice(0, n);
    var list = ids.map(snapOf);
    return { docs: list, empty: !list.length, size: list.length };
  }
  function query(path, n) {
    return { _q: true, limit: function (m) { return query(path, m); }, get: function () { return Promise.resolve(listOf(path, n)); },
      select: function () { return query(path, n); } };
  }
  function col(path) {
    var q = query(path, null);
    q.doc = function (id) { return docRef(path + '/' + id); };
    q.add = function (d) { var id = 'auto' + (++addN); docs[path + '/' + id] = clone(d); return Promise.resolve(docRef(path + '/' + id)); };
    return q;
  }
  function setPath(obj, dotted, value) {
    var keys = dotted.split('.'), o = obj;
    for (var i = 0; i < keys.length - 1; i++) { if (!o[keys[i]] || typeof o[keys[i]] !== 'object') o[keys[i]] = {}; o = o[keys[i]]; }
    o[keys[keys.length - 1]] = clone(value);
  }
  function docRef(path) {
    return {
      _path: path, id: path.split('/').pop(),
      collection: function (name) { return col(path + '/' + name); },
      get: function () { return Promise.resolve(snapOf(path)); },
      set: function (d) { docs[path] = clone(d); return Promise.resolve(); },
      update: function (patch) { var d = docs[path] || {}; Object.keys(patch).forEach(function (k) { setPath(d, k, patch[k]); }); docs[path] = d; return Promise.resolve(); }
    };
  }
  var db = {
    collection: function (name) { return col(name); },
    runTransaction: function (work) {
      var writes = [];
      var tx = {
        get: function (r) { return r.get(); },
        set: function (r, d) { writes.push(function () { docs[r._path] = clone(d); }); },
        update: function (r, patch) { writes.push(function () { r.update(patch); }); }
      };
      return Promise.resolve(work(tx)).then(function (out) { writes.forEach(function (w) { w(); }); return out; });
    }
  };
  return { db: db, docs: docs };
}
function formsOf(fb, eventId) {
  var pre = 'events/' + eventId + '/forms/';
  return Object.keys(fb.docs).filter(function (p) { return p.indexOf(pre) === 0; }).map(function (p) { return F.storedForm(p.slice(pre.length), fb.docs[p]); }).sort(F.byOrder);
}
function activity(fb, eventId) {
  var pre = 'events/' + eventId + '/activity/';
  return Object.keys(fb.docs).filter(function (p) { return p.indexOf(pre) === 0; }).map(function (p) { return fb.docs[p]; });
}
var EV = { name: 'ETHR Awards 2027', createdAt: '2026-10-01T00:00:00.000Z', createdBy: 'qa' };
var CATS = ['Technology › AI Leader', { master: 'People', name: 'CHRO of the Year' }];

function run() {
  var steps = [];

  /* a new award event: both forms made, the original "Register now" kept */
  steps.push(function () {
    var fb = fakeFb({ 'events/qa-award': EV });
    return AF.createAwardForms(fb, 'qa-award', { categories: CATS, nominateTitle: 'Nominate for ETHR Awards 2027', by: 'qa-agent@timesinternet.in' }).then(function (r) {
      ok(r.nominateFormId === 'nomination' && r.interestFormId === 'express-interest', 'the two forms get readable ids', JSON.stringify(r));
      ok(JSON.stringify(r.created) === '["nomination","express-interest"]' && !r.updated.length && r.needsCategories === false && r.skippedCategories === 0, 'both were made', JSON.stringify(r));
      var list = formsOf(fb, 'qa-award');
      ok(list.map(function (f) { return f.id; }).join() === 'register,nomination,express-interest', 'the event\'s "Register now" is stored first and kept', list.map(function (f) { return f.id; }).join());
      var nom = list[1], ei = list[2];
      ok(nom.purpose === 'nomination' && nom.title === 'Nominate for ETHR Awards 2027' && nom.template === 'nomination' && nom.rev === 1 && nom.createdBy === 'qa-agent@timesinternet.in', 'the nomination form as stored', JSON.stringify(nom).slice(0, 300));
      ok(JSON.stringify(nom.fields[0].options) === '["Technology › AI Leader","People › CHRO of the Year"]', 'with the award\'s categories');
      ok(nom.fields.filter(function (f) { return f.id === 'entry_summary'; })[0].maxWords === 300, 'the word limit is stored');
      ok(nom.fields.filter(function (f) { return f.id === 'designation'; })[0].requiredWhen.equals === 'Individual', 'the condition is stored');
      ok(nom.fields[nom.fields.length - 1].type === 'consent' && ei.fields[ei.fields.length - 1].type === 'consent', 'both end with the consent box');
      ok(ei.purpose === 'interest' && ei.fields.length === 8, 'the interest form: seven questions and the consent box');
      ok(fb.docs['events/qa-award'].settings.registration.defaultFormId === 'register', 'the default form is still "Register now"');
      var log = activity(fb, 'qa-award');
      ok(log.length === 2 && log.every(function (l) { return l.action === 'form-created' && l.by === 'qa-agent@timesinternet.in'; }), 'each is in the activity log', JSON.stringify(log));
      var pub = F.publicFormsPayload('qa-award', fb.docs['events/qa-award'], list, F.consentFor('hr'));
      var pn = pub.forms.filter(function (f) { return f.id === 'nomination'; })[0];
      ok(pn && pn.fields.some(function (f) { return f.maxWords === 300; }) && pn.fields.some(function (f) { return f.requiredWhen; }), 'a visitor\'s page is told both');

      /* again: nothing new, the same ids */
      return AF.createAwardForms(fb, 'qa-award', { categories: CATS }).then(function (r2) {
        ok(r2.nominateFormId === 'nomination' && r2.interestFormId === 'express-interest' && !r2.created.length && !r2.updated.length, 'called again: the same forms, nothing made', JSON.stringify(r2));
        ok(formsOf(fb, 'qa-award').length === 3, 'still three forms');
        /* the organiser edits the nomination form; then the award's categories change */
        var p = 'events/qa-award/forms/nomination';
        fb.docs[p].title = 'Organiser\'s own heading';
        return AF.createAwardForms(fb, 'qa-award', { categories: CATS.concat(['Leadership › CEO']) }).then(function (r3) {
          var n3 = formsOf(fb, 'qa-award').filter(function (f) { return f.id === 'nomination'; })[0];
          ok(JSON.stringify(r3.updated) === '["nomination"]' && !r3.created.length, 'new categories: the nomination form is updated', JSON.stringify(r3));
          ok(n3.fields[0].options.length === 3 && n3.fields[0].options[2] === 'Leadership › CEO' && n3.rev === 2, 'its Category options and rev', JSON.stringify(n3.fields[0]));
          ok(n3.title === 'Organiser\'s own heading', 'what the organiser changed is kept');
          return AF.createAwardForms(fb, 'qa-award', {}).then(function (r4) {
            ok(r4.nominateFormId === 'nomination' && !r4.updated.length && r4.needsCategories === false, 'no categories given: the existing form as it is');
          });
        });
      });
    });
  });

  /* forms the event already has are reused; a name already taken gets a number */
  steps.push(function () {
    var ei = Object.assign(F.awardInterestForm(), { id: 'my-interest', order: 0, rev: 3, createdAt: 'x', updatedAt: 'x' });
    ei.name = 'Keep me posted';
    var other = Object.assign(F.cleanFormInput({ name: 'Nomination', fields: F.defaultFields(), submitLabel: 'Go', successMessage: 'Ok', purpose: 'custom' }, { creating: true }).value, { id: 'nomination', order: 1, rev: 1, createdAt: 'x', updatedAt: 'x' });
    var fb = fakeFb({ 'events/qa-award2': Object.assign({}, EV, { counters: { audienceV: 2, forms: { 'nomination-2': { n: 4 } } } }),
      'events/qa-award2/forms/my-interest': ei, 'events/qa-award2/forms/nomination': other });
    return AF.createAwardForms(fb, 'qa-award2', { categories: ['A'] }).then(function (r) {
      ok(r.interestFormId === 'my-interest' && r.created.length === 1, 'an interest form the event has is used', JSON.stringify(r));
      ok(r.nominateFormId === 'nomination-2-2', 'ids never reuse a form\'s, nor a deleted form\'s that still has responses', r.nominateFormId);
      var made = formsOf(fb, 'qa-award2').filter(function (f) { return f.id === r.nominateFormId; })[0];
      ok(made && made.name === 'Nomination 2', 'a name another form has gets a number', made && made.name);
    });
  });

  /* no categories yet: the interest form only, and the caller is told */
  steps.push(function () {
    var fb = fakeFb({ 'events/qa-award3': EV });
    return AF.createAwardForms(fb, 'qa-award3', { categories: [] }).then(function (r) {
      ok(r.nominateFormId === '' && r.needsCategories === true && r.interestFormId === 'express-interest', 'no categories: no nomination form yet, said so', JSON.stringify(r));
      return AF.createAwardForms(fb, 'qa-award3', { categories: ['Only one'] }).then(function (r2) {
        ok(r2.nominateFormId === 'nomination' && JSON.stringify(r2.created) === '["nomination"]' && r2.interestFormId === 'express-interest', 'categories later: the nomination form is made then', JSON.stringify(r2));
      });
    });
  });

  /* the gates */
  steps.push(function () {
    var fb = fakeFb({ 'events/qa-gone': Object.assign({}, EV, { deletedAt: 'x' }) });
    return AF.createAwardForms(fb, 'qa-gone', { categories: CATS }).then(function () { ok(false, 'a deleted event is refused'); }, function (err) {
      ok(err && err.status === 404, 'a deleted event: 404', err && err.message);
    });
  });
  steps.push(function () {
    return AF.createAwardForms(fakeFb({}), '../x', { categories: CATS }).then(function () { ok(false, 'a bad id is refused'); }, function (err) {
      ok(err && err.status === 400, 'a bad event id: 400');
    });
  });
  steps.push(function () {
    var seed = { 'events/qa-full': EV };
    for (var i = 0; i < F.LIMITS.maxForms - 1; i++) seed['events/qa-full/forms/f' + i] = { name: 'F' + i, purpose: 'custom', order: i, fields: F.defaultFields() };
    var fb = fakeFb(seed);
    return AF.createAwardForms(fb, 'qa-full', { categories: CATS }).then(function () { ok(false, 'the forms limit is kept'); }, function (err) {
      ok(err && err.status === 409 && err.extra && err.extra.code === 'limit', 'the forms limit is kept: 409 limit', err && err.message);
      ok(formsOf(fb, 'qa-full').length === F.LIMITS.maxForms - 1, 'and nothing was half made (one transaction)');
    });
  });

  return steps.reduce(function (p, s) { return p.then(s); }, Promise.resolve());
}

run().then(function () {
  if (failures.length) {
    console.error('award-forms: ' + failures.length + ' of ' + checks + ' checks failed');
    failures.forEach(function (f) { console.error('  - ' + f); });
    process.exit(1);
  }
  console.log('award-forms: all ' + checks + ' checks passed');
}, function (err) { console.error('award-forms: crashed — ' + (err && err.stack || err)); process.exit(1); });
