/* node functions/lib/picture-fit.test.js — a placed picture cut again to the frame it is in (lib/picture-fit.js, W4,
   builder A, 16 Nov 2026): from the picture as first made, with sharp and no AI, stored beside it, recorded on its job;
   nothing for a picture already in its frame's shape, a held one, another event's, or a frame not given. Real sharp,
   in-memory Storage and Firestore. */
'use strict';
var failures = [], checks = 0;
function check(cond, label, detail) { checks++; if (!cond) failures.push(label + (detail !== undefined ? '\n      ' + JSON.stringify(detail).slice(0, 400) : '')); }
function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
var sharp = require('sharp');
var fit = require('./picture-fit');

function fakeFb() {
  var docs = {}, files = {};
  function ref(p) { return { id: p.split('/').pop(), path: p, get: function () { return Promise.resolve({ exists: !!docs[p], data: function () { return clone(docs[p]); } }); } }; }
  return { docs: docs, files: files,
    db: { runTransaction: function (fn) {
      var w = [];
      var tx = { get: function (r) { return r.get(); }, update: function (r, data) { w.push(function () { Object.keys(data).forEach(function (k) { docs[r.path][k] = clone(data[k]); }); }); return tx; } };
      return Promise.resolve(fn(tx)).then(function (v) { w.forEach(function (f) { f(); }); return v; });
    } },
    bucket: { name: 'test-bucket', file: function (path) { return {
      download: function () { return files[path] ? Promise.resolve([files[path].bytes]) : Promise.reject(new Error('No such object')); },
      save: function (bytes, o) { files[path] = { bytes: bytes, type: o && o.metadata && o.metadata.contentType }; return Promise.resolve(); },
      makePublic: function () { files[path].public = true; return Promise.resolve(); } }; } },
    ref: ref };
}
var EV = 'qa-paia-fit', T = 'events/' + EV + '/aiChats/u/turns/TURNFIT0001';
var URL0 = 'https://storage.googleapis.com/test-bucket/events/' + EV + '/generated/20261116-chat-place-TURNFIT0.png';

(async function () {
  var fb = fakeFb();
  var png = await sharp({ create: { width: 1536, height: 672, channels: 3, background: { r: 200, g: 40, b: 40 } } }).png().toBuffer();
  fb.files['events/' + EV + '/generated/20261116-chat-place-TURNFIT0.png'] = { bytes: png };
  fb.docs[T] = { newPicture: { n: 1, state: 'made', sectionId: 'kdp', url: URL0, size: '1536x672', storagePath: 'x' } };
  var o = { fb: fb, eventId: EV, uid: 'u', turnRef: fb.ref(T), job: 0, frame: '1200:900' };

  var r = await fit.fitStep({}, o);
  check(r.status === 200 && /-fit1200x900\.png$/.test(r.body.url) && r.body.size && r.body.frame === '1200:900', 'a 21:9 picture in a 4:3 frame: cut again to 4:3 and stored beside it', r);
  var stored = fb.files['events/' + EV + '/generated/20261116-chat-place-TURNFIT0-fit1200x900.png'];
  var meta = stored ? await sharp(stored.bytes).metadata() : {};
  check(stored && stored.public && Math.abs(meta.width / meta.height - 4 / 3) < 0.01 && stored.type === 'image/png', '… the new cut is 4:3, public, still a PNG', meta);
  check(fb.docs[T].newPicture.fit && fb.docs[T].newPicture.fit.url === r.body.url && fb.docs[T].newPicture.url === URL0, '… recorded on its job, the first picture kept', fb.docs[T].newPicture);

  var same = await fit.fitStep({}, Object.assign({}, o, { frame: '1536:672' }));
  check(same.status === 200 && same.body.same === true && same.body.url === URL0, 'a frame of its own shape: nothing cut', same);
  var bad = await fit.fitStep({}, Object.assign({}, o, { frame: 'tall' }));
  check(bad.status === 400 && /Nothing on your site changed/.test(bad.body.error) && !/\bET\b/.test(bad.body.error), 'no frame: said in plain words', bad);
  fb.docs[T].newPicture.held = true;
  var held = await fit.fitStep({}, o);
  check(held.status === 409, 'a held picture is never fitted (it is not on the page)', held);
  delete fb.docs[T].newPicture.held;
  fb.docs[T].newPicture.url = 'https://storage.googleapis.com/test-bucket/events/other-event/generated/x.png';
  fb.docs[T].newPicture.size = '';
  var other = await fit.fitStep({}, o);
  check(other.status === 400 && other.body.code === 'not-own', 'another event\'s picture is never read', other);
  fb.docs[T].newPicture.url = URL0;
  fb.docs[T].newPicture.original = URL0;
  check((await fit.fitStep({}, Object.assign({}, o, { job: 2 }))).status === 404 && (await fit.fitStep({}, Object.assign({}, o, { job: 9 }))).status === 404, 'a job the turn does not have: none');
  check((await fit.fitStep({}, {})).status === 400, 'nothing given: refused');
  check(fit.ownPath(URL0, 'test-bucket', EV) && !fit.ownPath(URL0.replace('generated', 'logos'), 'test-bucket', EV) && !fit.ownPath(URL0.replace('chat-place', 'logo-unit'), 'test-bucket', EV),
    'only this event\'s own made pictures, never a logo');
})().then(function () {
  if (failures.length) { console.log('picture-fit: ' + failures.length + ' of ' + checks + ' checks FAILED'); failures.forEach(function (f) { console.log('  - ' + f); }); process.exit(1); }
  console.log('picture-fit: all ' + checks + ' checks passed');
}, function (err) { console.log('picture-fit: the test stopped — ' + (err && err.stack)); process.exit(1); });
