/* lib/picture-fit.js — W4 "fit check" (builder A): a placed picture whose frame changed (a later rework, a phone
   frame) is cut again from its kept original to the new frame, with sharp and no AI, Undo-able. STEP 0 STUB: the
   step answers that it cannot be done yet, and changes nothing.

     fitStep(deps, o) -> Promise<{ status, body }>   POST /api/chat-edit { step: 'fit', turnId, job, frame: 'w:h' }
                         o: { fb, eventId, uid, turnRef, job (k), frame, decoded }
                         builder A: { url, size, focus } of the new cut, stored beside the original; the job keeps
                         `original` (builder B stores it) and its focus (picture-job.focusOf) */
'use strict';

function fitStep(deps, o) {
  return Promise.resolve({ status: 501, body: { error: 'Fitting a picture again is not available yet. Nothing on your site changed.', code: 'not-supported', retryable: false } });
}

module.exports = { fitStep: fitStep };
