/* An AI-designed site's generations, and where its sections are kept (launch check BE-029, BE-032, WZ-034).

   A GENERATION ("run") is one press of Create Event's "Generate my site": the wizard names it (runId) and sends that
   name with every step. What a run reads and what it makes are its own until it is complete:
     events/<id>/briefs/<briefId>            .runId  — the brief this run read (extract-brief)
     events/<id>/sources/<sourceId>          .runId  — a page this run read (ingest-source; the same page read again
                                                       belongs to the run that read it last)
     events/<id>/generations/<runId>         { runId, status: 'planned' | 'stopped' | 'done', designPlan, described, by, plannedAt,
                                               doneAt } — the plan (plan-structure), kept apart from the event
     events/<id>/generations/<runId>/sections/<sectionId>
                                             { id, kind, page?, html, css, order } — the site it wrote (generate-content)
   Only when the whole site is written does the event switch to it, in one write of the event document:
     events/<id>.generatedSite               { runId, at, sections: [{ id, kind, page? }] } — which sections the site
                                             has, top to bottom, without their markup
     events/<id>.designPlan                  the run's plan
     events/<id>.generationRun               { runId, at, done? } — the run that is the event's newest: a run that
                                             planned after another one takes it, and only that run may switch the
                                             event to its site (a second tab, a second click)
   and then what earlier runs read or made is let go (retire): their briefs (and the documents behind them), their
   pages read and their generations. A run that was stopped, failed or was overtaken changes nothing of the event.

   The markup is kept in documents of its own because every section on the event's document brought that document
   near Firestore's 1 MiB limit, and GET /api/event sent all of it to every page that opens an event.

   An event generated before 13 Nov 2026 keeps its sections where they were, events/<id>.generatedSections
   ([{ id, kind, page?, html, css }]): they are read there as they are and never moved. Its next generation is
   written the new way, and that same write removes the old field.

     isRunId(v) / newRunId()               a run's name as the wizard sends it / one for a caller that sends none
     runStart(runId)                       when a run was started (its name says), 0 when unknown
     index(data)                           -> [{ id, kind, page? }] the site's sections, either way, without markup
     has(data)                             -> whether the event has a generated site
     where(data)                           -> 'run' | 'event' | '' — where its sections are kept
     readAll(fb, eventId, data)            -> Promise<[{ id, kind, page?, html, css }]> in the site's order
     readOne(fb, eventId, data, id)        -> Promise<section | null>
     sectionRef(fb, eventId, data, id)     -> the document of one section ('run' events), else null
     inputs(fb, eventId, runId)            -> Promise<{ brief, sourceDocs }>: this run's own (runId), else the event's
                                              newest brief and every page read (a caller without a run)
     readRun(fb, eventId, runId)           -> Promise<run record | null>
     writeSections(fb, eventId, runId, sections, extra) -> Promise: the run's sections (and its record)
     pointer(runId, sections, at)          -> the value of events/<id>.generatedSite
     retire(fb, eventId, runId, opts)      -> Promise<{ runs, briefs, sources }>: what earlier runs left, let go;
                                              opts.inputs: also their briefs and pages read. Never rejects. */
'use strict';
var crypto = require('crypto');

var RUNS = 'generations', SECTIONS = 'sections';
var RUN_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
var BATCH = 400;                                   // Firestore takes 500 writes in a batch

function isRunId(v) { return typeof v === 'string' && RUN_ID.test(v); }
function newRunId() { return 'srv-' + Date.now().toString(36) + '-' + crypto.randomBytes(4).toString('hex'); }
/* the wizard's names are 'run-<ms in base 36>-<random>', the server's 'srv-…': the time a run was started */
function runStart(runId) {
  var m = /^(?:run|srv)-([0-9a-z]{6,12})-/.exec(String(runId || ''));
  var t = m ? parseInt(m[1], 36) : 0;
  return isFinite(t) && t > 0 ? t : 0;
}

function eventRef(fb, eventId) { return fb.db.collection('events').doc(eventId); }
function runRef(fb, eventId, runId) { return eventRef(fb, eventId).collection(RUNS).doc(runId); }
function sectionsCol(fb, eventId, runId) { return runRef(fb, eventId, runId).collection(SECTIONS); }
/* a section's own document is named by its id, which every id the pipeline makes can be */
function docIdOf(id) {
  id = String(id || '');
  return /^[a-z0-9][a-z0-9_-]{0,119}$/i.test(id) ? id : 'x-' + crypto.createHash('sha1').update(id).digest('hex');
}

function pointerOf(data) {
  var p = data && data.generatedSite;
  return p && isRunId(p.runId) && Array.isArray(p.sections) ? p : null;
}
function legacyOf(data) {
  return data && Array.isArray(data.generatedSections) && data.generatedSections.length ? data.generatedSections : null;
}
function entry(s) {
  var e = { id: String(s.id), kind: typeof s.kind === 'string' ? s.kind : '' };
  if (typeof s.page === 'string' && s.page) e.page = s.page;
  return e;
}
function named(s) { return !!(s && typeof s.id === 'string' && s.id); }

function where(data) { return pointerOf(data) ? 'run' : legacyOf(data) ? 'event' : ''; }
function index(data) {
  var p = pointerOf(data);
  if (p) return p.sections.filter(named).map(entry);
  var l = legacyOf(data);
  return l ? l.filter(named).map(entry) : [];
}
function has(data) { return index(data).length > 0; }

function readAll(fb, eventId, data) {
  var p = pointerOf(data);
  if (!p) return Promise.resolve((legacyOf(data) || []).filter(named).map(function (s) { return Object.assign({}, s); }));
  return sectionsCol(fb, eventId, p.runId).get().then(function (snap) {
    var byId = {};
    snap.docs.forEach(function (d) { var s = d.data() || {}; if (named(s)) byId[s.id] = s; });
    return p.sections.filter(named).map(function (e) {
      var s = byId[e.id];
      return s ? Object.assign({}, entry(e), { html: String(s.html || ''), css: String(s.css || '') }) : null;
    }).filter(Boolean);
  });
}
function readOne(fb, eventId, data, id) {
  var p = pointerOf(data);
  if (!p) {
    var found = (legacyOf(data) || []).filter(function (s) { return named(s) && s.id === id; })[0];
    return Promise.resolve(found ? Object.assign({}, found) : null);
  }
  if (!p.sections.some(function (s) { return named(s) && s.id === id; })) return Promise.resolve(null);
  return sectionsCol(fb, eventId, p.runId).doc(docIdOf(id)).get().then(function (snap) {
    var s = snap.exists ? snap.data() || {} : null;
    return s && s.id === id ? s : null;
  });
}
function sectionRef(fb, eventId, data, id) {
  var p = pointerOf(data);
  return p ? sectionsCol(fb, eventId, p.runId).doc(docIdOf(id)) : null;
}

/* the newest of a set of briefs */
function newest(docs) {
  return docs.slice().sort(function (a, b) {
    var x = String((a.data() || {}).createdAt || ''), y = String((b.data() || {}).createdAt || '');
    return x < y ? 1 : x > y ? -1 : 0;
  })[0] || null;
}
function inputs(fb, eventId, runId) {
  var ref = eventRef(fb, eventId);
  /* equality alone (no ordering on another field): Firestore answers it without an index of its own */
  var briefs = runId ? ref.collection('briefs').where('runId', '==', runId).get()
    : ref.collection('briefs').orderBy('createdAt', 'desc').limit(1).get();
  var sources = runId ? ref.collection('sources').where('runId', '==', runId).get() : ref.collection('sources').get();
  return Promise.all([briefs, sources]).then(function (r) {
    var b = r[0].empty ? null : newest(r[0].docs);
    return {
      brief: b ? ((b.data() || {}).extracted || null) : null,
      /* the filter repeats the query: a store that ignores where() must still give this run's pages only */
      sourceDocs: r[1].docs.map(function (d) { return d.data() || {}; }).filter(function (v) { return !runId || v.runId === runId; })
    };
  });
}

function readRun(fb, eventId, runId) {
  if (!isRunId(runId)) return Promise.resolve(null);
  return runRef(fb, eventId, runId).get().then(function (snap) { return snap.exists ? snap.data() || {} : null; });
}

function writeSections(fb, eventId, runId, sections, extra) {
  var col = sectionsCol(fb, eventId, runId), list = (sections || []).filter(named);
  var keep = {};
  var writes = list.map(function (s, i) {
    var doc = { id: s.id, kind: typeof s.kind === 'string' ? s.kind : '', html: String(s.html || ''), css: String(s.css || ''), order: i };
    if (typeof s.page === 'string' && s.page) doc.page = s.page;
    keep[docIdOf(s.id)] = 1;
    return { ref: col.doc(docIdOf(s.id)), data: doc };
  });
  writes.push({ ref: runRef(fb, eventId, runId), data: Object.assign({ runId: runId }, extra || {}), merge: true });
  /* the run's sections are exactly these: one an earlier try of the same run wrote and this one has not goes */
  return col.get().then(function (had) {
    had.docs.forEach(function (d) { if (!keep[d.id]) writes.push({ ref: d.ref, del: true }); });
    var chain = Promise.resolve();
    for (var i = 0; i < writes.length; i += BATCH) (function (group) {
      chain = chain.then(function () {
        var batch = fb.db.batch();
        group.forEach(function (w) {
          if (w.del) batch.delete(w.ref);
          else if (w.merge) batch.set(w.ref, w.data, { merge: true });
          else batch.set(w.ref, w.data);
        });
        return batch.commit();
      });
    })(writes.slice(i, i + BATCH));
    return chain;
  });
}

function pointer(runId, sections, at) {
  return { runId: runId, at: at, sections: (sections || []).filter(named).map(entry) };
}

function deleteDocs(fb, docs) {
  var chain = Promise.resolve();
  for (var i = 0; i < docs.length; i += BATCH) (function (group) {
    chain = chain.then(function () {
      var batch = fb.db.batch();
      group.forEach(function (d) { batch.delete(d.ref); });
      return batch.commit();
    });
  })(docs.slice(i, i + BATCH));
  return chain;
}
/* An earlier run's: one with no name (made before runs had one), or one started no later than this one. A run
   started after this one is someone else's newer press of Generate — still running, or about to plan — and is left
   alone. */
function earlier(otherRunId, runId) {
  if (otherRunId === runId) return false;
  if (!isRunId(otherRunId)) return true;
  return runStart(otherRunId) <= runStart(runId);
}
function retire(fb, eventId, runId, opts) {
  var ref = eventRef(fb, eventId), out = { runs: 0, briefs: 0, sources: 0 };
  var runs = ref.collection(RUNS).get().then(function (snap) {
    var gone = snap.docs.filter(function (d) { return earlier(d.id, runId); });
    out.runs = gone.length;
    return Promise.all(gone.map(function (d) {
      return d.ref.collection(SECTIONS).get().then(function (s) { return deleteDocs(fb, s.docs); }).then(function () { return d.ref.delete(); });
    }));
  });
  var briefs = !(opts && opts.inputs) ? null : ref.collection('briefs').get().then(function (snap) {
    var gone = snap.docs.filter(function (d) { return earlier((d.data() || {}).runId, runId); });
    out.briefs = gone.length;
    var prefix = 'events/' + eventId + '/briefs/';
    return Promise.all(gone.map(function (d) {
      var p = String((d.data() || {}).storagePath || '');
      return p.indexOf(prefix) === 0 && p.indexOf('..') === -1 ? fb.bucket.file(p).delete().catch(function () { /* already gone */ }) : null;
    })).then(function () { return deleteDocs(fb, gone); });
  });
  var sources = !(opts && opts.inputs) ? null : ref.collection('sources').get().then(function (snap) {
    var gone = snap.docs.filter(function (d) { return earlier((d.data() || {}).runId, runId); });
    out.sources = gone.length;
    return deleteDocs(fb, gone);
  });
  return Promise.all([runs, briefs, sources]).then(function () { return out; }, function (err) {
    console.error('generated-site: what earlier generations of ' + eventId + ' left was not all let go — ' + (err && err.message));
    return out;
  });
}

module.exports = {
  isRunId: isRunId, newRunId: newRunId, runStart: runStart, docIdOf: docIdOf,
  where: where, index: index, has: has, readAll: readAll, readOne: readOne, sectionRef: sectionRef,
  inputs: inputs, readRun: readRun, runRef: runRef, writeSections: writeSections, pointer: pointer, retire: retire,
  RUNS: RUNS, SECTIONS: SECTIONS
};
