/* ONEWORLD PORT — the browser half of the platform's social posts engine, for Promotions → Social posts.
   Built by tools/build-promo-social.js into assets/vendor/promo-social.js, an IIFE that sets window.OWSocial; the
   output is committed, so App Hosting needs no build step. Run the build again after any change here, in
   editor.ts, render/extract.ts, psd/extract.ts or promo-engine/vendor/webtoon-psd, and commit both.
   The platform did these three jobs in a server Chrome and sharp; Oneworld's server has neither, so the studio's
   page (promo-social-studio.html, through promo-studio/oneworld-social.js and oneworld-social-art.js) runs them:
     extract(doc, W, H)                          flatten a post drawn in a W × H frame into editable elements
     renderEditableHtml(w, h, base, elements)    the edited post as one page, to draw as the PNG
     psdUnits(arrayBuffer, { maxEdge })          a PSD's background and logo unit, as PNG blobs
     classify, MAX_EDGE, PSD_LIMITS              the PSD layer rules and limits, for the studio and its checks */
export { extract } from "./render/extract.ts";
export { renderEditableHtml } from "./editor.ts";
export { psdUnits, classify, MAX_EDGE, PSD_LIMITS } from "./psd/extract.ts";
