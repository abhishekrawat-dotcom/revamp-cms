import type { Mailer } from "./mailer.ts";
import { blockOf } from "./blocks.ts";
import { dateVenue } from "./base.ts";
import {
  THEME_PARAM, ACCENT_PARAM, BANNER_PARAMS, headerBlocks, sectionLabel, metaBlock,
  ctaBlock, footerBlock, contactsBlock, dividerBlock, speakersBlock, listBlock,
  copyParams, ctaParams, overviewBlock, YES_NO, isNo, compact,
} from "./shared.ts";

// The "what we'll actually talk about" send, modelled on the reference
// keydiscussion mailers: agenda themes and the audience profile as ticked panels,
// the numbers band, then the line-up. Every section comes from the event APIs
// (`key_discussion_points`, `who_should_attend`, `why_join_us`) and each one drops
// out entirely when that field is empty for the event.
export const discussionMailer: Mailer = {
  id: "mailer.discussion",
  group: "Announcement",
  label: "Key Discussion Points",
  description: "Agenda themes and audience profile as ticked panels, with the numbers band and speaker preview.",
  params(event) {
    return [
      THEME_PARAM, ACCENT_PARAM, ...BANNER_PARAMS,
      ...copyParams("What we'll be discussing", ""),
      { key: "pointsStyle", label: "Section layout", type: "select", default: "panel",
        options: [
          { value: "panel", label: "Tinted panels" },
          { value: "ticks", label: "Ticked lists" },
          { value: "two", label: "Ticked, two columns" },
        ] },
      { key: "statStyle", label: "Numbers layout", type: "select", default: "panel",
        options: [
          { value: "panel", label: "Tinted panel, quartered" },
          { value: "band", label: "One band" },
          { value: "boxes", label: "Separate boxes" },
          { value: "solid", label: "Solid accent band" },
        ] },
      { key: "speakerCount", label: "Speakers to preview", type: "number", default: 4, hint: "0 hides the speaker block." },
      YES_NO("showMeta", "Date / venue tiles"),
      ...ctaParams(event),
    ];
  },
  requires(event) {
    const has = event.keyPoints.length || event.whoShouldAttend.length || event.whyJoin.length;
    return { ok: !!has, missing: has ? [] : ["key discussion points / who should attend"] };
  },
  build(event, params) {
    const nSpeakers = Number(params.speakerCount ?? 4);
    const speakers = nSpeakers > 0 ? event.speakers.slice(0, nSpeakers) : [];
    const style = String(params.pointsStyle || "panel");
    const points = listBlock(event.keyPoints, "Key discussion points", style);
    const who = listBlock(event.whoShouldAttend, "Who should attend", style);
    const why = listBlock(event.whyJoin, "Why join us", style);

    return {
      mailerId: this.id,
      subject: `On the table at ${event.name}`,
      preheader: event.keyPoints[0] || event.whyJoin[0] || dateVenue(event),
      theme: params.theme || "site",
      accent: params.accent || undefined,
      blocks: compact([
        ...headerBlocks(event, params),
        ctaBlock(event, params, { align: "center" }),
        sectionLabel("Overview"),
        blockOf("heading", { text: params.headline || "What we'll be discussing", size: 22, align: "center" }),
        overviewBlock(event, params),
        !event.stats.length ? null : blockOf("stats", {
          style: String(params.statStyle || "panel"),
          title: String(params.statStyle || "panel") === "panel" ? "Summit highlights" : "",
          items: event.stats.slice(0, 4),
        }),
        points ? dividerBlock() : null,
        points,
        who,
        why && !points ? why : null,          // "why join" only leads when there are no themes
        speakers.length ? dividerBlock() : null,
        speakers.length ? sectionLabel("Speakers") : null,
        speakers.length ? speakersBlock(speakers, { title: "", cols: 4 }) : null,
        isNo(params.showMeta) ? null : metaBlock(event),
        dividerBlock(),
        ctaBlock(event, params, { align: "center", note: "Seats are limited and allotted on approval." }),
        contactsBlock(),
        footerBlock(event),
      ]),
    };
  },
};
