import type { Template } from "../template.ts";
import { ALL_RATIOS } from "../template.ts";
import { page, esc, editionRibbon, hashtag, brandLockup, footerBar, type TemplateContext } from "../base.ts";

const css = `
  .po-body { flex:1; display:flex; flex-direction:column; gap:3cqw; min-height:0; }
  .po-title { font-size:5.4cqw; font-weight:700; line-height:1.06; letter-spacing:-.01em;
    text-shadow:0 .4cqw 2cqw rgba(0,0,0,.25); }
  .po-cards { flex:1; display:grid; grid-template-columns:repeat(2,1fr); gap:2.6cqw;
    align-content:center; min-height:0; }
  .po-card { border-radius:2.6cqw; padding:3cqw 2.6cqw; display:flex; flex-direction:column;
    align-items:center; text-align:center; gap:1.8cqw; min-height:0; overflow:hidden;
    -webkit-backdrop-filter:blur(14px) saturate(1.3); backdrop-filter:blur(14px) saturate(1.3);
    box-shadow:0 1.5cqw 4cqw rgba(0,0,0,.28); }
  .po-card.pred { background:rgba(244,63,94,.42); border:1px solid rgba(244,63,94,.7); }
  .po-card.out  { background:rgba(34,197,94,.42);  border:1px solid rgba(34,197,94,.7); }
  .po-label { font-size:3.4cqw; font-weight:700; letter-spacing:-.01em; }
  .po-card.pred .po-label { color:#fb7185; }
  .po-card.out  .po-label { color:#4ade80; }
  .po-icon { width:8cqw; height:8cqw; flex:none; }
  .po-card.pred .po-icon { color:#fb7185; }
  .po-card.out  .po-icon { color:#4ade80; }
  .po-text { font-size:2.5cqw; font-weight:700; line-height:1.28; opacity:.96; }
  body[data-ratio="9:16"] .po-cards { grid-template-columns:1fr; }
  body[data-ratio="16:9"] .po-title { font-size:4cqw; }
  body[data-ratio="16:9"] .po-text { font-size:2.2cqw; }
`;

const iconPred = `<svg class="po-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;

const iconOut = `<svg class="po-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg>`;

function yearOf(iso?: string): number | undefined {
  if (!iso) return undefined;
  const y = new Date(iso).getFullYear();
  return Number.isFinite(y) ? y : undefined;
}

export const predictionOutcome: Template = {
  id: "generic.prediction-outcome",
  category: "generic",
  subtype: "prediction-outcome",
  label: "Prediction vs Outcome",
  description: "Last year's prediction paired with this year's outcome in two contrasting cards.",
  formats: ALL_RATIOS,
  params: [
    { key: "headline", label: "Headline", type: "text",
      default: "What leaders saw last year. What they must prepare for next." },
    { key: "prediction", label: "Prediction paragraph", type: "text",
      default: "Last year set the signals — shifting priorities, new risks, and rising expectations." },
    { key: "outcome", label: "Outcome paragraph", type: "text",
      default: "This year, leaders will act on it — with sharper strategy, governance and execution." },
    { key: "predictionLabel", label: "Prediction label", type: "text", default: "Prediction" },
    { key: "outcomeLabel", label: "Outcome label", type: "text", default: "Outcome" },
  ],
  requires() {
    return { ok: true, missing: [] };
  },
  render(ctx) {
    const year = yearOf(ctx.event.startDate);
    const predBase = String(ctx.params.predictionLabel || "Prediction");
    const outBase = String(ctx.params.outcomeLabel || "Outcome");
    const predLabel = year ? `${predBase} ${year - 1}` : predBase;
    const outLabel = year ? `${outBase} ${year}` : outBase;
    const inner = `
      ${editionRibbon(ctx)} ${hashtag(ctx)}
      ${brandLockup(ctx, { compact: true })}
      <div class="po-body">
        <div class="po-title">${esc(ctx.params.headline || "What leaders saw last year. What they must prepare for next.")}</div>
        <div class="po-cards">
          <div class="po-card pred">
            <div class="po-label">${esc(predLabel)}</div>
            ${iconPred}
            <div class="po-text">${esc(ctx.params.prediction)}</div>
          </div>
          <div class="po-card out">
            <div class="po-label">${esc(outLabel)}</div>
            ${iconOut}
            <div class="po-text">${esc(ctx.params.outcome)}</div>
          </div>
        </div>
      </div>
      ${footerBar(ctx)}`;
    return page(ctx, css, inner);
  },
  caption(ctx) {
    return `From last year's signals to this year's action — see what's next at ${ctx.event.name}. ${ctx.event.hashtag}`;
  },
};
