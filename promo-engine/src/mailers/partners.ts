import type { Mailer } from "./mailer.ts";
import { blockOf } from "./blocks.ts";
import { dateVenue } from "./base.ts";
import {
  THEME_PARAM, ACCENT_PARAM, BANNER_PARAMS, headerBlocks, logoBlock, heroBlock, sectionLabel, metaBlock,
  ctaBlock, footerBlock, contactsBlock, dividerBlock, sponsorsBlock, copyParams, ctaParams,
  selectSponsors, YES_NO, isNo, compact,
  overviewBlock,
} from "./shared.ts";

// ---- partner line-up (tier ladder) -----------------------------------------

export const partnersMailer: Mailer = {
  id: "mailer.partners",
  group: "Partner",
  label: "Partner Line-up",
  description: "Sponsor-focused send: logos stacked by tier (presenting → associate), with a thank-you note and CTA.",
  params(event) {
    return [
      THEME_PARAM, ACCENT_PARAM, ...BANNER_PARAMS,
      { key: "tiers", label: "Tiers to include", type: "multiselect", source: "sponsorTiers",
        hint: "Leave empty for every tier, in ladder order." },
      { key: "sponsorIds", label: "Or pick sponsors", type: "multiselect", source: "sponsors",
        hint: "Narrows the tiers above to just these partners." },
      ...copyParams("Powered by our partners", `The brands backing ${event.name} — thank you for making it happen.`),
      YES_NO("showStats", "Stat tiles", "no"),
      YES_NO("showMeta", "Date / venue tiles"),
      ...ctaParams(event),
    ];
  },
  requires(event) {
    const n = event.sponsorTiers.reduce((a, t) => a + t.sponsors.length, 0);
    return { ok: n >= 1, missing: n ? [] : ["sponsors"] };
  },
  build(event, params) {
    const groups = selectSponsors(event, params);
    const n = groups.reduce((a, t) => a + t.sponsors.length, 0);

    return {
      mailerId: this.id,
      subject: n === 1 ? `Meet the partner powering ${event.name}` : `Meet the ${n} partners powering ${event.name}`,
      preheader: groups.slice(0, 2).map((t) => `${t.tier}: ${t.sponsors.map((s) => s.title).slice(0, 2).join(", ")}`).join(" • ") || dateVenue(event),
      theme: params.theme || "site",
      accent: params.accent || undefined,
      blocks: compact([
        ...headerBlocks(event, params),
        sectionLabel("Partners"),
        blockOf("heading", { text: params.headline || "Powered by our partners", size: 22, align: "center" }),
        overviewBlock(event, params, `The brands backing ${event.name} — thank you for making it happen.`),
        // One block per tier: same ladder, but each tier is independently editable.
        ...groups.map((t) => sponsorsBlock(t.sponsors, t.tier)),
        isNo(params.showStats) || !event.stats.length ? null : blockOf("stats", { items: event.stats.slice(0, 4) }),
        isNo(params.showMeta) ? null : metaBlock(event),
        dividerBlock(),
        blockOf("heading", { text: "Want your brand on this list?", size: 18, align: "center" }),
        blockOf("text", { text: "Reply to this mail for the partnership deck.", size: 14, align: "center" }),
        ctaBlock(event, params, { align: "center" }),
        contactsBlock(),
        footerBlock(event),
      ]),
    };
  },
};

// ---- presenting-partner spotlight ------------------------------------------

export const partnerSpotlightMailer: Mailer = {
  id: "mailer.partner-spotlight",
  group: "Partner",
  label: "Presenting Partner Spotlight",
  description: "One partner front and centre: big logo lockup, an about note, and the rest of the roster below.",
  params(event) {
    return [
      THEME_PARAM, ACCENT_PARAM,
      { key: "sponsorIds", label: "Partner", type: "multiselect", source: "sponsors",
        hint: "Pick one — the first selection is the spotlight. Defaults to the presenting partner." },
      ...copyParams("In association with", ""),
      { key: "about", label: "About the partner", type: "textarea",
        hint: "A short paragraph on the partner and why they're backing the event." },
      { key: "benefits", label: "Highlights", type: "textarea", hint: "One per line — shown as bullets." },
      YES_NO("showOthers", "Other partners strip"),
      ...ctaParams(event),
    ];
  },
  requires(event) {
    const n = event.sponsorTiers.reduce((a, t) => a + t.sponsors.length, 0);
    return { ok: n >= 1, missing: n ? [] : ["sponsors"] };
  },
  build(event, params) {
    const groups = selectSponsors(event, params);
    const star = groups[0]?.sponsors[0] ?? event.sponsorTiers[0]?.sponsors[0];
    const others = isNo(params.showOthers)
      ? []
      : event.sponsorTiers.flatMap((t) => t.sponsors).filter((s) => s.id !== star?.id).slice(0, 8);
    const lines = String(params.benefits || "").split(/\n+/).map((s) => s.trim()).filter(Boolean);

    return {
      mailerId: this.id,
      subject: star ? `${star.title} presents ${event.name}` : `Partner spotlight | ${event.name}`,
      preheader: star ? `${star.tier} — ${dateVenue(event)}` : dateVenue(event),
      theme: params.theme || "site",
      accent: params.accent || undefined,
      blocks: compact([
        logoBlock(event),
        heroBlock(event),
        sectionLabel(params.headline || "In association with"),
        blockOf("heading", { text: star?.title || "Our presenting partner", size: 22, align: "center" }),
        star ? sponsorsBlock([star], star.tier) : null,
        params.about ? blockOf("text", { text: params.about, size: 15, align: "center" })
                     : overviewBlock(event, params, star ? `${star.title} is backing ${event.name} as ${star.tier}.` : undefined),
        lines.length ? blockOf("bullets", { title: "", marker: "→", items: lines.map((t) => ({ text: t })) }) : null,
        metaBlock(event),
        dividerBlock(),
        ctaBlock(event, params, { align: "center" }),
        others.length ? dividerBlock() : null,
        others.length ? sponsorsBlock(others, "Also partnering with us") : null,
        contactsBlock(),
        footerBlock(event),
      ]),
    };
  },
};
