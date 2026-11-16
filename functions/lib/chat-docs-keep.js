/* lib/chat-docs-keep.js — the pictures taken out of a document attached to ETB2B AI (lib/doc-pictures.js, under
   events/<id>/chat-docs/<key>/) are kept 30 days; the ones put on the page are kept for good (owner, 16 Nov 2026).

   HOW. Storage's lifecycle rules match a folder only by a fixed start of its name, never "every event's chat-docs folder", so the
   rule goes by each object's own Custom-Time instead:
     - every object doc-pictures.storeBatch writes (the picture, its small copy, its WebP copies) is given a
       Custom-Time of when it was stored (storeOpts);
     - the bucket's rule (tools/storage-lifecycle-chat-docs.json: Delete when daysSinceCustomTime is 30) touches only
       objects that have a Custom-Time — nothing else in the bucket sets one (checked by the owner-run step in
       tools/release-check.js before the rule is set);
     - a picture that is on the page when the site is saved (lib/api.js handleSitePut) has its Custom-Time, and its
       WebP copies', moved far forward (keepInPage), so the rule never reaches it. Storage lets a Custom-Time only
       move later, never earlier, which is exactly what this needs;
     - the conversation no longer offers a document's pictures once they are 30 days old (doc-pictures.recall), as
       the ones not placed are gone by then.
   Nothing here is an infrastructure change: the rule itself is set by the owner (tools/release-check.js, step 8).

     KEEP_DAYS, KEEP_UNTIL, PICTURE_RE
     storeOpts(nowIso)                 -> the metadata a stored document picture carries: { customTime }
     pathsInPage(html, bucket, eventId) -> this event's document pictures the page shows, as Storage paths (at most 64)
     keepInPage(fb, eventId, html)     -> Promise<{ kept, failed }> never rejects; each picture is kept once per
                                          server (a later save of the same page asks Storage nothing)
     forget()                          -> the server's memory of kept pictures emptied (tests) */
'use strict';

var KEEP_DAYS = 30;
/* far enough ahead that the 30-day rule never reaches it: a placed picture stays as long as the page shows it */
var KEEP_UNTIL = '2126-01-01T00:00:00.000Z';
var MAX_PER_SAVE = 64;
var PICTURE_RE = /chat-docs\/\d{14}-[a-z0-9]{6}\/[a-z0-9]{1,12}-[0-9a-f]{12}-[a-z0-9-]{1,40}\.jpg/g;

function escRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function storeOpts(nowIso) { return { customTime: nowIso || new Date().toISOString() }; }

function pathsInPage(html, bucket, eventId) {
  html = typeof html === 'string' ? html : '';
  if (!bucket || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/.test(String(eventId || '')) || html.indexOf('chat-docs/') === -1) return [];
  var re = new RegExp('https://storage\\.googleapis\\.com/' + escRe(bucket) + '/events/' + escRe(eventId) + '/(' + PICTURE_RE.source + ')', 'g');
  var out = [], seen = {}, m;
  while ((m = re.exec(html)) && out.length < MAX_PER_SAVE) {
    var path = 'events/' + eventId + '/' + m[1];
    if (!seen[path]) { seen[path] = true; out.push(path); }
  }
  return out;
}

var kept = new Set(), KEPT_MAX = 5000;
function forget() { kept = new Set(); }

function keepInPage(fb, eventId, html) {
  return Promise.resolve().then(function () {
    if (!fb || !fb.bucket || !fb.bucket.name) return { kept: 0, failed: 0 };
    var paths = pathsInPage(html, fb.bucket.name, eventId).filter(function (p) { return !kept.has(p); });
    if (!paths.length) return { kept: 0, failed: 0 };
    return Promise.all(paths.map(function (path) {
      /* the picture and its WebP copies (lib/pictures.js variantName: <path>.rv-…) share its name as their start */
      return Promise.resolve().then(function () { return fb.bucket.getFiles({ prefix: path, autoPaginate: true, maxResults: 50 }); }).then(function (r) {
        var files = (r && r[0]) || [];
        if (!files.length) return 0;
        return Promise.all(files.map(function (f) { return f.setMetadata({ customTime: KEEP_UNTIL }); })).then(function () {
          if (kept.size >= KEPT_MAX) kept = new Set();
          kept.add(path);
          return files.length;
        });
      }).then(function (n) { return { n: n }; }, function (err) {
        console.error('chat-docs-keep: the placed document picture ' + path + ' could not be marked to keep — ' + (err && err.message));
        return { failed: true };
      });
    })).then(function (got) {
      return { kept: got.filter(function (g) { return g.n > 0; }).length, failed: got.filter(function (g) { return g.failed; }).length };
    });
  }).catch(function (err) {
    console.error('chat-docs-keep: the placed document pictures of ' + eventId + ' were not checked — ' + (err && err.message));
    return { kept: 0, failed: 1 };
  });
}

module.exports = { KEEP_DAYS: KEEP_DAYS, KEEP_UNTIL: KEEP_UNTIL, PICTURE_RE: PICTURE_RE, storeOpts: storeOpts, pathsInPage: pathsInPage, keepInPage: keepInPage, forget: forget };
