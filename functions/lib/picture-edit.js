/* lib/picture-edit.js — W3 "edit the picture you point at" (builder C): "warmer", "brighter", "crop it", "wider",
   "remove the people", "fill the blank part" change THAT picture (exactly and free with sharp where it can, else
   through the picture model with the picture as its input). STEP 0 STUB: every edit answers 'not-supported', and the
   runner then makes a new picture as it does today.

     run(job, ctx)        -> Promise<{ bytes, type, width, height, how: 'sharp'|'model', line } | { code, status }>
                             never rejects. code 'not-supported': the runner makes a new picture instead (today).
                             job: the stored job (mode 'edit', editOf { url }, change, changeKind, frame, aspect)
                             ctx: { fb, eventId, deadlineAt, record (usage), switches, refs, review (the Critic's, for
                                    a repair: builder B calls run() with { change: review.repair }) }
     classify(changeKind) -> 'sharp' | 'model' | '' (builder C)
     sharpOps(bytes, job) -> Promise<null> (builder C: brightness, warmth, saturation, crop, re-fit)
     extendCanvas(bytes, ratio) -> Promise<null> (builder C: a wider canvas whose margins the model fills) */
'use strict';

var NOT_SUPPORTED = { code: 'not-supported', status: 501 };
function run(job, ctx) { return Promise.resolve(Object.assign({}, NOT_SUPPORTED)); }
function classify(changeKind) { return ''; }
function sharpOps(bytes, job) { return Promise.resolve(null); }
function extendCanvas(bytes, ratio) { return Promise.resolve(null); }

module.exports = { NOT_SUPPORTED: NOT_SUPPORTED, run: run, classify: classify, sharpOps: sharpOps, extendCanvas: extendCanvas };
