/* lib/picture-plan.js — W1 "plan and act" (builder A): what pictures a message asks for, checked, as up to
   picture-job.MAX_JOBS jobs. STEP 0 STUB: with the `plan` switch off (and until builder A fills it) this is exactly
   today's chatPicture.planAsk on the first entry, so the chat behaves as it did.

     planPictures(entries, ctx) -> planAsk's answer ({ ask, reply, code, note, pending, edits, newSections }) plus
                                   jobs: [job] (picture-job.fromAsk of the ask; [] when none is made)
                                   ctx: planAsk's ctx, plus ctx.switches (lib/picture-switches.js)
   Builder A fills (CONTRACT.md): verifyQuote(quote, instruction), gateEntities(entities, ctx), kindFor(section, ctx),
   peopleBudget(jobs, ctx), quotaFor(jobs, ctx), and planPictures for several entries behind on(switches, 'plan'). */
'use strict';

var chatPicture = require('./chat-picture');
var pictureJob = require('./picture-job');

function planPictures(entries, ctx) {
  var planned = chatPicture.planAsk(entries, ctx) || {};
  planned.jobs = planned.ask ? [pictureJob.fromAsk(planned.ask, 0)] : [];
  return planned;
}

module.exports = { planPictures: planPictures };
