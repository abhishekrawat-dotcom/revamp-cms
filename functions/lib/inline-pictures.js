/* Pictures that arrive as image text — a data: URL — are stored as files, never inside a record.

   WHY (launch check 13 Nov 2026, CON-052/054/055). The console used to crop a speaker's photo and shrink a company or
   sponsor logo on a canvas and save the result, as base64 text, in the speaker or partner document itself. Every read
   of Speakers or Sponsors then carried every picture whole, the site drew them as <img src="data:…">, a picture got no
   WebP copies and no caching, and a document near Firestore's 1 MiB limit failed with a database error. The console
   now uploads each picture first (RevampCore.storePicture) and saves its address. This module is the server's side
   of the same rule, for anything that still sends image text — a console page opened before the change, a library
   entry that holds an old inline picture, a direct API call:
     - a new data: picture is stored as a file, exactly as POST /api/event/upload stores one (lib/api-events.js
       storeImageFile: the same folder, the same unique name, the same WebP copies), and the record keeps its address;
     - one that is not a picture this product keeps (not an image by its bytes, over 8 MB, an SVG that could run
       something, not base64) is refused with a sentence that says why — nothing is stored;
     - a value sent back exactly as it is stored is left alone: records saved before the change keep their inline
       pictures until the owner decides to move them (tools/migrate-inline-pictures.js), and saving such a record for
       a typo in a name must not move its photo or fail.

     isInline(v)                              -> true for text that is a data: URL
     decode(v, label)                         -> { buffer, contentType } | { status, error }
     store(fb, folder, v, o)                  -> Promise<{ url, path, … }>; rejects (status, body) when it is not usable
                                                 o: { label, fileName, actor }
     storeFields(fb, body, fields, stored, o) -> Promise<[field…]>  each field of `body` named in `fields`
                                                 ({ photoUrl: 'events/<id>/speakers', … }: field -> folder) that holds
                                                 a data: URL different from `stored`'s is replaced by its file's address
     changedInline(body, fields, stored)      -> [field…] the fields storeFields would store
   Rejections carry `status` and `body` ({ error, field, code: 'picture-not-usable' }), as lib/api.js sendFailure
   answers them, and `extra` for lib/api-events.js fail(). Node 20, CommonJS. */
'use strict';

var DATA_URL = /^\s*data:([^,]*?),([\s\S]*)$/i;
/* what a picture's file is named after, so a person reading the bucket can tell the files apart (and a logo's
   WebP copies are made without loss: lib/pictures.js isLogoPath) */
var LABEL_NAME = { photoUrl: 'photo', logoUrl: 'logo', imageUrl: 'picture', photo: 'photo', logo: 'logo' };

function shared() { return require('./api-events')._shared; }

function isInline(v) { return typeof v === 'string' && /^\s*data:/i.test(v); }

function refusal(status, message, field) {
  var err = new Error(message);
  err.status = status;
  err.body = { error: message, code: 'picture-not-usable' };
  if (field) err.body.field = field;
  err.extra = { code: 'picture-not-usable', field: field || undefined };
  return err;
}

/* -> { buffer, contentType } | { status, error } */
function decode(v, label) {
  label = label || 'The picture';
  var m = DATA_URL.exec(String(v == null ? '' : v));
  if (!m) return { status: 400, error: label + ' is not a picture.' };
  var meta = m[1].toLowerCase().split(';').map(function (x) { return x.trim(); });
  if (meta.indexOf('base64') === -1) return { status: 415, error: label + ' is not a picture we can use. Upload a PNG, JPG, WebP, GIF or SVG file.' };
  var b64 = m[2].replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+\/]*={0,2}$/.test(b64)) return { status: 400, error: label + ' did not arrive intact. Please add it again.' };
  var buffer = Buffer.from(b64, 'base64');
  var S = shared();
  var problem = S.imageProblem(buffer, label);
  if (problem) return { status: problem.status, error: problem.status === 400 ? label + ' is empty. Choose another picture.' : problem.error };
  return { buffer: buffer, contentType: S.sniffImage(buffer) };
}

/* -> Promise<{ url, path, contentType, size, width?, height? }> */
function store(fb, folder, v, o) {
  o = o || {};
  var d = decode(v, o.label);
  if (d.error) return Promise.reject(refusal(d.status, d.error, o.field));
  return shared().storeImageFile(fb, folder, d.buffer, d.contentType, o.fileName || 'picture', o.actor || '', {});
}

function sameValue(a, b) { return a === b || JSON.stringify(a) === JSON.stringify(b); }

function changedInline(body, fields, stored) {
  return Object.keys(fields || {}).filter(function (f) {
    if (!body || !Object.prototype.hasOwnProperty.call(body, f) || !isInline(body[f])) return false;
    return !(stored && Object.prototype.hasOwnProperty.call(stored, f) && sameValue(stored[f], body[f]));
  });
}

/* "Naven Singh" + "photoUrl" -> "naven-singh-photo" (the stored name keeps letters, digits and hyphens only) */
function fileNameFor(body, field) {
  body = body || {};
  var who = String((field === 'logoUrl' && body.comp) || body.name || body.caption || '').slice(0, 30);
  return (who ? who + ' ' : '') + (LABEL_NAME[field] || 'picture');
}

/* o: { labels: { field: 'The photo' }, actor } -> Promise<[field…]> */
function storeFields(fb, body, fields, stored, o) {
  o = o || {};
  var todo = changedInline(body, fields, stored);
  if (!todo.length) return Promise.resolve([]);
  /* every one is checked before any is stored, so a refused second picture leaves no file behind for the first */
  for (var i = 0; i < todo.length; i++) {
    var label = (o.labels && o.labels[todo[i]]) || 'The picture';
    var d = decode(body[todo[i]], label);
    if (d.error) return Promise.reject(refusal(d.status, d.error, todo[i]));
  }
  return Promise.all(todo.map(function (f) {
    return store(fb, fields[f], body[f], { label: (o.labels && o.labels[f]) || 'The picture', field: f, fileName: fileNameFor(body, f), actor: o.actor })
      .then(function (up) { body[f] = up.url; return f; });
  }));
}

module.exports = { isInline: isInline, decode: decode, store: store, storeFields: storeFields, changedInline: changedInline };
