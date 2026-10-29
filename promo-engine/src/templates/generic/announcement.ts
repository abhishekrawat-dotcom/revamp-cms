import type { Template } from "../template.ts";
import { ALL_RATIOS } from "../template.ts";
import { page, esc, editionRibbon, hashtag, brandLockup, type TemplateContext } from "../base.ts";
// ONEWORLD PORT: the QR tile (Oneworld's merge); see the button row in render below.
import { qrTile } from "../base.ts";

type Stat = { value: string; label: string };

const css = `
  /* logo clears the edition ribbon; content never overflows the canvas */
  .an-lockup { margin-top:6cqw; }
  .an-fill { flex:1; min-height:0; }
  .an-panel { padding:4cqw 4.5cqw; display:flex; flex-direction:column; gap:1.6cqw; }
  .an-save { font-size:min(3cqw,4.4cqh); font-weight:700; letter-spacing:.3em; text-transform:uppercase; opacity:.92; }
  .an-date { font-size:min(9cqw,13cqh); font-weight:700; line-height:1; letter-spacing:-.01em; }
  .an-venue { font-size:min(3.6cqw,5cqh); font-weight:700; opacity:.96; }
  .an-stats { display:flex; flex-wrap:wrap; gap:2cqw; margin-top:1cqw; }
  .an-stat { flex:1 1 0; min-width:18%; }
  .an-stat .v { font-size:min(5.4cqw,7.5cqh); font-weight:700; color:var(--accent); line-height:1; }
  .an-stat .l { font-size:min(2.2cqw,3cqh); font-weight:600; opacity:.9; margin-top:.6cqw;
    text-transform:uppercase; letter-spacing:.04em; }
  .an-cta { align-self:flex-start; margin-top:1.5cqw; background:var(--accent); color:var(--accent-ink);
    font-weight:700; font-size:min(2.8cqw,3.8cqh); padding:1.6cqw 3.6cqw; border-radius:99px; }
`;

// ONEWORLD PORT: with a QR (only while the site is published) the button and the code share one row, the button
// on the left and the code on the right, centred on each other as in Oneworld's own posts; the row's CSS travels
// inside the tile's <style>. Without a QR this is the platform's button, byte for byte, and no row exists.
const AN_ACTS_CSS = ".an-acts{display:flex;align-items:center;justify-content:space-between;gap:2cqw;margin-top:1.5cqw}" +
  ".an-acts .an-cta{margin-top:0;align-self:center}";
// ONEWORLD PORT: in 16:9 the panel already reaches the bottom of the 675 px canvas, so a row as tall as the code
// (about 140 px with its caption) would push the code and the button off it. There the panel becomes a two-column
// grid: every line keeps the full width except the one just above the button (the stats, else the venue, else the
// date), and the code stands in the right column beside that line and the button, so the panel is no taller than
// without a QR. The row box steps aside (display:contents) so the button and the code sit in the panel's grid, and
// the button gets back its own top margin and left alignment. A long caption (Oneworld allows 60 characters) wraps
// under the code within 240 px, so the code's column never squeezes the stats into each other.
const AN_ACTS_16_9_CSS = ".an-panel{display:grid;grid-template-columns:minmax(0,1fr) auto;" +
  "grid-auto-flow:row dense;column-gap:3cqw}" +
  ".an-panel>*{grid-column:1/-1}.an-panel>:has(+.an-acts),.an-acts>.an-cta{grid-column:1}" +
  ".an-acts{display:contents}.an-acts>.an-cta{margin-top:1.5cqw;align-self:start;justify-self:start}" +
  ".an-acts>.ow-qr{grid-column:2;grid-row:span 2;align-self:center}" +
  ".an-acts>.ow-qr .ow-qr-t{white-space:normal;overflow-wrap:anywhere;max-width:240px;text-align:center}";
function ctaRow(ctx: TemplateContext): string {
  const cta = `<div class="an-cta">${esc(ctx.event.ctaLabel)}</div>`;
  if (!ctx.assets?.qrUrl) return cta;
  const css = AN_ACTS_CSS + (ctx.format?.ratio === "16:9" ? AN_ACTS_16_9_CSS : "");
  return `<div class="an-acts">${cta}${qrTile(ctx, css)}</div>`;
}

export const announcement: Template = {
  id: "generic.announcement",
  category: "generic",
  subtype: "announcement",
  label: "Announcement / Save the Date",
  description: "Hero save-the-date: logo, dates, venue, editable stats and CTA on a frosted panel.",
  formats: ALL_RATIOS,
  params: [
    { key: "kicker", label: "Kicker", type: "text", default: "Save the Date" },
    { key: "stats", label: "Stats (editable)", type: "stats" },
  ],
  requires(event) {
    const ok = Boolean(event.dateLabel || event.venue);
    return { ok, missing: ok ? [] : ["event date/venue"] };
  },
  render(ctx) {
    const { event } = ctx;
    const stats: Stat[] = (Array.isArray(ctx.params.stats) ? ctx.params.stats : event.stats).slice(0, 4);
    const statsHtml = stats.map((s) =>
      `<div class="an-stat"><div class="v">${esc(s.value)}</div><div class="l">${esc(s.label)}</div></div>`).join("");
    const inner = `
      ${editionRibbon(ctx)} ${hashtag(ctx)}
      <div class="an-lockup">${brandLockup(ctx, { compact: true })}</div>
      <div class="an-fill"></div>
      <div class="frost an-panel">
        <div class="an-save">${esc(ctx.params.kicker || "Save the Date")}</div>
        ${event.dateLabel ? `<div class="an-date">${esc(event.dateLabel)}</div>` : ""}
        ${event.venue || event.city ? `<div class="an-venue">${esc(event.venue || event.city)}</div>` : ""}
        ${statsHtml ? `<div class="an-stats">${statsHtml}</div>` : ""}
        ${ctaRow(ctx) /* ONEWORLD PORT: the button, with the QR beside it when there is one (ctaRow above) */}
      </div>`;
    return page(ctx, css, inner);
  },
  caption(ctx) {
    const { event } = ctx;
    return `Save the date! ${event.name}${event.tagline ? " — " + event.tagline : ""}. ` +
      [event.dateLabel, event.venue].filter(Boolean).join(" · ") + `. ${event.hashtag}`;
  },
};
