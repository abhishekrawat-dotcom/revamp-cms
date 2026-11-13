/* Lovable imports nobody took, cleared away (BE-049).

   Every import is stored the moment it is made (Create Event's "Import from Lovable"), before anyone decides to keep
   it. One that no event ever took — the person pressed Back, imported again, or closed the tab — stays for good
   otherwise: its record, its page and every picture, font and film copied from the site.

     node functions/lib/import-sweep.js                 lists what it would delete — deletes nothing (the default)
     node functions/lib/import-sweep.js --apply         deletes what it lists
          --days <n>                                    how old an import must be (default 7)
     POST /api/imports/sweep { apply?: true, days? }    the same, for an admin (role Admin); lists unless apply is true

   An import is TAKEN, and never deleted, when
     - an event (any: one in the bin too, which can be restored) has 'imported-<id>' as its templateId or
       site.templateId;
     - a Create Event draft kept with someone's account (createDrafts/<person>/drafts/<id>) names it;
     - its record says claimedBy.
   It is OLD when its importedAt / failedAt (else when its record was created) is more than <days> ago. A record with
   no date at all is kept, and listed as such.
   A folder of files (events/import-<id>/) with no record at all — an import that stopped half way — is deleted on the
   same rules, its age being its newest file's.
   What is deleted: every file under events/import-<id>/ (each one listed), then the record — imports/<id>, and
   events/import-<id> for one from before ops-migrate-imports.js moved it.

   Fail closed: when the imports, the events, the drafts or the files cannot all be read, nothing is deleted.
   Credentials as the server's (tools/.env.local locally, this checkout's or the main checkout's), never printed.

     plan(fb, { days, now })  -> Promise<{ days, cutoff, candidates, kept, counts }>   reads only
     apply(fb, planned)       -> Promise<{ deleted: [id], failed: [{ id, why }] }>
     handleSweep(req, res)    the route */
'use strict';
const importStore = require('./import-store');

var DAY = 24 * 3600 * 1000;
var DEFAULT_DAYS = 7;
var TEMPLATE_RE = /^imported-([a-z0-9][a-z0-9-]{0,59})$/;
var MENTION_RE = /imported-([a-z0-9][a-z0-9-]{0,59})/g;
var FOLDER_RE = /^events\/import-([a-z0-9][a-z0-9-]{0,59})\/(.+)$/;
var RECORD_FIELDS = ['importStatus', 'importedAt', 'failedAt', 'sourceUrl', 'sourceZipName', 'createdBy', 'claimedBy', 'page', 'sectionHtmlPath'];

function millis(iso) { var t = Date.parse(iso || ''); return isFinite(t) ? t : null; }
function createdMillis(snap) {
  var t = snap && snap.createTime;
  return t && typeof t.toMillis === 'function' ? t.toMillis() : null;
}
function selected(query, fields) { return typeof query.select === 'function' ? query.select.apply(query, fields) : query; }
function eachDoc(snap, fn) { (snap && snap.docs ? snap.docs : []).forEach(fn); }

/* imports/<id> and, while lib/http.js LEGACY_IMPORT_DOCS is on, events/import-<id>; with every event's template */
function readRecordsAndEvents(fb) {
  var records = {}, taken = {};
  function record(id, ref, data, legacy, snap) {
    var r = records[id] || (records[id] = { id: id, refs: [], data: null, legacy: false, at: null });
    r.refs.push(ref);
    if (!r.data || !legacy) { r.data = data || {}; r.legacy = legacy; }
    var at = millis(data && (data.importedAt || data.failedAt)) || createdMillis(snap);
    if (at != null && (r.at == null || at > r.at)) r.at = at;
  }
  return Promise.all([
    selected(fb.db.collection(importStore.COLLECTION), RECORD_FIELDS).get(),
    selected(fb.db.collection('events'), ['templateId', 'site.templateId'].concat(RECORD_FIELDS)).get()
  ]).then(function (got) {
    eachDoc(got[0], function (d) { if (importStore.isImportId(d.id)) record(d.id, d.ref || importStore.recordRef(fb, d.id), d.data() || {}, false, d); });
    var events = 0;
    eachDoc(got[1], function (d) {
      var data = d.data() || {};
      if (d.id.indexOf(importStore.LEGACY_PREFIX) === 0) {
        var id = d.id.slice(importStore.LEGACY_PREFIX.length);
        if (importStore.LEGACY && importStore.isImportId(id)) record(id, d.ref || importStore.legacyRef(fb, id), data, true, d);
        return;
      }
      events++;
      [data.templateId, data.site && data.site.templateId].forEach(function (t) {
        var m = TEMPLATE_RE.exec(String(t || ''));
        if (m) taken[m[1]] = 'an event (' + d.id + ')';
      });
    });
    return { records: records, taken: taken, events: events };
  });
}

/* the Create Event drafts kept with people's accounts (lib/create-drafts.js): the imports their states name */
function readDrafts(fb, taken) {
  if (typeof fb.db.collectionGroup !== 'function') return Promise.reject(new Error('the drafts cannot be read here'));
  return selected(fb.db.collectionGroup('drafts'), ['state']).get().then(function (snap) {
    var n = 0;
    eachDoc(snap, function (d) {
      var path = (d.ref && d.ref.path) || '';
      if (path.indexOf('createDrafts/') !== 0) return;                 // events/<id>/drafts: an AI design's drafts
      n++;
      var state = String((d.data() || {}).state || ''), m;
      MENTION_RE.lastIndex = 0;
      while ((m = MENTION_RE.exec(state))) if (!taken[m[1]]) taken[m[1]] = 'a Create Event draft';
    });
    return n;
  });
}

/* every file under events/import-…/, by import: { id: { files: [{ name, size }], bytes, newest } } */
function readFolders(fb) {
  return fb.bucket.getFiles({ prefix: 'events/import-' }).then(function (r) {
    var folders = {};
    (r[0] || []).forEach(function (f) {
      var m = FOLDER_RE.exec(f.name || '');
      if (!m) return;
      var meta = f.metadata || {}, size = +meta.size || 0, at = millis(meta.timeCreated || meta.updated);
      var folder = folders[m[1]] || (folders[m[1]] = { files: [], bytes: 0, newest: null });
      folder.files.push({ name: f.name, size: size });
      folder.bytes += size;
      if (at != null && (folder.newest == null || at > folder.newest)) folder.newest = at;
    });
    return folders;
  });
}

function plan(fb, opts) {
  opts = opts || {};
  var days = +opts.days > 0 ? +opts.days : DEFAULT_DAYS;
  var now = +opts.now || Date.now(), cutoff = now - days * DAY;
  return readRecordsAndEvents(fb).then(function (seen) {
    return Promise.all([readDrafts(fb, seen.taken), readFolders(fb)]).then(function (got) {
      var drafts = got[0], folders = got[1];
      var candidates = [], kept = { taken: [], young: [], undated: [] };
      var ids = Object.keys(seen.records).concat(Object.keys(folders).filter(function (id) { return !seen.records[id]; }));
      ids.sort().forEach(function (id) {
        var rec = seen.records[id] || null, folder = folders[id] || { files: [], bytes: 0, newest: null };
        var data = (rec && rec.data) || {};
        var at = rec ? rec.at : folder.newest;
        var item = {
          id: id, store: rec ? (rec.legacy ? 'events/import-' + id : 'imports/' + id) : 'files only (no record)',
          status: rec ? (data.importStatus || (data.sectionHtmlPath ? 'imported' : 'unknown')) : 'no record',
          at: at != null ? new Date(at).toISOString() : null, ageDays: at != null ? Math.floor((now - at) / DAY) : null,
          source: String(data.sourceUrl || data.sourceZipName || ''), by: String(data.createdBy || ''),
          title: String((data.page && data.page.title) || ''), files: folder.files.length, bytes: folder.bytes,
          refs: rec ? rec.refs : [], fileNames: folder.files.map(function (f) { return f.name; })
        };
        if (seen.taken[id] || data.claimedBy) { item.why = seen.taken[id] || 'claimed by ' + data.claimedBy; kept.taken.push(item); return; }
        if (at == null) { kept.undated.push(item); return; }
        if (at > cutoff) { kept.young.push(item); return; }
        candidates.push(item);
      });
      return { days: days, now: new Date(now).toISOString(), cutoff: new Date(cutoff).toISOString(), candidates: candidates, kept: kept,
        counts: { records: Object.keys(seen.records).length, folders: Object.keys(folders).length, events: seen.events, drafts: drafts } };
    });
  });
}

/* the files first, then the record: a stop half way leaves the record, so the next run finds it again */
function apply(fb, planned) {
  var deleted = [], failed = [];
  return (planned.candidates || []).reduce(function (chain, item) {
    return chain.then(function () {
      return item.fileNames.reduce(function (c, name) {
        return c.then(function () { return fb.bucket.file(name).delete({ ignoreNotFound: true }); });
      }, Promise.resolve()).then(function () {
        return Promise.all(item.refs.map(function (ref) { return ref.delete(); }));
      }).then(function () { deleted.push(item.id); }, function (err) { failed.push({ id: item.id, why: String((err && err.message) || err).slice(0, 200) }); });
    });
  }, Promise.resolve()).then(function () { return { deleted: deleted, failed: failed }; });
}

function publicItem(item) {
  return { id: item.id, store: item.store, status: item.status, at: item.at, ageDays: item.ageDays, source: item.source, by: item.by,
    title: item.title, files: item.files, bytes: item.bytes, why: item.why };
}
function summary(planned) {
  return { days: planned.days, cutoff: planned.cutoff, counts: planned.counts, candidates: planned.candidates.map(publicItem),
    kept: { taken: planned.kept.taken.length, young: planned.kept.young.length, undated: planned.kept.undated.map(publicItem) } };
}

/* ---------- POST /api/imports/sweep { apply?, days? } — an admin's ---------- */
function handleSweep(req, res) {
  var http = require('./http');
  var AC = require('./access-control');
  http.requireAdmin(req, res, function (fb, decoded) {
    if (!AC.can(decoded && decoded.access, 'admin')) {
      return http.sendJson(res, 403, { error: 'Only an admin can clear away imports nobody used. Ask an admin.', code: 'not-admin' });
    }
    http.parseJsonBody(req, res, function (body) {
      var doApply = body.apply === true;
      plan(fb, { days: body.days }).then(function (planned) {
        if (!doApply) return http.sendJson(res, 200, Object.assign({ applied: false }, summary(planned)));
        return apply(fb, planned).then(function (done) {
          console.log('import-sweep: ' + (decoded.email || 'an admin') + ' deleted ' + done.deleted.length + ' unused import(s)' + (done.failed.length ? ', ' + done.failed.length + ' failed' : ''));
          http.sendJson(res, 200, Object.assign({ applied: true, deleted: done.deleted, failed: done.failed }, summary(planned)));
        });
      }).catch(function (err) {
        console.error('import-sweep: failed — ' + (err && (err.stack || err.message)));
        http.sendJson(res, 500, { error: 'The imports nobody used could not all be read, so nothing was deleted. Try again in a minute.', code: 'sweep-failed' });
      });
    }, 16 * 1024);
  });
}

module.exports = { plan, apply, handleSweep, DEFAULT_DAYS };

/* ---------- run by hand ---------- */
function mb(bytes) { return (bytes / 1048576).toFixed(1) + ' MB'; }
function line(item) {
  return '  ' + item.id + '  ' + item.store + '  ' + item.status + '  ' + (item.ageDays != null ? item.ageDays + ' days' : 'no date') +
    (item.title ? '  "' + item.title + '"' : '') + (item.source ? '  ' + item.source : '') + (item.by ? '  by ' + item.by : '') +
    '  ' + item.files + ' file(s), ' + mb(item.bytes);
}
if (require.main === module) {
  (function loadLocalEnv() {
    var fs = require('fs'), path = require('path');
    var root = path.resolve(__dirname, '..', '..');
    var file = [path.join(root, 'tools', '.env.local'), path.join(root, '..', '..', '..', 'tools', '.env.local')].filter(function (f) { return fs.existsSync(f); })[0];
    if (!file) return;
    fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach(function (l) {
      var m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(l);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    });
  })();
  var APPLY = process.argv.indexOf('--apply') !== -1;
  var at = process.argv.indexOf('--days');
  var days = at !== -1 ? +process.argv[at + 1] : DEFAULT_DAYS;
  var fb = require('./firebase').getFirebase();
  if (fb.error) { console.error('Cannot start: ' + fb.error); process.exit(1); }
  plan(fb, { days: days }).then(function (planned) {
    var c = planned.counts;
    console.log('Imports: ' + c.records + ' record(s), ' + c.folders + ' folder(s) of files; read against ' + c.events + ' event(s) and ' + c.drafts + ' Create Event draft(s).');
    console.log('Kept: ' + planned.kept.taken.length + ' taken by an event or a draft, ' + planned.kept.young.length + ' younger than ' + planned.days + ' days, ' + planned.kept.undated.length + ' with no date.');
    planned.kept.undated.forEach(function (item) { console.log(line(item) + '  (no date: kept)'); });
    var bytes = planned.candidates.reduce(function (n, i) { return n + i.bytes; }, 0);
    console.log((APPLY ? 'Deleting ' : 'Would delete ') + planned.candidates.length + ' import(s) nobody took, older than ' + planned.days + ' days (' + mb(bytes) + ')' + (APPLY ? ':' : ' — dry run, nothing is deleted (--apply deletes them):'));
    planned.candidates.forEach(function (item) { console.log(line(item)); });
    if (!APPLY) return null;
    return apply(fb, planned).then(function (done) {
      console.log('Deleted ' + done.deleted.length + '.' + (done.failed.length ? ' Not deleted: ' + done.failed.map(function (f) { return f.id + ' (' + f.why + ')'; }).join(', ') : ''));
    });
  }).then(function () { process.exit(0); }, function (err) {
    console.error('import-sweep: stopped, nothing was deleted — ' + (err && (err.stack || err.message)));
    process.exit(1);
  });
}
