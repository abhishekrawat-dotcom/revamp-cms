import type { Template } from "../template.ts";
import { ALL_RATIOS } from "../template.ts";
import { page, esc, editionRibbon, hashtag, brandLockup, footerBar, logoChip, type TemplateContext } from "../base.ts";
import type { SponsorTier } from "../../model/types.ts";

function asIdList(v: any): string[] {
  if (!v) return [];
  return (Array.isArray(v) ? v : String(v).split(",")).map((x) => String(x).trim()).filter(Boolean);
}

// Which tiers/sponsors to show: explicit user pick, else top-N across ranked tiers.
function selectTiers(ctx: TemplateContext): SponsorTier[] {
  const all = ctx.event.sponsorTiers;
  const ids = new Set(asIdList(ctx.params.sponsorIds));
  if (ids.size) {
    return all
      .map((t) => ({ tier: t.tier, sponsors: t.sponsors.filter((s) => ids.has(String(s.id))) }))
      .filter((t) => t.sponsors.length);
  }
  const maxTiers = Number(ctx.params.maxTiers) || 4;
  const maxSponsors = Number(ctx.params.maxSponsors) || 10;
  const out: SponsorTier[] = [];
  let count = 0;
  for (const t of all.slice(0, maxTiers)) {
    if (count >= maxSponsors) break;
    const take = t.sponsors.slice(0, maxSponsors - count);
    if (take.length) { out.push({ tier: t.tier, sponsors: take }); count += take.length; }
  }
  return out;
}

const css = `
  .tl-body { flex:1; display:flex; flex-direction:column; gap:2.5cqw; min-height:0; overflow:hidden; }
  .tl-title { font-size:5cqw; font-weight:700; }
  .tl-tiers { flex:1; display:flex; flex-direction:column; gap:2.2cqw; justify-content:center; }
  .tl-tier-name { font-size:2.4cqw; font-weight:700; text-transform:uppercase;
    letter-spacing:.06em; color:var(--accent); margin-bottom:1cqw; }
  .tl-logos { display:flex; flex-wrap:wrap; gap:1.6cqw; }
  .tl-logo { background:#fff; border-radius:1.6cqw; padding:1.6cqw 2.2cqw;
    height:9cqw; min-width:14cqw; display:flex; align-items:center; justify-content:center; }
  .tl-logo img { max-height:100%; max-width:26cqw; object-fit:contain; }
  .tl-logo.text { color:var(--ink); font-weight:700; font-size:2.4cqw; }
  body[data-ratio="16:9"] .tl-title { font-size:3.6cqw; }
  body[data-ratio="16:9"] .tl-logo { height:7cqw; }
`;

export const tierLadder: Template = {
  id: "partner.tier-ladder",
  category: "partner",
  subtype: "tier-ladder",
  label: "Sponsor Tier Ladder",
  description: "Partners grouped by tier (Presenting → Powered by → Gold …). Defaults to the top 10; hand-pick to override.",
  formats: ALL_RATIOS,
  params: [
    { key: "sponsorIds", label: "Pick partners", type: "multiselect", source: "sponsors",
      hint: "Leave empty to auto-pick the top partners across the highest tiers." },
    { key: "maxSponsors", label: "Auto-pick count", type: "number", default: 10 },
    { key: "maxTiers", label: "Max tiers", type: "number", default: 4 },
    { key: "title", label: "Heading", type: "text", default: "Our Partners" },
  ],
  requires(event) {
    const ok = event.sponsorTiers.length > 0;
    return { ok, missing: ok ? [] : ["sponsors"] };
  },
  render(ctx) {
    const tiers = selectTiers(ctx).map((t) => {
      const logos = t.sponsors.map((s) => logoChip(s.logoUrl, s.title, "tl-logo")).join("");
      return `<div class="tl-tier"><div class="tl-tier-name">${esc(t.tier)}</div><div class="tl-logos">${logos}</div></div>`;
    }).join("");
    const inner = `
      ${editionRibbon(ctx)} ${hashtag(ctx)}
      ${brandLockup(ctx, { compact: true })}
      <div class="tl-body">
        <div class="tl-title">${esc(ctx.params.title || "Our Partners")}</div>
        <div class="tl-tiers">${tiers}</div>
      </div>
      ${footerBar(ctx)}`;
    return page(ctx, css, inner);
  },
  caption(ctx) {
    const tiers = selectTiers(ctx).map((t) => t.tier);
    return `Proud to be powered by our partners at ${ctx.event.name} — ${[...new Set(tiers)].slice(0, 3).join(", ")} and more. ${ctx.event.hashtag}`;
  },
};
