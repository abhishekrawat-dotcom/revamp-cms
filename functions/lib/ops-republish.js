/* Run by hand, never by the server:

     node functions/lib/ops-republish.js            report only — changes nothing
     node functions/lib/ops-republish.js --write    make the changes listed below

   Pages published before the site moved to /e/<id> are files on storage.googleapis.com that anybody with
   the old link can open: the editor's page as it was sent, linking its styles by the address of
   whichever host the editor ran on, with no registration form. /e/<id> already serves each of them
   through the publish transform on the way out (lib/api.js, handlePublicPage), so visitors of the new
   address get a working page without this script. What is left, and what --write does for every event
   that is published with no publishedVersion:
     - the stored page is made private, so the old storage link stops answering and /e/<id> is the one
       address of the site;
     - the event records publishedPath "/e/<id>" and loses its publishedUrl.
   The page itself is not rewritten and nothing is re-published: an owner's unpublished edits never go
   live because of this script. It can be run again at any time. Needs the same credentials as the
   server (tools/.env.local locally, see lib/firebase.js). */
const fs = require('fs');
const path = require('path');

(function loadLocalEnv() {
  var file = path.join(__dirname, '..', '..', 'tools', '.env.local');
  if (!fs.existsSync(file)) return;
  fs.readFileSync(file, 'utf8').split('\n').forEach(function (line) {
    var m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  });
})();

const { getFirebase } = require('./firebase');
const { publishTransform } = require('./api')._testHooks;

var WRITE = process.argv.indexOf('--write') !== -1;

function main() {
  var fb = getFirebase();
  if (fb.error) { console.error('Cannot start: ' + fb.error); process.exit(1); }
  var FieldValue = require('firebase-admin').firestore.FieldValue;

  return fb.db.collection('events').where('published', '==', true)
    .select('name', 'createdAt', 'deletedAt', 'publishedVersion', 'publishedUrl', 'publishedPath', 'templateId', 'logoUrl', 'site').get()
    .then(function (snap) {
      var legacy = snap.docs.filter(function (d) { var e = d.data(); return e.createdAt && !e.deletedAt && !e.publishedVersion; });
      console.log(snap.size + ' published event(s); ' + legacy.length + ' published before /e/<id>.' + (WRITE ? '' : ' Report only — nothing will be changed.'));
      var failed = [];
      return legacy.reduce(function (chain, d) {
        return chain.then(function () {
          var id = d.id, e = d.data(), file = fb.bucket.file('events/' + id + '/published/index.html');
          return file.exists().then(function (r) {
            if (!r[0]) { failed.push(id + ' — no stored page: publish it again from the editor'); return; }
            return Promise.all([file.download(), file.isPublic()]).then(function (got) {
              var html = got[0][0].toString('utf8'), isPublic = got[1][0];
              var live = publishTransform(html, { eventId: id, event: e, mode: 'live', templateId: e.templateId });
              var hosts = (html.match(/https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?/g) || []).filter(function (h, i, a) { return a.indexOf(h) === i; });
              var stillLocal = /https?:\/\/(?:localhost|127\.0\.0\.1)/.test(live);
              console.log('\n' + id + '  "' + (e.name || '') + '"');
              console.log('  stored page: ' + html.length + ' bytes, ' + (isPublic ? 'PUBLIC on storage.googleapis.com' : 'private') +
                (hosts.length ? '; links back to ' + hosts.join(', ') : ''));
              console.log('  served at /e/' + id + ': ' + live.length + ' bytes, runtime ' + (/rv-live\.js/.test(live) ? 'present' : 'MISSING') +
                (stillLocal ? '; STILL links to a local host' : '') + '; saved site: ' + (e.site && e.site.version ? 'version ' + e.site.version : 'none'));
              if (stillLocal) failed.push(id + ' — a link to a local host survives the transform: publish it again from the editor');
              if (!WRITE) return;
              var steps = isPublic ? file.makePrivate() : Promise.resolve();
              return steps.then(function () {
                return d.ref.update({ publishedPath: '/e/' + id, publishedUrl: FieldValue.delete() });
              }).then(function () { console.log('  done: page private, publishedPath /e/' + id); });
            });
          }).catch(function (err) { failed.push(id + ' — ' + (err && err.message)); });
        });
      }, Promise.resolve()).then(function () {
        if (failed.length) { console.log('\nNeeds a person:'); failed.forEach(function (f) { console.log('  - ' + f); }); }
        console.log(WRITE ? '\nFinished.' : '\nNothing was changed. Run again with --write to apply.');
      });
    });
}

main().then(function () { process.exit(0); }, function (err) { console.error(err && err.stack || err); process.exit(1); });
