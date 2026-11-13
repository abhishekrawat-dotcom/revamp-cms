/* Run by hand, never by the server, once (BE-055):

     node functions/lib/ops-migrate-imports.js            report only — changes nothing
     node functions/lib/ops-migrate-imports.js --write    make the changes listed below

   Until 13 Nov 2026 a Lovable import's record was the document events/import-<id>, in among the events, and the
   import wrote a public index.html (a debug copy nothing reads) and made its section.html public. New imports keep
   their record at imports/<id>, write no index.html and keep their pages private (lib/import-store.js, BE-049).
   For every events/import-<id> document, --write:
     1. creates imports/<id> from it (without flattenedHtmlPath, with migratedFrom / migratedAt). One already there is
        left as it is (moved by an earlier run);
     2. makes events/import-<id>/section.html and sections.json private, when they are public — GET
        /api/imported-section reads them with the server's own access, so nothing that works stops working;
     3. deletes events/import-<id>/index.html;
     4. deletes the events/import-<id> document, once imports/<id> has been read back.
   The import's pictures, fonts and films (assets/, images/) are not touched: the editor and published pages show them
   at their public addresses. Templates keep their id (imported-<id>), so no event changes.
   It can be run again at any time; each step is skipped when already done. Afterwards set LEGACY_IMPORT_DOCS to false
   in functions/lib/http.js (old records are then no longer looked for in events/, and import-… is an ordinary address
   again) and deploy.
   Needs the same credentials as the server (tools/.env.local, this checkout's or the main checkout's), never printed. */
'use strict';
const fs = require('fs');
const path = require('path');

(function loadLocalEnv() {
  var root = path.resolve(__dirname, '..', '..');
  var file = [path.join(root, 'tools', '.env.local'), path.join(root, '..', '..', '..', 'tools', '.env.local')].filter(function (f) { return fs.existsSync(f); })[0];
  if (!file || require.main !== module) return;
  fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach(function (l) {
    var m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(l);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  });
})();

const importStore = require('./import-store');

/* the events documents whose id begins import- (an id range: no event document is read) */
function legacyQuery(fb) {
  var events = fb.db.collection('events');
  try {
    var FieldPath = require('firebase-admin').firestore.FieldPath;
    return events.where(FieldPath.documentId(), '>=', importStore.LEGACY_PREFIX).where(FieldPath.documentId(), '<', 'import.');
  } catch (e) { return events; }
}
function exists(file) { return file.exists().then(function (r) { return !!r[0]; }, function () { return false; }); }
function isPublic(file) { return typeof file.isPublic === 'function' ? file.isPublic().then(function (r) { return !!r[0]; }) : Promise.resolve(false); }

/* -> Promise<[{ id, steps: [words], done: [words] }]>; write: false changes nothing */
function migrate(fb, write, log) {
  log = log || function () {};
  return legacyQuery(fb).get().then(function (snap) {
    var legacy = (snap.docs || []).filter(function (d) {
      return d.id.indexOf(importStore.LEGACY_PREFIX) === 0 && importStore.isImportId(d.id.slice(importStore.LEGACY_PREFIX.length));
    });
    log(legacy.length + ' import record(s) still in the events collection (events/import-<id>).' + (write ? '' : ' Report only — nothing will be changed.'));
    var out = [];
    return legacy.reduce(function (chain, d) {
      return chain.then(function () {
        var id = d.id.slice(importStore.LEGACY_PREFIX.length), data = d.data() || {}, folder = importStore.folderOf(id);
        var target = importStore.recordRef(fb, id), oldRef = d.ref || importStore.legacyRef(fb, id);
        var section = fb.bucket.file(data.sectionHtmlPath || folder + 'section.html');
        var sections = fb.bucket.file(data.sectionsPath || folder + 'sections.json');
        var index = fb.bucket.file(data.flattenedHtmlPath || folder + 'index.html');
        var item = { id: id, steps: [], done: [] };
        out.push(item);
        return Promise.all([target.get(), exists(section), exists(sections), exists(index)]).then(function (got) {
          var moved = got[0].exists;
          return Promise.all([got[1] ? isPublic(section) : false, got[2] ? isPublic(sections) : false]).then(function (pub) {
            if (!moved) item.steps.push('create imports/' + id);
            if (pub[0]) item.steps.push('make section.html private');
            if (pub[1]) item.steps.push('make sections.json private');
            if (got[3]) item.steps.push('delete index.html');
            item.steps.push('delete events/import-' + id);
            log('\nimport-' + id + '  ' + (data.importStatus || (data.sectionHtmlPath ? 'imported' : 'unknown')) + '  ' + (data.importedAt || data.failedAt || 'no date') +
              (data.sourceUrl || data.sourceZipName ? '  ' + (data.sourceUrl || data.sourceZipName) : ''));
            log('  ' + (write ? '' : 'would ') + item.steps.join('; '));
            if (!write) return null;
            var copy = Object.assign({}, data, { migratedFrom: 'events/import-' + id, migratedAt: new Date().toISOString() });
            delete copy.flattenedHtmlPath;
            return (moved ? Promise.resolve() : target.create(copy).then(function () { item.done.push('created imports/' + id); }))
              .then(function () { return pub[0] ? section.makePrivate().then(function () { item.done.push('section.html private'); }) : null; })
              .then(function () { return pub[1] ? sections.makePrivate().then(function () { item.done.push('sections.json private'); }) : null; })
              .then(function () { return got[3] ? index.delete({ ignoreNotFound: true }).then(function () { item.done.push('index.html deleted'); }) : null; })
              .then(function () { return target.get(); })
              .then(function (check) {
                if (!check.exists) throw new Error('imports/' + id + ' could not be read back: events/import-' + id + ' kept');
                return oldRef.delete().then(function () { item.done.push('events/import-' + id + ' deleted'); });
              })
              .then(function () { log('  done: ' + item.done.join('; ')); }, function (err) {
                item.failed = String((err && err.message) || err);
                log('  FAILED after: ' + (item.done.join('; ') || 'nothing') + ' — ' + item.failed);
              });
          });
        });
      });
    }, Promise.resolve()).then(function () { return out; });
  });
}

module.exports = { migrate };

if (require.main === module) {
  var WRITE = process.argv.indexOf('--write') !== -1;
  var fb = require('./firebase').getFirebase();
  if (fb.error) { console.error('Cannot start: ' + fb.error); process.exit(1); }
  migrate(fb, WRITE, function (s) { console.log(s); }).then(function (items) {
    var failed = items.filter(function (i) { return i.failed; }).length;
    console.log('\n' + items.length + ' import record(s) ' + (WRITE ? 'handled' + (failed ? ', ' + failed + ' FAILED (run again)' : '') : 'to move (dry run: --write moves them)') + '.');
    if (WRITE && !failed) console.log('Next: set LEGACY_IMPORT_DOCS = false in functions/lib/http.js and deploy.');
    process.exit(failed ? 1 : 0);
  }, function (err) { console.error('ops-migrate-imports: stopped — ' + (err && (err.stack || err.message))); process.exit(1); });
}
