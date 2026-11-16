/* lib/picture-critic.js — W2 "the Critic" (builder B): a look at each picture made (people, words, logos with boxes,
   borders, artefacts, the place, a famous likeness, Indian people with women where people are allowed, the brief, the
   tone, the focus), and the one table that decides what happens next. STEP 0 STUB: review() is today's Haiku check
   (chatPicture.checkPicture + refusedFor) and decide() is today's runner (a stronger remake, the strictest third try,
   then kept off the page), so with the `critic` switch off every picture is made, checked and held exactly as before.

     review(pic, job, ctx)  -> Promise<review>   never rejects
                               pic: { bytes, type, width, height }; job: the stored job (its peopleRule …)
                               ctx: { rule, eventId, deadlineAt, record (usage of the look), switches, caller,
                                      before (the picture before an edit, W3), refs }
                               review: picture-job.reviewOf's shape — { verdict, source, flags: ['people'|'text'|'logos'
                                       |…], found: { people, text, logos } | {} (the stub: the check's answer, null when
                                       it could not look), scores, why, repair? }
     decide(review, t)      -> { action: 'keep' } | { action: 'remake', line } | { action: 'hold', why }
                               (builder B adds { action: 'trim' } and { action: 'repair', change })
                               t: { calls (paid picture calls so far), made (pictures made), maxTries, timeLeftMs,
                                    retryNeedsMs, switches }
                               why: 'tries' | 'time' (the runner adds 'limit' and 'failed' itself)
     trimBorders(bytes, o)  -> Promise<null> (builder B: { bytes, width, height, trimmed } with flat edge bands cut)
     framePreviews(pic, job) -> Promise<[]> (builder B: the picture cut to its desktop and phone frames) */
'use strict';

/* chat-picture.js requires this file, so it is read when first used, never at load */
function cp() { return require('./chat-picture'); }

function review(pic, job, ctx) {
  ctx = ctx || {};
  var rule = ctx.rule || 'none';
  return Promise.resolve().then(function () {
    return cp().checkPicture(pic && pic.bytes, pic && pic.type, rule, { eventId: ctx.eventId, deadlineAt: ctx.deadlineAt, record: ctx.record });
  }).then(function (found) {
    var flags = cp().refusedFor(found, rule);
    return { verdict: flags.length ? 'remake' : 'ok', source: 'check', flags: flags, found: found, scores: {}, why: '' };
  }, function (err) {
    /* checkPicture never rejects; this is a fault of this file: the picture goes on unchecked, as a failed look does */
    console.error('picture-critic: the look at the picture of ' + ctx.eventId + ' failed — ' + (err && err.message));
    return { verdict: 'ok', source: 'check', flags: [], found: null, scores: {}, why: '' };
  });
}

function decide(rev, t) {
  t = t || {};
  var flags = rev && Array.isArray(rev.flags) ? rev.flags : [];
  if (!flags.length) return { action: 'keep' };
  var maxTries = t.maxTries || cp().MAX_TRIES, calls = t.calls || 1;
  if (calls >= maxTries) return { action: 'hold', why: 'tries' };
  if (!(t.timeLeftMs >= (t.retryNeedsMs == null ? cp().RETRY_NEEDS_MS : t.retryNeedsMs))) return { action: 'hold', why: 'time' };
  return { action: 'remake', line: cp().againLine(flags) + (calls + 1 >= maxTries ? ' ' + cp().strictLine(flags) : '') };
}

function trimBorders(bytes, o) { return Promise.resolve(null); }
function framePreviews(pic, job) { return Promise.resolve([]); }

module.exports = { review: review, decide: decide, trimBorders: trimBorders, framePreviews: framePreviews };
