/* lib/picture-brief.js — W2 "the Director" (builder B): one call per plan writes a brief for each new picture
   (scene, composition, palette in colour names, light, medium, place cues, not-this, people line), and the prompt
   the picture model gets is built from it. STEP 0 STUB: no brief is written, so the runner uses today's
   chatPicture.promptFor, and the brief step answers that there is nothing to do.

     writeBriefs(jobs, ctx)          -> Promise<null | [brief per job, picture-job.briefOf's shape]>   never rejects
                                        ctx: { eventId, eventData, sections, ownerWords, ledger, styleCard, switches,
                                               deadlineAt, record (usage) }
     promptFromBrief(brief, job, ctx) -> '' (builder B: the picture model's prompt; '' = use promptFor)
     writeStyleCard(ctx)             -> Promise<null> (builder B: events/<id>.pictureStyle)
     briefStep(deps, o)              -> Promise<{ status, body }>  POST /api/chat-edit { step: 'brief', turnId }:
                                        writes `brief` on every new job of the turn in one call (builder B); the stub
                                        answers 200 { briefs: 0 } and writes nothing */
'use strict';

function writeBriefs(jobs, ctx) { return Promise.resolve(null); }
function promptFromBrief(brief, job, ctx) { return ''; }
function writeStyleCard(ctx) { return Promise.resolve(null); }
function briefStep(deps, o) { return Promise.resolve({ status: 200, body: { briefs: 0 } }); }

module.exports = { writeBriefs: writeBriefs, promptFromBrief: promptFromBrief, writeStyleCard: writeStyleCard, briefStep: briefStep };
