import type { Mailer } from "./mailer.ts";
import { blockOf } from "./blocks.ts";
import { dateVenue, daysToGo } from "./base.ts";
import {
  THEME_PARAM, ACCENT_PARAM, logoBlock, sectionLabel, metaBlock, ctaBlock, footerBlock, contactsBlock, dividerBlock,
  speakersBlock, copyParams, ctaParams, bulletsFor, BULLET_SOURCE_PARAM, YES_NO, isNo, compact,
  overviewBlock,
} from "./shared.ts";

// Urgency send. No banner: a countdown band does the work, so it stays light and
// renders fast in the inbox.
export const reminderMailer: Mailer = {
  id: "mailer.reminder",
  group: "Reminder",
  label: "Final Call / Countdown",
  description: "Urgency send: days-to-go band, one-line pitch, stat tiles, speaker strip and a single hard CTA.",
  params(event) {
    const d = daysToGo(event);
    return [
      THEME_PARAM, ACCENT_PARAM,
      { key: "countdown", label: "Countdown line", type: "text",
        default: d ? `${d} day${d === 1 ? "" : "s"} to go` : "Registrations closing soon",
        hint: "Auto-computed from the event start date — override for 'Last 48 hours', etc." },
      ...copyParams(
        d && d <= 7 ? "Final call to register" : "Don't miss your seat",
        `${event.name} is ${event.dateLabel ? `on ${event.dateLabel}` : "almost here"}${event.venue ? ` at ${event.venue}` : ""}. Confirm your seat before registrations close.`,
      ),
      BULLET_SOURCE_PARAM,
      { key: "speakerCount", label: "Speakers to show", type: "number", default: 3, hint: "0 hides the speaker strip." },
      YES_NO("showStats", "Stat tiles"),
      ...ctaParams(event),
    ];
  },
  requires(event) {
    if (!event.name) return { ok: false, missing: ["event name"] };
    // A "registrations closing soon" reminder for an event that has already
    // happened is contradictory. If the end date is in the past, the reminder is
    // the wrong send — the catalog greys it out with a reason.
    const end = event.endDate || event.startDate;
    const past = end ? new Date(String(end).replace(" ", "T")).getTime() < Date.now() : false;
    if (past) return { ok: false, missing: ["an upcoming date (this event has already taken place)"] };
    return { ok: true, missing: [] };
  },
  build(event, params) {
    const d = daysToGo(event);
    const bullets = bulletsFor(event, params.bulletSource).slice(0, 4);
    const nSpeakers = Number(params.speakerCount ?? 3);
    const speakers = nSpeakers > 0 ? event.speakers.slice(0, nSpeakers) : [];
    const countdown = String(params.countdown ?? (d ? `${d} day${d === 1 ? "" : "s"} to go` : "Registrations closing soon")).trim();

    return {
      mailerId: this.id,
      subject: d ? `${d} day${d === 1 ? "" : "s"} to go: ${event.name}` : `Last chance to register: ${event.name}`,
      preheader: `${dateVenue(event)} — confirm your seat.`,
      theme: params.theme || "site",
      accent: params.accent || undefined,
      blocks: compact([
        logoBlock(event),
        // The countdown band is a hero with no sub-line: full-width colour, one line.
        countdown ? blockOf("hero", { ribbon: "", title: countdown, sub: "", meta: dateVenue(event) }) : null,
        sectionLabel(event.hashtag),
        blockOf("heading", { text: params.headline || "Don't miss your seat", size: 25, align: "center" }),
        overviewBlock(event, params),
        ctaBlock(event, params, { align: "center" }),
        metaBlock(event),
        isNo(params.showStats) || !event.stats.length ? null : blockOf("stats", { items: event.stats.slice(0, 4) }),
        bullets.length ? dividerBlock() : null,
        bullets.length ? blockOf("bullets", { title: "What you'll walk away with", marker: "✓", items: bullets.map((t) => ({ text: t })) }) : null,
        speakers.length ? dividerBlock() : null,
        speakers.length ? speakersBlock(speakers, { title: "Who you'll meet" }) : null,
        dividerBlock(),
        ctaBlock(event, params, { align: "center" }),
        contactsBlock(),
        footerBlock(event),
      ]),
    };
  },
};
