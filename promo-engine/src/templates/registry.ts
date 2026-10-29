import type { Template, ParamDef, Category } from "./template.ts";
import type { EventEntity } from "../model/types.ts";
import { FORMATS, type FormatId } from "./formats.ts";
// ONEWORLD PORT: the PSD frame (psd.partner) is not part of Oneworld (map-psd F10), so its reader is not imported:
// Oneworld reads a PSD in the browser for its background and logo only.

import { announcement } from "./generic/announcement.ts";
import { whoShouldAttend } from "./generic/who-should-attend.ts";
import { summitHighlights } from "./generic/summit-highlights.ts";
import { predictionOutcome } from "./generic/prediction-outcome.ts";
import { testimonial } from "./generic/testimonial.ts";
import { tierLadder } from "./partner/tier-ladder.ts";
import { presentingSpotlight } from "./partner/presenting-spotlight.ts";
import { individualSpeaker } from "./speaker/individual.ts";
import { combinedSpeakers } from "./speaker/combined.ts";

export const ALL_TEMPLATES: Template[] = [
  announcement,
  whoShouldAttend,
  summitHighlights,
  predictionOutcome,
  testimonial,
  tierLadder,
  presentingSpotlight,
  individualSpeaker,
  combinedSpeakers,
];

export function getTemplate(id: string): Template | undefined {
  return ALL_TEMPLATES.find((t) => t.id === id);
}

/** Merge a template's declared param defaults under any user-supplied overrides. */
export function resolveParams(tpl: Template, overrides: Record<string, any> = {}): Record<string, any> {
  const out: Record<string, any> = {};
  for (const p of tpl.params) if (p.default !== undefined) out[p.key] = p.default;
  return { ...out, ...overrides };
}

const CATEGORY_LABELS: Record<Category, string> = {
  generic: "Generic",
  partner: "Partner",
  speaker: "Speaker",
};

// Resolve a data-bound param's options against a specific event. This is what
// powers the front-end's dependent dropdowns (pick speaker, pick tier, …).
// Shared with the mailer catalog (see ../mailers/registry.ts).
export function resolveParamOptions(p: ParamDef, event: EventEntity): ParamDef {
  // Editable stats: pre-fill defaults from the event's computed stats.
  if (p.type === "stats") return { ...p, default: event.stats };
  if (!p.source) return p;
  let options: { value: string | number; label: string }[] = [];
  switch (p.source) {
    case "speakers":
      options = event.speakers.map((s) => ({ value: s.id, label: `${s.name} — ${s.company}` }));
      break;
    case "speakerGroups":
      options = [...new Set(event.speakers.map((s) => s.group).filter(Boolean) as string[])]
        .map((g) => ({ value: g, label: g }));
      break;
    case "sponsors":
      options = event.sponsorTiers.flatMap((t) =>
        t.sponsors.map((s) => ({ value: s.id, label: `${s.title} — ${t.tier}` })));
      break;
    case "sponsorTiers":
      options = event.sponsorTiers.map((t) => ({ value: t.tier, label: `${t.tier} (${t.sponsors.length})` }));
      break;
    case "sessions":
      options = event.sessions.map((s) => ({ value: s.id, label: s.title }));
      break;
  }
  return { ...p, options };
}

export interface CatalogEntry {
  id: string;
  category: Category;
  subtype: string;
  label: string;
  description: string;
  formats: { id: string; label: string; ratio: string }[];
  params: ParamDef[];
  available: boolean;
  missing: string[];
  isNew: boolean;
  kind: "code" | "psd";
}

export interface Catalog {
  categories: { key: Category; label: string; templates: CatalogEntry[] }[];
}

/**
 * The selection model. Given an event, returns every template organised by
 * category, each annotated with:
 *  - availability (does the event have the data?) -> drives filtering/greying-out
 *  - supported formats (aspect-ratio axis)
 *  - resolved params (the extra selection axes: which speaker/tier/group, limits)
 * Call with no event to get the raw catalog (labels only, all "available").
 */
export async function buildCatalog(event?: EventEntity): Promise<Catalog> {
  const cats: Category[] = ["generic", "partner", "speaker"];
  // ONEWORLD PORT: no PSD frames (see the imports), so there are no PSD entries; the catalog keeps the
  // platform's shape and order, with every entry `kind: "code"`.
  const psdEntries = async (_key: Category): Promise<CatalogEntry[]> => [];
  const THEME_PARAM: ParamDef = {
    key: "theme", label: "Theme", type: "select", default: "dark",
    options: [{ value: "dark", label: "Dark bg · light text" }, { value: "light", label: "Light bg · dark text" }],
    hint: "Flips text colours for the background you're placing it on.",
  };
  const codeEntries = (key: Category): CatalogEntry[] =>
    ALL_TEMPLATES.filter((t) => t.category === key).map((t): CatalogEntry => {
      const avail = event ? t.requires(event) : { ok: true, missing: [] };
      return {
        id: t.id, category: t.category, subtype: t.subtype, label: t.label, description: t.description,
        formats: t.formats.map((f) => ({ id: f, label: FORMATS[f].label, ratio: FORMATS[f].ratio })),
        params: [THEME_PARAM, ...(event ? t.params.map((p) => resolveParamOptions(p, event)) : t.params)],
        available: avail.ok, missing: avail.missing, isNew: false, kind: "code",
      };
    });
  const categories = await Promise.all(cats.map(async (key) => ({
    key, label: CATEGORY_LABELS[key],
    templates: [...(await psdEntries(key)), ...codeEntries(key)], // NEW PSD frames first
  })));
  return { categories };
}
