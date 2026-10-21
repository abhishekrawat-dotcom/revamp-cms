/* node tools/republish-current.js --event <id> [--event <id> …] [--dry]

   Runs each event's CURRENTLY PUBLISHED version through today's publish step again (lib/api.js
   publishVersion), so a page published before a platform change carries it — the registration forms'
   current definitions, pictures' WebP copies, the page runtime — without anything else changing:
     - the same version goes live again: what the owner saved after it (and has not published) stays
       unpublished, and no approval is skipped (that version was approved when it was first published);
     - the publisher of record stays the one who published it; the event's history gets a "published"
       line saying it was a refresh of the same version by the platform.
   --dry  reads each event and says what it would do, writes nothing.
   Credentials: the main checkout's tools/.env.local (FIREBASE_* as for tools/serve.js), never printed. */
'use strict';
const fs = require('fs');
const path = require('path');

(function loadLocalEnv() {
  var file = path.join(__dirname, '.env.local');
  if (!fs.existsSync(file)) return;
  fs.readFileSync(file, 'utf8').split('\n').forEach(function (line) {
    var m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  });
})();

const args = process.argv.slice(2);
const DRY = args.indexOf('--dry') !== -1;
const ids = [];
args.forEach(function (a, i) { if (a === '--event' && args[i + 1]) ids.push(args[i + 1].trim()); });
if (!ids.length || ids.some(function (id) { return !/^[a-z0-9][a-z0-9-]{0,99}$/.test(id); })) {
  console.error('usage: node tools/republish-current.js --event <id> [--event <id> …] [--dry]');
  process.exit(2);
}
/* the address published pages are served from (publicBaseFor prefers PUBLIC_BASE_URL when it is set) */
const ORIGIN = 'https://revamp-cms--revamp-cms.us-east4.hosted.app';

const { getFirebase } = require('../functions/lib/firebase');
const api = require('../functions/lib/api');
const { logActivity } = require('../functions/lib/activity');

function main() {
  var fb = getFirebase();
  if (fb.error) { console.error('Cannot start: ' + fb.error); process.exit(1); }
  var failed = 0;
  return ids.reduce(function (chain, id) {
    return chain.then(function () {
      return fb.db.collection('events').doc(id).get().then(function (snap) {
        if (!snap.exists) { failed++; console.log(id + ': no such event'); return; }
        var e = snap.data(), v = +e.publishedVersion || 0;
        if (e.published !== true || !v) { failed++; console.log(id + ': not published with a version — left alone'); return; }
        var saved = (e.site && +e.site.version) || 0;
        var line = id + ': version ' + v + ' (published ' + (e.publishedAt || '?') + ' by ' + (e.publishedBy || '?') + ')' +
          (saved > v ? '; saved version ' + saved + ' stays unpublished' : '');
        if (DRY) { console.log(line + ' — would publish version ' + v + ' again'); return; }
        var req = { headers: { host: ORIGIN.replace(/^https:\/\//, ''), 'x-forwarded-proto': 'https' }, socket: {} };
        return api._testHooks.publishVersion(fb, req, id, v, e.publishedBy || 'platform', ORIGIN).then(function (out) {
          return logActivity(fb, id, 'platform', 'published',
            'version ' + v + ' again — a refresh by the platform so the published page carries today\'s forms, pictures and page code; nothing in the site changed',
            { version: v }).then(function () { console.log(line + ' — published again at ' + out.publishedPath); });
        }, function (err) { failed++; console.log(line + ' — FAILED: ' + (err && err.message)); });
      });
    });
  }, Promise.resolve()).then(function () {
    console.log(DRY ? '\nDRY RUN: nothing written.' : '\nDone' + (failed ? ', ' + failed + ' not republished.' : '.'));
    process.exit(failed && !DRY ? 1 : 0);
  });
}
main().catch(function (err) { console.error(err && err.stack || err); process.exit(1); });
