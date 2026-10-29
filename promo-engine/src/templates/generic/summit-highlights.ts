import type { Template } from "../template.ts";
import { ALL_RATIOS } from "../template.ts";
import { page, esc, editionRibbon, hashtag, brandLockup, footerBar, type TemplateContext } from "../base.ts";

const css = `
  .sh-body { flex:1; display:flex; flex-direction:column; gap:3cqw; min-height:0; justify-content:center; padding:4.5cqw; }
  .sh-title { font-size:5.6cqw; font-weight:700; text-align:center; letter-spacing:-.01em; }
  .sh-grid { flex:1; display:grid; grid-template-columns:repeat(3,1fr); gap:2cqw;
    align-content:center; min-height:0; }
  .sh-tile { background:rgba(255,255,255,.12); border:1px solid rgba(255,255,255,.24);
    border-radius:2.4cqw; padding:2.8cqw 1.8cqw; display:flex; flex-direction:column;
    align-items:center; justify-content:center; text-align:center; gap:.9cqw; min-width:0; }
  .sh-v { font-size:6.6cqw; font-weight:700; color:var(--accent); line-height:1; }
  .sh-l { font-size:2.2cqw; font-weight:700; line-height:1.15; opacity:.92;
    text-transform:uppercase; letter-spacing:.05em; }
  /* portrait & story: two columns, roomy numbers */
  body[data-ratio="4:5"] .sh-grid, body[data-ratio="9:16"] .sh-grid { grid-template-columns:repeat(2,1fr); }
  body[data-ratio="9:16"] .sh-v { font-size:8cqw; }
  /* landscape: single row, tighter type so nothing crops on the short canvas */
  body[data-ratio="16:9"] .sh-grid { grid-auto-flow:column; grid-auto-columns:1fr; grid-template-columns:none; }
  body[data-ratio="16:9"] .sh-title { font-size:4cqw; }
  body[data-ratio="16:9"] .sh-v { font-size:4.6cqw; }
  body[data-ratio="16:9"] .sh-l { font-size:1.7cqw; }
  body[data-ratio="16:9"] .sh-tile { padding:2cqw 1.2cqw; }
`;

type Stat = { value: string; label: string };

export const summitHighlights: Template = {
  id: "generic.summit-highlights",
  category: "generic",
  subtype: "summit-highlights",
  label: "Summit Highlights",
  description: "At-a-glance grid of the event's headline numbers (speakers, sessions, attendees…).",
  formats: ALL_RATIOS,
  params: [
    { key: "title", label: "Heading", type: "text", default: "Summit Highlights" },
    { key: "stats", label: "Stats (editable)", type: "stats" },
  ],
  requires(event) {
    const ok = (event.stats?.length ?? 0) > 0;
    return { ok, missing: ok ? [] : ["stats"] };
  },
  render(ctx) {
    const stats = ((ctx.params.stats ?? ctx.event.stats) as Stat[]).slice(0, 6);
    const tiles = stats
      .map((s) => `<div class="sh-tile"><div class="sh-v">${esc(s.value)}</div><div class="sh-l">${esc(s.label)}</div></div>`)
      .join("");
    const inner = `
      ${editionRibbon(ctx)} ${hashtag(ctx)}
      ${brandLockup(ctx, { compact: true })}
      <div class="frost sh-body">
        <div class="sh-title">${esc(ctx.params.title || "Summit Highlights")}</div>
        <div class="sh-grid">${tiles}</div>
      </div>
      ${footerBar(ctx)}`;
    return page(ctx, css, inner);
  },
  caption(ctx) {
    const stats = ((ctx.params.stats ?? ctx.event.stats) as Stat[]).slice(0, 4);
    const summary = stats.map((s) => `${s.value} ${s.label}`).join(", ");
    return `${ctx.event.name} by the numbers — ${summary} and more. ${ctx.event.hashtag}`;
  },
};
