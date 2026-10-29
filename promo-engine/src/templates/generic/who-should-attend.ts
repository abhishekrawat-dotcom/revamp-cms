import type { Template } from "../template.ts";
import { ALL_RATIOS } from "../template.ts";
import { page, esc, editionRibbon, hashtag, brandLockup, footerBar, type TemplateContext } from "../base.ts";

const css = `
  .wsa-body { flex:1; display:flex; flex-direction:column; gap:2.5cqw; min-height:0; padding:4.5cqw; }
  .wsa-title { font-size:5.4cqw; font-weight:700; }
  .wsa-grid { flex:1; display:grid; grid-template-columns:repeat(2,1fr); gap:2cqw; align-content:center; }
  .wsa-item { background:rgba(255,255,255,.12); border:1px solid rgba(255,255,255,.24);
    border-radius:2cqw; padding:2.4cqw; font-size:2.5cqw; font-weight:700; line-height:1.2;
    display:flex; align-items:center; gap:1.4cqw; }
  .wsa-item::before { content:""; width:2cqw; height:2cqw; border-radius:50%;
    background:var(--accent); flex:none; }
  body[data-ratio="9:16"] .wsa-grid { grid-template-columns:1fr; }
  body[data-ratio="16:9"] .wsa-title { font-size:4cqw; }
`;

// ONEWORLD PORT: in 16:9 the platform's grid of six personas (three rows of 86 px chips) is taller than its panel
// leaves it (about 185 px, 158 px under a logo unit), so the last row spills out below the panel, across the date
// line and into the corner the QR tile takes. With a QR only (this CSS travels inside the tile's <style>), the chips
// keep their two columns, width and type but lose some height and row gap, so six personas stay inside the panel and
// clear of the tile, and none is covered. Without a QR the post is the platform's, byte for byte.
const QR_16_9_CSS = ".wsa-grid{row-gap:1.2cqw}.wsa-item{padding-top:1cqw;padding-bottom:1cqw}";

export const whoShouldAttend: Template = {
  id: "generic.who-should-attend",
  category: "generic",
  subtype: "who-should-attend",
  label: "Who Should Attend",
  description: "Audience-persona grid built from the event's who_should_attend list.",
  formats: ALL_RATIOS,
  params: [
    { key: "limit", label: "Max personas", type: "number", default: 6 },
    { key: "title", label: "Heading", type: "text", default: "Who Should Attend" },
  ],
  requires(event) {
    const ok = event.whoShouldAttend.length > 0;
    return { ok, missing: ok ? [] : ["who_should_attend"] };
  },
  render(ctx) {
    const limit = Number(ctx.params.limit) || 6;
    const items = ctx.event.whoShouldAttend.slice(0, limit)
      .map((p) => `<div class="wsa-item">${esc(p)}</div>`).join("");
    const inner = `
      ${editionRibbon(ctx)} ${hashtag(ctx)}
      ${brandLockup(ctx, { compact: true })}
      <div class="frost wsa-body">
        <div class="wsa-title">${esc(ctx.params.title || "Who Should Attend")}</div>
        <div class="wsa-grid">${items}</div>
      </div>
      ${footerBar(ctx, { css: ctx.format?.ratio === "16:9" ? QR_16_9_CSS : "" }) /* ONEWORLD PORT: QR_16_9_CSS above */}`;
    return page(ctx, css, inner);
  },
  caption(ctx) {
    return `Is ${ctx.event.name} for you? ${ctx.event.whoShouldAttend.slice(0, 4).join(", ")} and more should attend. ${ctx.event.hashtag}`;
  },
};
