/* lib/picture-capabilities.js — W1 (builder A): the one list of what ETB2B AI can and cannot do with pictures, from
   which the prompt block, the help text and the refusal sentences are written, and the check that a summary does not
   claim a limit the switches have lifted. STEP 0 STUB: nothing reads it yet, and claimCheck finds nothing, so every
   answer goes out as today.

     MANIFEST                       -> { can: [{ code, words, needs }], cannot: [{ code, words }] }
     promptBlock(switches)          -> '' (builder A: the lines for chatPicture.promptLines)
     sentence(code, ctx)            -> '' (builder A: a refusal or limit in the manifest's words)
     claimCheck(summary, switches)  -> { ok: true } | { ok: false, code, line } (builder A: "can't see the PDF's
                                       pictures", "one picture per message" … while the capability is on) */
'use strict';

/* `needs`: the switch that must be on for the capability to be claimed ('' = always) */
var MANIFEST = {
  can: [
    { code: 'pdf-pictures', words: 'see the pictures inside an attached PDF or deck, place them and re-create them', needs: '' },
    { code: 'owner-photo', words: 'put a picture the owner attaches in as it is', needs: '' },
    { code: 'fit-frame', words: 'make a picture in the shape of its frame', needs: '' },
    { code: 'several', words: 'make several pictures in one message (up to 4)', needs: 'plan' },
    { code: 'edit', words: 'change a picture already on the page (warmer, brighter, wider, without the people)', needs: 'edit' },
    { code: 'references', words: 'use an attached photo or a document picture as a guide for a new picture', needs: 'refs' },
    { code: 'options', words: 'show 3 options for one picture when asked', needs: 'variants' }
  ],
  cannot: [
    { code: 'real-people', words: 'put a real or named person into a picture it makes' },
    { code: 'lettering', words: 'put words, letters or logos into a picture it makes' },
    { code: 'content-photos', words: 'replace the photos that come from Content (speakers, partners): those are changed under Content' },
    { code: 'web', words: 'open other websites or find photos on the web' }
  ]
};

function promptBlock(switches) { return ''; }
function sentence(code, ctx) { return ''; }
function claimCheck(summary, switches) { return { ok: true }; }

module.exports = { MANIFEST: MANIFEST, promptBlock: promptBlock, sentence: sentence, claimCheck: claimCheck };
