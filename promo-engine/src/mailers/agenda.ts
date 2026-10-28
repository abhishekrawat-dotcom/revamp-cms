import type { Mailer } from "./mailer.ts";
import { blockOf } from "./blocks.ts";
import { dateVenue } from "./base.ts";
import {
  THEME_PARAM, ACCENT_PARAM, BANNER_PARAMS, headerBlocks, logoBlock, heroBlock, sectionLabel, metaBlock,
  ctaBlock, footerBlock, contactsBlock, dividerBlock, sessionsBlock, speakersBlock, copyParams, ctaParams,
  selectSessions, isNo, YES_NO, compact,
  overviewBlock,
} from "./shared.ts";

// Agenda drop: the sessions themselves are the pitch.
export const agendaMailer: Mailer = {
  id: "mailer.agenda",
  group: "Agenda",
  label: "Agenda / Sessions",
  description: "Session-by-session send: times, titles and the speakers on each panel, with a CTA to the full agenda.",
  params(event) {
    return [
      THEME_PARAM, ACCENT_PARAM, ...BANNER_PARAMS,
      { key: "sessionIds", label: "Pick sessions", type: "multiselect", source: "sessions",
        hint: "Leave empty to auto-pick the earliest sessions in time order." },
      { key: "limit", label: "Auto-pick count", type: "number", default: 6 },
      ...copyParams("The agenda is live", `Here's what the ${event.dateLabel ? `${event.dateLabel} ` : ""}programme looks like.`),
      YES_NO("showSessionSpeakers", "Speakers under each session"),
      { key: "speakerCount", label: "Speaker grid at the bottom", type: "number", default: 0, hint: "0 hides it." },
      ...ctaParams(event),
    ];
  },
  requires(event) {
    return { ok: event.sessions.length >= 1, missing: event.sessions.length ? [] : ["agenda sessions"] };
  },
  build(event, params) {
    const list = selectSessions(event, params);
    const nSpeakers = Number(params.speakerCount ?? 0);
    const speakers = nSpeakers > 0 ? event.speakers.slice(0, nSpeakers) : [];

    return {
      mailerId: this.id,
      subject: `Inside the agenda: ${list.length} session${list.length === 1 ? "" : "s"} at ${event.name}`,
      preheader: list.slice(0, 2).map((s) => s.title).join(" • ") || dateVenue(event),
      theme: params.theme || "site",
      accent: params.accent || undefined,
      blocks: compact([
        ...headerBlocks(event, params),
        sectionLabel("Agenda"),
        blockOf("heading", { text: params.headline || "The agenda is live", size: 22, align: "center" }),
        overviewBlock(event, params),
        sessionsBlock(list, { title: "", showSpeakers: !isNo(params.showSessionSpeakers) }),
        event.sessions.length > list.length
          ? blockOf("text", { text: `+ ${event.sessions.length - list.length} more sessions in the full agenda.`, size: 13.5 })
          : null,
        metaBlock(event),
        speakers.length ? dividerBlock() : null,
        speakers.length ? speakersBlock(speakers, { title: "On stage" }) : null,
        dividerBlock(),
        ctaBlock(event, params, { align: "center", note: "See the full programme and reserve your seat." }),
        contactsBlock(),
        footerBlock(event),
      ]),
    };
  },
};
