/* lib/picture-fit.js — W4 "fit check" (builder A): a placed picture whose frame is not its shape (a later rework drew
   another frame, a layout that would not take the picture's shape) is cut again to that frame from the picture as it
   was first made (job.original, kept by the runner; else the stored picture itself), around its focal point when one
   is known (job.focus), with sharp and no AI. The new cut is stored beside the first, and the editor swaps it in inside
   the same change, so the change's Undo takes it back. Nothing is cut for a frame within 5% of the picture's shape.

     FIT_TOLERANCE
     fitStep(deps, o) -> Promise<{ status, body }>   never rejects
                         POST /api/chat-edit { step: 'fit', turnId, job, frame: 'w:h' }
                         o: { fb, eventId, uid, turnRef, job (k), frame, decoded }
                         200 { url, size, frame, k } the new cut (and job.fit = { frame, url, size, at } on the job)
                         200 { url, size, frame, k, same: true } the picture already has that shape: nothing stored
                         4xx { error, code, retryable: false } in plain words, nothing changed */
'use strict';

var pictureJob = require('./picture-job');
var pictureShape = require('./picture-shape');
var pictures = require('./pictures');

var FIT_TOLERANCE = Math.log(1.05);
var EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

function fail(status, code, words) { return { status: status, body: { error: words + ' Nothing on your site changed.', code: code, retryable: false } }; }
function sniff(buf) {
  if (!buf || buf.length < 12) return '';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return '';
}
/* the Storage path of one of this event's own made pictures: never another event's, never a logo or a document */
function ownPath(url, bucket, eventId) {
  var pre = 'https://storage.googleapis.com/' + bucket + '/';
  url = String(url || '').replace(/\?v=\d+$/, '');
  if (url.indexOf(pre) !== 0) return '';
  var path = url.slice(pre.length);
  return new RegExp('^events/' + String(eventId).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/generated/[A-Za-z0-9._-]+\\.(?:png|jpe?g|webp)$').test(path) && !/logo/i.test(path) ? path : '';
}
function sizeOf(s) { var m = /^(\d{1,5})x(\d{1,5})$/.exec(String(s || '')); return m ? { w: +m[1], h: +m[2] } : null; }

function fitStep(deps, o) {
  deps = deps || {};
  o = o || {};
  var fb = o.fb, eventId = String(o.eventId || ''), turnRef = o.turnRef;
  var k = o.job == null ? 0 : parseInt(o.job, 10);
  var frame = pictureShape.frameFromText(o.frame);
  if (!fb || !fb.db || !fb.bucket || !turnRef || !eventId) return Promise.resolve(fail(400, 'bad-request', 'That picture could not be fitted again.'));
  if (!(k >= 0 && k < pictureJob.MAX_JOBS)) return Promise.resolve(fail(404, 'chat-picture-none', 'There is no such picture to fit again.'));
  if (!frame) return Promise.resolve(fail(400, 'bad-frame', 'The frame\'s size was not given, so the picture was not fitted again.'));
  var ratio = frame.w / frame.h;
  return Promise.resolve().then(function () { return turnRef.get(); }).then(function (snap) {
    var turn = snap && snap.exists ? snap.data() : null;
    var job = pictureJob.jobOf(turn, k);
    if (!job || job.state !== 'made' || !job.url) return fail(404, 'chat-picture-none', 'There is no picture made for that place to fit again.');
    if (job.held === true) return fail(409, 'chat-picture-held', 'That picture was kept off the page, so it was not fitted.');
    var have = sizeOf(job.size);
    if (have && Math.abs(Math.log((have.w / have.h) / ratio)) <= FIT_TOLERANCE) return { status: 200, body: { url: job.url, size: job.size, frame: pictureShape.frameText(frame), k: k, same: true } };
    var src = ownPath(job.original, fb.bucket.name, eventId) || ownPath(job.url, fb.bucket.name, eventId);
    if (!src) return fail(400, 'not-own', 'That picture is not one of this event\'s own, so it was not fitted again.');
    return Promise.resolve().then(function () { return fb.bucket.file(src).download(); }).then(function (got) {
      var bytes = got && got[0];
      var type = sniff(bytes);
      if (!type) return fail(422, 'chat-picture-unreadable', 'That picture could not be read, so it was not fitted again.');
      return pictureShape.crop(bytes, ratio, { focus: pictureJob.focusOf(job.focus), label: 'the fit of ' + eventId + '/' + (turnRef.id || '') + '/' + k }).then(function (cut) {
        if (!cut || !cut.cropped) return fail(422, 'chat-picture-not-cut', 'That picture could not be cut to its frame, so it was left as it is.');
        var outType = sniff(cut.bytes) || type;
        var path = src.replace(/\.(png|jpe?g|webp)$/, '') + '-fit' + frame.w + 'x' + frame.h + '.' + EXT[outType];
        var url = 'https://storage.googleapis.com/' + fb.bucket.name + '/' + path, file = fb.bucket.file(path), size = cut.width && cut.height ? cut.width + 'x' + cut.height : '';
        return Promise.resolve().then(function () { return file.save(cut.bytes, { metadata: { contentType: outType, cacheControl: pictures.CACHE } }); })
          .then(function () { return file.makePublic(); })
          .then(function () {
            return fb.db.runTransaction(function (tx) {
              return tx.get(turnRef).then(function (s2) {
                var cur = s2 && s2.exists ? s2.data() : null;
                if (!pictureJob.jobOf(cur, k)) return;
                pictureJob.writeJob(tx, turnRef, k, { fit: { frame: pictureShape.frameText(frame), url: url, size: size, at: new Date().toISOString() } }, cur, { updatedAt: new Date().toISOString() });
              });
            }).catch(function (err) { console.error('picture-fit: the new cut of ' + eventId + ' was not recorded on its turn — ' + (err && err.message)); });
          })
          .then(function () { return { status: 200, body: { url: url, size: size, frame: pictureShape.frameText(frame), k: k } }; });
      });
    }, function (err) {
      console.error('picture-fit: the picture of ' + eventId + ' could not be read — ' + (err && err.message));
      return fail(502, 'chat-picture-unreadable', 'That picture could not be read just now, so it was not fitted again.');
    });
  }).catch(function (err) {
    console.error('picture-fit: the fit of ' + eventId + ' failed — ' + (err && err.message));
    return { status: 500, body: { error: 'That picture could not be fitted again. Nothing on your site changed — try again.', code: 'chat-step-failed', retryable: true } };
  });
}

module.exports = { fitStep: fitStep, FIT_TOLERANCE: FIT_TOLERANCE, ownPath: ownPath };
