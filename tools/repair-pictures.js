/* node tools/repair-pictures.js (--event <eventId> | --all) [--dry] [--limit <n>]

   Gives the pictures stored before functions/lib/pictures.js existed what a picture stored now gets:
     - WebP copies at a few widths, next to the original (<original>.rv-<hash>.<W>x<H>.w<width>.webp), which
       published pages and previews then load instead of the original;
     - a year's cache on an AI picture or an imported picture whose name is unique (a generated picture
       named after its run, "20261019051531-overview.png"; anything in an import's own folder) that has no
       cache header — Storage then sends an hour. The old fixed-name hero picture ("hero-bg.png") keeps
       its hour: what that one name holds changed with every run. Its WebP copies are named after its
       content, so they are cached for a year whatever happens to it.
   No original is changed, moved or deleted, and nothing is published: a page published before this gets
   the copies on its way out (/e/<id> looks them up), with no republish.

   Which pictures: PNG, JPEG and WebP files in an event's generated/, speakers/, partners/, gallery/,
   banner/, media/ and logo/ folders, and in the import folders (events/import-<id>/images/) its saved or
   published page uses. GIF is left as it is. An SVG in those folders that is stored as plain text is stored
   again gzipped — the same drawing, name and headers (Content-Encoding: gzip; Storage then sends it compressed,
   about a third of the size, and unzips it for any reader that does not take gzip). A picture whose copies
   were made from what it holds now, and an SVG already gzipped, are skipped, so the script can be run again
   at any time.

   --event <id>  that event (and the import folders its pages use)
   --all         every event in the bucket
   --dry         print what would be done, write nothing
   --limit <n>   stop after making copies for n pictures

   Needs no AI: it only reads and re-encodes pictures (sharp). Credentials: the main checkout's
   tools/.env.local (FIREBASE_* as for tools/serve.js), never printed. */
'use strict';
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const dry = args.indexOf('--dry') !== -1;
const all = args.indexOf('--all') !== -1;
const eventId = args.indexOf('--event') === -1 ? '' : (args[args.indexOf('--event') + 1] || '').trim();
const limit = args.indexOf('--limit') === -1 ? Infinity : parseInt(args[args.indexOf('--limit') + 1], 10);
if ((!all && !/^[a-z0-9][a-z0-9-]{0,99}$/.test(eventId)) || (all && eventId) || !(limit > 0)) {
  console.error('usage: node tools/repair-pictures.js (--event <eventId> | --all) [--dry] [--limit <n>]');
  process.exit(2);
}

const REPO = path.join(__dirname, '..');
/* the env file sits in the main checkout (a worktree has none): look here, then up from .claude/worktrees/<x> */
const envCandidates = [path.join(REPO, 'tools', '.env.local'), path.join(REPO, '..', '..', '..', 'tools', '.env.local')];
const envFile = envCandidates.filter(function (f) { return fs.existsSync(f); })[0];
if (!envFile) { console.error('tools/.env.local not found'); process.exit(2); }
fs.readFileSync(envFile, 'utf8').split('\n').forEach(function (line) {
  var m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
});

const pictures = require(path.join(REPO, 'functions', 'lib', 'pictures.js'));
const { getFirebase } = require(path.join(REPO, 'functions', 'lib', 'firebase.js'));
const { logActivity } = require(path.join(REPO, 'functions', 'lib', 'activity.js'));

var FOLDERS = ['generated', 'speakers', 'partners', 'gallery', 'banner', 'media', 'logo'];
var YEAR = 'public, max-age=31536000';

/* is this object one of the pictures this script looks after? */
function inScope(name) {
  var parts = name.split('/');
  if (parts[0] !== 'events' || parts.length !== 4 || !pictures.wanted(name)) return false;
  if (/^import-/.test(parts[1])) return parts[2] === 'images';
  return FOLDERS.indexOf(parts[2]) !== -1;
}
/* an SVG in the same folders (stored gzipped by this script when it is not) */
function svgInScope(name) {
  var parts = name.split('/');
  if (parts[0] !== 'events' || parts.length !== 4 || !/\.svg$/i.test(name)) return false;
  if (/^import-/.test(parts[1])) return parts[2] === 'images';
  return FOLDERS.indexOf(parts[2]) !== -1;
}
/* may it be cached for a year? (its name is never written again) */
function uniqueName(name) {
  var parts = name.split('/');
  if (/^import-/.test(parts[1])) return true;
  return parts[2] === 'generated' && /^\d{14}-/.test(parts[3]);
}

function listAll(fb, prefix) {
  return fb.bucket.getFiles({ prefix: prefix, autoPaginate: true }).then(function (r) { return r[0] || []; });
}

/* the import folders an event's pages use (a Lovable import keeps its pictures under events/import-<id>/) */
function importFoldersOf(fb, id) {
  var pages = ['site/page.html', 'published/index.html'].map(function (p) { return fb.bucket.file('events/' + id + '/' + p); });
  return Promise.all(pages.map(function (f) {
    return f.download().then(function (r) { return r[0].toString('utf8'); }, function () { return ''; });
  })).then(function (texts) {
    var dirs = {};
    pictures.urlsIn(texts.join('\n')).forEach(function (u) {
      var p = pictures.pathOfUrl(u, fb.bucket.name);
      var m = /^(events\/import-[^/]+\/images\/)/.exec(p);
      if (m) dirs[m[1]] = 1;
    });
    return Object.keys(dirs);
  });
}

function kb(n) { return Math.round(n / 1024) + ' KB'; }

function main() {
  var fb = getFirebase();
  if (fb.error) { console.error('Cannot start: ' + fb.error); process.exit(1); }
  if (!pictures.available()) { console.error('sharp is not installed here: run npm install in the repository first.'); process.exit(1); }

  var prefixes = all ? Promise.resolve(['events/']) : importFoldersOf(fb, eventId).then(function (dirs) { return ['events/' + eventId + '/'].concat(dirs); });
  return prefixes.then(function (list) {
    console.log((dry ? 'DRY RUN — nothing will be written.\n' : '') + 'Looking in: ' + list.join(', '));
    return Promise.all(list.map(function (p) { return listAll(fb, p); }));
  }).then(function (lists) {
    var files = [].concat.apply([], lists);
    var seen = {};
    files = files.filter(function (f) { if (seen[f.name]) return false; seen[f.name] = 1; return true; });
    var index = pictures.indexFromListing(fb.bucket.name, files.map(function (f) { return { name: f.name, md5Hash: f.metadata && f.metadata.md5Hash }; }));
    var originals = files.filter(function (f) { return inScope(f.name); });
    /* a picture with no copies, or with only some of them (an upload of the others failed half-way: the
       copies it has are used, but the full-size one a hero needs may be missing) */
    var todo = originals.filter(function (f) {
      var e = index.entries[f.name];
      return !e || pictures.widthsFor(e.w).some(function (w) { return e.widths.indexOf(w) === -1; });
    });
    var noCache = originals.filter(function (f) { return uniqueName(f.name) && !(f.metadata && f.metadata.cacheControl); });
    var bytes = todo.reduce(function (n, f) { return n + (+(f.metadata && f.metadata.size) || 0); }, 0);
    console.log(originals.length + ' picture(s); ' + (originals.length - todo.length) + ' already have their WebP copies; ' +
      todo.length + ' need them (' + kb(bytes) + ' of originals); ' + noCache.length + ' have no cache header and can be cached for a year.');

    /* SVGs stored as plain text: stored again gzipped, the same drawing with the same name and headers
       (pictures.js gzipWorthIt) — Storage then sends them compressed */
    var svgs = files.filter(function (f) {
      var m = f.metadata || {};
      return svgInScope(f.name) && m.contentEncoding !== 'gzip' && (+m.size || 0) > 1024;
    });
    var svgBytes = svgs.reduce(function (n, f) { return n + (+(f.metadata && f.metadata.size) || 0); }, 0);
    console.log(svgs.length + ' SVG(s) stored uncompressed (' + kb(svgBytes) + '): to be stored gzipped.');

    var made = 0, failed = [], before = 0, after = 0;
    /* per event, the pictures this run actually changed: one "platform" line in each event's activity log */
    var touched = {};
    function touch(name, what) {
      var m = /^events\/([a-z0-9-]+)\//.exec(name);
      if (!m || m[1].indexOf('import-') === 0) return;
      var t = touched[m[1]] = touched[m[1]] || { copies: 0, gzip: 0, cache: 0 };
      t[what]++;
    }
    var steps = svgs.reduce(function (chain, f) {
      return chain.then(function () {
        var m = f.metadata || {};
        if (dry) { console.log('  gzip   ' + f.name + '  (' + kb(+m.size || 0) + ')'); return; }
        return f.download().then(function (r) {
          var buffer = r[0];
          if (!pictures.gzipWorthIt(m.contentType || 'image/svg+xml', buffer, f.name)) return;
          var metadata = { contentType: m.contentType || 'image/svg+xml' };
          ['cacheControl', 'contentDisposition', 'contentLanguage'].forEach(function (k) { if (m[k]) metadata[k] = m[k]; });
          if (m.metadata) metadata.metadata = m.metadata;
          return f.save(buffer, { resumable: false, gzip: true, metadata: metadata })
            .then(function () { return f.makePublic(); })
            .then(function () { return f.getMetadata(); })
            .then(function (got) { touch(f.name, 'gzip'); console.log('  gzip   ' + f.name + '  ' + kb(buffer.length) + ' -> ' + kb(+(got[0] && got[0].size) || 0)); });
        }).catch(function (err) { failed.push(f.name + ' (gzip) — ' + (err && err.message)); });
      });
    }, Promise.resolve());
    steps = noCache.reduce(function (chain, f) {
      return chain.then(function () {
        if (dry) { console.log('  cache  ' + f.name); return; }
        return f.setMetadata({ cacheControl: YEAR }).then(function () { touch(f.name, 'cache'); console.log('  cache  ' + f.name + '  -> ' + YEAR); },
          function (err) { failed.push(f.name + ' (cache) — ' + (err && err.message)); });
      });
    }, steps);
    return todo.reduce(function (chain, f) {
      return chain.then(function () {
        if (made >= limit) return;
        var size = +(f.metadata && f.metadata.size) || 0;
        if (dry) { made++; console.log('  copies ' + f.name + '  (' + kb(size) + ')'); return; }
        return f.download().then(function (r) {
          var buffer = r[0];
          return pictures.storeVariants(fb, f.name, buffer, { strict: true }).then(function (out) {
            made++;
            if (!out) { console.log('  none   ' + f.name + '  (' + kb(size) + ': no smaller copy can be made)'); return; }
            touch(f.name, 'copies');
            var full = pictures.variantName(f.name, pictures.md5Hex8(buffer), out.width, out.height, out.widths[out.widths.length - 1]);
            return fb.bucket.file(full).getMetadata().then(function (m) {
              var fullSize = +(m[0] && m[0].size) || 0;
              before += buffer.length; after += fullSize;
              console.log('  copies ' + f.name + '  ' + out.width + 'x' + out.height + '  ' + kb(buffer.length) + ' -> ' + kb(fullSize) + ' at full size; widths ' + out.widths.join(', '));
            });
          });
        }).catch(function (err) { failed.push(f.name + ' — ' + (err && err.message)); });
      });
    }, steps).then(function () {
      if (!dry && before) console.log('\nFull-size copies: ' + kb(before) + ' of originals -> ' + kb(after) + ' (' + Math.round(100 - after / before * 100) + '% smaller).');
      if (failed.length) { console.log('\nCould not be done:'); failed.forEach(function (x) { console.log('  - ' + x); }); }
      console.log(dry ? '\nNothing was changed. Run again without --dry to apply.' : '\nFinished.');
      return Promise.all(Object.keys(touched).map(function (id) {
        var t = touched[id], parts = [];
        if (t.copies) parts.push(t.copies + ' picture' + (t.copies === 1 ? '' : 's') + ' given fast WebP copies');
        if (t.gzip) parts.push(t.gzip + ' SVG' + (t.gzip === 1 ? '' : 's') + ' stored compressed');
        if (t.cache) parts.push(t.cache + ' picture' + (t.cache === 1 ? '' : 's') + ' made cacheable');
        /* only a real event gets the line (a folder can outlive its event, or belong to a wizard draft) */
        return fb.db.collection('events').doc(id).get().then(function (snap) {
          if (!snap.exists || !(snap.data() || {}).createdAt) return;
          return logActivity(fb, id, 'platform', 'repaired', 'picture repair (tools/repair-pictures.js): ' + parts.join(', ') + ' — the pictures look the same', { area: 'site' });
        }).catch(function (err) { console.error('activity line for ' + id + ' not written — ' + (err && err.message)); });
      }));
    });
  });
}

main().then(function () { process.exit(0); }, function (err) { console.error(err && err.stack || err); process.exit(1); });
