import type { Mailer } from "./mailer.ts";
import { blockOf } from "./blocks.ts";
import { dateVenue } from "./base.ts";
import {
  THEME_PARAM, ACCENT_PARAM, BANNER_PARAMS, headerBlocks, sectionLabel, metaBlock,
  ctaBlock, footerBlock, contactsBlock, dividerBlock, speakersBlock, sponsorsBlock,
  copyParams, ctaParams, introFrom, bulletsFor, BULLET_SOURCE_PARAM, YES_NO, isNo, compact,
} from "./shared.ts";

// The workhorse "save the date" send: what it is, when/where, why attend, who's
// speaking, who's backing it, one CTA.
export const announcementMailer: Mailer = {
  id: "mailer.announcement",
  group: "Announcement",
  label: "Event Announcement",
  description: "Full announcement send: banner, hero, date/venue, why attend, speaker preview, partners, CTA.",
  params(event) {
    return [
      THEME_PARAM, ACCENT_PARAM, ...BANNER_PARAMS,
      ...copyParams(`Announcing ${event.name}`, introFrom(event)),
      BULLET_SOURCE_PARAM,
      { key: "bulletsTitle", label: "Bullets heading", type: "text", default: "On the agenda" },
      { key: "speakerCount", label: "Speakers to preview", type: "number", default: 6, hint: "0 hides the speaker block." },
      YES_NO("showStats", "Stat tiles"),
      YES_NO("showPartners", "Partner logos"),
      ...ctaParams(event),
    ];
  },
  requires(event) {
    return { ok: !!event.name, missing: event.name ? [] : ["event name"] };
  },
  build(event, params) {
    const bullets = bulletsFor(event, params.bulletSource).slice(0, 6);
    const nSpeakers = Number(params.speakerCount ?? 6);
    const speakers = nSpeakers > 0 ? event.speakers.slice(0, nSpeakers) : [];
    const partners = isNo(params.showPartners) ? [] : event.sponsorTiers.flatMap((t) => t.sponsors).slice(0, 8);

    return {
      mailerId: this.id,
      subject: `${event.name}${event.dateLabel ? ` | ${event.dateLabel}` : ""}${event.city ? `, ${event.city}` : ""}`,
      /* ONEWORLD PORT: no "0+ speakers" for an event that has no speaker records yet */
      preheader: event.tagline || (event.speakers.length ? `${event.speakers.length}+ speakers. ${dateVenue(event)}` : dateVenue(event)),
      theme: params.theme || "site",
      accent: params.accent || undefined,
      // Section order follows the house mailers: artwork, CTA, labelled sections,
      // contacts, unsubscribe footer.
      blocks: compact([
        ...headerBlocks(event, params),
        ctaBlock(event, params, { align: "center" }),
        sectionLabel("Overview"),
        blockOf("heading", { text: params.headline || `Announcing ${event.name}`, size: 22, align: "center" }),
        blockOf("text", { text: params.intro || introFrom(event), size: 15, align: "center" }),
        metaBlock(event),
        isNo(params.showStats) || !event.stats.length ? null : blockOf("stats", { items: event.stats.slice(0, 4) }),
        bullets.length ? dividerBlock() : null,
        bullets.length ? sectionLabel(params.bulletsTitle || "Discussion topics") : null,
        bullets.length ? blockOf("bullets", { title: "", marker: "→", items: bullets.map((t) => ({ text: t })) }) : null,
        speakers.length ? dividerBlock() : null,
        speakers.length ? sectionLabel("Speakers") : null,
        speakers.length ? speakersBlock(speakers, {
          title: "",
          note: event.speakers.length > speakers.length ? `+ ${event.speakers.length - speakers.length} more leaders on stage.` : "",
        }) : null,
        partners.length ? dividerBlock() : null,
        partners.length ? sectionLabel("Partners") : null,
        partners.length ? sponsorsBlock(partners, "") : null,
        dividerBlock(),
        ctaBlock(event, params, { align: "center", note: "Seats are limited and allotted on approval." }),
        contactsBlock(),
        footerBlock(event),
      ]),
    };
  },
};
