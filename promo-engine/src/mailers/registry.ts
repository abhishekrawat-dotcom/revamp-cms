import type { Mailer } from "./mailer.ts";
import type { EventEntity } from "../model/types.ts";
import type { ParamDef } from "../templates/template.ts";
import { resolveParamOptions } from "../templates/registry.ts";
import { renderDoc, blockPalette, blockIsEmpty, type MailerDoc, type Field } from "./blocks.ts";

import { announcementMailer } from "./announcement.ts";
import { speakersMailer, speakerSpotlightMailer } from "./speakers.ts";
import { partnersMailer, partnerSpotlightMailer } from "./partners.ts";
import { agendaMailer } from "./agenda.ts";
import { discussionMailer } from "./discussion.ts";
import { reminderMailer } from "./reminder.ts";
import { conferenceMailer } from "./conference.ts";
import { resilienceMailer } from "./resilience.ts";
import { decryptMailer } from "./decrypt.ts";
import {
  awardNominationsMailer, awardDeadlineMailer, awardJuryMailer,
  awardCeremonyMailer, awardWinnersMailer,
} from "./awards.ts";
import { allInOneMailer } from "./allinone.ts";
import { blankMailer } from "./blank.ts";

export const ALL_MAILERS: Mailer[] = [
  announcementMailer,
  discussionMailer,
  speakersMailer,
  speakerSpotlightMailer,
  partnersMailer,
  partnerSpotlightMailer,
  agendaMailer,
  reminderMailer,
  // The two design-led sends sit with the focused ones: each answers a single
  // question (come to this session / here is who is judging), and each is offered
  // only when the event carries what its layout is built around — the invitation
  // needs the event's own reasons to attend, the teaser needs a roster.
  resilienceMailer,
  decryptMailer,
  // The award family, in the order an award actually lives: entries open, the
  // deadline, who is deciding, the night itself, the result. Every one of them
  // is greyed out on an ordinary event and on an award in the wrong phase, so
  // the list a sender sees on an award is only the sends that are true today.
  awardNominationsMailer,
  awardDeadlineMailer,
  awardJuryMailer,
  awardCeremonyMailer,
  awardWinnersMailer,
  // The everything send sits after the focused ones: you reach for it when you
  // want the whole story in front of you and would rather cut than assemble.
  conferenceMailer,
  allInOneMailer,
  // Last: it is the escape hatch, not a starting point. Everything above answers
  // "build me this kind of send"; this one answers "get out of my way".
  blankMailer,
];

export function getMailer(id: string): Mailer | undefined {
  return ALL_MAILERS.find((m) => m.id === id);
}

/** Declared defaults under user overrides (same contract as the social templates). */
export function resolveMailerParams(m: Mailer, event: EventEntity, overrides: Record<string, any> = {}): Record<string, any> {
  const out: Record<string, any> = {};
  for (const p of m.params(event)) if (p.default !== undefined) out[p.key] = p.default;
  return { ...out, ...overrides };
}

/** Seed a fresh block document from live event data. */
export function buildDoc(m: Mailer, event: EventEntity, overrides: Record<string, any> = {}): MailerDoc {
  return m.build(event, resolveMailerParams(m, event, overrides));
}

export { renderDoc };

export interface MailerCatalogEntry {
  id: string;
  group: string;
  label: string;
  description: string;
  params: ParamDef[];
  available: boolean;
  missing: string[];
  /** Default subject line, so the card can show what lands in the inbox. */
  subject: string;
  /** Block types in order, skipping the ones that would render nothing for this
   *  event — the shape of the mail, for the card's wireframe. Free: the doc is
   *  already built here for the subject line, so this costs no extra work. */
  outline: string[];
  /** Whether this mailer type fits how far away the event currently is. */
  suggested: boolean;
}

const EMPTY_EVENT = {
  speakers: [], sponsorTiers: [], sessions: [], stats: [],
  keyPoints: [], whyJoin: [], whoShouldAttend: [],
} as unknown as EventEntity;

/** Which promotion phase each timing-aware mailer fits. The award family and the
 *  full/everything/blank sends are deliberately absent — the award mailers gate
 *  themselves via their own requires(event), and the rest are fine at any time,
 *  so flagging them here would be noise rather than signal. */
const MAILER_PHASE: Record<string, "early" | "mid" | "near"> = {
  "mailer.announcement": "early",
  "mailer.discussion": "early",
  "mailer.speakers": "early",
  "mailer.speaker-spotlight": "mid",
  "mailer.partners": "mid",
  "mailer.partner-spotlight": "mid",
  "mailer.agenda": "mid",
  "mailer.resilience": "mid",
  "mailer.decrypt": "mid",
  "mailer.reminder": "near",
};

/** Whole days from now until the event starts, or null when startDate is
 *  missing/unparseable. Calendar-day granularity — not timezone-precise. */
function daysUntilEvent(event: EventEntity): number | null {
  if (!event.startDate) return null;
  const start = new Date(event.startDate);
  if (Number.isNaN(start.getTime())) return null;
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((start.getTime() - Date.now()) / msPerDay);
}

/** The current promotion phase for an event, or null when timing is unknown or
 *  the event has already started/ended (nothing left to promote before it). */
function eventPhase(event: EventEntity): "early" | "mid" | "near" | null {
  const days = daysUntilEvent(event);
  if (days === null || days < 0) return null;
  if (days > 21) return "early";
  if (days >= 3) return "mid";
  return "near";
}

/** Every mailer annotated with availability + event-resolved params/options,
 *  plus the block palette + field schemas the studio's settings panel renders from. */
export function buildMailerCatalog(event?: EventEntity): {
  mailers: MailerCatalogEntry[];
  blocks: { type: string; label: string; icon: string; addable: boolean; fields: Field[] }[];
} {
  const phase = event ? eventPhase(event) : null;
  const mailers = ALL_MAILERS.map((m): MailerCatalogEntry => {
    const avail = event ? m.requires(event) : { ok: true, missing: [] };
    const params = event
      ? m.params(event).map((p) => resolveParamOptions(p, event))
      : m.params(EMPTY_EVENT);
    // One build serves both the subject line and the wireframe outline; building
    // it twice would double the catalog's cost for no gain.
    const doc = event && avail.ok ? buildDoc(m, event) : null;
    return {
      id: m.id, group: m.group, label: m.label, description: m.description,
      params, available: avail.ok, missing: avail.missing,
      subject: doc ? doc.subject : "",
      outline: doc && event
        ? doc.blocks.filter((b) => !blockIsEmpty(b, event, doc)).map((b) => b.type)
        : [],
      suggested: phase !== null && MAILER_PHASE[m.id] === phase,
    };
  });
  return { mailers, blocks: blockPalette() };
}

/** Filename for a downloaded mailer. */
export function mailerFileName(m: Mailer, event: EventEntity): string {
  const slug = (s: string) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${slug(event.name).slice(0, 48)}-${slug(m.id.replace(/^mailer\./, ""))}.html`;
}
