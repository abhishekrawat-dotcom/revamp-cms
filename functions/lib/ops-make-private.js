/* Run by hand, never by the server (BE-055):

     node functions/lib/ops-make-private.js            report only — changes nothing
     node functions/lib/ops-make-private.js --write    make each object listed private

   Pages earlier versions of this server stored as PUBLIC objects, which anybody with the storage.googleapis.com
   address can still open, though nothing reads them there any more:
     - events/<id>/staging/index.html   the Preview copy of the editor's previous script (POST /api/event/stage). The
                                        server writes it private now and shows Preview at /preview/<id>;
     - events/import-<id>/index.html, section.html, sections.json
                                        a Lovable import's page (BE-049). GET /api/imported-section reads them with the
                                        server's own access. (ops-migrate-imports.js deletes index.html and does the
                                        same for the imports it moves; this catches every other one.)
   Never touched: an import's pictures, fonts and films (assets/, images/) and every other picture — the editor and the
   published pages show them at their public addresses — and events/<id>/published/index.html (ops-republish.js).
   It can be run again at any time. Needs the same credentials as the server (tools/.env.local, this checkout's or the
   main checkout's), never printed. */
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

var STAGING = /^events\/[^/]+\/staging\/index\.html$/;
var IMPORT_PAGE = /^events\/import-[a-z0-9][a-z0-9-]{0,59}\/(?:index\.html|section\.html|sections\.json)$/;

/* the objects of those kinds, by listing only where they can be */
function listCandidates(fb) {
  return Promise.all([
    fb.bucket.getFiles({ prefix: 'events/', matchGlob: 'events/*/staging/index.html' }),
    fb.bucket.getFiles({ prefix: 'events/import-', matchGlob: 'events/import-*/*' })
  ]).then(function (got) {
    var seen = {}, out = [];
    got.forEach(function (r) {
      (r[0] || []).forEach(function (f) {
        if (seen[f.name] || !(STAGING.test(f.name) || IMPORT_PAGE.test(f.name))) return;
        seen[f.name] = 1;
        out.push(f);
      });
    });
    return out.sort(function (a, b) { return a.name < b.name ? -1 : 1; });
  });
}

/* -> Promise<{ checked, public: [name], made: [name], failed: [{ name, why }] }>; write: false changes nothing */
function makePrivate(fb, write, log) {
  log = log || function () {};
  return listCandidates(fb).then(function (files) {
    var res = { checked: files.length, public: [], made: [], failed: [] };
    log(files.length + ' staging and import page(s) found.' + (write ? '' : ' Report only — nothing will be changed.'));
    return files.reduce(function (chain, f) {
      return chain.then(function () {
        return f.isPublic().then(function (r) {
          if (!r[0]) return null;
          res.public.push(f.name);
          log('  ' + (write ? 'making private: ' : 'public: ') + f.name);
          if (!write) return null;
          return f.makePrivate().then(function () { res.made.push(f.name); });
        }).catch(function (err) {
          res.failed.push({ name: f.name, why: String((err && err.message) || err).slice(0, 200) });
          log('  FAILED ' + f.name + ' — ' + ((err && err.message) || err));
        });
      });
    }, Promise.resolve()).then(function () { return res; });
  });
}

module.exports = { makePrivate, STAGING, IMPORT_PAGE };

if (require.main === module) {
  var WRITE = process.argv.indexOf('--write') !== -1;
  var fb = require('./firebase').getFirebase();
  if (fb.error) { console.error('Cannot start: ' + fb.error); process.exit(1); }
  makePrivate(fb, WRITE, function (s) { console.log(s); }).then(function (r) {
    console.log(r.checked + ' checked; ' + r.public.length + ' public' + (WRITE ? ', ' + r.made.length + ' made private' : ' (dry run: --write makes them private)') +
      (r.failed.length ? '; ' + r.failed.length + ' could not be checked or changed (run again)' : '') + '.');
    process.exit(r.failed.length ? 1 : 0);
  }, function (err) { console.error('ops-make-private: stopped — ' + (err && (err.stack || err.message))); process.exit(1); });
}
