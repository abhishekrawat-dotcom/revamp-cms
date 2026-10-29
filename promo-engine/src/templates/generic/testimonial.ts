import type { Template } from "../template.ts";
import { ALL_RATIOS } from "../template.ts";
import { page, esc, editionRibbon, hashtag, brandLockup, footerBar, type TemplateContext } from "../base.ts";

const DEFAULT_KICKER = "Voices of Last Edition";
// ONEWORLD PORT: no invented quote. The platform's default ("An unmissable gathering of the industry's sharpest
// minds — insightful, high-signal, and genuinely valuable.") put made-up words in a real speaker's mouth; Oneworld
// shows a real quote only, typed in Options. Until one is typed the card shows its quotation mark alone, with no
// voice, and the caption is empty (Oneworld refuses to download it then).
const DEFAULT_QUOTE = "";

// Resolve the "voice" behind the quote. A selected speaker (or the first speaker)
// supplies the name/title/photo; the author / authorTitle params override the text.
function resolveVoice(ctx: TemplateContext) {
  const { speakers } = ctx.event;
  const id = ctx.params.speakerId;
  const byId =
    id != null && String(id) !== ""
      ? speakers.find((s) => String(s.id) === String(id))
      : undefined;
  const s = byId ?? speakers[0]; // may be undefined when no speakers exist

  const authorOverride = String(ctx.params.author ?? "").trim();
  const titleOverride = String(ctx.params.authorTitle ?? "").trim();

  const name = authorOverride || (s ? s.name : "");
  const title =
    titleOverride || (s ? [s.designation, s.company].filter(Boolean).join(", ") : "");

  return { name, title, photoUrl: s?.photoUrl };
}

// Sizing uses cqw with cqh clamps so text never crops in the short 16:9 canvas.
const css = `
  .tst-body { flex:1; display:flex; gap:4cqw; align-items:stretch; min-height:0; margin-top:2.5cqw; }
  .tst-main { flex:1; display:flex; flex-direction:column; justify-content:center; gap:2.4cqw; min-height:0; }
  .tst-kicker { align-self:flex-start; font-weight:700; line-height:1;
    font-size:min(4.6cqw,6.4cqh); letter-spacing:.02em; text-transform:uppercase;
    color:var(--accent); text-shadow:0 .4cqw 2cqw rgba(0,0,0,.3); }
  /* quote in a light rounded card: semi-opaque white + dark ink reads on any background */
  .tst-card { position:relative; background:rgba(255,255,255,.95); color:#191b22;
    border-radius:3cqw; padding:4.4cqw; box-shadow:0 2cqw 6cqw rgba(0,0,0,.26); }
  .tst-quotemark { font-family:Georgia,"Times New Roman",serif; color:var(--accent);
    font-weight:700; font-size:min(11cqw,15cqh); line-height:.8; margin-bottom:.4cqw; }
  .tst-quote { font-size:min(3.6cqw,5cqh); font-weight:600; line-height:1.32; }
  /* attribution shown below the card when there is no photo */
  .tst-attr { margin-top:2cqw; }
  .tst-attr-name { font-size:min(4cqw,5.6cqh); font-weight:700; line-height:1.05; }
  .tst-attr-title { font-size:min(2.8cqw,3.9cqh); font-weight:600; color:var(--accent); margin-top:.6cqw; }
  /* rounded speaker photo with scrim + name plate */
  .tst-photo { position:relative; width:40%; border-radius:3cqw; overflow:hidden;
    box-shadow:0 2cqw 6cqw rgba(0,0,0,.3); background:rgba(255,255,255,.08); }
  .tst-photo img { width:100%; height:100%; object-fit:cover; object-position:top center; }
  .tst-photo::after { content:""; position:absolute; inset:0;
    background:linear-gradient(180deg, transparent 46%, rgba(0,0,0,.62)); }
  .tst-plate { position:absolute; left:0; right:0; bottom:0; z-index:2;
    padding:3.4cqw 3cqw; text-align:center; color:#fff; }
  .tst-plate .tst-attr-name { text-shadow:0 .3cqw 1.4cqw rgba(0,0,0,.55); }
  .tst-plate .tst-attr-title { color:#fff; opacity:.94; margin-top:.4cqw; }
  /* landscape is short & wide: tighten type + shrink photo so nothing crops */
  body[data-ratio="16:9"] .tst-body { gap:3cqw; margin-top:1.5cqw; }
  body[data-ratio="16:9"] .tst-card { padding:3cqw; border-radius:2.4cqw; }
  body[data-ratio="16:9"] .tst-quotemark { margin-bottom:0; }
  body[data-ratio="16:9"] .tst-photo { width:30%; }
  /* story is tall: stack the quote over the photo */
  body[data-ratio="9:16"] .tst-body { flex-direction:column; gap:3.5cqw; }
  body[data-ratio="9:16"] .tst-main { flex:none; justify-content:flex-start; }
  body[data-ratio="9:16"] .tst-photo { width:100%; flex:1; min-height:0; }
  body[data-ratio="9:16"] .tst-quote { font-size:4cqw; }
  body[data-ratio="9:16"] .tst-kicker { font-size:5.2cqw; }
`;

// ONEWORLD PORT: in 16:9, with no photo, the kicker, the card and the attribution under it are taller than the body
// (about 45 px with a two-line quote), and the column is centred, so the attribution's last line spills into the
// footer's top padding, where the QR tile's top edge stands. With a QR only (this CSS travels inside the tile's
// <style>), that column's gaps close up a little (the photo layout has no attribution under the card and is left as
// it is), so the attribution ends above the tile. Without a QR the post is the platform's, byte for byte.
const QR_16_9_CSS = ".tst-main:has(>.tst-attr){gap:1.2cqw}.tst-attr{margin-top:.6cqw}";

export const testimonial: Template = {
  id: "generic.testimonial",
  category: "generic",
  subtype: "testimonial",
  label: "Testimonial",
  description: "Quote card in a speaker's voice: big quotation mark, quote and attribution with an optional headshot.",
  formats: ALL_RATIOS,
  params: [
    { key: "kicker", label: "Kicker", type: "text", default: DEFAULT_KICKER },
    { key: "quote", label: "Quote", type: "text", default: DEFAULT_QUOTE },
    { key: "speakerId", label: "Speaker (optional)", type: "select", source: "speakers" },
    { key: "author", label: "Attribution name (override)", type: "text", default: "" },
    { key: "authorTitle", label: "Attribution title / company (override)", type: "text", default: "" },
  ],
  requires() {
    return { ok: true, missing: [] };
  },
  render(ctx) {
    const kicker = String(ctx.params.kicker ?? "").trim() || DEFAULT_KICKER;
    const quote = String(ctx.params.quote ?? "").trim() || DEFAULT_QUOTE;
    // ONEWORLD PORT: no quote, no voice: a person's photo and name are never shown beside an empty card.
    const { name, title, photoUrl } = quote ? resolveVoice(ctx) : { name: "", title: "", photoUrl: undefined };

    const attrInner =
      `<div class="tst-attr-name">${esc(name)}</div>` +
      (title ? `<div class="tst-attr-title">${esc(title)}</div>` : "");

    // With a photo: name plate overlays the headshot. Without: attribution sits
    // under the card. No name at all: just the quote.
    const photoCol = photoUrl
      ? `<div class="tst-photo">
          <img src="${esc(photoUrl)}" alt="">
          ${name ? `<div class="tst-plate">${attrInner}</div>` : ""}
        </div>`
      : "";
    const attrBelow = !photoUrl && name ? `<div class="tst-attr">${attrInner}</div>` : "";

    const inner = `
      ${editionRibbon(ctx)} ${hashtag(ctx)}
      ${brandLockup(ctx, { compact: true })}
      <div class="tst-body">
        <div class="tst-main">
          <div class="tst-kicker">${esc(kicker)}</div>
          <div class="tst-card">
            <div class="tst-quotemark" aria-hidden="true">&ldquo;</div>
            ${quote ? `<div class="tst-quote">${esc(quote)}</div>` : "" /* ONEWORLD PORT: no quote text while it is empty */}
          </div>
          ${attrBelow}
        </div>
        ${photoCol}
      </div>
      ${footerBar(ctx, { css: ctx.format?.ratio === "16:9" ? QR_16_9_CSS : "" }) /* ONEWORLD PORT: QR_16_9_CSS above */}`;
    return page(ctx, css, inner);
  },
  caption(ctx) {
    const quote = String(ctx.params.quote ?? "").trim() || DEFAULT_QUOTE;
    if (!quote) return ""; // ONEWORLD PORT: no caption for a testimonial with no quote
    const { name, title } = resolveVoice(ctx);
    const attr = name ? ` — ${name}${title ? `, ${title}` : ""}` : "";
    return `"${quote}"${attr} ${ctx.event.hashtag}`;
  },
};
