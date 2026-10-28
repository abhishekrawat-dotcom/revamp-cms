import type { EventEntity } from "../model/types.ts";
import { BLOCK_SCHEMAS } from "../mailers/blocks.ts";

// AI copy assistance for the mailer studio: subject lines, per-block rewrites, a
// whole-document polish, and the full redesign. All four go through one
// structured, non-streaming call.
//
// ---------------------------------------------------------------------------
// WHY THERE ARE TWO TIERS RATHER THAN ONE MODEL
// ---------------------------------------------------------------------------
// Three of the four jobs are small and well specified — "write six subject
// lines", "tighten this paragraph". The fourth rebuilds a whole document's
// structure and copy. Paying the top rate for the first three to protect the
// fourth is the expensive mistake, and downgrading the fourth to save on the
// first three is the quality mistake. So the model is chosen per job:
//
//   subjects / rewrite / polish -> Haiku 4.5   $1 / $5   per MTok
//   enhance (the redesign)      -> Opus 5      $5 / $25  per MTok
//
// The redesign is one click and runs rarely; the small ops run constantly. That
// asymmetry is where the money actually is — and nothing about it touches the
// quality of the redesign itself.
//
// ---------------------------------------------------------------------------
// WHY CACHING IS ON FOR ONE TIER AND OFF FOR THE OTHER
// ---------------------------------------------------------------------------
// A cached prefix is billed at ~0.1x on a read and ~1.25x on the write, so it
// pays back on the second call of a window. But the minimum cacheable prefix is
// ~1024 tokens, and BELOW THAT NOTHING CACHES AND NOTHING WARNS YOU.
//
// Measured here: the instructions alone are ~248 tokens and the block reference
// another ~542 — ~790 together, still short. So `cache_control` on the small-op
// prompt would be decoration: it would cache nothing and bill full price.
//
// Worse, padding the small ops up to the floor would COST money, not save it. A
// ~2k-token prefix that does not cache is ~2k tokens at full rate on every
// subject-line click, against a few hundred for a lean prompt.
//
// So: the small ops get a LEAN, uncached prompt. The redesign gets the rich one
// — instructions, the generated block reference, the house style rules — which
// clears the floor honestly, is identical between calls, and is read back at
// 0.1x every time the sender re-runs with a different tone.
// ---------------------------------------------------------------------------

/** Opus 5 for the redesign: it is the one call where structure and judgement
 *  matter, and the brief was explicit that quality is not the thing to trade. */
const MODEL_DEEP = process.env.AI_MODEL_DEEP || "claude-opus-5";
/** Haiku 4.5 for the short, well-specified rewrites. */
const MODEL_FAST = process.env.AI_MODEL_FAST || "claude-haiku-4-5";
/** The redesign's quality/cost dial. `high` is the default for a reason; drop it
 *  to `medium` only if the bill matters more than the output. */
const EFFORT_DEEP = (process.env.AI_EFFORT || "high") as "low" | "medium" | "high" | "xhigh" | "max";

export class AiUnavailable extends Error {}

// What a marketer sees when AI help hasn't been switched on. It names no env
// var, file or command, because none of those are theirs to change.
const NO_CREDS = "AI assistance isn't set up yet. Ask your admin to switch it on, then try again.";

// These messages double as the operator's cue that the key is missing, so the
// technical detail (which env var, where) goes to the server log for an admin
// while the marketer-facing `.message` stays plain. Keep the two in sync here.
function noCreds(): AiUnavailable {
  console.warn(
    "[ai] No Anthropic credentials found. Set ANTHROPIC_API_KEY (or ANTHROPIC_AUTH_TOKEN, or an `ant auth login` profile) for app/.env, then restart the server.",
  );
  return new AiUnavailable(NO_CREDS);
}

/* ONEWORLD PORT: the model is not called from here. The host (Oneworld's functions/lib/promo-mailer.js) hands
   in one function that sends a prompt + JSON schema through its own AI layer (llm.js: Claude first, Gemini as the
   fallback) and returns the parsed answer, or throws AiUnavailable with a sentence fit for a marketer. Everything
   else in this file — the prompts, tones, schemas and what is done with the answers — is the platform's own. */
export interface AiCall { op: string; deep: boolean; system: string; user: string; schema: Record<string, any>; maxTokens: number }
export type AiCaller = (call: AiCall) => Promise<any>;
let caller: AiCaller | null = null;
export function setAiCaller(fn: AiCaller | null): void { caller = fn; }

/** The block reference, generated from the registry rather than written out, so
 *  it cannot drift from what the renderer actually accepts — and so it is
 *  byte-identical between calls, which is what makes the prefix cacheable at
 *  all. One re-ordered key here would invalidate the cache silently. */
function blockReference(): string {
  return Object.entries(BLOCK_SCHEMAS)
    .filter(([, sc]) => (sc as any).addable !== false)
    .map(([id, sc]) => `- ${id} (${(sc as any).label}) — ${((sc as any).fields || []).map((f: any) => f.key).join(", ")}`)
    .join("\n");
}

/** Compact event brief the model writes against. */
export function eventBrief(event: EventEntity): string {
  const lines = [
    `Event: ${event.name}`,
    event.edition ? `Edition: ${event.edition}` : "",
    event.tagline ? `Tagline: ${event.tagline}` : "",
    event.dateLabel ? `Date: ${event.dateLabel}` : "",
    event.venue || event.city ? `Venue: ${event.venue || event.city}` : "",
    `Hashtag: ${event.hashtag}`,
    event.speakers.length ? `Speakers: ${event.speakers.length} (e.g. ${event.speakers.slice(0, 4).map((s) => `${s.name}, ${s.company}`).join("; ")})` : "",
    event.sponsorTiers.length ? `Partners: ${event.sponsorTiers.flatMap((t) => t.sponsors).slice(0, 5).map((s) => s.title).join(", ")}` : "",
    event.keyPoints.length ? `Key themes: ${event.keyPoints.slice(0, 5).join(" | ")}` : "",
    event.whoShouldAttend.length ? `Audience: ${event.whoShouldAttend.slice(0, 4).join(", ")}` : "",
    `CTA: ${event.ctaLabel}`,
  ];
  return lines.filter(Boolean).join("\n");
}

const TONES: Record<string, string> = {
  professional: "measured B2B professional — precise, no hype, no exclamation marks",
  punchy: "short, punchy and concrete — front-load the value, cut every filler word",
  warm: "warm and personal, as if written by one person inviting another",
  urgent: "urgent but not shouty — make the deadline and scarcity concrete",
  editorial: "editorial and insight-led, like a newsletter lede rather than an ad",
};
export const TONE_OPTIONS = Object.keys(TONES);
const toneOf = (t?: string) => TONES[String(t || "professional")] || TONES.professional;

const SYSTEM = `You are a senior B2B event-marketing copywriter for The Economic Times' industry brands (ETBrandEquity, ETCIO, ETCISO, ET Infra and similar).
You write promotional EMAIL copy for real business audiences: CXOs, senior marketers, technology and infrastructure leaders in India.

Rules:
- Write only what is asked for. Never invent facts — no fabricated names, numbers, dates, venues, claims or quotes. Use only what the event brief provides.
- Keep Indian English conventions and the event's own naming exactly as given.
- No emoji, no ALL CAPS words, no "Don't miss out!"-style filler, no exclamation marks unless the tone explicitly calls for one.
- Subject lines: under 60 characters where possible. Preview text: 40-90 characters, and must add information rather than repeat the subject.
- Body copy stays scannable: short sentences, no marketing throat-clearing.
- Preserve any {{merge_tag}} placeholders exactly.`;

/** The rich prefix, for the redesign only. Deliberately over the ~1024-token
 *  cache floor: instructions, the generated block reference, and the house rules
 *  that make the difference between "rewritten" and "usable". It is read back at
 *  ~0.1x on every re-run, so its size costs almost nothing after the first call
 *  of a window — and it is the same bytes every time, or it would cache nothing. */
const SYSTEM_DEEP = `${SYSTEM}

You are rebuilding a whole mailer, not editing one field. Reorder, merge and drop
sections where it helps. Do not use a block type that is not listed here.

Sequence a mailer the way a reader scans one: impact first, then the reason to
care, then the detail that proves it, then the ask. A hero or banner opens; a
figures band or icon tiles carry the reason; speakers, agenda and partners carry
the proof; buttons and contacts close. Prefer a figures band to a paragraph of
numbers, and give one speaker a spotlight rather than flattening everyone into a
grid.

Block types you may use, with their editable fields:
${blockReference()}

The tone you are given will be one of these. Write to its definition, not to the
word:
${Object.entries(TONES).map(([k, v]) => `- ${k}: ${v}`).join("\n")}

House rules the layout must respect, because the renderer enforces them and a
section that fights them looks broken in an inbox:
- A mail is one 750px column. Nothing sits side by side except within a block
  that is built for it, and every grid collapses on a phone.
- A section with no content renders as nothing. Dropping a block is better than
  keeping it with a placeholder in it, and better than inventing content to fill
  it.
- Figures belong in a figures band, not in prose. "12+ speakers" is a tile.
- One idea per block. A paragraph carrying a heading, a statistic and a call to
  action should be three blocks.
- Buttons carry a verb and a destination. Two buttons in a row is one too many
  unless they are genuinely different asks.
- Copy is read on a phone first: short sentences, no throat-clearing, the point
  in the first line.

What NOT to change, ever: dates, times, venues, names, company names, figures,
URLs and merge tags. You may re-word around them. You may not add one that was
not given to you, and you may not adjust one that was.`;

/** Which model, and how hard it works, per job. `effort` is deliberately absent
 *  on the fast tier: Haiku 4.5 REJECTS `output_config.effort`, so sending it
 *  would turn every subject-line click into a 400. */
type Op = "subjects" | "rewrite" | "polish" | "enhance";
const PLAN: Record<Op, { model: string; deep: boolean }> = {
  subjects: { model: MODEL_FAST, deep: false },
  rewrite: { model: MODEL_FAST, deep: false },
  polish: { model: MODEL_FAST, deep: false },
  enhance: { model: MODEL_DEEP, deep: true },
};

/** What the last call cost, so "caching is working" is an observation rather
 *  than an assumption. Read it after any op; `cacheRead > 0` is the only real
 *  evidence a cached prefix is being hit. */
export interface AiSpend {
  op: string; model: string;
  input: number; output: number; cacheWrite: number; cacheRead: number;
}
export let lastSpend: AiSpend | null = null;

/** One structured, non-streaming call. Throws AiUnavailable on auth problems. */
async function ask<T>(op: Op, userPrompt: string, schema: Record<string, any>, maxTokens = 4000): Promise<T> {
  const plan = PLAN[op];
  if (!caller) throw noCreds();
  const parsed = await caller({ op, deep: plan.deep, system: plan.deep ? SYSTEM_DEEP : SYSTEM, user: userPrompt, schema, maxTokens });
  lastSpend = { op, model: plan.model, input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
  if (parsed == null || typeof parsed !== "object") throw new AiUnavailable("The AI's response didn't come through cleanly. Please try again.");
  return parsed as T;
}

// ---- subject lines ----------------------------------------------------------

const SUBJECT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["options"],
  properties: {
    options: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["subject", "preheader", "angle"],
        properties: {
          subject: { type: "string" },
          preheader: { type: "string" },
          angle: { type: "string", description: "2-5 words naming the angle, e.g. 'speaker-led' or 'deadline'" },
        },
      },
    },
  },
};

export interface SubjectOption { subject: string; preheader: string; angle: string }

export async function suggestSubjects(event: EventEntity, o: { tone?: string; kind: string; current?: string; body?: string }): Promise<SubjectOption[]> {
  const out = await ask<{ options: SubjectOption[] }>("subjects",
    `Write 5 alternative subject lines (each with matching preview text) for a promotional email.

Mailer type: ${o.kind}
Tone: ${toneOf(o.tone)}
${o.current ? `Current subject (improve on it, don't just reword): ${o.current}` : ""}

EVENT BRIEF
${eventBrief(event)}
${o.body ? `\nMAIL BODY (for context; do not restate it)\n${o.body.slice(0, 1500)}` : ""}

Give 5 genuinely different angles — vary what leads (the speakers, the theme, the audience, the date/deadline, the outcome). Each subject must stand alone in a crowded inbox.`,
    SUBJECT_SCHEMA,
  );
  return (out.options || []).slice(0, 5);
}

// ---- single-field rewrite ---------------------------------------------------

const REWRITE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["text", "note"],
  properties: {
    text: { type: "string", description: "The rewritten copy, plain text. Keep line breaks where the original had them." },
    note: { type: "string", description: "One short sentence on what changed." },
  },
};

export async function rewriteField(event: EventEntity, o: { text: string; tone?: string; what: string; instruction?: string }): Promise<{ text: string; note: string }> {
  return ask<{ text: string; note: string }>("rewrite",
    `Rewrite this piece of email copy.

What it is: ${o.what}
Tone: ${toneOf(o.tone)}
${o.instruction ? `Extra instruction: ${o.instruction}` : ""}

EVENT BRIEF
${eventBrief(event)}

CURRENT COPY
"""
${o.text}
"""

Keep roughly the same length unless it is padded. Return plain text only — no markdown, no HTML, no quotes around it.`,
    REWRITE_SCHEMA,
  );
}

// ---- whole-document polish --------------------------------------------------

const POLISH_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["ref", "text"],
        properties: {
          ref: { type: "string", description: "The ref string from the input, copied exactly" },
          text: { type: "string", description: "The rewritten copy for that ref" },
        },
      },
    },
    summary: { type: "string" },
  },
};

export interface PolishItem { ref: string; what: string; text: string }

export async function polishCopy(event: EventEntity, o: { items: PolishItem[]; tone?: string; kind: string }): Promise<{ items: { ref: string; text: string }[]; summary?: string }> {
  const listing = o.items.map((i) => `ref: ${i.ref}\nfield: ${i.what}\ncopy: ${JSON.stringify(i.text)}`).join("\n---\n");
  return ask<{ items: { ref: string; text: string }[]; summary?: string }>("polish",
    `Polish every copy field in this ${o.kind} email so it reads as one coherent, well-written send.

Tone: ${toneOf(o.tone)}

EVENT BRIEF
${eventBrief(event)}

FIELDS (return one item per ref, with the ref copied exactly)
${listing}

Rules for this pass:
- Headings stay short (under 8 words). Button labels stay under 4 words.
- Keep each field's role: a heading stays a heading, a bullet stays one line.
- Remove repetition across fields — if two fields say the same thing, differentiate them.
- Do not add new claims, numbers or names.`,
    POLISH_SCHEMA,
    8000,
  );
}


// ---- whole-mailer enhancer ---------------------------------------------------

const ENHANCE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["copy", "order", "remove", "summary"],
  properties: {
    theme: { type: "string", enum: ["site", "light", "dark"] },
    background: { type: "string", description: "Hex like #0f1b2d, or empty string to leave the palette default" },
    accent: { type: "string", description: "Hex, or empty string to keep the event's own accent" },
    copy: {
      type: "array",
      description: "Rewritten copy, one entry per ref you want to change. Omit refs you'd leave alone.",
      items: {
        type: "object", additionalProperties: false, required: ["ref", "text"],
        properties: { ref: { type: "string" }, text: { type: "string" } },
      },
    },
    order: { type: "array", description: "Block ids in the order they should appear.", items: { type: "string" } },
    remove: { type: "array", description: "Block ids to drop (empty or redundant sections).", items: { type: "string" } },
    summary: { type: "string", description: "One sentence on what you changed and why." },
  },
};

export interface EnhanceIn {
  kind: string;
  tone?: string;
  /** id, type and current copy of every block, in document order. */
  blocks: { id: string; type: string; fields: Record<string, string>; empty: boolean }[];
  theme?: string;
  background?: string;
  accent?: string;
}

export interface EnhanceOut {
  theme?: string; background?: string; accent?: string;
  copy: { ref: string; text: string }[];
  order: string[];
  remove: string[];
  summary: string;
}

/** One pass over the whole document: tighten every line, drop dead sections,
 *  order the story properly and suggest a palette — all from the real content. */
export async function enhanceMailer(event: EventEntity, o: EnhanceIn): Promise<EnhanceOut> {
  const listing = o.blocks.map((b, i) =>
    `${i + 1}. id=${b.id} type=${b.type}${b.empty ? " (renders nothing — no content)" : ""}\n` +
    Object.entries(b.fields).map(([k, v]) => `   ${k}: ${JSON.stringify(v)}`).join("\n")).join("\n");

  return ask<EnhanceOut>("enhance",
    `Improve this ${o.kind} email end to end, using only the event's real content.

Tone: ${toneOf(o.tone)}
Current palette: theme=${o.theme || "site"} background=${o.background || "(default)"} accent=${o.accent || "(event accent)"}

EVENT BRIEF
${eventBrief(event)}

CURRENT DOCUMENT (blocks in order)
${listing}

Do all of the following:
1. COPY — rewrite weak lines: the headline should say something specific, the intro should earn the click in two sentences, section labels stay short and uppercase-friendly, button labels stay under 4 words. Return one entry per field you change, using "blockId.fieldName" as the ref. Leave good lines alone.
2. ORDER — return every remaining block id in the order that tells the story best: identity and artwork first, then the offer, then proof (speakers/partners/agenda), then the ask, then contacts and footer. Keep the logo bar first and the footer last.
3. REMOVE — drop blocks marked as rendering nothing, and any block whose content repeats a neighbour. Never remove the footer.
4. PALETTE — if the current setting is weak for a B2B send, suggest a theme and optionally a background/accent hex. Prefer the event's own colours; return empty strings to leave them as they are.

Every id in "order" and "remove" must come from the list above. Do not invent blocks, facts, names or numbers.`,
    ENHANCE_SCHEMA,
    12000,
  );
}
