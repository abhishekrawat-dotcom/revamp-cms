/* lib/picture-refs.js — W3 "references" (builder C): the pictures the picture model may be shown with a job (at most
   picture-job.MAX_REFS): the owner's attachments, pictures taken out of a document, the site's own pictures (style),
   the job's current picture (an edit's base) and the previous edition's (style only, with the near-copy guard).
   This event's own Storage only. STEP 0 STUB: no reference is ever loaded, so the picture model is shown nothing, as
   today.

     load(job, ctx)          -> Promise<[{ mimeType, data (base64), label, kind, use, id }]>  never rejects; [] = none
                                ctx: { fb, eventId, ownPrefix, switches, deadlineAt }
     ownOnly(url, ctx)       -> '' (builder C: the Storage path when the address is this event's own picture)
     dHash(bytes)            -> Promise<null> (builder C: a 64-bit difference hash, as a 16-hex string)
     nearCopy(hashA, hashB)  -> false (builder C: Hamming distance <= COPY_DISTANCE) */
'use strict';

var COPY_DISTANCE = 10;                 // of 64 bits: closer than this is a copy (plan §6.5)
function load(job, ctx) { return Promise.resolve([]); }
function ownOnly(url, ctx) { return ''; }
function dHash(bytes) { return Promise.resolve(null); }
function nearCopy(a, b) { return false; }

module.exports = { COPY_DISTANCE: COPY_DISTANCE, load: load, ownOnly: ownOnly, dHash: dHash, nearCopy: nearCopy };
