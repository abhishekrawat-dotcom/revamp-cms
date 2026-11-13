/* Where a Lovable import is kept, and what it is called (BE-049, BE-055).

   Firestore  imports/<importId>              the import's record, written once with create() — never merged over
                                              another (lib/api.js processLovableImport, recordImportFailure):
     { importStatus: 'imported' | 'failed', importedAt | failedAt, sourceUrl, createdBy,
       page { title, description, shareImage, lang }   what the page said of itself (lib/import-page.js)
       sectionHtmlPath, sectionsPath, sections, importRepairs, importRemoved, importMedia, importFailure }
   Storage    events/import-<importId>/       its files (the folder kept its old name: published pages name the copies)
     section.html     the page as one section — PRIVATE, read only through GET /api/imported-section
     sections.json    the page cut into its sections — private, read the same way (?all=1)
     assets/…         its pictures, fonts and films — public: the editor and every published page show them
   The id is made here (newImportId), on the server; a request cannot choose it, so an import can never be written
   over another.

   Until 13 Nov 2026 the record was the document events/import-<id> (written with a merge, its id chosen by the
   browser), and the import also wrote a public index.html and made its section.html public. ops-migrate-imports.js
   moves those records here and makes their files private; until the owner has run it, and set lib/http.js
   LEGACY_IMPORT_DOCS to false, a record that is not here is read there.

     newImportId()            -> 'imp-' + 20 random hex characters
     isImportId(id)           -> the shape of an import id (what /api/imported-* accept)
     recordRef(fb, id)        -> imports/<id>
     legacyRef(fb, id)        -> events/import-<id>
     folderOf(id)             -> 'events/import-<id>/'
     readRecord(fb, id)       -> Promise<{ data, ref, legacy }>: data null when there is no such import
     LEGACY                   whether old records are still read (lib/http.js LEGACY_IMPORT_DOCS) */
'use strict';
const crypto = require('crypto');

var COLLECTION = 'imports';
var LEGACY_PREFIX = 'import-';
var ID_RE = /^[a-z0-9][a-z0-9-]{0,59}$/;

function legacyOn() {
  try { return require('./http').LEGACY_IMPORT_DOCS !== false; } catch (e) { return true; }
}

function newImportId() { return 'imp-' + crypto.randomBytes(10).toString('hex'); }
function isImportId(id) { return typeof id === 'string' && ID_RE.test(id); }
function recordRef(fb, id) { return fb.db.collection(COLLECTION).doc(id); }
function legacyRef(fb, id) { return fb.db.collection('events').doc(LEGACY_PREFIX + id); }
function folderOf(id) { return 'events/' + LEGACY_PREFIX + id + '/'; }

function readRecord(fb, id) {
  var ref = recordRef(fb, id);
  return ref.get().then(function (snap) {
    if (snap.exists) return { data: snap.data() || {}, ref: ref, legacy: false };
    if (!legacyOn()) return { data: null, ref: ref, legacy: false };
    var old = legacyRef(fb, id);
    return old.get().then(function (s) { return { data: s.exists ? (s.data() || {}) : null, ref: s.exists ? old : ref, legacy: s.exists }; });
  });
}

module.exports = { COLLECTION, LEGACY_PREFIX, newImportId, isImportId, recordRef, legacyRef, folderOf, readRecord,
  get LEGACY() { return legacyOn(); } };
