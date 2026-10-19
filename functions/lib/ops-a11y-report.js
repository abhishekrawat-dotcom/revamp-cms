/* Run by hand, never by the server. REPORT ONLY — it reads, it never writes:

     node functions/lib/ops-a11y-report.js              every published event
     node functions/lib/ops-a11y-report.js <eventId>…   just these

   What the accessibility and search pass (lib/site-a11y.js pagePass) does to each published page as /e/<id> serves
   it. Nothing needs repairing by hand: a page published before the pass existed gets it on its way out (lib/api.js
   handlePublicPage), and every publish from now on writes it; the stored page and the saved site are never touched.
   This lists, per page, what visitors now get — so the change can be checked before and after it goes live:
   zoom allowed, headings re-levelled, pictures given alt="", a main landmark added, the reading colours of an
   AI-designed site (and how many text colours were made to read), the schema.org Event, the link-preview picture.
   Needs the same credentials as the server (tools/.env.local locally, see lib/firebase.js). */
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
const { sitePagePass } = require('./api')._testHooks;

function count(re, s) { return (String(s).match(re) || []).length; }
function sheets(html) {
  var found = {}, re = /<style data-rv-style="([^"]+)">([\s\S]*?)<\/style>/g, m;
  while ((m = re.exec(html))) found[m[1]] = m[2];
  return found;
}

function main() {
  var only = process.argv.slice(2).filter(function (a) { return /^[a-z0-9][a-z0-9-]*$/.test(a); });
  var fb = getFirebase();
  if (fb.error) { console.error('Cannot start: ' + fb.error); process.exit(1); }
  return fb.db.collection('events').where('published', '==', true).get().then(function (snap) {
    var docs = snap.docs.filter(function (d) { var e = d.data(); return e.createdAt && !e.deletedAt && (!only.length || only.indexOf(d.id) !== -1); });
    console.log(docs.length + ' published event(s). Report only — nothing is written.');
    return docs.reduce(function (chain, d) {
      return chain.then(function () {
        var id = d.id, e = d.data(), file = fb.bucket.file('events/' + id + '/published/index.html');
        return file.exists().then(function (r) {
          if (!r[0]) { console.log('\n' + id + ': no stored page'); return; }
          if (!e.publishedVersion) { console.log('\n' + id + ': published before /e/<id> — served through the whole transform (see ops-republish.js)'); return; }
          return file.download().then(function (got) {
            var html = got[0].toString('utf8');
            var t0 = Date.now();
            var out = sitePagePass(html, { mode: 'live', event: e, templateId: (e.site && e.site.templateId) || e.templateId });
            var ms = Date.now() - t0;
            var lines = [];
            if (/user-scalable\s*=\s*(0|no)/i.test(html) && !/user-scalable\s*=\s*(0|no)/i.test(out)) lines.push('zoom allowed');
            var lv = count(/data-rv-level/g, out) - count(/data-rv-level/g, html);
            if (lv) lines.push(lv + ' heading(s) re-levelled');
            var alts = count(/<img\b[^>]*\salt=""/g, out) - count(/<img\b[^>]*\salt=""/g, html);
            if (alts) lines.push(alts + ' picture(s) given alt=""');
            if (/<main data-rv-main>/.test(out) && !/<main data-rv-main>/.test(html)) lines.push('main landmark added');
            var before = sheets(html), after = sheets(out);
            var restyled = Object.keys(after).filter(function (k) { return before[k] !== after[k]; });
            if (restyled.length) lines.push('text colours made to read in ' + restyled.length + ' section(s): ' + restyled.join(', '));
            var ld = /<script type="application\/ld\+json" data-rv-seo>([^<]*)</.exec(out);
            lines.push(ld ? 'schema.org Event: ' + JSON.parse(ld[1]).startDate : 'no schema.org Event (no exact start date)');
            var og = /<meta property="og:image" content="([^"]*)"/.exec(out);
            lines.push(og ? 'link preview picture: ' + og[1] : 'no link preview picture');
            console.log('\n' + id + '  "' + (e.name || '') + '"  (' + html.length + ' -> ' + out.length + ' bytes, ' + ms + ' ms)\n  - ' + lines.join('\n  - '));
          });
        });
      });
    }, Promise.resolve());
  }).then(function () { process.exit(0); }, function (err) { console.error(err && err.stack || err); process.exit(1); });
}

main();
