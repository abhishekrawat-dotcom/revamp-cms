/* The template gallery: sections saved from any site, for every site (the owner, 19 Nov 2026: "Add an option in each
   section to add to template gallary, and when a user is trying to add duplicate template it should be avoided. By
   adding a section to the template gallary, that section will be available globally and easily can be accommodated in
   any site. Later on we can add a manual site creation method using the same templates").

   A section is saved from the site editor (its pill's "Add to gallery") as the Developer zone shows it — its markup
   without the editor's marks, a list of the event's records as the one model item it is drawn from, its own CSS and
   its own script — and is added to another site from Add section › Template gallery, where it takes that site's
   theme (an AI-designed section's CSS is written in the theme's variables) and that event's records.

   One design is kept once. Its fingerprint is the markup's tags, classes and styles and its CSS and script, without
   its words, pictures, links and ids: the same section saved again with other words, from another event, or after
   being added to a site from here, is the same design, and is answered with the one already kept.

   Pictures are never shared by address. Saving copies the section's pictures out of the event's files into the
   gallery's own (a draft that is discarded takes its files with it); adding it to a site copies them again into that
   event's files. Each site owns what it shows, and a design taken out of the gallery breaks no site that used it.

     GET    /api/section-gallery                 -> { items: [meta], family } newest first, at most LIST_MAX
                                                    meta: { id, name, kind, family, srcType, records, pictures, size,
                                                            savedAt, savedBy, savedByName, fromEvent: { id, name, portal },
                                                            uses, canDelete }
     GET    /api/section-gallery/item?id=        -> { item: meta + { html, css, js } }
     POST   /api/section-gallery { eventId, name, html, css, js, family, srcType, records }
                                                 -> { ok, item: meta }     201
                                                    409 duplicate { existing: meta } — this design is kept already
     POST   /api/section-gallery/use { eventId, id }
                                                 -> { item: meta + { html, css, js } } with its pictures copied into the
                                                    event's files and their addresses in the markup and CSS changed
     DELETE /api/section-gallery?id=             -> { ok, removed }  by the person who saved it, an approver or an admin

   STORE  sectionGallery/{id} (SECTION_GALLERY_COL), id 'g' + 32 hex of the fingerprint
   FILES  section-gallery/{id}/{n}.{ext} (SECTION_GALLERY_PREFIX), public like every picture of a site;
          a site's copies: events/{eventId}/gallery/{id}/{n}.{ext}
   QA runs against its own collection and folder (SECTION_GALLERY_COL=qaSectionGallery, SECTION_GALLERY_PREFIX=
   qa-section-gallery/), so a test never shows in the team's gallery.

   Only this file reads or writes either, with the Admin SDK. Saving and adding need the site editor (Settings › Access:
   the 'design' section, lib/access-control.js); seeing the gallery needs only to be signed in.

     wire(helpers)  lib/api.js hands over its helpers on each call (portalHelpers) */
'use strict';
const crypto = require('crypto');
const pictures = require('./pictures');

var H = null;
function wire(helpers) { H = helpers; }

function col() { return process.env.SECTION_GALLERY_COL || 'sectionGallery'; }
function filesPrefix() { return process.env.SECTION_GALLERY_PREFIX || 'section-gallery/'; }

var ID_RE = /^g[0-9a-f]{32}$/;
var FAMILY_RE = /^(gen|[a-z0-9][a-z0-9-]{1,60})$/;
var TYPE_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$/;
var HTML_MAX = 400 * 1024, CSS_MAX = 200 * 1024, JS_MAX = 50 * 1024;
var BODY_MAX = 900 * 1024;
var PICTURES_MAX = 60;
var LIST_MAX = 300;
var COPY_AT_ONCE = 6;
var META = ['name', 'kind', 'family', 'srcType', 'records', 'pictures', 'size', 'savedAt', 'savedBy', 'savedByName', 'fromEvent', 'uses'];

function str(v) { return v == null ? '' : String(v); }
function clip(v, n) { return str(v).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n); }
function queryOf(req) { return new URLSearchParams(str(req.url).split('?')[1] || ''); }
function unwired(res) {
  try {
    res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ error: 'This part of the service is not available right now. Please try again shortly.', code: 'module-unavailable' }));
  } catch (e) { /* the socket is already gone */ }
}
function planned(status, message, extra) { var e = new Error(message); e.status = status; e.extra = extra || {}; return e; }
function escRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/* ---------- what is kept: the markup made safe to put on any site ----------
   The editor sends the section as the Developer zone shows it; a script on the page, a handler written into a tag or a
   javascript: link would run on every site the design is added to, so they never reach the gallery. The section's
   own script (Developer zone › JS) is kept apart and runs only on the published site, as it does on its own. */
function cleanHtml(html) {
  return str(html)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<script\b[^>]*>/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(\s(?:href|src|xlink:href|action|formaction)\s*=\s*["']?)\s*javascript:[^"'\s>]*/gi, '$1#')
    .trim();
}
/* one root element, a <section> or the like */
function oneRoot(html) {
  var m = /^<([a-zA-Z][a-zA-Z0-9-]*)\b/.exec(html);
  return !!m && !/^(script|style|template)$/i.test(m[1]);
}

/* ---------- the fingerprint: the design without its words, pictures, links and ids ---------- */
var SKIP_ATTRS = /\s(?:src|srcset|href|xlink:href|alt|title|aria-[a-z-]+|id|for|poster|content|data-rv-key|data-sec-name|data-rv-page|data-rv-placeholder|data-rv-id|data-rv-filled|data-rv-empty[a-z-]*|data-ai-[a-z-]+|data-rv-sample[a-z-]*|data-rv-media-v)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi;
/* The section's type (data-rv-section) names its CSS scope and nothing of its look: a design added to a site gets a
   type of its own there (editor-template-ui.js galleryElement), and is still the same design */
var TYPE_SCOPE = /data-rv-section\s*=\s*(?:"[^"]*"|'[^']*'|[^\s\]>]+)/g;
function designOf(text) {
  return str(text).replace(TYPE_SCOPE, 'data-rv-section="__SEC__"')
    .replace(/url\(\s*(["']?)[^"')]*\1\s*\)/g, 'url()').replace(/\s+/g, ' ').trim();
}
function fingerprint(family, type, html, css, js) {
  var shape = str(html)
    .replace(/>[^<]*</g, '><')                // the words
    .replace(SKIP_ATTRS, '')
    .replace(/\sstyle\s*=\s*"([^"]*)"/gi, function (m, s) { return ' style="' + designOf(s) + '"'; });
  var all = family + '\n' + designOf(shape) + '\n' + designOf(css) + '\n' + str(js).replace(/\s+/g, ' ').trim();
  return 'g' + crypto.createHash('sha256').update(all, 'utf8').digest('hex').slice(0, 32);
}

/* ---------- pictures ---------- */
var STORAGE_URL = /(?:https?:)?\/\/storage\.googleapis\.com\/[^\s"'()<>,]+(?:,[^\s"'()<>,]+)*/g;
function urlsIn(text) {
  var out = [];
  (str(text).match(STORAGE_URL) || []).forEach(function (u) { if (out.indexOf(u) === -1) out.push(u); });
  return out;
}
/* the object a public address names in this bucket ('' when it is not one of ours); `under`: a folder it must be in */
function objectOf(url, bucket, under) {
  var s = str(url).replace(/&amp;/g, '&');
  if (s.indexOf('//') === 0) s = 'https:' + s;
  var head = 'https://storage.googleapis.com/' + bucket + '/';
  if (s.indexOf(head) !== 0) return '';
  var rest = s.slice(head.length).split(/[?#]/)[0];
  try { rest = rest.split('/').map(decodeURIComponent).join('/'); } catch (e) { return ''; }
  if (rest.indexOf('..') !== -1) return '';
  return rest.indexOf(under) === 0 ? rest : '';
}
function extOf(path) {
  var m = /\.([a-z0-9]{2,5})$/i.exec(path);
  return m ? '.' + m[1].toLowerCase() : '';
}
/* Copies every picture of ours that `texts` name from under `from` to `toFolder`, and resolves the texts with the new
   addresses. A picture that is gone keeps its address (it shows nothing, as it did). -> { texts, copied, files } */
function copyPictures(fb, texts, from, toFolder) {
  var bucket = fb.bucket.name, found = [];
  texts.forEach(function (t) {
    urlsIn(t).forEach(function (u) {
      var path = objectOf(u, bucket, from);
      if (path && !found.some(function (f) { return f.url === u; })) found.push({ url: u, path: path });
    });
  });
  var paths = [];
  found.forEach(function (f) { if (paths.indexOf(f.path) === -1) paths.push(f.path); });
  if (paths.length > PICTURES_MAX) return Promise.reject(planned(413, 'This section has ' + paths.length + ' pictures; the gallery keeps sections of up to ' + PICTURES_MAX + '.', { code: 'too-many-pictures' }));
  var dest = {}, files = [];
  paths.forEach(function (p, i) { dest[p] = toFolder + (i + 1) + extOf(p); });
  var queue = paths.slice(), done = {};
  function next() {
    var p = queue.shift();
    if (!p) return Promise.resolve();
    var target = fb.bucket.file(dest[p]);
    return fb.bucket.file(p).copy(target).then(function () { return target.makePublic(); }).then(function () {
      done[p] = true; files.push(dest[p]);
    }, function (err) {
      if (!(err && (err.code === 404 || /No such object/i.test(err.message || '')))) throw err;
    }).then(next);
  }
  var workers = [];
  for (var i = 0; i < Math.min(COPY_AT_ONCE, paths.length); i++) workers.push(next());
  return Promise.all(workers).then(function () {
    var out = texts.map(function (t) {
      var s = str(t);
      found.forEach(function (f) {
        if (!done[f.path]) return;
        s = s.split(f.url).join(pictures.publicUrl(bucket, dest[f.path]));
      });
      return s;
    });
    return { texts: out, copied: files.length, files: files };
  });
}

/* ---------- reading ---------- */
function metaOf(id, d, decoded) {
  var m = { id: id };
  META.forEach(function (k) { if (d[k] !== undefined) m[k] = d[k]; });
  m.canDelete = canDelete(d, decoded);
  return m;
}
function canDelete(d, decoded) {
  var access = decoded && decoded.access, me = str(decoded && decoded.email).toLowerCase();
  if (access && (access.role === 'admin' || access.role === 'approver')) return true;
  return !!me && str(d.savedBy).toLowerCase() === me;
}
function actorName(decoded) {
  return clip(decoded && (decoded.name || decoded.email), 80);
}

function handleList(req, res) {
  if (!H) return unwired(res);
  H.withAdmin(req, res, function (fb, decoded) {
    /* the list never reads a section's markup: select() fetches only what is listed */
    var q = fb.db.collection(col()).orderBy('savedAt', 'desc').limit(LIST_MAX);
    q.select.apply(q, META).get().then(function (snap) {
      var items = [];
      snap.forEach(function (doc) { if (ID_RE.test(doc.id)) items.push(metaOf(doc.id, doc.data() || {}, decoded)); });
      H.sendJson(res, 200, { items: items });
    }).catch(function (err) { H.sendFailure(res, 'section gallery list', err, 'The template gallery could not be read. Please try again.'); });
  });
}

function handleGet(req, res) {
  if (!H) return unwired(res);
  H.withAdmin(req, res, function (fb, decoded) {
    var id = queryOf(req).get('id') || '';
    if (!ID_RE.test(id)) return H.sendJson(res, 400, { error: 'That is not a section of the gallery.', code: 'bad-id' });
    fb.db.collection(col()).doc(id).get().then(function (snap) {
      if (!snap.exists) return H.sendJson(res, 404, { error: 'This section is no longer in the gallery.', code: 'gone' });
      var d = snap.data() || {}, item = metaOf(id, d, decoded);
      item.html = str(d.html); item.css = str(d.css); item.js = str(d.js);
      H.sendJson(res, 200, { item: item });
    }).catch(function (err) { H.sendFailure(res, 'section gallery item', err, 'This section could not be read. Please try again.'); });
  });
}

/* ---------- POST /api/section-gallery ---------- */
function handleSave(req, res) {
  if (!H) return unwired(res);
  H.withAdminBody(req, res, BODY_MAX, function (fb, decoded, body) {
    var eventId = str(body.eventId).trim();
    if (!H.isEventId(eventId)) return H.sendJson(res, 400, { error: 'Invalid eventId.' });
    var name = clip(body.name, 80);
    if (!name) return H.sendJson(res, 400, { error: 'Give the section a name for the gallery.', code: 'no-name' });
    var family = str(body.family).trim(), type = str(body.srcType).trim();
    if (!FAMILY_RE.test(family)) return H.sendJson(res, 400, { error: 'This site’s design cannot share its sections yet.', code: 'bad-family' });
    if (!TYPE_RE.test(type)) return H.sendJson(res, 400, { error: 'The section did not arrive whole. Please try again.', code: 'bad-section' });
    var html = cleanHtml(body.html), css = str(body.css).trim(), js = str(body.js).trim();
    if (!html || !oneRoot(html)) return H.sendJson(res, 400, { error: 'The section did not arrive whole. Please try again.', code: 'bad-section' });
    if (Buffer.byteLength(html, 'utf8') > HTML_MAX || Buffer.byteLength(css, 'utf8') > CSS_MAX || Buffer.byteLength(js, 'utf8') > JS_MAX) {
      return H.sendJson(res, 413, { error: 'This section is too large for the gallery. Sections with pictures written into the page itself (rather than uploaded) are the usual cause.', code: 'too-large' });
    }
    if (/<\/style/i.test(css)) return H.sendJson(res, 400, { error: 'The section’s CSS cannot close its own style block.', code: 'bad-css' });
    var id = fingerprint(family, type, html, css, js), ref = fb.db.collection(col()).doc(id), ev = null;
    H.eventDocRef(fb, eventId).get().then(function (snap) {
      if (!snap.exists) throw planned(404, 'No event found for "' + eventId + '".');
      ev = snap.data() || {};
      return ref.get();
    }).then(function (snap) {
      if (snap.exists) throw planned(409, 'This design is in the gallery already.', { code: 'duplicate', existing: metaOf(id, snap.data() || {}, decoded) });
      return copyPictures(fb, [html, css], 'events/', filesPrefix() + id + '/');
    }).then(function (copied) {
      var now = new Date().toISOString();
      var data = {
        name: name, kind: clip(body.kind, 60) || name, family: family, srcType: type, records: body.records === true,
        html: copied.texts[0], css: copied.texts[1], js: js, pictures: copied.copied,
        size: Buffer.byteLength(copied.texts[0] + copied.texts[1] + js, 'utf8'),
        savedAt: now, savedBy: str(decoded && decoded.email).toLowerCase(), savedByName: actorName(decoded),
        fromEvent: { id: eventId, name: clip(ev.name, 120), portal: clip(ev.portal, 60) }, uses: 0
      };
      return ref.create(data).then(function () { return data; }, function (err) {
        /* saved by someone else in the same moment: theirs is kept, ours goes with its copies */
        return fb.bucket.deleteFiles({ prefix: filesPrefix() + id + '/' }).catch(function () {}).then(function () {
          if (err && (err.code === 6 || /already exists/i.test(err.message || ''))) {
            return ref.get().then(function (s) { throw planned(409, 'This design is in the gallery already.', { code: 'duplicate', existing: metaOf(id, s.data() || {}, decoded) }); });
          }
          throw err;
        });
      });
    }).then(function (data) {
      if (H.logActivity) H.logActivity(fb, eventId, decoded, 'site-designed', 'Section “' + name + '” added to the template gallery', { area: 'design' });
      H.sendJson(res, 201, { ok: true, item: metaOf(id, data, decoded) });
    }).catch(function (err) {
      if (err && err.status) return H.sendJson(res, err.status, Object.assign({ error: err.message }, err.extra || {}));
      H.sendFailure(res, 'section gallery save', err, 'The section could not be added to the gallery. Please try again.');
    });
  });
}

/* ---------- POST /api/section-gallery/use ---------- */
function handleUse(req, res) {
  if (!H) return unwired(res);
  H.withAdminBody(req, res, H.BODY_LIMITS ? H.BODY_LIMITS.small : 64 * 1024, function (fb, decoded, body) {
    var eventId = str(body.eventId).trim(), id = str(body.id).trim();
    if (!H.isEventId(eventId)) return H.sendJson(res, 400, { error: 'Invalid eventId.' });
    if (!ID_RE.test(id)) return H.sendJson(res, 400, { error: 'That is not a section of the gallery.', code: 'bad-id' });
    var ref = fb.db.collection(col()).doc(id), d = null;
    H.eventDocRef(fb, eventId).get().then(function (snap) {
      if (!snap.exists) throw planned(404, 'No event found for "' + eventId + '".');
      return ref.get();
    }).then(function (snap) {
      if (!snap.exists) throw planned(404, 'This section is no longer in the gallery.', { code: 'gone' });
      d = snap.data() || {};
      return copyPictures(fb, [str(d.html), str(d.css)], filesPrefix() + id + '/', 'events/' + eventId + '/gallery/' + id + '/');
    }).then(function (copied) {
      ref.update({ uses: (+d.uses || 0) + 1, lastUsedAt: new Date().toISOString() }).catch(function () { /* a count, never the reason it fails */ });
      var item = metaOf(id, d, decoded);
      item.html = copied.texts[0]; item.css = copied.texts[1]; item.js = str(d.js);
      H.sendJson(res, 200, { item: item });
    }).catch(function (err) {
      if (err && err.status) return H.sendJson(res, err.status, Object.assign({ error: err.message }, err.extra || {}));
      H.sendFailure(res, 'section gallery use', err, 'The section could not be added. Please try again.');
    });
  });
}

/* ---------- DELETE /api/section-gallery?id= ---------- */
function handleDelete(req, res) {
  if (!H) return unwired(res);
  H.withAdmin(req, res, function (fb, decoded) {
    var id = queryOf(req).get('id') || '';
    if (!ID_RE.test(id)) return H.sendJson(res, 400, { error: 'That is not a section of the gallery.', code: 'bad-id' });
    var ref = fb.db.collection(col()).doc(id);
    ref.get().then(function (snap) {
      if (!snap.exists) return { removed: false };
      if (!canDelete(snap.data() || {}, decoded)) throw planned(403, 'Only the person who added this section, an approver or an admin can take it out of the gallery.', { code: 'not-yours' });
      /* the document first: once it is gone nobody can add the design, so its pictures are never copied mid-delete */
      return ref.delete().then(function () {
        return fb.bucket.deleteFiles({ prefix: filesPrefix() + id + '/' }).catch(function (err) {
          console.error('section-gallery: the pictures of ' + id + ' were not removed — ' + (err && err.message));
        });
      }).then(function () { return { removed: true }; });
    }).then(function (r) {
      H.sendJson(res, 200, { ok: true, removed: r.removed });
    }).catch(function (err) {
      if (err && err.status) return H.sendJson(res, err.status, Object.assign({ error: err.message }, err.extra || {}));
      H.sendFailure(res, 'section gallery delete', err, 'The section could not be taken out of the gallery. Please try again.');
    });
  });
}

module.exports = {
  wire: wire, handleList: handleList, handleGet: handleGet, handleSave: handleSave, handleUse: handleUse, handleDelete: handleDelete,
  _test: { cleanHtml: cleanHtml, oneRoot: oneRoot, fingerprint: fingerprint, urlsIn: urlsIn, objectOf: objectOf, copyPictures: copyPictures, canDelete: canDelete, col: col, filesPrefix: filesPrefix }
};
