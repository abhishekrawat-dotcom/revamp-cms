import type { Mailer } from "./mailer.ts";
import { blockOf } from "./blocks.ts";
import {
  THEME_PARAM, ACCENT_PARAM, BANNER_PARAMS, headerBlocks, heroBlock, sectionLabel,
  metaBlock, ctaBlock, footerBlock, contactsBlock, dividerBlock, speakersBlock,
  sponsorsBlock, sessionsBlock, listBlock, copyParams, ctaParams, overviewBlock,
  selectSpeakers, selectSponsors, selectSessions, YES_NO, isNo, compact,
} from "./shared.ts";

// The everything send: one mail carrying every section the event data can fill,
// so a sender starts from the whole story and cuts back rather than assembling
// it. The other mailers each answer one question — who is speaking, who is
// backing it, what is on the agenda — and this one answers all of them.
//
// Two rules shape what is actually in here, and they are why this is not simply
// "every block type":
//
//   • A block that renders nothing must not be in the document at all. Rule 7
//     says an empty section renders nothing, and the `editor` suite fails on a
//     block that is present but invisible — so every section below is guarded on
//     the data that fills it, and drops out entirely when the event has none.
//   • A section LABEL must never outlive its section. `geometry` fails on a
//     heading left stranded above an empty block, so each label is guarded by
//     the same condition as the content it introduces.
//
// That leaves `quote`, `image`, `html` and `spacer` out: the APIs expose nothing
// to fill them, and seeding them empty would either break those two rules or mean
// inventing content. They are one drag away in the studio.
export const allInOneMailer: Mailer = {
  id: "mailer.all-in-one",
  group: "All in one",
  label: "Everything",
  description: "Every section this event has data for — overview, numbers, topics, audience, speakers, a spotlight, agenda, partners and contacts — in one mail to cut back from.",
  params(event) {
    return [
      THEME_PARAM, ACCENT_PARAM, ...BANNER_PARAMS,
      ...copyParams(`Everything you need to know about ${event.name}`, ""),
      { key: "speakerCount", label: "Speakers to show", type: "number", default: 6,
        hint: "0 hides the speaker grid. The spotlight below is separate." },
      { key: "sessionCount", label: "Sessions to show", type: "number", default: 5 },
      YES_NO("showStats", "Numbers band"),
      YES_NO("showSpotlight", "Speaker spotlight"),
      YES_NO("showTopics", "Discussion topics"),
      YES_NO("showAudience", "Who should attend"),
      YES_NO("showPartners", "Partner logos"),
      YES_NO("showAgenda", "Agenda"),
      YES_NO("showContacts", "Contact rows"),
      ...ctaParams(event),
    ];
  },
  // Needs only what every mail needs. Each section decides for itself whether it
  // has anything to say, so a thin event yields a shorter mail rather than an
  // unavailable one.
  requires() {
    return { ok: true, missing: [] };
  },
  build(event, params) {
    const nSpeakers = Number(params.speakerCount ?? 6);
    const speakers = nSpeakers > 0 ? selectSpeakers(event, params, nSpeakers).slice(0, nSpeakers) : [];
    const sessions = isNo(params.showAgenda) ? [] : selectSessions(event, params, Number(params.sessionCount ?? 5));
    const tiers = isNo(params.showPartners) ? [] : selectSponsors(event, params);
    const topics = isNo(params.showTopics) ? [] : (event.keyPoints || []);
    const audience = isNo(params.showAudience) ? [] : (event.whoShouldAttend || []);
    const stats = isNo(params.showStats) ? [] : (event.stats || []);
    // The spotlight is the FIRST speaker, and the grid then shows the others —
    // the same person appearing twice reads as a mistake, not as emphasis.
    const star = !isNo(params.showSpotlight) && speakers.length ? speakers[0] : null;
    const grid = star ? speakers.slice(1) : speakers;

    const topicsList = topics.length ? listBlock(topics, "", "panel") : null;
    const audienceList = audience.length ? listBlock(audience, "", "ticks") : null;

    return {
      mailerId: this.id,
      subject: `Everything about ${event.name}`,
      preheader: `Speakers, agenda, partners and how to register.`,
      theme: params.theme || "site",
      accent: params.accent || undefined,
      blocks: compact([
        ...headerBlocks(event, params),
        heroBlock(event),

        sectionLabel("Overview"),
        overviewBlock(event, params),
        metaBlock(event),
        stats.length ? blockOf("stats", { items: stats.slice(0, 4) }) : null,

        topicsList ? dividerBlock() : null,
        topicsList ? sectionLabel("Discussion topics") : null,
        topicsList,

        audienceList ? dividerBlock() : null,
        audienceList ? sectionLabel("Who should attend") : null,
        audienceList,

        star ? dividerBlock() : null,
        star ? blockOf("speaker", {
          eyebrow: "In the spotlight", name: star.name, role: star.designation,
          company: star.company, photo: star.photoUrl || "", link: (star as any).linkedin || "",
        }) : null,

        grid.length ? dividerBlock() : null,
        grid.length ? speakersBlock(grid, { title: star ? "Also speaking" : "Speakers" }) : null,

        sessions.length ? dividerBlock() : null,
        sessions.length ? sessionsBlock(sessions, { title: "On the agenda", showSpeakers: true }) : null,

        tiers.length ? dividerBlock() : null,
        tiers.length ? sponsorsBlock(tiers.flatMap((t) => t.sponsors), "Our partners") : null,

        dividerBlock(),
        ctaBlock(event, params, { align: "center" }),
        isNo(params.showContacts) ? null : contactsBlock(),
        footerBlock(event),
      ]),
    };
  },
};
