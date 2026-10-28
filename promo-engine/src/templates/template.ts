import type { EventEntity } from "../model/types.ts";
import type { FormatId } from "./formats.ts";
import type { TemplateContext } from "./base.ts";

export type Category = "generic" | "partner" | "speaker";

export interface ParamDef {
  key: string;
  label: string;
  // multiselect => the user hand-picks which speakers/sponsors appear.
  // stats => editable list of {value,label} tiles (defaults from the event).
  // image => an image URL slot (background / logo).
  // textarea => multi-line copy (mailer body text).
  type: "select" | "multiselect" | "number" | "text" | "textarea" | "stats" | "image";
  options?: { value: string | number; label: string }[];
  default?: string | number | { value: string; label: string }[];
  hint?: string; // shown under the control in the UI
  // For data-bound (multi)selects, the front-end fills options from the event;
  // `source` tells it where from.
  source?: "speakers" | "speakerGroups" | "sponsors" | "sponsorTiers" | "sessions";
}

export interface Availability {
  ok: boolean;
  missing: string[];
}

export interface Template {
  id: string;
  category: Category;
  subtype: string;
  label: string;
  description: string;
  /** Aspect ratios this template supports. */
  formats: FormatId[];
  /** Selection axes beyond category/subtype/format (the "multiple bases"). */
  params: ParamDef[];
  /** Is there enough event data to render this at all? Drives dropdown filtering. */
  requires(event: EventEntity): Availability;
  render(ctx: TemplateContext): string;
  /** Platform-agnostic caption; the CLI writes these into captions.json. */
  caption(ctx: TemplateContext): string;
}

export const ALL_RATIOS: FormatId[] = ["ig_square", "ig_portrait", "landscape", "story"];
