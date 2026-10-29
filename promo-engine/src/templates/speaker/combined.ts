import type { Template } from "../template.ts";
import { ALL_RATIOS } from "../template.ts";
import { page, esc, editionRibbon, hashtag, brandLockup, footerBar, type TemplateContext } from "../base.ts";
import type { Speaker } from "../../model/types.ts";

// Grid scales the way the reference "Combined Sets" do: 3 -> row, up to 16 -> grid,
// beyond that -> dense speaker "wall".
function columnsFor(n: number): number {
  if (n <= 3) return n;
  if (n <= 4) return 2;
  if (n <= 6) return 3;
  if (n <= 12) return 4;
  if (n <= 16) return 4;
  return Math.min(7, Math.ceil(Math.sqrt(n)));
}

function asIdList(v: any): string[] {
  if (!v) return [];
  return (Array.isArray(v) ? v : String(v).split(",")).map((x) => String(x).trim()).filter(Boolean);
}

function selectSpeakers(ctx: TemplateContext): Speaker[] {
  const all = ctx.event.speakers;
  // 1) explicit user pick wins, in the order the user chose them
  const ids = asIdList(ctx.params.speakerIds);
  if (ids.length) {
    const byId = new Map(all.map((s) => [String(s.id), s]));
    return ids.map((id) => byId.get(id)).filter(Boolean) as Speaker[];
  }
  // 2) otherwise auto-pick the top N (by weightage) in the chosen group
  let list = all;
  const group = ctx.params.group;
  if (group) list = list.filter((s) => s.group === group);
  const limit = Number(ctx.params.limit) || 8;
  return list.slice(0, limit);
}

const css = `
  .cs-body { flex:1; display:flex; flex-direction:column; min-height:0; gap:2cqw; }
  .cs-title { font-size:5cqw; font-weight:700; align-self:flex-start; padding:1.6cqw 3cqw; border-radius:2.4cqw; }
  .cs-grid { flex:1; display:grid; gap:2cqw; min-height:0;
    grid-template-columns:repeat(var(--cols), 1fr); align-content:center; }
  .cs-tile { position:relative; border-radius:2cqw; overflow:hidden;
    background:rgba(255,255,255,.08); box-shadow:0 1cqw 3cqw rgba(0,0,0,.25);
    display:flex; flex-direction:column; }
  .cs-tile img { width:100%; flex:1; object-fit:cover; object-position:top center; min-height:0; }
  .cs-cap { padding:1.4cqw 1.6cqw; background:rgba(0,0,0,.55); color:#fff; }
  .cs-nm { font-size:1.9cqw; font-weight:700; line-height:1.1; color:#fff; }
  .cs-rl { font-size:1.4cqw; font-weight:600; opacity:.85; line-height:1.1; margin-top:.4cqw; color:#fff; }
  /* dense wall: shrink captions */
  .cs-grid.dense .cs-nm { font-size:1.4cqw; }
  .cs-grid.dense .cs-rl { display:none; }
  body[data-ratio="16:9"] .cs-title { font-size:3.6cqw; }
`;

export const combinedSpeakers: Template = {
  id: "speaker.combined",
  category: "speaker",
  subtype: "combined",
  label: "Combined Speaker Set",
  description: "Multi-speaker grid that auto-scales (3 / 6 / 8 / 16 / wall) by count; optional group filter.",
  formats: ALL_RATIOS,
  params: [
    { key: "speakerIds", label: "Pick speakers", type: "multiselect", source: "speakers",
      hint: "Leave empty to auto-pick the top speakers by priority." },
    { key: "group", label: "Speaker group", type: "select", source: "speakerGroups",
      hint: "Filters the auto-pick when no speakers are hand-picked." },
    { key: "limit", label: "Auto-pick count", type: "number", default: 8 },
    { key: "title", label: "Heading", type: "text", default: "Meet Our Speakers" },
  ],
  requires(event) {
    return { ok: event.speakers.length >= 2, missing: event.speakers.length >= 2 ? [] : ["speakers (>=2)"] };
  },
  render(ctx) {
    const list = selectSpeakers(ctx);
    const cols = columnsFor(list.length);
    const dense = list.length > 16;
    const tiles = list.map((s) => `
      <div class="cs-tile">
        ${s.photoUrl ? `<img src="${esc(s.photoUrl)}" alt="">` : `<div style="flex:1"></div>`}
        <div class="cs-cap">
          <div class="cs-nm">${esc(s.name)}</div>
          <div class="cs-rl">${esc([s.designation, s.company].filter(Boolean).join(", "))}</div>
        </div>
      </div>`).join("");
    const inner = `
      ${editionRibbon(ctx)} ${hashtag(ctx)}
      ${brandLockup(ctx, { compact: true })}
      <div class="cs-body">
        <div class="frost cs-title">${esc(ctx.params.title || "Meet Our Speakers")}</div>
        <div class="cs-grid ${dense ? "dense" : ""}" style="--cols:${cols}">${tiles}</div>
      </div>
      ${footerBar(ctx)}`;
    return page(ctx, css, inner);
  },
  caption(ctx) {
    const list = selectSpeakers(ctx);
    const names = list.slice(0, 5).map((s) => s.name).join(", ");
    return `Presenting ${list.length}${ctx.params.group ? " " + ctx.params.group : " speakers"} at ${ctx.event.name} — ${names}${list.length > 5 ? " and more" : ""}. ${ctx.event.hashtag}`;
  },
};
