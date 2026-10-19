/* Banner video files nothing uses any more (functions/lib/api-hero-video.js). Optional housekeeping: the routes
   already delete a replaced or removed video, and a refused upload; an upload whose check never
   ran (a closed tab) is deleted by the next upload to the same event after a day. What can still be left:

     - an upload sent but never checked, on an event nobody uploads to again (private, rvPending=1);
     - a checked video that was never saved as the banner video (the tab was closed between the upload and the
       save, or the save failed) — public, but no page names it.

   Only VIDEO files the banner video's own upload wrote are considered (events/<id>/media/, rvKind=hero-video).
   Still pictures are ordinary image uploads (a few hundred KB) that other parts of the product may also use, so
   they are never touched here. Anything younger than a day is left: it may be an upload in progress.

   node tools/sweep-hero-video.js [--dry | --apply] [--event <id> | --prefix <p>]
     --dry (default)   lists what it would delete, deletes nothing
     --apply           deletes
     --event <id> / --prefix <p>   only those events (default: every event)

   Env: tools/.env.local (this checkout's, else the main checkout's when run from a worktree), never printed. */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const envFile = [path.join(ROOT, 'tools', '.env.local'), path.join(ROOT, '..', '..', '..', 'tools', '.env.local')].filter(function (f) { return fs.existsSync(f); })[0];
if (envFile) {
  fs.readFileSync(envFile, 'utf8').split(/\r?\n/).forEach(function (l) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(l);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  });
}
const { getFirebase } = require(path.join(ROOT, 'functions', 'lib', 'firebase.js'));

function arg(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? null : (process.argv[i + 1] || '');
}
const APPLY = process.argv.indexOf('--apply') !== -1;
const ONE = arg('--event'), PREFIX = arg('--prefix');
const DAY = 24 * 3600 * 1000;

(async function () {
  const fb = getFirebase();
  if (fb.error) throw new Error(fb.error);
  const [files] = await fb.bucket.getFiles({ prefix: ONE ? 'events/' + ONE + '/media/' : 'events/' + (PREFIX || '') });
  const media = files.filter(function (f) { return /^events\/[^/]+\/media\/[^/]+$/.test(f.name); });
  const byEvent = {};
  media.forEach(function (f) { const id = f.name.split('/')[1]; (byEvent[id] = byEvent[id] || []).push(f); });
  let found = 0, deleted = 0, bytes = 0;
  for (const id of Object.keys(byEvent)) {
    const snap = await fb.db.collection('events').doc(id).get();
    const hv = snap.exists ? (snap.data() || {}).heroVideo || {} : {};
    const inUse = [hv.path].filter(Boolean);
    for (const f of byEvent[id]) {
      const m = f.metadata || {}, own = m.metadata || {};
      const age = Date.now() - Date.parse(m.timeCreated || 0);
      const ours = own.rvKind === 'hero-video';
      if (!ours || inUse.indexOf(f.name) !== -1 || age < DAY) continue;
      found++; bytes += +m.size || 0;
      console.log((APPLY ? 'delete ' : 'would delete ') + f.name + '  ' + Math.round((+m.size || 0) / 1024) + ' KB  ' +
        (own.rvPending === '1' ? 'never checked' : 'not the banner video') + (snap.exists ? '' : '  (no such event)'));
      if (APPLY) { await f.delete(); deleted++; }
    }
  }
  console.log((APPLY ? 'deleted ' + deleted : found + ' to delete (dry run: --apply deletes them)') + ', ' + (bytes / 1048576).toFixed(1) + ' MB');
  process.exit(0);
})().catch(function (err) { console.error(err && err.stack || err); process.exit(1); });
