import type { Template } from "../template.ts";
import { ALL_RATIOS } from "../template.ts";
import { page, esc, editionRibbon, hashtag, brandLockup, footerBar, type TemplateContext } from "../base.ts";

function pickSponsor(ctx: TemplateContext) {
  const tiers = ctx.event.sponsorTiers;
  // Exact sponsor pick wins.
  const sid = ctx.params.sponsorId;
  if (sid) {
    for (const t of tiers) {
      const s = t.sponsors.find((x) => String(x.id) === String(sid));
      if (s) return { tier: t.tier, sponsor: s };
    }
  }
  const tier = tiers.find((t) => t.tier === ctx.params.tier) ?? tiers[0];
  return tier ? { tier: tier.tier, sponsor: tier.sponsors[0] } : undefined;
}

const css = `
  .ps-body { flex:1; display:flex; flex-direction:column; align-items:center;
    justify-content:center; gap:3cqw; text-align:center; }
  .ps-welcome { font-size:3cqw; font-weight:700; letter-spacing:.06em; text-transform:uppercase; opacity:.9; }
  .ps-tier { font-size:6cqw; font-weight:700; color:var(--accent); line-height:1; }
  .ps-card { background:#fff; border-radius:3cqw; padding:5cqw 6cqw; min-width:52%;
    display:flex; align-items:center; justify-content:center; box-shadow:0 2cqw 6cqw rgba(0,0,0,.28); }
  .ps-card img { max-width:44cqw; max-height:22cqw; object-fit:contain; }
  .ps-card .ps-name { color:var(--ink); font-size:5cqw; font-weight:700; }
  body[data-ratio="16:9"] .ps-tier { font-size:4.5cqw; }
`;

export const presentingSpotlight: Template = {
  id: "partner.presenting-spotlight",
  category: "partner",
  subtype: "presenting-spotlight",
  label: "Partner Spotlight",
  description: "Single-partner hero card labelled by tier (e.g. Welcoming Our Presenting Partner).",
  formats: ALL_RATIOS,
  params: [
    { key: "sponsorId", label: "Pick partner", type: "select", source: "sponsors",
      hint: "Overrides the tier pick below." },
    { key: "tier", label: "Tier", type: "select", source: "sponsorTiers",
      hint: "Featured partner is the top one in this tier when no partner is picked." },
  ],
  requires(event) {
    const ok = event.sponsorTiers.length > 0;
    return { ok, missing: ok ? [] : ["sponsors"] };
  },
  render(ctx) {
    const pick = pickSponsor(ctx);
    if (!pick) return page(ctx, css, `${brandLockup(ctx)}<div class="ps-body">No partner</div>`);
    const { tier, sponsor } = pick;
    const onerr = `this.onerror=null;this.replaceWith(Object.assign(document.createElement('div'),{className:'ps-name',textContent:${JSON.stringify(sponsor.title)}}));`;
    const logo = sponsor.logoUrl
      ? `<img src="${esc(sponsor.logoUrl)}" alt="${esc(sponsor.title)}" onerror="${esc(onerr)}">`
      : `<div class="ps-name">${esc(sponsor.title)}</div>`;
    const inner = `
      ${editionRibbon(ctx)} ${hashtag(ctx)}
      ${brandLockup(ctx, { compact: true })}
      <div class="ps-body">
        <div class="ps-welcome">Welcoming our</div>
        <div class="ps-tier">${esc(tier)}</div>
        <div class="ps-card">${logo}</div>
      </div>
      ${footerBar(ctx, { pin: true }) /* ONEWORLD PORT: this body never shrinks, so a 16:9 QR tile is pinned to the canvas (base.ts qrFooterPinned16x9) */}`;
    return page(ctx, css, inner);
  },
  caption(ctx) {
    const pick = pickSponsor(ctx);
    return `We're delighted to welcome ${pick?.sponsor.title ?? "our partner"} as ${pick?.tier ?? "a partner"} at ${ctx.event.name}. ${ctx.event.hashtag}`;
  },
};
