/* ONEWORLD PORT — the promotional platform's mailer engine, as one module for Oneworld's backend.
   Built to functions/lib/vendor/promo-engine.js by tools/build-promo-engine.js (CommonJS, Node 20).
   Source: ~/Downloads/Social Post Generator/app/src (the owner's platform), copied unchanged except where a
   comment says "ONEWORLD PORT". */
export { ALL_MAILERS, getMailer, buildDoc, buildMailerCatalog, mailerFileName, renderDoc } from "./mailers/registry.ts";
export { BLOCK_SCHEMAS, COPY_FIELDS, makeBlock, blockIsEmpty, renderCtx, migrateSponsorTiers, blockPalette, sanitiseFragment } from "./mailers/blocks.ts";
export { relayout } from "./mailers/relayout.ts";
export { importHtml } from "./mailers/importhtml.ts";
export { injectTracking, newSendId, verifyClick, signClick } from "./mailers/track.ts";
export { suggestSubjects, rewriteField, polishCopy, enhanceMailer, AiUnavailable, TONE_OPTIONS, setAiCaller } from "./ai/copy.ts";
export { getBrand, PORTALS, ASSET_BASE } from "./brand/index.ts";
export { readable, resolvePalette, hexColor } from "./mailers/base.ts";
export { parseEdition, fmtDateLabel, daysBetween, groupSponsors, namesAnotherPortal } from "./model/normalize.ts";
