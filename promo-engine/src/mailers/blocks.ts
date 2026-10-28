import type { EventEntity } from "../model/types.ts";
import { getBrand, ASSET_BASE } from "../brand/index.ts";
import { esc } from "../templates/base.ts";
import { resizeUrl } from "../api/images.ts";
import type { Palette, RenderCtx, ThemeMode } from "./base.ts";
import {
  INNER, WIDTH, lum, resolvePalette, fontStack, emailPage, balancedCols, readable, safeUrl, legibleSurface,
  row, bleedRow, text, inlineCopy, heading, eyebrow, paragraphs, ctaButton, gridRows, fluidGrid, link, imageLink,
  dateVenue, siteUrl, whereOf, ordinal, hexColor, onSurface,
} from "./base.ts";

// A mailer is a DOCUMENT of blocks, not a fixed template. Templates only seed
// the first version; after that the studio edits blocks (reorder, add, delete,
// per-block settings) and the server renders those blocks back to email HTML.
// Every block carries RESOLVED data in `props` — no template params at render
// time — which is what makes drag-and-drop editing possible.

export type BlockType =
  | "banner" | "logobar" | "hero" | "heading" | "text" | "bullets" | "button"
  | "meta" | "stats" | "speakers" | "speaker" | "sponsors" | "sessions"
  | "quote" | "image" | "contacts" | "divider" | "spacer" | "footer" | "html"
  | "lozenges" | "pricing" | "navbar" | "mosaic" | "social"
  | "features" | "circles" | "ribbon" | "resources";

export interface Block {
  id: string;
  type: BlockType;
  props: Record<string, any>;
}

export interface MailerDoc {
  mailerId: string;
  subject: string;
  preheader: string;
  theme: ThemeMode;
  /** Optional accent override; defaults to the event's website accent. */
  accent?: string;
  /** Optional background colour applied across the whole mailer. */
  background?: string;
  /** "no" leaves content images unwrapped, accepting the inbox's save button. */
  imageGuard?: string;
  blocks: Block[];
  savedAt?: number;
}

// ---- editor field schema ----------------------------------------------------
// The studio renders each block's settings panel straight from this, so a new
// block type needs no front-end code.

export interface Field {
  /** Only show this control while the block's props match, e.g. {style:["cards"]}.
   *  A control that cannot affect the chosen layout is worse than no control. */
  showWhen?: Record<string, string[]>;
  key: string;
  label: string;
  /** `icon` is a URL field with a picker instead of a paste box — see the note on
   *  `itemFields` below. The VALUE is still a plain URL string. */
  type: "text" | "textarea" | "number" | "select" | "color" | "url" | "list" | "picker" | "multipick" | "icon";
  options?: { value: string; label: string }[];
  /** Value assumed when a block doesn't carry the prop, so the panel and the
   *  renderer agree on what "unset" means. */
  default?: string;
  /** This control's sensible value depends on another field: picking a new value
   *  for `on` resets this one from `map`. Keeps "3 speakers per row" from
   *  surviving a switch to a layout drawn for two. */
  defaultBy?: { on: string; map: Record<string, number | string> };
  hint?: string;
  /** This field's renderer parses inline markers (`**bold**`, `==highlight==`,
   *  `[label](url)`), so the studio may offer formatting on it — the B/I/U bar,
   *  and Quill on the long ones.
   *
   *  Declared here because the schema is the only place that can be right. The
   *  bar used to be attached by field NAME, so a new field called `title` picked
   *  it up whether or not its renderer parsed anything, while a differently
   *  named one silently went without — and the mail printed `**bold**` at the
   *  reader. Same contract as `showWhen`: both editors and the `formatting`
   *  suite read it from here, and the suite fails if a field's declaration and
   *  its renderer ever disagree in either direction. */
  rich?: boolean;
  /** For `picker`/`multipick`: which event collection to choose from. */
  source?: "speakers" | "sponsors" | "sessions";
  /** For `list`: the shape of each row.
   *
   *  `icon` is a CONTROL, not a data type: the stored value is the same URL
   *  string a plain `url` field holds, so every document saved before the picker
   *  existed — and the two templates that seed house-icon URLs — keep rendering
   *  byte for byte. What changes is only how a sender produces that string:
   *  pick a house glyph, upload artwork, or clear it back to empty. The renderer
   *  never learns the difference, and a value the picker did not produce (a
   *  pasted URL in an old document) still shows in the preview and still
   *  renders. Empty means no icon, which every renderer already handles. */
  itemFields?: { key: string; label: string; type?: "text" | "url" | "textarea" | "icon" }[];
}

export interface BlockSchema {
  label: string;
  icon: string;
  /** Can the user insert this from the block palette? */
  addable: boolean;
  fields: Field[];
  /** Defaults used when inserted from the palette. */
  make(event: EventEntity): Record<string, any>;
}

const ALIGN: Field = {
  key: "align", label: "Align", type: "select",
  options: [{ value: "left", label: "Left" }, { value: "center", label: "Centre" }, { value: "right", label: "Right" }],
};
/** Yes/no field for a block's settings panel, and its reader. Blocks default to
 *  showing everything, so only an explicit "no" hides a part. */
const YESNO_FIELD = (key: string, label: string, hint?: string, def = "yes"): Field => ({
  key, label, type: "select", default: def,
  options: [{ value: "yes", label: "Show" }, { value: "no", label: "Hide" }],
  ...(hint ? { hint } : {}),
});
const isNoProp = (v: any) => String(v ?? "yes").toLowerCase() === "no";

/** Natural columns for each speaker layout. A "photo left, details right" card
 *  carries a portrait and three lines of text, so three-up crowds it — two is the
 *  width it was drawn for. Circles are small and read well four-up. The renderer
 *  and the settings panel both take the default from here, so they cannot drift. */
export const SPEAKER_COLS: Record<string, number> = { cards: 3, circle: 4, feature: 2, rows: 2, tiles: 2, checker: 4 };

const COLS = (max = 4): Field => ({
  key: "cols", label: "Per row", type: "select",
  options: Array.from({ length: max }, (_, i) => ({ value: String(i + 1), label: `${i + 1} per row` })),
});

/** "Section background", declared ONCE and spread into every block that offers
 *  it — seven schemas holding seven copies of the same control is how two of them
 *  end up with different options after the next change.
 *
 *  The two original values are kept verbatim. Documents saved before this grew
 *  store `tint:"yes"|"no"` on speaker and partner grids (and on contacts, whose
 *  renderer read the prop while the schema never declared it), and those have to
 *  keep rendering to the same bytes: "yes" still means the accent wash and "no"
 *  still means no fill at all. "tile" and "custom" are the new choices. */
const SECTION_BG: Field[] = [
  { key: "tint", label: "Section background", type: "select", default: "no",
    options: [
      { value: "no", label: "Plain" },
      { value: "yes", label: "Tinted (website colour)" },
      { value: "tile", label: "Card colour" },
      { value: "custom", label: "Custom…" },
    ],
    hint: "Bands the whole section. “Card colour” is the deeper shade the mail already uses for tiles and cards." },
  { key: "tintColor", label: "Background colour", type: "color", showWhen: { tint: ["custom"] },
    hint: "Hex; anything else falls back to the tinted shade, because a value that is not a colour must never reach the style attribute. Every text colour in the section is re-measured against what you pick, so a dark background flips the type light rather than hiding it." },
];

/** Which block types offer a section background. A block that never offered the
 *  control must not paint a band off a stray prop — the settings panel would have
 *  no way to turn it back off. */
const SECTION_BG_TYPES = new Set<BlockType>([
  "meta", "stats", "speakers", "sponsors", "sessions", "contacts", "pricing",
  "features", "circles", "ribbon", "mosaic", "quote", "resources",
  "heading", "speaker", "lozenges", "social",
]);

/** The chosen fill, and whether the section's ink has to be re-derived for it.
 *
 *  Only the NEW choices re-derive. "yes" is the palette's own accent wash — a
 *  colour computed from the card, whose inks were already measured against it —
 *  so re-measuring it would move pixels in every document saved before this
 *  existed. It is deliberately left alone. */
function sectionFill(type: BlockType, q: Record<string, any>, p: Palette): { bg?: string; own: boolean } {
  if (!SECTION_BG_TYPES.has(type)) return { own: false };
  switch (String(q.tint ?? "no")) {
    case "yes": return { bg: p.wash, own: false };
    // The section paints this colour AND every ink is re-derived against it, so a
    // saturated mid-tone the sender picked (or a derived tile shade) that can carry
    // no small text at AA is nudged just enough that it can — the small caps labels
    // on plain/rules tiles, and every cell once the phone rule dissolves its fill,
    // sit directly on this surface with nothing else to measure them against.
    case "tile": return { bg: legibleSurface(p.tileBg), own: true };
    case "custom": return { bg: legibleSurface(hexColor(q.tintColor) || p.wash), own: true };
    default: return { own: false };
  }
}

/** House glyphs, shipped as PNGs at `/assets/icons/` because no mail client
 *  renders an icon font or an SVG. Each has a light and a dark cut; the renderer
 *  picks by the surface the tile actually sits on, so a dark section does not get
 *  a dark glyph. Seeds `features` with real artwork rather than empty frames.
 *
 *  Deliberately only the glyphs that SHIP with the app (`public/assets/icons/`):
 *  seeding a URL that 404s would put a broken image in the mail the moment the
 *  block is added, which is worse than no icon at all.
 *
 *  A MIRROR of the set `tools/icons.mjs` draws. This file renders synchronously
 *  and cannot read the directory per render, so the roster is a constant — add a
 *  glyph to that tool and to this list together, or the picker below will never
 *  reach for it.
 *
 *  28 names ship; the five social marks (facebook, instagram, linkedin, x,
 *  youtube) are deliberately LEFT OUT of this list. They are wayfinding, drawn
 *  by the socials block from a network name, and a stat labelled "Attendees"
 *  must never land on the YouTube logo. That leaves 23 to decorate with. */
const HOUSE_ICONS = [
  "agenda", "ai", "award", "calendar", "certificate", "clock", "data", "dining",
  "global", "growth", "insight", "keynote", "learn", "location", "mic", "network",
  "panel", "partner", "shield", "speakers", "tick", "ticket", "workshop",
];
/** What a tile with nothing to go on takes, in order: the generally-true event
 *  glyphs first, so an unmatched caption gets `network` rather than `ai`. Only
 *  once these run out does the fallback reach into the rest of the roster. */
const NEUTRAL_ICONS = ["network", "insight", "learn", "growth", "speakers", "agenda", "award", "global", "tick", "clock"];

/** Ordered, because the FIRST match wins and the specific has to beat the
 *  general: "data" appears in half the insight vocabulary, and a security
 *  masterclass should take the shield rather than the graduation cap. Written to
 *  read both a stat's one-word LABEL ("Speakers", "Days", "Partners") and a
 *  feature tile's whole sentence. */
const ICON_WORDS: [string, RegExp][] = [
  ["shield", /\bsecurit|cyber|threat|risk|resilien|complian|privacy|breach|defen[cs]e|zero.trust/i],
  ["ai", /\bA\.?I\b|artificial intelligence|machine learning|\bLLM|generative|copilot|automat/i],
  ["data", /\bdata\b|analytic|metric|benchmark|dashboard|measur|report/i],
  ["global", /\bglobal|international|worldwide|countr|nation|region|cross.border/i],
  ["certificate", /\bcertificat|accredit|credential|diploma/i],
  ["award", /\baward|recognit|celebrat|honour|honor|winner|trophy|excellence|jury/i],
  ["dining", /\bdinner|lunch|cocktail|refreshment|banquet|gala/i],
  ["ticket", /\bticket|pass\b|registration|seat|delegate fee|early bird/i],
  ["location", /\bvenue|location|cit(?:y|ies)|hotel|on.?site|in person|edition/i],
  ["calendar", /\bday|date|month|calendar/i],
  ["clock", /\bhour|minute|timing|duration/i],
  ["agenda", /\bsession|agenda|track|programme|program\b|schedule|itinerar/i],
  ["workshop", /\bworkshop|masterclass|hands.on|clinic|lab\b|deep.dive|bootcamp/i],
  ["panel", /\bpanel|roundtable|debate|fireside|discussion|boardroom/i],
  ["keynote", /\bkeynote|address|opening|plenary|headline (?:talk|speaker)/i],
  ["speakers", /\bspeaker|delegate|attendee|participant|leader|cxo|c.suite|executive|audience/i],
  ["partner", /\bpartner|sponsor|exhibitor|brand|supporter|associat/i],
  ["mic", /\btalk|voice|interview|podcast|stage/i],
  ["network", /\bnetwork|peer|connect|meet|communit|room|conversation/i],
  ["insight", /\binsight|trend|research|intelligence|discover|understand|landscape/i],
  ["learn", /\blearn|training|skill|practice|playbook|framework|course|knowledge/i],
  ["growth", /\bgrowth|scale|strateg|transform|future|roadmap|advantage|outcome|impact|roi\b/i],
  ["tick", /\bincluded|access|benefit|eligib|checklist/i],
];
/** Glyphs for a WHOLE grid at once, matched on each cell's own words and never
 *  repeating one inside that grid.
 *
 *  Both halves of that were paid for. Picking by MEANING, because "Partners"
 *  beside a microphone is a worse guess than beside the partner mark and the
 *  word is right there. Picking DISTINCTLY, because the lists this replaces were
 *  `["speakers","mic","calendar"]` and a literal `["speakers","mic","calendar",
 *  "speakers","mic","calendar"]` — so a six-figure stats band printed the same
 *  three glyphs twice, and a grid that shows one picture twice reads as broken.
 *
 *  Shallow on purpose: these are decoration, and a clever mapping that is subtly
 *  wrong reads worse than an obviously neutral one. `tileIcons` in
 *  `resilience.ts` does the same job for that template's own seeded tiles.
 *
 *  Returns NAMES. The light/dark cut belongs to whoever draws it, settled
 *  against the surface the glyph actually lands on — never assumed here. */
export function houseIconNames(texts: string[]): string[] {
  const used = new Set<string>();
  return texts.map((t, i) => {
    const hit = ICON_WORDS.find(([n, re]) => !used.has(n) && re.test(String(t ?? "")))?.[0];
    if (hit) { used.add(hit); return hit; }
    // Nothing matched, or every match it had was already taken by an earlier
    // cell: step to the next UNUSED glyph rather than cycling back onto one that
    // is already on screen. The modulo is only the impossible case of a grid
    // longer than the whole roster.
    const spare = NEUTRAL_ICONS.find((n) => !used.has(n))
      || HOUSE_ICONS.find((n) => !used.has(n))
      || HOUSE_ICONS[i % HOUSE_ICONS.length];
    used.add(spare);
    return spare;
  });
}
const houseIconUrl = (name: string) => `${ASSET_BASE}/assets/icons/${name}-dark.png`;

export const BLOCK_SCHEMAS: Record<BlockType, BlockSchema> = {
  banner: {
    label: "Banner image", icon: "▭", addable: true,
    fields: [
      { key: "url", label: "Image URL", type: "url", hint: "Must be publicly reachable — inboxes can't load local files." },
      { key: "href", label: "Links to", type: "url" },
      { key: "alt", label: "Alt text", type: "text" },
    ],
    make: (e) => ({ url: e.keyVisualUrl || "", href: siteUrl(e), alt: e.name }),
  },
  logobar: {
    label: "Logo bar", icon: "✦", addable: true,
    fields: [
      { key: "logo", label: "Logo URL", type: "url",
        hint: "Defaults to the portal's masthead (PNG — email clients don't render SVG). Set MAILER_ASSET_BASE so the URL is publicly reachable before a real send." },
      { key: "size", label: "Logo size", type: "select", default: "medium",
        options: [
          { value: "small", label: "Small (150px)" },
          { value: "medium", label: "Default (180px)" },
          { value: "large", label: "Large (270px)" },
          { value: "xl", label: "Extra large (360px)" },
        ],
        hint: "Desktop cap; phones scale down automatically." },
      { key: "logoLight", label: "Logo URL (dark backgrounds)", type: "url",
        hint: "Light-ink masthead, used automatically when the mailer sits on a dark card." },
      { key: "href", label: "Links to", type: "url" },
      { key: "right", label: "Right-hand text", type: "text" },
    ],
    make: (e) => ({
      logo: getBrand(e.portal).logoUrl || "",
      logoLight: getBrand(e.portal).logoLightUrl || "",
      href: siteUrl(e), right: e.hashtag,
    }),
  },
  hero: {
    label: "Hero band", icon: "▰", addable: true,
    fields: [
      { key: "ribbon", label: "Ribbon", type: "text", hint: "Small pill above the title. Leave empty to hide." },
      { key: "title", label: "Title", type: "text", rich: true },
      { key: "sub", label: "Sub-line", type: "textarea", rich: true },
      { key: "meta", label: "Date / venue line", type: "text" },
      { key: "style", label: "Background", type: "select", default: "gradient",
        options: [
          { value: "gradient", label: "Brand gradient" },
          { value: "photo", label: "Photograph, darkened" },
        ] },
      { key: "photo", label: "Photograph", type: "url", showWhen: { style: ["photo"] },
        hint: "A plain photograph. Leave empty and the band keeps its brand gradient — the event's own key visual already carries the name and strapline, so text over it prints two headlines." },
      { key: "align", label: "Align", type: "select", default: "left",
        options: [{ value: "left", label: "Left" }, { value: "center", label: "Centre" }] },
      { key: "cta1", label: "Button", type: "text" },
      { key: "cta1href", label: "Button link", type: "url" },
      { key: "cta2", label: "Second button", type: "text", hint: "Outline style beside the first. Empty hides it." },
      { key: "cta2href", label: "Second button link", type: "url" },
    ],
    make: (e) => ({
      ribbon: e.edition ? `${ordinal(e.edition)} Edition` : "",
      title: e.name, sub: e.tagline || "", meta: dateVenue(e),
      style: "gradient", photo: "", align: "left",
      cta1: "", cta1href: e.micrositeUrl || "", cta2: "", cta2href: e.micrositeUrl || "",
    }),
  },
  heading: {
    label: "Heading", icon: "H", addable: true,
    fields: [
      { key: "eyebrow", label: "Eyebrow", type: "text" },
      { key: "text", label: "Heading", type: "text", rich: true },
      { key: "size", label: "Size (px)", type: "number" },
      { key: "caps", label: "Style", type: "select",
        options: [{ value: "no", label: "Normal heading" }, { value: "yes", label: "Section label (uppercase)" }],
        hint: "The house mailers label sections in caps — OVERVIEW, PARTNERS, CONTACT US." },
      // Same three tones, same key, as the `text` block — an accent heading used to
      // mean building it out of a paragraph instead. "Default" is the ink this block
      // has always used, so a document with no `tone` does not move; every slot here
      // is one the palette already fitted against the card.
      { key: "tone", label: "Colour", type: "select", default: "ink",
        options: [
          { value: "ink", label: "Default (full contrast)" },
          { value: "accent", label: "Accent" },
          { value: "body", label: "Muted" },
        ],
        hint: "Every choice is contrast-checked against the mailer background." },
      ALIGN,
      ...SECTION_BG,
    ],
    make: () => ({ eyebrow: "", text: "Section heading", size: 22, caps: "no", align: "left" }),
  },
  text: {
    label: "Paragraph", icon: "¶", addable: true,
    fields: [
      { key: "text", label: "Copy", type: "textarea", rich: true,
        hint: "One paragraph per line. **bold**, *italic*, __underline__, ~~strike~~, ==highlight==, [label](https://…)" },
      { key: "size", label: "Size (px)", type: "number" },
      { key: "weight", label: "Weight", type: "select", default: "400",
        options: [{ value: "400", label: "Regular" }, { value: "500", label: "Medium" }, { value: "700", label: "Bold" }] },
      { key: "tone", label: "Colour", type: "select", default: "body",
        options: [
          { value: "body", label: "Body (muted)" },
          { value: "ink", label: "Strong (full contrast)" },
          { value: "accent", label: "Accent" },
        ],
        hint: "Every choice is contrast-checked against the mailer background. Pick an exact colour below to override it." },
      { key: "color", label: "Exact colour", type: "color",
        hint: "Overrides Colour above with a hex you choose. Leave empty to use the contrast-checked tone instead." },
      { key: "lh", label: "Line height", type: "select", default: "1.55",
        options: [{ value: "1.35", label: "Tight" }, { value: "1.55", label: "Normal" }, { value: "1.8", label: "Airy" }] },
      YESNO_FIELD("italic", "Italic", undefined, "no"),
      YESNO_FIELD("underline", "Underline", undefined, "no"),
      YESNO_FIELD("caps", "Small caps / letter-spaced", undefined, "no"),
      ALIGN,
    ],
    make: () => ({ text: "Write your copy here.", size: 15, align: "left", weight: "400", tone: "body", lh: "1.55" }),
  },
  bullets: {
    label: "Bullet list", icon: "⋮", addable: true,
    fields: [
      { key: "title", label: "Heading", type: "text", rich: true },
      { key: "style", label: "Layout", type: "select", default: "plain",
        options: [
          { value: "plain", label: "Plain list" },
          { value: "ticks", label: "Ticked list" },
          { value: "two", label: "Two columns" },
          { value: "panel", label: "Tinted panel" },
          { value: "panelTwo", label: "Tinted panel, two columns" },
          { value: "numbered", label: "Numbered" },
          { value: "cards", label: "One card per point" },
          { value: "tiles", label: "Solid colour tiles" },
        ],
        hint: "Ticked lists and tinted panels are the reference treatment for 'who should attend' / 'key discussion points'." },
      { key: "marker", label: "Marker", type: "select", default: "",
        showWhen: { style: ["plain", "ticks", "two", "panel", "panelTwo", "cards"] },
        options: [
          { value: "", label: "Default for this layout" },
          { value: "✓", label: "✓  Tick" },
          { value: "→", label: "→  Arrow" },
          { value: "•", label: "•  Dot" },
          { value: "▪", label: "▪  Square" },
          { value: "◆", label: "◆  Diamond" },
          { value: "★", label: "★  Star" },
          { value: "»", label: "»  Chevron" },
          { value: "none", label: "No marker" },
        ] },
      { ...COLS(4), showWhen: { style: ["tiles"] } },
      { key: "items", label: "Bullets", type: "list", rich: true, itemFields: [{ key: "text", label: "Bullet", type: "textarea" }] },
    ],
    make: () => ({ title: "", style: "plain", marker: "", items: [{ text: "First point" }] }),
  },
  button: {
    label: "Button", icon: "⬢", addable: true,
    fields: [
      { key: "label", label: "Label", type: "text" },
      { key: "href", label: "Link", type: "url" },
      { key: "note", label: "Line above", type: "text", rich: true },
      { key: "variant", label: "Style", type: "select", default: "solid",
        options: [{ value: "solid", label: "Solid fill" }, { value: "outline", label: "Outline (no fill)" }] },
      { key: "bg", label: "Button colour", type: "color",
        hint: "Hex. Empty uses the mailer's accent." },
      { key: "ink", label: "Label colour", type: "color",
        hint: "Hex. Empty works it out from the fill. Either way it is nudged until it clears AA, so the label can never end up unreadable." },
      { key: "border", label: "Border colour", type: "color",
        showWhen: { variant: ["outline"] }, hint: "Hex. Empty follows the button colour." },
      { key: "borderWidth", label: "Border width (px)", type: "number",
        showWhen: { variant: ["outline"] }, default: "2" },
      { key: "radius", label: "Corner radius (px)", type: "number", default: "8",
        hint: "0 square · 8 house default · 99 pill. Outlook on Windows squares every button off regardless." },
      { key: "size", label: "Size", type: "select", default: "md",
        options: [{ value: "sm", label: "Small" }, { value: "md", label: "Medium" }, { value: "lg", label: "Large" }] },
      { key: "fontSize", label: "Text size (px)", type: "number", default: "14" },
      YESNO_FIELD("full", "Full width", "Spans the column — the usual mobile-first CTA.", "no"),
      YESNO_FIELD("caps", "Uppercase label", undefined, "no"),
      ALIGN,
    ],
    make: (e) => ({ label: e.ctaLabel || "Register now", href: e.ctaUrl || siteUrl(e), note: "", align: "left",
      variant: "solid", bg: "", ink: "", radius: 8, size: "md", fontSize: 14, full: "no", caps: "no" }),
  },
  meta: {
    label: "Date / venue tiles", icon: "▤", addable: true,
    fields: [
      { key: "items", label: "Tiles", type: "list", itemFields: [{ key: "label", label: "Label" }, { key: "value", label: "Value" }] },
      ...SECTION_BG,
    ],
    make: (e) => ({
      items: [
        { label: "When", value: e.dateLabel || "Date to be announced" },
        { label: "Where", value: whereOf(e) || "Venue to be announced" },
        ...(e.totalDays ? [{ label: "Format", value: `${e.totalDays} day${e.totalDays > 1 ? "s" : ""}` }] : []),
      ],
    }),
  },
  stats: {
    label: "Stat tiles", icon: "◫", addable: true,
    fields: [
      { key: "style", label: "Layout", type: "select", default: "band",
        options: [
          { value: "band", label: "One band, hairline dividers" },
          { value: "boxes", label: "Separate bordered boxes" },
          { value: "panel", label: "Tinted panel, divided" },
          { value: "solid", label: "Solid accent band" },
          { value: "plain", label: "No fill, accent figures" },
          { value: "rules", label: "Underlined figures" },
        ],
        hint: "From the ET reference mailers. One row on desktop, two per row on a phone." },
      { key: "title", label: "Heading", type: "text", rich: true, hint: "Optional label above the figures — e.g. SUMMIT HIGHLIGHTS." },
      YESNO_FIELD("icons", "Icon above each figure", "The conference layout puts a glyph over every number.", "no"),
      { key: "items", label: "Stats", type: "list", itemFields: [{ key: "value", label: "Value" }, { key: "label", label: "Label" }] },
      ...SECTION_BG,
    ],
    make: (e) => ({ style: "band", title: "", items: e.stats.slice(0, 4) }),
  },
  speakers: {
    label: "Speaker grid", icon: "⊞", addable: true,
    fields: [
      { key: "title", label: "Heading", type: "text", rich: true },
      // The heading is pre-filled by several templates ("Also speaking", "Speakers")
      // rather than typed fresh, so it had no control of its own — only the block
      // types that always start with an empty heading happened to get one.
      { ...ALIGN, label: "Heading align" },
      { key: "style", label: "Layout", type: "select", default: "cards",
        options: [
          { value: "cards", label: "Photo cards (bordered)" },
          { value: "circle", label: "Circular portraits" },
          { value: "feature", label: "Two-up feature (name bar)" },
          { value: "rows", label: "Photo left, details right" },
          { value: "tiles", label: "Colour tiles (no photos)" },
          { value: "checker", label: "Checkerboard (photo / name tiles)" },
        ],
        hint: "Layouts from the ET reference mailers. Falls back to colour tiles when the API has no portraits." },
      // "feature" is two-up by definition and crops square, so neither of these
      // would change anything there.
      { ...COLS(4), showWhen: { style: ["cards", "circle", "rows", "tiles"] },
        defaultBy: { on: "style", map: SPEAKER_COLS } },
      { key: "shape", label: "Photo shape", type: "select", default: "square",
        options: [{ value: "square", label: "Square" }, { value: "round", label: "Rounded" }, { value: "circle", label: "Circle" }],
        showWhen: { style: ["cards", "rows"] } },
      YESNO_FIELD("showRole", "Show designation"),
      YESNO_FIELD("showCompany", "Show company"),
      // Both off by default so no existing template changes shape. The APIs carry
      // no bio at all and only LinkedIn of the five networks, so these are the
      // sender's to fill — a person with nothing filled in simply shows neither,
      // rather than a blank line and four dead icons.
      { ...YESNO_FIELD("showBio", "Show bio line", "A sentence under the company. Speakers with no bio typed in show nothing.", "no"),
        showWhen: { style: ["cards"] } },
      { ...YESNO_FIELD("showSocial", "Show social icons", "Only handles you fill in appear. LinkedIn seeds from the event; the rest are yours.", "no"),
        showWhen: { style: ["cards"] } },
      { key: "max", label: "Max speakers", type: "number",
        hint: "How many may appear. Extras beyond this are not rendered." },
      { key: "pick", label: "Speakers on this event", type: "multipick", source: "speakers",
        hint: "Every speaker this event has. Tick up to the max above; untick to remove." },
      { key: "note", label: "Note below", type: "text", rich: true },
      ...SECTION_BG,
      { key: "items", label: "Speakers", type: "list",
        itemFields: [{ key: "name", label: "Name" }, { key: "role", label: "Designation" }, { key: "company", label: "Company" }, { key: "photo", label: "Photo URL", type: "url" },
          { key: "bio", label: "Bio line", type: "textarea" },
          { key: "linkedin", label: "LinkedIn", type: "url" }, { key: "facebook", label: "Facebook", type: "url" }, { key: "x", label: "X", type: "url" }] },
    ],
    make: (e) => ({
      title: "Speakers", cols: "3", max: 6, note: "",
      items: e.speakers.slice(0, 6).map((s) => ({ name: s.name, role: s.designation, company: s.company, photo: s.photoUrl || "" })),
    }),
  },
  speaker: {
    label: "Speaker spotlight", icon: "★", addable: true,
    fields: [
      { key: "eyebrow", label: "Eyebrow", type: "text" },
      { key: "name", label: "Name", type: "text" },
      { key: "role", label: "Designation", type: "text" },
      { key: "company", label: "Company", type: "text" },
      { key: "photo", label: "Photo URL", type: "url" },
      { key: "link", label: "Profile link", type: "url" },
      ...SECTION_BG,
    ],
    make: (e) => {
      const s = e.speakers[0];
      return { eyebrow: "Speaker", name: s?.name || "", role: s?.designation || "", company: s?.company || "", photo: s?.photoUrl || "", link: s?.linkedin || "" };
    },
  },
  sponsors: {
    label: "Partner logos", icon: "◈", addable: true,
    fields: [
      { key: "title", label: "Heading", type: "text", rich: true,
        hint: "Sits above everything. With Show tier label on and partners from more than one tier, each tier ALSO gets its own label below this." },
      { key: "style", label: "Layout", type: "select", default: "cards",
        options: [
          { value: "cards", label: "White logo cards" },
          { value: "bordered", label: "Outlined cards (no fill)" },
          { value: "plain", label: "Logos only, no card" },
          { value: "strip", label: "Compact strip (5 per row)" },
        ] },
      { key: "logoHeight", label: "Logo height", type: "select", default: "44",
        options: [{ value: "34", label: "Small" }, { value: "44", label: "Medium" }, { value: "60", label: "Large" }],
        showWhen: { style: ["cards", "bordered", "plain"] } },
      { ...YESNO_FIELD("showTier", "Show tier label"),
        hint: "Groups partners under their own tier name (Gold, Silver, …) when they span more than one. One tier, or none set, shows the Heading above instead." },
      { ...YESNO_FIELD("showName", "Show partner name under logo"), showWhen: { style: ["cards", "bordered", "plain"] } },
      { ...COLS(5), showWhen: { style: ["cards", "bordered", "plain"] } },
      { key: "max", label: "Max partners", type: "number",
        hint: "How many may appear. Extras beyond this are not rendered." },
      { key: "pick", label: "Partners on this event", type: "multipick", source: "sponsors",
        hint: "Every partner this event has. Tick up to the max above; untick to remove." },
      ...SECTION_BG,
      { key: "items", label: "Partners", type: "list",
        itemFields: [{ key: "title", label: "Name" }, { key: "logo", label: "Logo URL", type: "url" },
          { key: "url", label: "Links to", type: "url" }, { key: "tier", label: "Tier", type: "text" }] },
    ],
    make: (e) => {
      // Every tier, not just the first few sponsors overall — capping at a flat
      // count used to cut an event's later tiers off entirely, so "Show tier
      // label" (on by default) had nothing from them to ever show. `max` is
      // still there for a sender who wants fewer.
      const list = e.sponsorTiers.flatMap((t) => t.sponsors.map((s) => ({ ...s, tierName: t.tier })));
      return {
        title: "Our partners", cols: "4",
        items: list.map((s: any) => ({ title: s.title, logo: s.logoUrl || "", url: s.url || "", tier: s.tierName || "" })),
      };
    },
  },
  sessions: {
    label: "Agenda list", icon: "☰", addable: true,
    fields: [
      { key: "title", label: "Heading", type: "text", rich: true },
      { key: "style", label: "Layout", type: "select", default: "cards",
        options: [
          { value: "cards", label: "Tinted cards" },
          { value: "timeline", label: "Timeline rail" },
          { value: "table", label: "Time column" },
          { value: "tiles", label: "Tiles, two per row" },
          { value: "numbered", label: "Numbered running order" },
          { value: "days", label: "Day columns (1st Day / 2nd Day)" },
        ] },
      { ...COLS(3), showWhen: { style: ["tiles"] } },
      { key: "align", label: "Heading alignment", type: "select", default: "left",
        options: [{ value: "left", label: "Left" }, { value: "center", label: "Centred, with a rule" }] },
      { key: "day1Text", label: "First day, intro line", type: "textarea", showWhen: { style: ["days"] },
        hint: "Sits under the day heading, as the conference reference has. Yours to write — the agenda API carries no day summary." },
      { key: "day2Text", label: "Second day, intro line", type: "textarea", showWhen: { style: ["days"] } },
      { key: "max", label: "Max sessions", type: "number",
        hint: "How many may appear. Extras beyond this are not rendered." },
      YESNO_FIELD("showTime", "Show time"),
      YESNO_FIELD("showWho", "Show speakers"),
      { key: "pick", label: "Sessions on this event", type: "multipick", source: "sessions",
        hint: "Every session this event has. Tick up to the max above; untick to remove." },
      ...SECTION_BG,
      { key: "items", label: "Sessions", type: "list",
        itemFields: [{ key: "day", label: "Day" }, { key: "time", label: "Time" }, { key: "title", label: "Session", type: "textarea" }, { key: "who", label: "Speakers", type: "textarea" }] },
    ],
    make: (e) => ({
      title: "Agenda", style: "cards", showTime: "yes", showWho: "yes", max: "",
      items: e.sessions.slice(0, 5).map((s) => ({ time: "", title: s.title, who: s.speakers.map((x) => x.name).join(" • ") })),
    }),
  },
  lozenges: {
    label: "Statement lines", icon: "▰", addable: true,
    fields: [
      { key: "items", label: "Lines", type: "list", rich: true,
        itemFields: [{ key: "text", label: "Line", type: "text" }],
        hint: "One short line per band. The punch comes from breaking a sentence across them." },
      { key: "style", label: "Colour run", type: "select", default: "alternate",
        options: [
          { value: "alternate", label: "Alternating light / accent / outline" },
          { value: "accent", label: "All accent" },
          { value: "light", label: "All light" },
          { value: "outline", label: "All outline" },
        ] },
      { key: "layout", label: "Arrangement", type: "select", default: "stagger",
        options: [
          { value: "stagger", label: "Staggered (alternating sides)" },
          { value: "left", label: "All left" },
          { value: "center", label: "All centred" },
          { value: "full", label: "Full width" },
        ] },
      { key: "size", label: "Text size (px)", type: "number", default: "26" },
      { key: "radius", label: "Corner radius (px)", type: "number", default: "99",
        hint: "99 is a pill. Outlook on Windows squares every band off regardless." },
      YESNO_FIELD("caps", "Uppercase", undefined, "no"),
      ...SECTION_BG,
    ],
    make: () => ({
      items: [{ text: "Your campaign" }, { text: "understood the assignment." }, { text: "It's giving" }, { text: "award-winning energy." }],
      style: "alternate", layout: "stagger", size: "26", radius: "99", caps: "no",
    }),
  },
  pricing: {
    label: "Price tiers", icon: "▤", addable: true,
    fields: [
      { key: "title", label: "Heading", type: "text", rich: true },
      { key: "align", label: "Heading alignment", type: "select", default: "left",
        options: [{ value: "left", label: "Left" }, { value: "center", label: "Centred, with a rule" }] },
      { key: "currency", label: "Currency symbol", type: "text", default: "\u20b9" },
      { key: "items", label: "Tiers", type: "list",
        hint: "There is no pricing endpoint on the ET APIs, so these are yours to fill — nothing here is taken from the event.",
        itemFields: [
          { key: "name", label: "Tier" },
          { key: "price", label: "Price" },
          { key: "features", label: "What's included (one per line)", type: "textarea" },
          { key: "label", label: "Button" },
          { key: "href", label: "Button link", type: "url" },
          { key: "highlight", label: "Highlight this one (yes/no)" },
        ] },
      ...SECTION_BG,
    ],
    // Seeds the SHAPE, never the numbers: a price this platform invented would be
    // a price someone might send. Tier names and the CTA are structure the sender
    // renames; the figures stay empty until a human types them.
    make: (e) => ({
      title: "", currency: "\u20b9",
      items: [
        { name: "Delegate pass", price: "", features: "", label: "Register", href: e.micrositeUrl || "", highlight: "no" },
        { name: "Premium pass", price: "", features: "", label: "Register", href: e.micrositeUrl || "", highlight: "yes" },
      ],
    }),
  },
  navbar: {
    label: "Nav bar", icon: "\u2261", addable: true,
    fields: [
      { key: "logo", label: "Logo URL", type: "url" },
      { key: "items", label: "Links", type: "list",
        hint: "The APIs carry no site navigation, so these are yours. Each one defaults to the event microsite so none is a dead link.",
        itemFields: [{ key: "label", label: "Label" }, { key: "href", label: "Links to", type: "url" }] },
      { key: "label", label: "Button", type: "text" },
      { key: "href", label: "Button link", type: "url" },
      { key: "tone", label: "Bar", type: "select", default: "dark",
        options: [{ value: "dark", label: "Dark" }, { value: "accent", label: "Accent" }, { value: "light", label: "Light" }] },
    ],
    make: (e) => ({
      logo: getBrand(e.portal).logoLightUrl || getBrand(e.portal).logoUrl || "",
      tone: "dark", label: "Register", href: e.micrositeUrl || "",
      items: [
        { label: "Sponsors", href: e.micrositeUrl || "" },
        { label: "About", href: e.micrositeUrl || "" },
        { label: "Location", href: e.micrositeUrl || "" },
      ],
    }),
  },
  mosaic: {
    label: "Photo mosaic", icon: "\u25a6", addable: true,
    fields: [
      { key: "title", label: "Heading", type: "text", rich: true },
      // Same control, same words and same rule as `sessions` and `pricing` — a
      // third spelling of "centred heading with a rule under it" is how three of
      // them end up drawing three different rules.
      { key: "align", label: "Heading alignment", type: "select", default: "left",
        options: [{ value: "left", label: "Left" }, { value: "center", label: "Centred, with a rule" }] },
      { key: "text", label: "Copy", type: "textarea", rich: true,
        hint: "One paragraph per line." },
      { key: "label", label: "Button", type: "text" },
      { key: "href", label: "Button link", type: "url" },
      { key: "side", label: "Photos on the", type: "select", default: "left",
        options: [{ value: "left", label: "Left" }, { value: "right", label: "Right" }] },
      ...SECTION_BG,
      { key: "items", label: "Photos", type: "list",
        hint: "Four works best \u2014 a 2\u00d72 grid. Seeded from the event's own speaker photos; replace the URLs with your own artwork.",
        itemFields: [{ key: "url", label: "Image URL", type: "url" }, { key: "alt", label: "Alt text" }] },
    ],
    // Seeded from REAL event artwork rather than blank frames, so the block says
    // something the moment it lands and the sender edits rather than fills.
    make: (e) => ({
      title: e.name, text: "", label: "More info", href: e.micrositeUrl || "", side: "left",
      items: (e.speakers || []).filter((s: any) => s.photoUrl).slice(0, 4)
        .map((s: any) => ({ url: s.photoUrl, alt: s.name })),
    }),
  },
  social: {
    label: "Social row", icon: "\u25cf", addable: true,
    fields: [
      { key: "title", label: "Line above", type: "text", rich: true },
      { key: "tone", label: "Icon colour", type: "select", default: "auto",
        options: [{ value: "auto", label: "Automatic" }, { value: "light", label: "Light (for dark bands)" }, { value: "dark", label: "Dark (for light bands)" }] },
      { key: "size", label: "Icon size (px)", type: "number", default: "20" },
      { key: "items", label: "Accounts", type: "list",
        hint: "The APIs carry no social handles, so these are yours \u2014 they default to the portal's own pages.",
        itemFields: [{ key: "network", label: "facebook / x / linkedin / instagram / youtube" }, { key: "href", label: "Links to", type: "url" }] },
      ...SECTION_BG,
    ],
    make: (e) => ({
      title: "", tone: "auto", size: "20",
      items: ["facebook", "x", "linkedin", "instagram", "youtube"]
        .map((network) => ({ network, href: `https://${e.portal}.economictimes.indiatimes.com/` })),
    }),
  },
  quote: {
    label: "Pull quote", icon: "\u275D", addable: true,
    fields: [
      { key: "text", label: "Quote", type: "textarea", rich: true },
      { key: "name", label: "Said by", type: "text" },
      { key: "role", label: "Designation, company", type: "text" },
      { key: "photo", label: "Photograph", type: "url",
        hint: "Square crops best. Empty drops the picture and the panel takes the full width." },
      { key: "style", label: "Layout", type: "select", default: "panel",
        options: [
          { value: "panel", label: "Photo beside a filled panel" },
          { value: "card", label: "Panel only, no photo" },
          { value: "bar", label: "Rule down the left (plain)" },
        ] },
      { key: "side", label: "Photo side", type: "select", default: "left",
        options: [{ value: "left", label: "Left" }, { value: "right", label: "Right" }],
        showWhen: { style: ["panel"] } },
      { key: "photoWidth", label: "Photo width", type: "select", default: "230",
        options: [{ value: "170", label: "Small" }, { value: "230", label: "Medium" }, { value: "290", label: "Large" }],
        showWhen: { style: ["panel"] } },
      { key: "shape", label: "Photo shape", type: "select", default: "square",
        options: [{ value: "square", label: "Square" }, { value: "round", label: "Rounded" }, { value: "circle", label: "Circle" }],
        showWhen: { style: ["panel"] } },
      { key: "panelBg", label: "Panel colour", type: "color",
        hint: "Hex. Empty uses the mailer's own primary. Every line on the panel is re-measured against whatever you pick.",
        showWhen: { style: ["panel", "card"] } },
      YESNO_FIELD("mark", "Quotation mark", "The oversized \u201D above the quote, as the reference has.", "yes"),
      { key: "size", label: "Quote size", type: "select", default: "15",
        options: [{ value: "14", label: "Small" }, { value: "15", label: "Medium" }, { value: "17", label: "Large" }] },
      ALIGN,
      ...SECTION_BG,
    ],
    make: () => ({ text: "", name: "", role: "", photo: "", style: "panel", side: "left",
      photoWidth: "230", shape: "square", panelBg: "", mark: "yes", size: "15", align: "left" }),
  },
  image: {
    label: "Inline image", icon: "⬚", addable: true,
    fields: [
      { key: "url", label: "Image URL", type: "url" },
      { key: "href", label: "Links to", type: "url" },
      { key: "alt", label: "Alt text", type: "text" },
      { key: "width", label: "Width (px)", type: "number" },
      // `ALIGN`'s first option is Left, which is where a display:block image has
      // always sat, so a document with no `align` renders the same bytes.
      ALIGN,
      // The first option is the 10px this block has always drawn, and it is the
      // declared default, so a document saved before this field existed carries no
      // `radius`, resolves to "" here, and renders the exact bytes it always did.
      // A corner radius is the one decoration Outlook on Windows drops outright —
      // Word squares every box off — so "circle" is a progressive enhancement, not
      // something a layout may depend on.
      { key: "radius", label: "Corners", type: "select", default: "",
        options: [
          { value: "", label: "House default (10px)" },
          { value: "0", label: "Square" },
          { value: "12", label: "Rounded" },
          { value: "999", label: "Circle" },
        ],
        hint: "“Circle” only reads as one on a square image, and Outlook on Windows squares every corner off regardless." },
    ],
    make: () => ({ url: "", href: "", alt: "", width: INNER }),
  },
  features: {
    label: "Icon tiles", icon: "◇", addable: true,
    fields: [
      { key: "title", label: "Heading", type: "text", rich: true },
      // 2/3/4 only: one per row is a paragraph with a picture over it, not a grid,
      // and five across leaves an icon smaller than the caption under it.
      { key: "cols", label: "Per row", type: "select", default: "3",
        options: [{ value: "2", label: "2 per row" }, { value: "3", label: "3 per row" }, { value: "4", label: "4 per row" }] },
      { key: "iconSize", label: "Icon size", type: "select", default: "56",
        options: [{ value: "40", label: "Small (40px)" }, { value: "56", label: "Medium (56px)" }, { value: "72", label: "Large (72px)" }] },
      { ...ALIGN, default: "center" },
      ...SECTION_BG,
      { key: "items", label: "Tiles", type: "list",
        hint: "The ET APIs expose no iconography, so the artwork is yours — these seed from the house icon set. Choose a house glyph or upload your own; a tile with no icon still prints its words.",
        itemFields: [
          { key: "icon", label: "Icon", type: "icon" },
          { key: "title", label: "Title" },
          { key: "text", label: "Caption", type: "textarea" },
        ] },
    ],
    // Seeded from the event's OWN "why join us" lines when it has them, so the
    // block says something true the moment it lands; otherwise it seeds the shape
    // (icons + empty captions), the way `pricing` seeds tiers without prices.
    make: (e) => {
      const points = (e.whyJoin || []).filter(Boolean).slice(0, 3);
      const src = points.length ? points : (e.keyPoints || []).filter(Boolean).slice(0, 3);
      const rows = src.length ? src : ["", "", ""];
      // Seeded from the tile's OWN words, and distinct across the grid — the old
      // three-name cycle repeated a glyph the moment a fourth tile existed.
      const names = houseIconNames(rows);
      return {
        title: "", cols: "3", iconSize: "56", align: "center",
        items: rows.map((t: string, i: number) => ({ icon: houseIconUrl(names[i]), title: "", text: t })),
      };
    },
  },
  // A grid of downloadable resources — ebooks, whitepapers, articles — each a
  // cover image, a title and a link. The ET APIs expose NO resources for a
  // microsite (verified: no resource endpoint, empty page-content modules), so
  // this seeds the SHAPE only and every card is filled in by hand — the same way
  // `pricing` seeds tiers without prices.
  resources: {
    label: "Resource cards", icon: "▢", addable: true,
    fields: [
      { key: "title", label: "Heading", type: "text", rich: true },
      { key: "cols", label: "Per row", type: "select", default: "3",
        options: [{ value: "2", label: "2 per row" }, { value: "3", label: "3 per row" }, { value: "4", label: "4 per row" }] },
      { key: "linkLabel", label: "Link text", type: "text", default: "Know more" },
      { ...ALIGN, default: "left" },
      ...SECTION_BG,
      { key: "items", label: "Resources", type: "list",
        hint: "One card per resource. The APIs carry no downloads, so the cover image and link are yours: upload or paste a cover, the title, and where it opens.",
        itemFields: [
          { key: "image", label: "Cover image URL", type: "url" },
          { key: "title", label: "Title", type: "textarea" },
          { key: "url", label: "Links to", type: "url" },
        ] },
    ],
    make: (e) => ({
      title: "Explore Resources", cols: "3", linkLabel: "Know more", align: "left",
      items: [0, 1, 2].map(() => ({ image: "", title: "", url: e.micrositeUrl || e.ctaUrl || "" })),
    }),
  },
  circles: {
    label: "Circle callouts", icon: "◯", addable: true,
    fields: [
      { key: "size", label: "Circle size", type: "select", default: "medium",
        options: [{ value: "small", label: "Small" }, { value: "medium", label: "Medium" }, { value: "large", label: "Large" }] },
      { key: "tone", label: "Fill", type: "select", default: "accent",
        options: [
          { value: "accent", label: "Accent" },
          { value: "tile", label: "Card colour" },
          { value: "outline", label: "Outline only" },
        ] },
      ...SECTION_BG,
      { key: "items", label: "Circles", type: "list",
        hint: "Two to four. Text does not flow around a curve in email HTML, so a caption longer than the circle holds is shrunk a step and then clipped — keep them to a few words.",
        itemFields: [{ key: "text", label: "Text", type: "textarea" }] },
    ],
    // Seeded from the event's own headline figures where it has them — a circle
    // holds a few words, which is exactly what a stat is.
    make: (e) => {
      const fromStats = (e.stats || []).slice(0, 3)
        .map((s: any) => ({ text: [s.value, s.label].filter(Boolean).join(" ").trim() }))
        .filter((x) => !!x.text);
      return {
        size: "medium", tone: "accent",
        items: fromStats.length ? fromStats : [{ text: "Two days" }, { text: "One room" }, { text: "Every decision-maker" }],
      };
    },
  },
  ribbon: {
    label: "Edition flag", icon: "⚑", addable: true,
    fields: [
      { key: "flag", label: "Flag", type: "text", hint: "e.g. “4th edition”. Empty and the tab is not drawn at all." },
      { key: "hashtag", label: "Hashtag", type: "text", hint: "Sits at the right-hand end of the same row. Empty and nothing prints there." },
      { key: "tone", label: "Flag colour", type: "select", default: "accent",
        options: [{ value: "accent", label: "Accent" }, { value: "dark", label: "Dark" }, { value: "light", label: "Light" }] },
      ...SECTION_BG,
    ],
    make: (e) => ({
      flag: e.edition ? `${ordinal(e.edition)} Edition` : "",
      hashtag: e.hashtag || "",
      tone: "accent",
    }),
  },
  contacts: {
    label: "Contact rows", icon: "✆", addable: true,
    fields: [
      { key: "title", label: "Section label", type: "text", rich: true, hint: "Shown as a caps section label above the rows." },
      { key: "items", label: "Contacts", type: "list",
        itemFields: [{ key: "role", label: "For…" }, { key: "name", label: "Name" }, { key: "email", label: "Email" }, { key: "phone", label: "Phone" }] },
      ...SECTION_BG,
    ],
    make: () => ({
      title: "Contact us",
      items: [
        { role: "For Delegation", name: "", email: "", phone: "" },
        { role: "For Sponsorship", name: "", email: "", phone: "" },
      ],
    }),
  },
  divider: { label: "Divider", icon: "—", addable: true, fields: [], make: () => ({}) },
  spacer: {
    label: "Spacer", icon: "␣", addable: true,
    fields: [{ key: "height", label: "Height (px)", type: "number" }],
    make: () => ({ height: 24 }),
  },
  footer: {
    label: "Footer", icon: "▁", addable: true,
    fields: [
      { key: "portal", label: "Portal name", type: "text",
        hint: "Auto-filled from the selected portal — appears before the address." },
      { key: "unsubscribe", label: "Unsubscribe link", type: "text",
        hint: "The ESP token the house mailers use. Leave as-is unless your send tool differs." },
      { key: "address", label: "Registered address", type: "textarea" },
    ],
    make: (e) => ({
      name: e.name, meta: dateVenue(e), href: siteUrl(e),
      portal: getBrand(e.portal).name,
      unsubscribe: "{$$!!unsubscribelink!!$$}",
      address: ADDRESS,
    }),
  },
  html: {
    label: "Custom HTML", icon: "</>", addable: true,
    fields: [{ key: "html", label: "HTML", type: "textarea", hint: "Dropped in as-is. Keep it table-based to stay email-safe." }],
    make: () => ({ html: "<p>Custom HTML</p>" }),
  },
};

/** Which text fields on a block hold prose — used by the AI copy pass. */
export const COPY_FIELDS: Partial<Record<BlockType, string[]>> = {
  hero: ["title", "sub"],
  heading: ["eyebrow", "text"],
  text: ["text"],
  bullets: ["title"],
  button: ["label", "note"],
  quote: ["text"],
  speakers: ["title", "note"],
  sponsors: ["title"],
  sessions: ["title"],
  features: ["title"],
  resources: ["title"],
};

// ---- block renderers --------------------------------------------------------

/** Times Internet's registered address, as it appears in every house mailer. */
const ADDRESS = "(Times Center), FC - 6, Film City, Sector 16A, Noida - 201301, Uttar Pradesh, India";

/** The Custom HTML block is the only place raw markup enters a mailer. It runs in
 *  the studio's preview iframe and must never carry anything executable into a
 *  downloaded mail — email clients strip most of it, but we do not rely on that.
 *
 *  A regex stripper is the wrong tool here: the old one required WHITESPACE before
 *  an `on…=` handler (`/\son[a-z]+=/`), so `<img src=x/onerror=…>` and `<svg/onload=…>`
 *  slipped straight through. This is a small ALLOW-LIST tokeniser instead — it walks
 *  the fragment, keeps only known-safe elements, and re-emits every attribute with a
 *  quoted, escaped value. Because the output is fully quoted, a browser re-parsing it
 *  cannot discover a handler or a broken-out attribute however the input was spelled;
 *  handlers, unknown/executable elements and `javascript:`/`data:`/`vbscript:` URLs
 *  never reach the output regardless of the separator or casing that hid them. */

// Formatting / layout elements a rich-HTML block may keep. Anything not here has its
// tags dropped (its text is preserved) — a whitelist can't be widened by a new trick.
const SANITISE_ALLOWED = new Set<string>([
  "a", "abbr", "address", "article", "aside", "b", "bdi", "bdo", "blockquote", "br",
  "caption", "center", "cite", "code", "col", "colgroup", "dd", "del", "dfn", "div",
  "dl", "dt", "em", "figcaption", "figure", "font", "footer", "h1", "h2", "h3", "h4",
  "h5", "h6", "header", "hr", "i", "img", "ins", "kbd", "li", "main", "mark", "nav",
  "ol", "p", "pre", "q", "s", "samp", "section", "small", "span", "strong", "sub",
  "summary", "sup", "table", "tbody", "td", "tfoot", "th", "thead", "time", "tr", "u",
  "ul", "var", "wbr",
]);
// Executable / document / interactive elements: dropped WITH their content (the
// non-void ones swallow everything up to their close), even self-closed or unclosed.
const SANITISE_DROP = new Set<string>([
  "script", "style", "iframe", "object", "embed", "form", "noscript", "template",
  "svg", "math", "title", "textarea", "select", "option", "optgroup", "button",
  "input", "frame", "frameset", "applet", "base", "meta", "link", "xml", "head",
  "body", "html", "marquee", "video", "audio", "source", "track", "canvas", "dialog",
  "portal", "param",
]);
// Void elements never open a content scope.
const SANITISE_VOID = new Set<string>([
  "br", "hr", "img", "col", "wbr", "area", "input", "base", "meta", "link", "source",
  "track", "embed", "param",
]);
// Attributes that hold a URL — re-checked for an executable scheme however it is hidden.
const SANITISE_URL_ATTRS = new Set<string>([
  "href", "src", "action", "background", "poster", "cite", "longdesc", "usemap", "profile",
]);

/** True when a URL's scheme is executable, seeing through whitespace, control chars
 *  and entity-encoded colons that try to hide `javascript:` / `data:` / `vbscript:`. */
function sanitiseIsDangerousUrl(v: string): boolean {
  let s = String(v)
    .replace(/&#x([0-9a-f]+);?/gi, (_, h) => { const n = parseInt(h, 16); return n ? String.fromCharCode(n) : ""; })
    .replace(/&#(\d+);?/g, (_, d) => { const n = parseInt(d, 10); return n ? String.fromCharCode(n) : ""; })
    .replace(/&colon;/gi, ":")
    .replace(/[\x00-\x20]+/g, "");
  return /^(javascript|data|vbscript):/i.test(s);
}

const sanitiseEscAttr = (s: string) => String(s)
  .replace(/&(?!(#\d+|#x[0-9a-f]+|[a-z]+);)/gi, "&amp;")
  .replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Re-parse and re-emit only the safe attributes of a kept tag. */
function sanitiseAttrs(rawAttrs: string, tag: string): string {
  const s = rawAttrs.replace(/\/\s*$/, ""); // drop a trailing self-closing slash
  const attrRe = /([^\s"'=<>/]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'=<>`]+))?/g;
  let out = "";
  let m: RegExpExecArray | null;
  while ((m = attrRe.exec(s))) {
    const name = m[1].toLowerCase();
    if (!/^[a-z_:][a-z0-9_:.-]*$/.test(name)) continue;
    // Event handlers, whatever separator preceded them, never survive.
    if (name.startsWith("on")) continue;
    // Attributes that can smuggle a URL/handler and have no place in email rich text.
    if (name === "srcset" || name === "formaction" || name === "xlink:href" || name === "data" || name === "codebase") continue;
    const rawVal = m[2];
    let value = rawVal == null ? null
      : (rawVal[0] === '"' || rawVal[0] === "'") ? rawVal.slice(1, -1) : rawVal;
    if (name === "style") {
      if (value && /(expression\s*\(|(?:javascript|vbscript)\s*:|url\s*\(\s*['"]?\s*(?:javascript|vbscript|data)\s*:|@import|behavior\s*:|-moz-binding)/i.test(value)) continue;
    }
    if (SANITISE_URL_ATTRS.has(name) && value != null && sanitiseIsDangerousUrl(value)) value = "#";
    out += value == null ? ` ${name}` : ` ${name}="${sanitiseEscAttr(value)}"`;
  }
  return out;
}

export function sanitiseFragment(raw: string): string {
  const src = String(raw ?? "");
  const n = src.length;
  let out = "";
  let i = 0;
  let dropTag = ""; // while set, suppress everything up to this element's close

  while (i < n) {
    const lt = src.indexOf("<", i);
    if (lt === -1) { if (!dropTag) out += src.slice(i); break; }
    if (!dropTag) out += src.slice(i, lt);

    // Comments and declarations / processing instructions: dropped entirely.
    if (src.startsWith("<!--", lt)) { const e = src.indexOf("-->", lt + 4); i = e === -1 ? n : e + 3; continue; }
    if (src[lt + 1] === "!" || src[lt + 1] === "?") { const e = src.indexOf(">", lt + 1); i = e === -1 ? n : e + 1; continue; }

    const head = /^<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9:-]*)/.exec(src.slice(lt));
    if (!head) { if (!dropTag) out += "&lt;"; i = lt + 1; continue; } // a stray '<'

    const closing = head[1] === "/";
    const tag = head[2].toLowerCase();
    // Find the tag's closing '>', honouring quoted attribute values.
    let j = lt + head[0].length, quote = "";
    while (j < n) {
      const ch = src[j];
      if (quote) { if (ch === quote) quote = ""; }
      else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === ">") break;
      j++;
    }
    const rawAttrs = src.slice(lt + head[0].length, j);
    const selfClose = /\/\s*$/.test(rawAttrs);
    i = j < n ? j + 1 : n;

    if (dropTag) { if (closing && tag === dropTag) dropTag = ""; continue; }

    if (SANITISE_DROP.has(tag)) {
      // Open a suppression scope for non-void droppable elements; void/self-closed
      // ones (and any close tag) simply vanish with nothing after them consumed.
      if (!closing && !selfClose && !SANITISE_VOID.has(tag)) dropTag = tag;
      continue;
    }
    if (!SANITISE_ALLOWED.has(tag)) continue; // drop the tag markup, keep text around it
    if (closing) { out += `</${tag}>`; continue; }
    out += `<${tag}${sanitiseAttrs(rawAttrs, tag)}>`;
  }
  return out;
}

const num = (v: any, d: number) => (Number.isFinite(Number(v)) ? Number(v) : d);
const colsOf = (v: any, d = 3) => Math.max(1, Math.min(4, num(v, d)));

/** Rough characters-per-line for a given cell width and font size. Used to size
 *  every caption in a grid to the LONGEST entry, so cards align exactly instead
 *  of relying on percentage heights (which table cells resolve inconsistently). */
function captionHeight(items: any[], w: number, o: { bio?: boolean; social?: boolean } = {}): number {
  const perLine = Math.max(12, Math.floor((w - 24) / 6.2));      // ~11.5px Verdana
  const lines = (txt: string, cap: number) => Math.min(cap, Math.max(txt ? 1 : 0, Math.ceil(String(txt || "").length / perLine)));
  let max = 0;
  for (const it of items) {
    const h = 11                                                  // padding top
      + (it?.name ? 18 : 0)
      + (it?.role ? 4 + lines(it.role, 3) * 16 : 0)
      + (it?.company ? 3 + lines(it.company, 2) * 16 : 0)
      + (o.bio && it?.bio ? 8 + lines(it.bio, 4) * 16 : 0)
      + (o.social && socialsOf(it).length ? 12 + 18 : 0)
      + 13;                                                       // padding bottom
    if (h > max) max = h;
  }
  return Math.max(58, max);
}

/** Uniform height for a row of label/value tiles, sized to the longest value.
 *  "Radisson Blu Hotel, Amritsar" wraps to two lines while "3 days" doesn't —
 *  without this the tiles in a row end at different heights. */
function tileHeight(items: any[], w: number, o: { valueSize: number; padY: number; labelH: number; gap: number }): number {
  const perLine = Math.max(8, Math.floor((w - 34) / (o.valueSize * 0.56)));
  let max = 0;
  for (const it of items) {
    const lines = Math.min(3, Math.max(1, Math.ceil(String(it?.value ?? "").length / perLine)));
    const labelLines = Math.min(2, Math.max(1, Math.ceil(String(it?.label ?? "").length / Math.max(8, Math.floor((w - 34) / 6.4)))));
    const h = o.padY * 2 + o.labelH * labelLines + o.gap + Math.round(lines * o.valueSize * 1.35);
    if (h > max) max = h;
  }
  return max;
}

/** House glyphs ship as a light/dark PAIR, and a block can end up on either kind
 *  of surface — house rule 5 is about every mark on the page, not only type. So a
 *  URL this codebase seeded is re-pointed at the cut that shows up on the surface
 *  the tile actually paints on. Anything else the sender typed is passed through
 *  untouched: we know nothing about their artwork and guessing at a variant that
 *  may not exist would replace a visible icon with a broken one. */
function iconFor(url: string, surface: string): string {
  const m = String(url || "").match(/^(.*\/assets\/icons\/[a-z0-9_-]+)-(?:dark|light)\.png$/i);
  if (!m) return url;
  return `${m[1]}-${lum(surface) < 0.5 ? "light" : "dark"}.png`;
}

/** Which parts of a person show. The blocks pass this through so one grid can be
 *  a full card or just names, without a separate layout for each combination. */
interface CellOpts { role?: boolean; company?: boolean; shape?: string; bio?: boolean; social?: boolean }

/** The networks a speaker actually has a link for, in a fixed order. A field left
 *  empty is left OUT — the reference prints three icons per person, but printing
 *  an icon with nowhere to go is worse than printing two. */
const SPEAKER_NETS = ["facebook", "x", "linkedin"] as const;
function socialsOf(s: any): { net: string; href: string }[] {
  return SPEAKER_NETS
    .map((net) => ({ net, href: String(s?.[net] ?? "").trim() }))
    .filter((x) => !!safeUrl(x.href));
}

function speakerCell(s: any, w: number, ctx: RenderCtx, capH?: number, o: CellOpts = {}): string {
  const p = ctx.p;
  const src = resizeUrl(s.photo, w, w);
  const photo = src
    // The CDN crop is square, but it can come back a pixel or two off; pinning the
    // height keeps every photo — and so every card — identical. `.fluid` releases
    // this on phones, where cards are one-per-row anyway.
    ? imageLink(`<img class="fluid" src="${esc(src)}" width="${w}" height="${w}" alt="${esc(s.name || "")}" style="display:block;width:100%;max-width:${w}px;height:${w}px;border:0${o.shape === "circle" ? `;border-radius:${w}px` : o.shape === "round" ? ";border-radius:10px" : ""}">`, ctx, s.link)
    : `<div style="height:${Math.round(w * 0.9)}px;background-color:${p.tileBg}"></div>`;
  // A bordered card with a captioned foot reads as designed; a bare photo + text
  // reads as a data dump.
  // height:100% makes every card fill its cell, so all cards in a row end at the
  // same baseline instead of stepping with the length of each person's title.
  // The caption's height attribute gives Word (Outlook) the same floor, since it
  // sizes nested tables to content and ignores height:100%.
  return `<table class="spcard" role="presentation" width="100%" height="100%" cellpadding="0" cellspacing="0" border="0" style="height:100%;background-color:${p.cardBg};border:1px solid ${p.cardEdge};border-radius:10px;overflow:hidden">
    <tr><td style="padding:0">${photo}</td></tr>
    <tr><td valign="top" height="${capH || 86}" style="height:${capH || 86}px;padding:11px 12px 13px">
      ${s.name ? `<div style="font-family:${ctx.font};font-size:13.5px;font-weight:700;line-height:1.3;color:${p.ink}">${esc(s.name)}</div>` : ""}
      ${s.role && o.role !== false ? `<div style="margin:4px 0 0;font-family:${ctx.font};font-size:11.5px;line-height:1.4;color:${p.inkSoft}">${esc(s.role)}</div>` : ""}
      ${s.company && o.company !== false ? `<div style="margin:3px 0 0;font-family:${ctx.font};font-size:11.5px;font-weight:700;line-height:1.4;color:${p.onCard}">${esc(s.company)}</div>` : ""}
      ${o.bio && s.bio ? `<div style="margin:8px 0 0;font-family:${ctx.font};font-size:11.5px;line-height:1.45;color:${p.inkSoft}">${esc(s.bio)}</div>` : ""}
      ${o.social && socialsOf(s).length ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:12px 0 0"><tr>
        ${socialsOf(s).map(({ net, href }) => `<td style="padding:0 9px 0 0"><a href="${esc(safeUrl(href) || "#")}" target="_blank" style="text-decoration:none"><img src="${ASSET_BASE}/assets/icons/${net}-${lum(p.cardBg) < 0.5 ? "light" : "dark"}.png" width="16" height="16" alt="${esc(net)}" style="display:block;width:16px;height:16px;border:0"></a></td>`).join("")}
      </tr></table>` : ""}
    </td></tr></table>`;
}

/** Circular portrait over centred name/role/company — the most common speaker
 *  layout in the reference set (Speaker styles 5, 7, 8, 9, 10, 18). Outlook shows
 *  the photo square; every other client rounds it. */
function speakerCircle(s: any, w: number, ctx: RenderCtx, capH?: number, o: CellOpts = {}): string {
  const p = ctx.p, d = Math.min(w, 132);
  const src = resizeUrl(s.photo, d * 2, d * 2);
  const photo = src
    ? imageLink(`<img src="${esc(src)}" width="${d}" height="${d}" alt="${esc(s.name || "")}" style="display:block;margin:0 auto;width:${d}px;height:${d}px;border-radius:${d}px;border:3px solid ${p.cardEdge}">`, ctx, s.link)
    : `<div style="width:${d}px;height:${d}px;margin:0 auto;border-radius:${d}px;background-color:${p.tileBg}"></div>`;
  return `<table class="spcard" role="presentation" width="100%" height="100%" cellpadding="0" cellspacing="0" border="0" style="height:100%">
    <tr><td align="center" style="padding:0 0 10px">${photo}</td></tr>
    <tr><td align="center" valign="top" height="${capH || 76}" style="height:${capH || 76}px;padding:0 4px;text-align:center">
      ${s.name ? `<div style="font-family:${ctx.font};font-size:13px;font-weight:700;line-height:1.3;color:${p.ink}">${esc(s.name)}</div>` : ""}
      ${s.role && o.role !== false ? `<div style="margin:3px 0 0;font-family:${ctx.font};font-size:11px;line-height:1.4;color:${p.inkSoft}">${esc(s.role)}</div>` : ""}
      ${s.company && o.company !== false ? `<div style="margin:2px 0 0;font-family:${ctx.font};font-size:11px;font-weight:700;line-height:1.4;color:${p.onCard}">${esc(s.company)}</div>` : ""}
    </td></tr></table>`;
}

/** Big photo with the name on an accent bar across the foot — the two-up feature
 *  layout (Speaker styles 1 and 6). */
function speakerFeature(s: any, w: number, ctx: RenderCtx, capH?: number, o: CellOpts = {}): string {
  const p = ctx.p;
  // Square crop, like every other layout. A portrait crop (w x 1.15w) asked the CDN
  // for a variant size nothing else uses, and imgv2 404s on cold sizes — the photo
  // then failed to load and the forced height left a stretched empty frame.
  const src = resizeUrl(s.photo, w, w);
  const photo = src
    ? imageLink(`<img class="fluid" src="${esc(src)}" width="${w}" height="${w}" alt="${esc(s.name || "")}" style="display:block;width:100%;max-width:${w}px;height:${w}px;border:0">`, ctx, s.link)
    : `<div style="height:${w}px;background-color:${p.tileBg}"></div>`;
  return `<table class="spcard" role="presentation" width="100%" height="100%" cellpadding="0" cellspacing="0" border="0" style="height:100%;border-radius:10px;overflow:hidden">
    <tr><td style="padding:0">${photo}</td></tr>
    <tr><td valign="top" height="${capH || 64}" bgcolor="${p.primary}" style="height:${capH || 64}px;padding:10px 12px;background-color:${p.primary};text-align:center">
      ${s.name ? `<div style="font-family:${ctx.font};font-size:13.5px;font-weight:700;line-height:1.25;color:${readable("#ffffff", p.primary)}">${esc(s.name)}</div>` : ""}
      ${(o.role !== false && s.role) || (o.company !== false && s.company) ? `<div style="margin:3px 0 0;font-family:${ctx.font};font-size:11px;line-height:1.35;color:${readable("#ffffff", p.primary, 3.5)}">${esc([o.role !== false ? s.role : "", o.company !== false ? s.company : ""].filter(Boolean).join(", "))}</div>` : ""}
    </td></tr></table>`;
}

/** Photo left, text right — the compact two-column list (Speaker style 11). */
function speakerRow(s: any, w: number, ctx: RenderCtx, capH?: number, o: CellOpts = {}): string {
  const p = ctx.p, d = 74;
  const src = resizeUrl(s.photo, d * 2, d * 2);
  return `<table class="spcard" role="presentation" width="100%" height="100%" cellpadding="0" cellspacing="0" border="0" style="height:100%;background-color:${p.cardBg};border:1px solid ${p.cardEdge};border-radius:10px">
    <tr><td valign="middle" height="${capH || 96}" style="height:${capH || 96}px;padding:10px 12px">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td width="${d}" valign="top" style="width:${d}px;padding:0 10px 0 0">${src
          ? imageLink(`<img src="${esc(src)}" width="${d}" height="${d}" alt="${esc(s.name || "")}" style="display:block;width:${d}px;height:${d}px;border-radius:8px;border:0">`, ctx, s.link)
          : `<div style="width:${d}px;height:${d}px;border-radius:8px;background-color:${p.tileBg}"></div>`}</td>
        <td valign="top">
          ${s.name ? `<div style="font-family:${ctx.font};font-size:13px;font-weight:700;line-height:1.3;color:${p.ink}">${esc(s.name)}</div>` : ""}
          ${s.role && o.role !== false ? `<div style="margin:3px 0 0;font-family:${ctx.font};font-size:11px;line-height:1.4;color:${p.inkSoft}">${esc(s.role)}</div>` : ""}
          ${s.company && o.company !== false ? `<div style="margin:2px 0 0;font-family:${ctx.font};font-size:11px;font-weight:700;line-height:1.4;color:${p.onCard}">${esc(s.company)}</div>` : ""}
        </td></tr></table>
    </td></tr></table>`;
}

/** Name/role on a solid colour tile — the photo-free grid (Speaker style 3), and
 *  the honest fallback when the API has no portraits for an event. */
function speakerTile(s: any, w: number, ctx: RenderCtx, capH?: number, o: CellOpts = {}): string {
  const p = ctx.p;
  return `<table class="spcard" role="presentation" width="100%" height="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${p.primary}" style="height:100%;background-color:${p.primary};border-radius:10px">
    <tr><td align="center" valign="middle" height="${capH || 92}" style="height:${capH || 92}px;padding:18px 14px;text-align:center">
      ${s.name ? `<div style="font-family:${ctx.font};font-size:14px;font-weight:700;line-height:1.3;color:${readable("#ffffff", p.primary)}">${esc(s.name)}</div>` : ""}
      ${(o.role !== false && s.role) || (o.company !== false && s.company) ? `<div style="margin:5px 0 0;font-family:${ctx.font};font-size:11px;line-height:1.4;color:${readable("#ffffff", p.primary, 3.5)}">${esc([o.role !== false ? s.role : "", o.company !== false ? s.company : ""].filter(Boolean).join(", "))}</div>` : ""}
    </td></tr></table>`;
}

/** One square of the checkerboard: either the portrait, or the solid tile that
 *  carries that person's name. Both are exactly `w` square, so the two kinds
 *  interlock instead of stepping — which is the whole of the effect. */
function checkerSquare(s: any, w: number, ctx: RenderCtx, photo: boolean, o: CellOpts = {}): string {
  const p = ctx.p;
  if (photo) {
    const src = resizeUrl(s.photo, w, w);
    // Same reasoning as every other photo here: the CDN crop is square but can
    // come back a pixel or two off, and email HTML has no object-fit to correct
    // with, so the height is pinned. `.fluid` is deliberately NOT used — on a
    // phone these stay two-up and must stay square, or the board goes ragged.
    return `<table class="spcard" role="presentation" width="100%" height="100%" cellpadding="0" cellspacing="0" border="0" style="height:100%">
      <tr><td height="${w}" style="height:${w}px;padding:0;font-size:0;line-height:0">${src
        ? imageLink(`<img src="${esc(src)}" width="${w}" height="${w}" alt="${esc(s.name || "")}" style="display:block;width:100%;height:${w}px;border:0">`, ctx, s.link)
        : `<div style="width:100%;height:${w}px;background-color:${p.tileBg}"></div>`}</td></tr></table>`;
  }
  // The name square is a solid fill, so its ink is measured against THAT fill and
  // not against the card — the dark-figures-on-a-dark-card bug, one surface over.
  const ink = readable("#ffffff", p.primary);
  const sub = readable("#ffffff", p.primary, 3.5);
  const line = [o.role !== false ? s.role : "", o.company !== false ? s.company : ""].filter(Boolean).join(", ");
  // No padding on the sized cell: a table cell resolves `height` as CONTENT height,
  // so padding is ADDED to it — 12px of it made this square 24px taller than the
  // photograph next to it and the board stepped. The inset lives on an inner div.
  return `<table class="spcard" role="presentation" width="100%" height="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${p.primary}" style="height:100%;background-color:${p.primary}">
    <tr><td align="center" valign="middle" height="${w}" style="height:${w}px;padding:0;text-align:center">
      <div style="padding:12px 10px">
        ${s.name ? `<div style="font-family:${ctx.font};font-size:13.5px;font-weight:700;line-height:1.28;color:${ink}">${esc(s.name)}</div>` : ""}
        ${line ? `<div style="margin:5px 0 0;font-family:${ctx.font};font-size:11px;line-height:1.35;color:${sub}">${esc(line)}</div>` : ""}
      </div>
    </td></tr></table>`;
}

function sponsorCell(s: any, w: number, ctx: RenderCtx, o: { style?: string; h?: number; name?: boolean; surface?: string } = {}): string {
  const p = ctx.p, style = o.style || "cards", cap = o.h || 44;
  // Only set when the SECTION brought its own background. The card layouts keep a
  // white ground whatever colour sits behind them (dark-on-transparent logos need
  // one), so the partner name under a logo has to be measured against the tile it
  // prints on and not against the band — on a dark section the section's own ink
  // is near-white, which on a white card is nothing at all. Left undefined, both
  // colours are exactly what they have always been.
  const tile = o.surface ? (style === "plain" || style === "bordered" ? o.surface : "#ffffff") : undefined;
  const nameInk = tile ? readable(p.inkSoft, tile, 4.6) : p.inkSoft;
  const wordInk = tile ? readable("#3c4257", tile, 4.6) : "#3c4257";
  const inner = s.logo
    ? `<img src="${esc(s.logo)}" alt="${esc(s.title || "")}" style="display:block;margin:0 auto;max-width:${w - 24}px;max-height:${cap}px;width:auto;height:auto;border:0">`
    : `<div style="font-family:${ctx.font};font-size:12.5px;font-weight:700;color:${wordInk};text-align:center">${esc(s.title || "")}</div>`;
  const name = o.name && s.logo && s.title
    ? `<div style="margin:8px 0 0;font-family:${ctx.font};font-size:11px;font-weight:700;line-height:1.35;color:${nameInk};text-align:center">${esc(s.title)}</div>`
    : "";
  // Logo tiles sit on white by default so dark-on-transparent logos stay visible.
  // "plain" drops the tile for a lighter strip; "bordered" keeps only the hairline.
  const skin = style === "plain"
    ? ""
    : style === "bordered"
      ? `border:1px solid ${p.cardEdge};border-radius:10px`
      : `background-color:#ffffff;border:1px solid ${p.cardEdge};border-radius:10px`;
  // `imageLink`, not `link`: a partner without its own URL used to render an
  // unwrapped logo, which is precisely what Gmail paints its download button on.
  return imageLink(
    `<table role="presentation" width="100%" height="100%" cellpadding="0" cellspacing="0" border="0" style="height:100%;${skin}">
       <tr><td align="center" valign="middle" height="${cap + 4}" style="height:${cap + 4}px;padding:${style === "plain" ? "8px 6px" : "16px 12px"}">${inner}${name}</td></tr>
     </table>`, ctx, s.url);
}

function renderBlock(b: Block, ctx: RenderCtx): string {
  // A null / non-object / typeless element renders to nothing, exactly as an
  // unknown block type does — the document may carry one (a bad edit, a truncated
  // paste) and a section that cannot be rendered must be skipped, never throw a 500.
  if (!b || typeof b !== "object" || typeof (b as any).type !== "string") return "";
  const q = b.props || {};
  // A background the sender chose is a surface the palette never measured any of
  // its ink against, so the ENTIRE block is rendered from a palette re-derived
  // from it rather than patched colour by colour — a block reads a dozen ink
  // slots and the one that gets forgotten is the one that goes invisible.
  // Blocks with no background of their own, and the legacy tint values, keep the
  // document palette untouched.
  const sec = sectionFill(b.type, q, ctx.p);
  if (sec.own && sec.bg) ctx = { ...ctx, p: onSurface(ctx.p, sec.bg) };
  const p = ctx.p, f = ctx.font;
  // Handles for editing on the canvas. Only in the studio: the download must carry
  // no editor hooks at all (the delivery suite fails the build otherwise).
  const ed = (path: string) => (ctx.editor ? `${b.id}|${path}` : undefined);
  switch (b.type) {
    case "banner":
      if (!q.url) return "";
      return bleedRow(link(`<img src="${esc(safeUrl(q.url) || "")}" width="${WIDTH}" alt="${esc(q.alt || "")}" style="display:block;width:100%;max-width:${WIDTH}px;height:auto;border:0">`, q.href), { id: b.id });

    case "logobar": {
      // ONEWORLD PORT: the right-hand text may break — a long event hashtag (#EthrworldAnnualConclave27) is one
      // word, and unbroken it pushed the mail to 428px on a 390px phone.
      // The mastheads are dark ink on transparency and the portals publish a
      // light-ink variant for their own footers, so the bar picks by background.
      // A portal with no light variant gets a white plate instead of an invisible
      // logo. Anything the sender types into "Logo URL" always wins.
      const darkCard = lum(p.cardBg) < 0.38;
      const chosen = darkCard ? (q.logoLight || q.logo) : (q.logo || q.logoLight);
      const needsPlate = darkCard && !q.logoLight && !!q.logo;
      // Three sizes: the desktop cap is inline (clients that strip <style> keep it)
      // and the phone cap comes from the matching class in the mailer's <style>.
      const SZ: Record<string, [number, number, number]> = {
        small: [150, 44, 120], medium: [180, 52, 150], large: [270, 72, 190], xl: [360, 96, 220],
      };
      const [mw, mh] = SZ[String(q.size || "medium")] || SZ.medium;
      const img = chosen
        ? `<img class="logom logom-${esc(String(q.size || "medium"))}" src="${esc(safeUrl(chosen) || "")}" width="${Math.round(mw * 0.67)}" alt="${esc(ctx.brand.name)}" style="display:block;width:auto;max-width:${mw}px;max-height:${mh}px;height:auto;margin-bottom:5px;border:0">`
        : "";
      // No text-name fallback when the logo is empty: a sender who clears both
      // URLs typed that as "nothing here", not "print the brand name instead" —
      // showing a substitute they never asked for is as wrong as showing none of
      // what they DID ask for. The right-side text (q.right) is unaffected.
      const logo = img
        ? link(needsPlate
            ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="background-color:#ffffff;border-radius:8px">
                 <tr><td style="padding:8px 12px">${img}</td></tr></table>`
            : img, q.href)
        : "";
      return `<tr data-block-id="${b.id}"><td class="pad" style="padding:20px ${32}px 0">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
          <td align="left" valign="middle">${logo}</td>
          <td align="right" valign="middle" style="font-family:${f};font-size:13px;font-weight:800;color:${p.onCard};word-break:break-word;overflow-wrap:anywhere">${esc(q.right || "")}</td>
        </tr></table></td></tr>`;
    }

    case "hero": {
      const ribbon = q.ribbon
        ? `<div style="display:inline-block;margin:0 0 12px;padding:5px 12px;border-radius:99px;background-color:${p.accent};font-family:${f};font-size:11px;font-weight:800;letter-spacing:.07em;text-transform:uppercase;color:${p.accentInk}">${esc(q.ribbon)}</div>`
        : "";
      const al = String(q.align || "left");
      // A photograph behind the headline is the signature of the conference
      // layout. background-image is ignored by Outlook on Windows, so the cell
      // ALSO carries a solid dark fill — there the hero degrades to the brand
      // band rather than to unreadable text on white.
      // ONLY an explicit photograph. It must not fall back to the event's key
      // visual: that is a composed banner with the event name and strapline
      // already set into it, so laying the headline over it double-prints two
      // different headlines on top of each other. A sender who wants text over
      // artwork supplies a plain photograph; otherwise this stays the brand band.
      const photo = String(q.style || "gradient") === "photo"
        ? safeUrl(String(q.photo || "").trim()) || ""
        : "";
      const bgFill = photo ? (p.heroFrom || "#12151c") : p.heroFrom;
      const bgImage = photo
        // The dark wash keeps the type readable over any photograph — the same
        // reason the reference darkens its skyline.
        ? `background-image:linear-gradient(rgba(12,14,20,.62),rgba(12,14,20,.78)),url('${esc(photo)}');background-size:cover;background-position:center`
        : `background-image:linear-gradient(140deg,${p.heroFrom} 0%,${p.heroTo} 100%)`;
      const btn = (label: string, href: string, outline: boolean) => !String(label || "").trim() ? "" :
        `<td style="padding:0 10px 0 0"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
          <td${outline ? "" : ` bgcolor="${p.accent}"`} align="center" style="border-radius:6px;${outline ? `border:2px solid ${p.heroInk};` : `background-color:${p.accent};`}">
            <a href="${esc(safeUrl(href) || "#")}" target="_blank" style="display:inline-block;padding:12px 24px;font-family:${f};font-size:13px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;text-decoration:none;color:${outline ? p.heroInk : p.accentInk}">${esc(label)}</a>
          </td></tr></table></td>`;
      const ctas = (q.cta1 || q.cta2)
        ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="${al}" style="margin:22px ${al === "center" ? "auto" : "0"} 0 ${al === "center" ? "auto" : "0"}"><tr>
             ${btn(q.cta1, q.cta1href, false)}${btn(q.cta2, q.cta2href, true)}</tr></table>`
        : "";
      return `<tr data-block-id="${b.id}"><td class="pad" bgcolor="${bgFill}" align="${al}" style="padding:${photo ? "48px 32px 46px" : "30px 32px 28px"};text-align:${al};background-color:${bgFill};${bgImage}">
        ${ribbon}
        <div class="h1" style="margin:0;font-family:${f};font-size:30px;line-height:1.16;font-weight:800;color:${p.heroInk};letter-spacing:-.015em;text-align:${al}"${ctx.editor ? ` data-ed="${b.id}|title"` : ""}>${inlineCopy(q.title || "", ctx)}</div>
        ${q.sub ? `<div style="margin:12px 0 0;font-family:${f};font-size:15.5px;line-height:1.5;font-weight:500;color:rgba(255,255,255,.9);text-align:${al}"${ctx.editor ? ` data-ed="${b.id}|sub"` : ""}>${inlineCopy(q.sub, ctx)}</div>` : ""}
        ${q.meta ? `<div style="margin:18px 0 0;font-family:${f};font-size:13.5px;font-weight:700;color:${photo ? p.heroInk : p.accent};text-align:${al}">${esc(q.meta)}</div>` : ""}
        ${ctas}
      </td></tr>`;
    }

    case "heading": {
      // Section-label style (uppercase, letter-spaced) is the house convention.
      const centred = (q.align || "left") === "center";
      const rule = `<div style="width:36px;height:3px;background-color:${p.onCard};font-size:0;line-height:0;margin:0 ${centred ? "auto" : "0"} 12px ${centred || (q.align === "right") ? "auto" : "0"}">&nbsp;</div>`;
      // Each of these is the palette slot already fitted against whatever surface
      // this block sits on — the card by default, or a section band the sender
      // chose (SECTION_BG re-derives the whole palette against it up top, so `p`
      // here is already correct either way; nothing below has to know which).
      const hcol = String(q.tone ?? "ink") === "accent" ? p.onCard
        : String(q.tone ?? "ink") === "body" ? p.inkSoft : p.ink;
      const head = q.caps === "yes"
        ? `${rule}<div class="h2" style="margin:0;font-family:${f};font-size:${num(q.size, 14)}px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:${hcol};text-align:${q.align || "left"}"${ctx.editor ? ` data-ed="${b.id}|text"` : ""}>${inlineCopy(q.text || "", ctx)}</div>`
        : heading(inlineCopy(q.text || "", ctx), ctx, { size: num(q.size, 22), align: q.align, mb: 0, raw: true, color: hcol, ed: ed("text") });
      return row(`${q.eyebrow ? eyebrow(q.eyebrow, ctx, q.align) : ""}${head}`, { id: b.id, align: q.align, pb: 8, bg: sec.bg });
    }

    case "text": {
      // Sender-facing type controls, plus inline **bold** / *italic* / __underline__
      // / ~~strike~~ / ==highlight== / [label](url) inside the copy itself.
      const tone = String(q.tone || "body");
      const toneColor = tone === "ink" ? p.ink : tone === "accent" ? p.onCard : tone === "muted" ? p.inkSoft : p.inkSoft;
      // An explicit hex wins outright — like tintColor/panelBg elsewhere, a colour
      // the sender typed is taken as meant, not run back through the auto-contrast
      // system that picks toneColor (that would look like the picker "not working").
      const color = hexColor(q.color) || toneColor;
      return row(paragraphs(q.text || "", ctx, {
        ed: ed("text"),
        size: num(q.size, 15),
        align: q.align,
        weight: num(q.weight, 400),
        lh: Number(q.lh) > 0 ? Number(q.lh) : 1.55,
        italic: q.italic === "yes",
        underline: q.underline === "yes",
        upper: q.caps === "yes",
        ls: q.caps === "yes" ? ".06em" : undefined,
        color,
      }), { id: b.id, pt: 10, pb: 10, align: q.align });
    }

    case "bullets": {
      // Blank points are dropped, so a point's position in the rendered list is
      // NOT the index the studio has to write back to. Card/tile layouts edit one
      // point at a time, so they keep the original index alongside the text.
      const kept: { text: string; n: number }[] = (q.items || [])
        .map((i: any, n: number) => ({ text: String(i?.text || "").trim(), n }))
        .filter((x: { text: string }) => Boolean(x.text));
      const items: string[] = kept.map((x) => x.text);
      if (!items.length) return "";
      const style = String(q.style || "plain");
      const chosenMark = String(q.marker ?? "");
      const noMark = chosenMark === "none";
      const marker = noMark ? "" : (chosenMark || (style === "plain" ? "→" : "✓"));
      const panel = style === "panel" || style === "panelTwo";
      const onSurface = panel ? p.onTile : p.onCard;
      const ink = panel ? p.inkTile : p.ink;
      const label = (col: string) => q.title
        ? `<div class="micro" style="margin:0 0 12px;font-family:${f};font-size:11.5px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:${col};text-align:center"${ctx.editor ? ` data-ed="${b.id}|title"` : ""}>${inlineCopy(q.title, ctx)}</div>`
        : "";
      // A list read as one run of copy is EDITED as one run of copy: the hook goes
      // on the element wrapping every row (and nothing but the rows), so the studio
      // makes the whole list contentEditable and one point per line. Only layouts
      // that turn each point into its own object (cards, tiles) hook rows singly.
      const listEd = ctx.editor ? ` data-ed="${b.id}|items"` : "";
      const line = (t: string, n?: number) => `<tr>
        ${n || !noMark ? `<td width="${n ? 26 : 20}" valign="top" style="width:${n ? 26 : 20}px;padding:0 8px 9px 0;font-family:${f};font-size:13px;font-weight:700;line-height:1.5;color:${onSurface};text-align:${n ? "center" : "left"}">${n ? `${n}.` : esc(marker)}</td>` : ""}
        <td valign="top" style="padding:0 0 9px;font-family:${f};font-size:13.5px;line-height:1.5;color:${ink}">${inlineCopy(t, ctx)}</td></tr>`;
      // `hook` is off for the halves of a two-column list — there the hook belongs
      // to the table that holds BOTH halves, or the block would offer two of them.
      const list = (arr: string[], numbered = false, from = 0, hook = true) =>
        `<table role="presentation"${hook ? listEd : ""} width="100%" cellpadding="0" cellspacing="0" border="0">${arr.map((t, i) => line(t, numbered ? from + i + 1 : undefined)).join("")}</table>`;
      const twoCol = (numbered = false) => {
        const half = Math.ceil(items.length / 2);
        return `<table role="presentation"${listEd} class="gridt" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
          <td class="stack" width="50%" valign="top" style="padding:0 12px 0 0">${list(items.slice(0, half), numbered, 0, false)}</td>
          <td class="stack" width="50%" valign="top" style="padding:0">${list(items.slice(half), numbered, half, false)}</td></tr></table>`;
      };
      const wrapPanel = (inner: string) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${p.tileBg}" style="background-color:${p.tileBg};border-radius:12px">
        <tr><td class="pad" style="padding:20px 22px 14px">${label(p.onTile)}${inner}</td></tr></table>`;

      // Two columns inside a tinted panel — the reference "who should attend" panel.
      if (style === "panelTwo") return row(wrapPanel(twoCol()), { id: b.id, pt: 12, pb: 8 });
      if (style === "panel") return row(wrapPanel(list(items)), { id: b.id, pt: 12, pb: 8 });
      if (style === "two" && items.length > 3) return row(`${label(p.onCard)}${twoCol()}`, { id: b.id, pt: 14, pb: 10 });

      // Numbered — reads as an ordered agenda of themes.
      if (style === "numbered") {
        return row(`${label(p.onCard)}${items.length > 5 ? twoCol(true) : list(items, true)}`, { id: b.id, pt: 14, pb: 10 });
      }

      // Each point on its own bordered card, two to a row (and two-up on a phone).
      if (style === "cards") {
        const cols = Math.min(2, items.length), gut = 12;
        const cw = Math.floor((INNER - gut * (cols - 1)) / cols);
        const ch = Math.max(64, ...items.map((t: string) => 26 + Math.ceil(t.length / Math.max(14, Math.floor((cw - 60) / 6.6))) * 20));
        const card = (t: string, n: number) => `<table role="presentation" width="100%" height="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${p.tileBg}" style="height:100%;background-color:${p.tileBg};border:1px solid ${p.cardEdge};border-radius:10px">
          <tr><td class="autoh" valign="middle" height="${ch}" style="height:${ch}px;padding:14px 16px">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
              ${noMark ? "" : `<td width="20" valign="top" style="width:20px;padding:0 8px 0 0;font-family:${f};font-size:13px;font-weight:700;line-height:1.45;color:${p.onTile}">${esc(marker)}</td>`}
              <td valign="top" style="font-family:${f};font-size:13px;line-height:1.45;color:${p.inkTile}"${ctx.editor ? ` data-ed="${b.id}|items.${n}.text"` : ""}>${inlineCopy(t, ctx)}</td>
            </tr></table></td></tr></table>`;
        return row(`${label(p.onCard)}${gridRows(kept, cols, cw, gut, (x) => card(x.text, x.n), { mobile: "one" })}`, { id: b.id, pt: 12, pb: 2 });
      }

      // Solid colour tiles — the reference "discussion topics" grid.
      if (style === "tiles") {
        const cols = Math.min(colsOf(q.cols, items.length <= 4 ? 2 : 3), Math.max(1, items.length));
        const gut = 10;
        const tw = Math.floor((INNER - gut * (cols - 1)) / cols);
        const th2 = Math.max(72, ...items.map((t: string) => 30 + Math.ceil(t.length / Math.max(12, Math.floor((tw - 28) / 6.4))) * 18));
        const tile = (t: string, n: number) => `<table role="presentation" width="100%" height="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${p.primary}" style="height:100%;background-color:${p.primary};border-radius:10px">
          <tr><td class="autoh" align="center" valign="middle" height="${th2}" style="height:${th2}px;padding:14px 14px;text-align:center;font-family:${f};font-size:12.5px;font-weight:600;line-height:1.4;color:${readable("#ffffff", p.primary)}"${ctx.editor ? ` data-ed="${b.id}|items.${n}.text"` : ""}>${esc(t)}</td></tr></table>`;
        return row(`${label(p.onCard)}${gridRows(kept, cols, tw, gut, (x) => tile(x.text, x.n), { mobile: "one" })}`, { id: b.id, pt: 12, pb: 2 });
      }

      return row(`${label(p.onCard)}${list(items)}`, { id: b.id, pt: 14, pb: 10 });
    }

    case "button":
      return row(
        `${q.note ? text(inlineCopy(q.note, ctx), ctx, { size: 14.5, align: q.align, mb: 14, ed: ed("note") }) : ""}${ctaButton(q.label || "Register", q.href, ctx, q.align || "left", q as any)}`,
        { id: b.id, align: q.align, pt: 12, pb: 16 },
      );

    case "meta": {
      const items = (q.items || []).filter((i: any) => i?.label || i?.value);
      if (!items.length) return "";
      const w = Math.floor(INNER / items.length);
      const th = tileHeight(items, w, { valueSize: 14, padY: 14, labelH: 14, gap: 5 });
      return row(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${items.map((c: any) => `
        <td class="stack" width="${w}" valign="top" style="padding:0 6px 0 0">
          <table role="presentation" width="100%" height="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${p.tileBg}" style="background-color:${p.tileBg};border-radius:10px">
            <tr><td class="autoh" align="center" valign="middle" height="${th}" style="height:${th}px;padding:14px 16px;text-align:center">
              <div class="micro" style="font-family:${f};font-size:10.5px;font-weight:800;letter-spacing:.09em;text-transform:uppercase;color:${p.inkTile};text-align:center">${esc(c.label || "")}</div>
              <div style="margin-top:5px;font-family:${f};font-size:14px;font-weight:700;line-height:1.35;color:${p.ink};text-align:center">${esc(c.value || "")}</div>
            </td></tr>
          </table></td>`).join("")}</tr></table>`, { id: b.id, pt: 14, pb: 6, bg: sec.bg });
    }

    case "stats": {
      const items = (q.items || []).filter((i: any) => i?.value || i?.label).slice(0, 6);
      if (!items.length) return "";
      const style = String(q.style || "band");
      // The phone rule repaints every .statcell in the DOCUMENT's tile colour,
      // which is baked into the page's <style> block. These figures were measured
      // against the section's own surface instead, so the cells opt out the same
      // way the solid band does — otherwise a dark section ships white numbers
      // that land on a light tile at 700px. Same bug, one layer up.
      const keep = sec.own ? " statkeep" : "";
      // House rule for every layout: one row on desktop, two per row on a phone.
      const gut = style === "boxes" ? 12 : 0;
      const w = Math.floor((INNER - gut * (items.length - 1)) / items.length);
      // The glyph has to be known BEFORE the tile height is worked out: adding
      // 34px of icon to a height computed without it pushed the number out of
      // the band and left the label overlapping the one below.
      const wantIcons = String(q.icons || "no") === "yes";
      const sh = tileHeight(items.map((x: any) => ({ label: x.value, value: x.label })), w,
        { valueSize: 11, padY: 16, labelH: 30 + (wantIcons ? 34 : 0), gap: 6 });   // the big number sits in the "label" row
      // The reference layout puts a glyph over every number. PNG, because no mail
      // client renders an icon font — and the light/dark pair exists because a
      // dark glyph on the solid accent band would be invisible.
      // Chosen from each figure's own LABEL and distinct across the band. This
      // was a literal ["speakers","mic","calendar","speakers","mic","calendar"],
      // so a six-figure band printed the same three glyphs twice — and every
      // band, whatever it counted, opened on a microphone.
      const GLYPH = houseIconNames(items.map((x: any) => String(x?.label ?? "")));
      // The glyph takes its tone from the ink readable() settled on for the
      // number beside it. Assuming "light on the accent band" put a white icon
      // over a dark figure, because a pale accent makes readable() pick dark ink.
      const glyph = (i: number, ink: string) => wantIcons
        ? `<img src="${ASSET_BASE}/assets/icons/${GLYPH[i % GLYPH.length]}-${lum(ink) > 0.5 ? "light" : "dark"}.png" width="26" height="26" alt="" style="display:block;margin:0 auto 8px;width:26px;height:26px;border:0">`
        : "";
      // `idx` picks the glyph, so every layout has to PASS it. Three of the six
      // took the `= 0` default, which meant a six-figure band printed glyph zero
      // six times — a worse repeat than the duplicated list above, and invisible
      // until the icons were switched on.
      const figure = (st: any, numCol: string, labCol: string, big = 26, idx = 0) => `
        ${glyph(idx, numCol)}
        <div style="font-family:${f};font-size:${big}px;font-weight:700;line-height:1.1;color:${numCol}">${esc(st.value || "")}</div>
        <div class="micro" style="margin-top:5px;font-family:${f};font-size:11px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:${labCol}">${esc(st.label || "")}</div>`;
      const title = q.title
        ? `<div class="micro" style="margin:0 0 12px;font-family:${f};font-size:12px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:${p.onCard};text-align:center"${ctx.editor ? ` data-ed="${b.id}|title"` : ""}>${inlineCopy(q.title, ctx)}</div>`
        : "";

      // Separate bordered boxes on one row (Stats styles 2, 4, 5).
      if (style === "boxes") {
        // `gridRows` hands its cell renderer the ITEM and nothing else, so the
        // second parameter this used to declare was never filled and every box
        // took glyph zero. The index comes from the list itself instead.
        const box = (st: any) => `<table role="presentation" width="100%" height="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${p.tileBg}" style="height:100%;background-color:${p.tileBg};border:1px solid ${p.cardEdge};border-radius:10px">
          <tr><td align="center" valign="middle" height="${sh}" style="height:${sh}px;padding:16px 10px;text-align:center">${figure(st, p.onTile, p.inkTile, 26, items.indexOf(st))}</td></tr></table>`;
        return row(`${title}${fluidGrid(items, items.length, w, gut, box, "center")}`, { id: b.id, pt: 10, pb: 0, bg: sec.bg });
      }

      // One tinted panel, cells divided by hairlines (Stats style 8).
      if (style === "panel") {
        const cells = items.map((st: any, i: number) => `
          <td class="half statcell${keep}" width="${w}" align="center" valign="middle" height="${sh}" style="height:${sh}px;padding:18px 10px;text-align:center;${i ? `border-left:1px solid ${p.line};` : ""}">${figure(st, p.onTile, p.inkTile, 28, i)}</td>`).join("");
        return row(
          `${title}<table role="presentation" class="gridt" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${p.tileBg}" style="background-color:${p.tileBg};border-radius:12px"><tr>${cells}</tr></table>`,
          { id: b.id, pt: 12, pb: 4, bg: sec.bg },
        );
      }

      // Solid accent band, figures reversed out of it (Stats style 6).
      if (style === "solid") {
        const ink = readable("#ffffff", p.primary), sub = readable("#ffffff", p.primary, 3.5);
        // One per row on a phone, not two: this is a BAND, not a grid of cards, so
        // an odd count leaves a visible empty half of solid accent rather than a
        // tidy short last row. Stacking is also what the reference design does.
        // `statkeep`, because this style brings its OWN fill: the band is the
        // accent and the ink was measured against it. Letting the phone rule
        // repaint each cell in the card colour put that ink on a surface it was
        // never checked against — dark figures on the dark card, invisible.
        const cells = items.map((st: any, i: number) => `
          <td class="stack statcell statkeep autoh" width="${w}" align="center" valign="middle" height="${sh}" style="height:${sh}px;padding:16px 8px;text-align:center">${figure(st, ink, sub, 26, i)}</td>`).join("");
        return row(
          `${title}<table role="presentation" class="gridt" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${p.primary}" style="background-color:${p.primary};border-radius:10px"><tr>${cells}</tr></table>`,
          { id: b.id, pt: 10, pb: 10, bg: sec.bg },
        );
      }

      // No fill at all — figures on the card, accent numbers (Stats style 3).
      if (style === "plain") {
        const cells = items.map((st: any, i: number) => `
          <td class="half statcell${keep}" width="${w}" align="center" valign="middle" height="${sh}" style="height:${sh}px;padding:6px 8px;text-align:center">${figure(st, p.onCard, p.inkSoft, 28, i)}</td>`).join("");
        return row(
          `${title}<table role="presentation" class="gridt" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${cells}</tr></table>`,
          { id: b.id, pt: 8, pb: 8, bg: sec.bg },
        );
      }

      // Underlined figures — a rule under each column instead of a filled tile.
      if (style === "rules") {
        const cells = items.map((st: any, i: number) => `
          <td class="half statcell${keep}" width="${w}" align="center" valign="middle" height="${sh}" style="height:${sh}px;padding:6px 8px 12px;text-align:center;border-bottom:3px solid ${p.onCard}">${figure(st, p.ink, p.inkSoft, 26, i)}</td>`).join("");
        return row(
          `${title}<table role="presentation" class="gridt" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${cells}</tr></table>`,
          { id: b.id, pt: 8, pb: 10, bg: sec.bg },
        );
      }

      // Default: the house band — one row, hairline dividers, and on a phone the
      // band dissolves so each figure becomes its own box, two to a row.
      const cells = items.map((st: any, i: number) => `
        ${i ? `<td class="mobile-none" width="1" style="padding:0"><div style="width:1px;height:44px;background-color:${p.line};font-size:0;line-height:0">&nbsp;</div></td>` : ""}
        <td class="half statcell${keep}" width="${w}" height="${sh}" align="center" valign="middle" style="height:${sh}px;padding:16px 8px">${figure(st, p.onTile, p.inkTile, 26, i)}</td>`).join("");
      return row(
        `${title}<table role="presentation" class="statband gridt" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${p.tileBg}" style="background-color:${p.tileBg};border:1px solid ${p.cardEdge};border-radius:10px"><tr>${cells}</tr></table>`,
        { id: b.id, pt: 10, pb: 10, bg: sec.bg },
      );
    }

    case "speakers": {
      const capN = Number(q.max) > 0 ? Number(q.max) : undefined;
      const all = (q.items || []).filter((s: any) => s?.name || s?.photo);
      const items = all.slice(0, capN);
      if (!items.length) return "";
      // Layouts lifted from the reference set. Each one keeps the house rules:
      // equal-height tiles, centred rows, two-up on a phone.
      const style = String(q.style || "cards");
      const noPhotos = items.every((s: any) => !s.photo);
      // No portraits? Don't ship empty frames. The checkerboard is half photographs
      // by construction, so with none it is a grid of blank squares — it takes the
      // same fallback the photo cards do.
      const kind = (style === "cards" || style === "checker") && noPhotos ? "tiles" : style;
      // A checkerboard has no gutter at all — the squares have to touch, or the
      // alternation reads as two separate grids that happen to be interleaved.
      const gut = kind === "checker" ? 0 : kind === "circle" ? 8 : kind === "feature" ? 14 : 12;
      const defCols = SPEAKER_COLS[kind] ?? 3;
      // "two-up feature" means two: a stored 3-column choice would undo the layout.
      const wanted = colsOf(q.cols, defCols);
      const cols = Math.min(kind === "feature" ? Math.min(2, wanted) : wanted, Math.max(1, items.length));
      const cap = kind === "circle" ? 165 : kind === "feature" ? 330 : kind === "rows" ? 336 : kind === "tiles" ? 336 : 230;
      const w = Math.min(cap, Math.floor((INNER - gut * (cols - 1)) / cols));
      const co: CellOpts = {
        role: !isNoProp(q.showRole), company: !isNoProp(q.showCompany), shape: String(q.shape || "square"),
        // Bio and icons are opt-in and card-only, so every other layout measures
        // exactly as it did before.
        bio: kind === "cards" && String(q.showBio ?? "no") === "yes",
        social: kind === "cards" && String(q.showSocial ?? "no") === "yes",
      };
      const capH2 = captionHeight(items.map((x: any) => ({
        name: x.name, role: co.role ? x.role : "", company: co.company ? x.company : "",
        bio: x.bio, facebook: x.facebook, x: x.x, linkedin: x.linkedin,
      })), w, { bio: co.bio, social: co.social });
      const cell = kind === "circle" ? (x: any) => speakerCircle(x, w, ctx, capH2, co)
        : kind === "feature" ? (x: any) => speakerFeature(x, w, ctx, Math.max(56, capH2 - 22), co)
        : kind === "rows" ? (x: any) => speakerRow(x, w, ctx, Math.max(96, capH2), co)
        : kind === "tiles" ? (x: any) => speakerTile(x, w, ctx, Math.max(88, capH2), co)
        : (x: any) => speakerCell(x, w, ctx, capH2, co);

      // The checkerboard. Each speaker contributes TWO squares — their portrait and
      // a solid tile carrying their name — so four columns hold two people and the
      // row reads photo / name / photo / name. The phase flips on every row, which
      // is what makes it a board rather than two interleaved stripes.
      //
      // Four columns, always: the alternation IS the layout, and a stored "3 per
      // row" from another layout would leave the last row a different pattern from
      // the first. The `Per row` control is hidden for this style for the same
      // reason (`showWhen` on the field).
      //
      // Squares are pinned to `cwk` on both axes so photo and name interlock. On a
      // phone `.half` narrows the cell but the pinned height stays, so a portrait is
      // squeezed by up to ~15% at 360px. That is the deliberate trade: letting the
      // photo size itself would leave it shorter than the name tile beside it, and
      // tiles in a row being equal height is house rule 6.
      if (kind === "checker") {
        const cwk = Math.floor(INNER / 4);
        const squares = items.flatMap((s: any) => [s, s]).map((s: any, k: number) => ({
          s,
          // k%2 picks which half of the pair this is; the row index flips which half
          // is the photograph, and that flip is the offset.
          photo: Math.floor(k / 4) % 2 === 0 ? k % 2 === 0 : k % 2 === 1,
        }));
        return row(
          `${q.title ? heading(inlineCopy(q.title, ctx), ctx, { size: 19, mb: 16, raw: true, align: String(q.align || "left"), ed: ed("title") }) : ""}
           ${gridRows(squares, 4, cwk, 0, (x: any) => checkerSquare(x.s, cwk, ctx, x.photo, co), { mobile: "two", gapY: 0 })}
           ${q.note ? text(inlineCopy(q.note, ctx), ctx, { size: 12.5, align: "center", ed: ed("note") }) : ""}`,
          { id: b.id, pt: 20, pb: 6, bg: sec.bg },
        );
      }

      return row(
        `${q.title ? heading(inlineCopy(q.title, ctx), ctx, { size: 19, mb: 16, raw: true, align: String(q.align || "left"), ed: ed("title") }) : ""}
         ${/* House rule 6 is "phones get two-up, not one-per-row", and every other
              speaker layout obeys it. `rows` is the exception, and earns it: the
              card is a portrait BESIDE name, role and company, so it is wide by
              construction — the same reason it defaults to 2 per row on desktop
              where the others take 3 or 4. Halve a phone and there is no room
              left for the text next to the photo. One per row on mobile only;
              desktop is untouched. A card carrying a BIO earns the same
              exception for the same reason: a paragraph in a half-width phone
              column wraps to a ragged tower. */""}
         ${kind === "rows" || co.bio ? gridRows(items, cols, w, gut, cell, { mobile: "one" }) : fluidGrid(items, cols, w, gut, cell, "center")}
         ${q.note ? text(inlineCopy(q.note, ctx), ctx, { size: 12.5, align: "center", ed: ed("note") }) : ""}`,
        { id: b.id, pt: 20, pb: 6, bg: sec.bg },
      );
    }

    case "speaker": {
      const src = resizeUrl(q.photo, 200, 200);
      return row(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td class="stack" width="200" valign="top" style="padding:0 18px 0 0">
          ${src ? imageLink(`<img class="fluid" src="${esc(src)}" width="200" alt="${esc(q.name || "")}" style="display:block;width:200px;max-width:200px;height:auto;border:0;border-radius:12px">`, ctx, q.link) : ""}
        </td>
        <td class="stack" valign="top">
          ${q.eyebrow ? eyebrow(q.eyebrow, ctx) : ""}
          <div style="font-family:${f};font-size:22px;font-weight:800;line-height:1.2;color:${p.ink}">${esc(q.name || "")}</div>
          ${q.role ? `<div style="margin:6px 0 0;font-family:${f};font-size:14px;line-height:1.45;color:${p.inkSoft}">${esc(q.role)}</div>` : ""}
          ${q.company ? `<div style="margin:3px 0 0;font-family:${f};font-size:14px;font-weight:700;line-height:1.45;color:${p.tier}">${esc(q.company)}</div>` : ""}
          ${q.link ? `<div style="margin:12px 0 0"><a href="${esc(q.link)}" target="_blank" style="font-family:${f};font-size:13px;font-weight:700;color:${p.onCard};text-decoration:none">View profile →</a></div>` : ""}
        </td></tr></table>`, { id: b.id, bg: sec.bg });
    }

    case "sponsors": {
      const capS = Number(q.max) > 0 ? Number(q.max) : undefined;
      // A tier on the item is what a freshly-added or freshly-picked partner
      // carries (see the schema's make()/the studio's multipick); a saved
      // document from before that existed is backfilled once on load — see
      // migrateSponsorTiers() — rather than guessed at every render, which
      // would also relabel the flat multi-tier grids some canned mailers build
      // on purpose (e.g. announcement.ts's "a few of our partners" teaser).
      const items = (q.items || [])
        .filter((s: any) => s?.title || s?.logo)
        .slice(0, capS);
      if (!items.length) return "";
      // Columns are balanced for the count so a tier never wraps to a lonely last
      // tile (9 logos become 3/3/3, not 4/4/1), and the tile width is capped so
      // every tier in the mail sits on the same visual grid.
      const style = String(q.style || "cards");
      const gut = style === "plain" ? 6 : 10;
      const showName = !isNoProp(q.showName) && style !== "strip";
      const label = (t: string, ed?: string) => `<div class="micro" style="margin:0 0 12px;font-family:${f};font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:${p.onCard};text-align:center"${ed ? ` data-ed="${ed}"` : ""}>${t}</div>`;
      // One balanced grid for a list of sponsors — columns/width/logo height all
      // sized to THIS list's own count, the same math a single-tier block always
      // used, now reused per tier group below.
      const gridFor = (list: any[]) => {
        const auto = balancedCols(list.length, style === "strip" ? 5 : 4);
        const cols = q.cols ? colsOf(q.cols, auto) : auto;
        const lead = list.length <= 2 && style !== "strip";    // presenting / co-presenting
        const cap = style === "strip" ? 150 : lead ? 300 : 190;
        const w = Math.min(cap, Math.floor((INNER - gut * (cols - 1)) / cols));
        const h = style === "strip" ? 30 : lead ? 56 : Number(q.logoHeight) > 0 ? Number(q.logoHeight) : 44;
        return fluidGrid(list, cols, w, gut, (x: any) => sponsorCell(x, w, ctx, { style, h, name: showName, surface: sec.own ? sec.bg : undefined }), "center");
      };
      // "Show tier label" only has real tier names to show when the sponsors on
      // THIS block actually span more than one tier — a hand-built list of mixed
      // partners, or a palette-added block seeded from every tier at once. Below
      // that, it is exactly the legacy single list: q.title is the one heading,
      // completely unchanged from before this grouping existed.
      const byTier = new Map<string, any[]>();
      for (const it of items) { const k = String(it.tier ?? "").trim(); if (!byTier.has(k)) byTier.set(k, []); byTier.get(k)!.push(it); }
      const tierKeys = [...byTier.keys()].filter(Boolean);
      const grouped = !isNoProp(q.showTier) && tierKeys.length > 1 && byTier.get("")?.length !== items.length;
      const body = grouped
        ? [
            q.title ? heading(inlineCopy(q.title, ctx), ctx, { size: 19, mb: 16, raw: true, align: "center", color: p.ink, ed: ed("title") }) : "",
            ...tierKeys.map((t) => `${label(esc(t))}${gridFor(byTier.get(t)!)}`),
            // Sponsors with no tier of their own (hand-picked without one set)
            // still render, under no label, after the named groups.
            byTier.get("")?.length ? gridFor(byTier.get("")!) : "",
          ].join("")
        : `${q.title && !isNoProp(q.showTier) ? label(inlineCopy(q.title, ctx), ed("title")) : ""}${gridFor(items)}`;
      return row(body, { id: b.id, pt: style === "plain" ? 10 : 16, pb: 4, bg: sec.bg });
    }

    case "sessions": {
      const capA = Number(q.max) > 0 ? Number(q.max) : undefined;
      const items = (q.items || []).filter((x: any) => x?.title || x?.time).slice(0, capA);
      if (!items.length) return "";
      const style = String(q.style || "cards");
      const showTime = !isNoProp(q.showTime), showWho = !isNoProp(q.showWho);
      const mid = String(q.align || "left") === "center";
      const head = q.title
        ? heading(inlineCopy(q.title, ctx), ctx, { size: mid ? 24 : 19, mb: mid ? 8 : 14, raw: true, align: mid ? "center" : "left", ed: ed("title") })
          + (mid ? `<div style="width:54px;height:3px;margin:0 auto 18px;background-color:${p.accent};font-size:0;line-height:0">&nbsp;</div>` : "")
        : "";
      const timeTx = (x: any) => showTime && x.time
        ? `<div style="font-family:${f};font-size:11.5px;font-weight:800;letter-spacing:.07em;color:${p.onTile}">${esc(x.time)}</div>` : "";
      const titleTx = (x: any, col = p.ink, mt = 0) =>
        `<div style="margin:${mt}px 0 0;font-family:${f};font-size:15px;font-weight:750;line-height:1.35;color:${col}">${inlineCopy(x.title || "", ctx)}</div>`;
      const whoTx = (x: any, col = p.inkTile) => showWho && x.who
        ? `<div style="margin:6px 0 0;font-family:${f};font-size:12.5px;line-height:1.4;color:${col}">${esc(x.who)}</div>` : "";

      // Day columns — the reference layout: the running order split by day, each
      // session a time badge over the title with the speakers beneath. Falls
      // back to one column when the agenda has no days on it, which is most ET
      // events: the API's start datetimes are frequently empty, so the `day`
      // field on each row is there for the sender to fill.
      if (style === "days") {
        const groups = new Map<string, any[]>();
        for (const x of items) {
          const k = String(x.day ?? "").trim() || "Programme";
          groups.set(k, [...(groups.get(k) || []), x]);
        }
        const days = [...groups.entries()];
        const n = Math.min(days.length, 2);
        const gut = 20;
        const cw = Math.floor((INNER - gut * (n - 1)) / n);
        const blurb = [String(q.day1Text ?? "").trim(), String(q.day2Text ?? "").trim()];
        const dayCol = ([label, rows]: [string, any[]], i = 0) => `
          <div style="font-family:${f};font-size:19px;font-weight:800;line-height:1.2;color:${p.ink};text-align:center;margin:0 0 ${blurb[i] ? 10 : 14}px">
            <span style="color:${p.onCard}">${esc(label.split(" ")[0])}</span> ${esc(label.split(" ").slice(1).join(" "))}</div>
          ${blurb[i] ? `<div style="margin:0 0 16px;font-family:${f};font-size:12.5px;line-height:1.6;color:${p.inkSoft}">${inlineCopy(blurb[i], ctx)}</div>` : ""}
          ${rows.map((x: any) => `
            <div style="padding:0 0 16px">
              ${showTime && x.time ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
                <td bgcolor="${p.tileBg}" style="background-color:${p.tileBg};border-radius:99px;padding:5px 11px;font-family:${f};font-size:11px;font-weight:800;letter-spacing:.05em;color:${p.inkTile}">&#9679;&nbsp; ${esc(x.time)}</td>
              </tr></table>` : ""}
              <div style="margin:${showTime && x.time ? 8 : 0}px 0 0;font-family:${f};font-size:13px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:${p.onCard}">${inlineCopy(x.title || "", ctx)}</div>
              ${showWho && x.who ? `<div style="margin:5px 0 0;font-family:${f};font-size:12.5px;line-height:1.5;color:${p.inkSoft}">${esc(x.who)}</div>` : ""}
            </div>`).join("")}`;
        return row(`${head}${gridRows(days, n, cw, gut, dayCol, { mobile: "one" })}`, { id: b.id, pt: 18, pb: 6, bg: sec.bg });
      }

      // Time on a rail down the left, dot per session — the reference agenda look.
      if (style === "timeline") {
        const rows = items.map((x: any, i: number) => `
          <tr>
            <td class="mobile-none" width="86" valign="top" style="width:86px;padding:0 12px 0 0;text-align:right">
              ${showTime && x.time ? `<div style="font-family:${f};font-size:12px;font-weight:800;color:${p.onCard};padding-top:2px">${esc(x.time)}</div>` : ""}
            </td>
            <td width="16" valign="top" style="width:16px;padding:0">
              <div style="width:9px;height:9px;margin:5px auto 0;border-radius:9px;background-color:${p.onCard};font-size:0;line-height:0">&nbsp;</div>
              ${i < items.length - 1 ? `<div style="width:1px;height:100%;min-height:26px;margin:2px auto 0;background-color:${p.line};font-size:0;line-height:0">&nbsp;</div>` : ""}
            </td>
            <td valign="top" style="padding:0 0 18px 10px">
              <div class="stackline" style="display:none;font-family:${f};font-size:11.5px;font-weight:800;color:${p.onCard}">${showTime ? esc(x.time || "") : ""}</div>
              ${titleTx(x)}${whoTx(x, p.inkSoft)}
            </td>
          </tr>`).join("");
        return row(`${head}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table>`,
          { id: b.id, pt: 16, pb: 4, bg: sec.bg });
      }

      // Time in its own column, hairline between rows — compact and scannable.
      if (style === "table") {
        const rows = items.map((x: any, i: number) => `
          <tr>
            <td class="stack" width="96" valign="top" style="width:96px;padding:${i ? 12 : 0}px 12px 12px 0;${i ? `border-top:1px solid ${p.line};` : ""}">
              ${showTime && x.time ? `<div style="font-family:${f};font-size:12.5px;font-weight:800;color:${p.onCard}">${esc(x.time)}</div>` : ""}
            </td>
            <td class="stack" valign="top" style="padding:${i ? 12 : 0}px 0 12px;${i ? `border-top:1px solid ${p.line};` : ""}">
              ${titleTx(x)}${whoTx(x, p.inkSoft)}
            </td>
          </tr>`).join("");
        return row(`${head}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table>`,
          { id: b.id, pt: 16, pb: 6, bg: sec.bg });
      }

      // Two to a row as tiles, and two-up on a phone like the other grids.
      if (style === "tiles") {
        const cols = Math.min(colsOf(q.cols, 2), Math.max(1, items.length)), gut = 12;
        const tw = Math.floor((INNER - gut * (cols - 1)) / cols);
        const th3 = Math.max(84, ...items.map((x: any) =>
          46 + Math.ceil(String(x.title || "").length / Math.max(14, Math.floor((tw - 32) / 6.6))) * 20 + (showWho && x.who ? 20 : 0)));
        const tile = (x: any) => `<table role="presentation" width="100%" height="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${p.tileBg}" style="height:100%;background-color:${p.tileBg};border-radius:10px">
          <tr><td valign="top" height="${th3}" style="height:${th3}px;padding:14px 16px">${timeTx(x)}${titleTx(x, p.ink, x.time && showTime ? 6 : 0)}${whoTx(x)}</td></tr></table>`;
        return row(`${head}${fluidGrid(items, cols, tw, gut, tile, "center")}`, { id: b.id, pt: 16, pb: 2, bg: sec.bg });
      }

      // Numbered running order — no fills, just rules.
      if (style === "numbered") {
        const rows = items.map((x: any, i: number) => `
          <tr>
            <td width="30" valign="top" style="width:30px;padding:${i ? 12 : 0}px 8px 12px 0;font-family:${f};font-size:15px;font-weight:800;color:${p.onCard};${i ? `border-top:1px solid ${p.line};` : ""}">${i + 1}</td>
            <td valign="top" style="padding:${i ? 12 : 0}px 0 12px;${i ? `border-top:1px solid ${p.line};` : ""}">${timeTx(x)}${titleTx(x, p.ink, x.time && showTime ? 5 : 0)}${whoTx(x, p.inkSoft)}</td>
          </tr>`).join("");
        return row(`${head}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table>`,
          { id: b.id, pt: 16, pb: 6, bg: sec.bg });
      }

      // Default: one tinted card per session, stacked.
      const list = items.map((x: any) => `
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 10px"><tr>
          <td valign="top" style="background-color:${p.tileBg};border-radius:10px;padding:14px 16px">
            ${timeTx(x)}${titleTx(x, p.ink, x.time && showTime ? 6 : 0)}${whoTx(x)}
          </td></tr></table>`).join("");
      return row(`${head}${list}`, { id: b.id, pt: 16, pb: 8, bg: sec.bg });
    }

    case "lozenges": {
      // Stacked bands, each holding one line, the way a display creative breaks a
      // sentence across lozenges. Table cells with a background and a radius:
      // Outlook squares the corners (same as every button here) and everything
      // else shows the pill, which is a degradation you can live with because the
      // COLOUR and the stagger carry the effect, not the curve.
      // Keep each point's index in the STORED array, so an edit writes back to
      // the right row even when a line above it is blank.
      const lines = (q.items || []).map((x: any, n: number) => ({ t: String(x?.text ?? "").trim(), n }))
        .filter((x: any) => x.t);
      if (!lines.length) return "";
      const style = String(q.style || "alternate");
      const layout = String(q.layout || "stagger");
      const fs = Math.max(12, Math.min(48, num(q.size, 26)));
      const rad = Math.max(0, Math.min(99, num(q.radius, 99)));
      const caps = String(q.caps || "no") === "yes";
      // Three skins, and each one's ink is checked against the surface it will
      // actually sit on — house rule 5. An accent band takes accentInk, a light
      // band takes the tile ink, an outline band sits on the card itself.
      const skin = (i: number) => {
        const kind = style === "alternate" ? (["light", "accent", "outline"] as const)[i % 3] : style;
        if (kind === "accent") return { bg: p.accent, ink: readable(p.accentInk || "#ffffff", p.accent), bd: p.accent };
        if (kind === "outline") return { bg: "", ink: readable(p.ink, p.cardBg), bd: p.accent };
        return { bg: p.tileBg, ink: readable(p.inkTile || p.ink, p.tileBg), bd: p.tileBg };
      };
      const side = (i: number) => layout === "stagger" ? (i % 2 ? "right" : "left") : layout === "full" ? "left" : layout;
      // One ROW per line. `align` on a table is a float in HTML, so bands that
      // aligned to opposite sides sat down beside each other and the sentence
      // read out of order — the line is placed by its row's cell instead.
      const band = (x: any, i: number) => {
        const k = skin(i);
        const a = side(i);
        return `<tr><td align="${a}" style="padding:0 0 8px">
          <table role="presentation" ${layout === "full" ? `width="100%" ` : ""}cellpadding="0" cellspacing="0" border="0" style="${layout === "full" ? "width:100%;" : ""}display:inline-table">
            <tr><td${k.bg ? ` bgcolor="${k.bg}"` : ""} align="${layout === "full" || a === "center" ? "center" : "left"}"
              style="padding:${Math.round(fs * 0.42)}px ${Math.round(fs * 0.8)}px;${k.bg ? `background-color:${k.bg};` : ""}border:2px solid ${k.bd};border-radius:${rad}px;
                font-family:${f};font-size:${fs}px;line-height:1.15;font-weight:800;letter-spacing:${caps ? ".04em" : "-.01em"};${caps ? "text-transform:uppercase;" : ""}color:${k.ink}"${ctx.editor ? ` data-ed="${b.id}|items.${x.n}.text"` : ""}>${inlineCopy(x.t, ctx)}</td></tr>
          </table></td></tr>`;
      };
      return row(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${lines.map(band).join("")}</table>`,
        { id: b.id, pt: 16, pb: 8, bg: sec.bg });
    }

    case "pricing": {
      const tiers = (q.items || []).filter((t: any) => String(t?.name ?? "").trim() || String(t?.price ?? "").trim());
      if (!tiers.length) return "";
      const cur = String(q.currency ?? "\u20b9");
      const cols2 = Math.min(tiers.length, 2);
      const gut = 14;
      const cw = Math.floor((INNER - gut * (cols2 - 1)) / cols2);
      const card = (t: any) => {
        const hot = String(t.highlight || "no") === "yes";
        const bg = hot ? p.accent : p.tileBg;
        const ink = hot ? readable(p.accentInk || "#ffffff", p.accent) : readable(p.ink, p.tileBg);
        const soft = hot ? ink : readable(p.inkTile || p.ink, p.tileBg);
        const lines = String(t.features ?? "").split(/\n+/).map((x: string) => x.trim()).filter(Boolean);
        return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${bg}" style="background-color:${bg};border-radius:10px;border:1px solid ${hot ? p.accent : p.cardEdge}">
          <tr><td align="center" style="padding:22px 16px 20px;text-align:center">
            <div style="font-family:${f};font-size:11.5px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:${soft}">${esc(t.name || "")}</div>
            ${String(t.price ?? "").trim() ? `<div style="margin:10px 0 0;font-family:${f};font-size:34px;line-height:1;font-weight:800;color:${ink}"><span style="font-size:16px;vertical-align:super">${esc(cur)}</span>${esc(t.price)}</div>` : ""}
            ${lines.length ? `<div style="margin:14px 0 0">${lines.map((x: string) => `<div style="padding:5px 0;font-family:${f};font-size:12.5px;line-height:1.45;color:${soft}">${esc(x)}</div>`).join("")}</div>` : ""}
            ${String(t.label ?? "").trim() ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:16px auto 0"><tr>
              <td align="center" bgcolor="${hot ? p.cardBg : p.accent}" style="border-radius:6px;background-color:${hot ? p.cardBg : p.accent}">
                <a href="${esc(safeUrl(t.href) || "#")}" target="_blank" style="display:inline-block;padding:11px 26px;font-family:${f};font-size:12px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;text-decoration:none;color:${hot ? readable(p.accent, p.cardBg) : readable(p.accentInk || "#ffffff", p.accent)}">${esc(t.label)}</a>
              </td></tr></table>` : ""}
          </td></tr></table>`;
      };
      const midP = String(q.align || "left") === "center";
      const head = q.title
        ? heading(inlineCopy(q.title, ctx), ctx, { size: midP ? 24 : 19, mb: midP ? 8 : 16, raw: true, align: midP ? "center" : "left", ed: ed("title") })
          + (midP ? `<div style="width:54px;height:3px;margin:0 auto 20px;background-color:${p.accent};font-size:0;line-height:0">&nbsp;</div>` : "")
        : "";
      return row(`${head}${gridRows(tiers, cols2, cw, gut, card, { mobile: "one" })}`, { id: b.id, pt: 18, pb: 8, bg: sec.bg });
    }

    case "navbar": {
      const links = (q.items || []).filter((x: any) => String(x?.label ?? "").trim());
      const tone = String(q.tone || "dark");
      const bg = tone === "accent" ? p.accent : tone === "light" ? p.cardBg : "#12151c";
      const ink = readable(tone === "light" ? p.ink : "#ffffff", bg);
      const logo = safeUrl(String(q.logo || "").trim());
      const btn = String(q.label ?? "").trim();
      if (!logo && !links.length && !btn) return "";
      return `<tr data-block-id="${b.id}"><td bgcolor="${bg}" style="padding:12px 20px;background-color:${bg}">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
          <td class="stack" align="left" valign="middle" style="padding:4px 0">${logo
            ? imageLink(`<img src="${esc(logo)}" alt="" height="20" style="display:block;height:20px;width:auto;border:0">`, ctx, q.href)
            : `<span style="font-family:${f};font-size:14px;font-weight:800;color:${ink}">${esc(ctx.brand?.name || "")}</span>`}</td>
          <td class="stack" align="center" valign="middle" style="padding:4px 0">${links.map((x: any) =>
            `<a href="${esc(safeUrl(x.href) || "#")}" target="_blank" style="display:inline-block;padding:0 9px;font-family:${f};font-size:10.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;text-decoration:none;color:${ink}">${esc(x.label)}</a>`).join("")}</td>
          <td class="stack" align="right" valign="middle" style="padding:4px 0">${btn
            ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="right" style="margin-left:auto"><tr>
                <td bgcolor="${p.accent}" align="center" style="border-radius:4px;background-color:${p.accent}">
                  <a href="${esc(safeUrl(q.href) || "#")}" target="_blank" style="display:inline-block;padding:8px 16px;font-family:${f};font-size:10.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;text-decoration:none;color:${readable(p.accentInk || "#ffffff", p.accent)}">${esc(btn)}</a>
                </td></tr></table>` : ""}</td>
        </tr></table></td></tr>`;
    }

    case "mosaic": {
      const pics = (q.items || []).filter((x: any) => String(x?.url ?? "").trim()).slice(0, 4);
      const body = String(q.text ?? "").trim();
      if (!pics.length && !q.title && !body) return "";
      const colW = Math.floor((INNER - 18) / 2);
      const cell = Math.floor((colW - 8) / 2);
      const grid = pics.length
        ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${
            [0, 2].map((i) => pics.slice(i, i + 2).length ? `<tr>${pics.slice(i, i + 2).map((x: any, j: number) =>
              `<td width="${cell}" valign="top" style="width:${cell}px;padding:0 ${j ? 0 : 8}px 8px 0">
                 ${imageLink(`<img class="fluid" src="${esc(resizeUrl(String(x.url), cell, cell) || "")}" width="${cell}" height="${cell}" alt="${esc(x.alt || "")}" style="display:block;width:${cell}px;height:${cell}px;border:0;border-radius:6px;object-fit:cover">`, ctx, q.href)}
               </td>`).join("")}</tr>` : "").join("")}</table>`
        : "";
      const midM = String(q.align || "left") === "center";
      // The accent used as a MARK on this band. Neither the 3px rule nor the button
      // fill is text, so `readable()`'s 4.5 does not apply — but an accent that
      // happens to match the band the sender chose makes both of them disappear.
      // WCAG 1.4.11 asks 3:1 of a control's boundary, and the same figure is what
      // keeps the rule visible. With no section fill this is the accent untouched,
      // so nothing that renders today moves.
      const mAccent = sec.bg ? readable(p.accent, sec.bg, 3) : p.accent;
      // The reference band is three paragraphs, not one run, so the copy goes through
      // `paragraphs()` — the prose path every other copy field here uses — and a
      // newline breaks the line instead of being swallowed. A single-paragraph value
      // renders the same bytes it always did; the only difference is the
      // per-paragraph `#0` on the canvas hook, which `mlRichPath` already resolves
      // back to the field. (This comment sits OUT here rather than inside the
      // template: a `${/* … */""}` in there adds its own newline to the mail, and
      // that alone broke byte-identity for the conference send.)
      const copy = `${q.title
          ? heading(inlineCopy(q.title, ctx), ctx, { size: midM ? 24 : 22, mb: midM ? 8 : 12, raw: true, align: midM ? "center" : "left", ed: ed("title") })
            + (midM ? `<div style="width:54px;height:3px;margin:0 auto 20px;background-color:${mAccent};font-size:0;line-height:0">&nbsp;</div>` : "")
          : ""}
        ${body ? paragraphs(body, ctx, { size: 14, lh: 1.6, ed: ed("text") }) : ""}
        ${String(q.label ?? "").trim() ? ctaButton(q.label, q.href, ctx, "left", { radius: 6, size: "sm", caps: "yes", bg: sec.bg ? mAccent : undefined } as any) : ""}`;
      const left = String(q.side || "left") === "left";
      return row(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td class="stack" width="${colW}" valign="middle" style="width:${colW}px;padding:0 ${left ? 18 : 0}px 0 ${left ? 0 : 18}px">${left ? grid : copy}</td>
        <td class="stack" width="${colW}" valign="middle" style="width:${colW}px">${left ? copy : grid}</td>
      </tr></table>`, { id: b.id, pt: 20, pb: 12, bg: sec.bg });
    }

    case "social": {
      const nets = (q.items || []).filter((x: any) => String(x?.network ?? "").trim());
      if (!nets.length) return "";
      const sz = Math.max(12, Math.min(40, num(q.size, 20)));
      // Icons ship as PNGs because no mail client renders an icon font or SVG.
      // The tone follows the surface unless it is pinned: a dark glyph on the
      // dark footer band is an invisible glyph.
      const tone = String(q.tone || "auto") === "auto" ? (lum(p.cardBg) < 0.5 ? "light" : "dark") : String(q.tone);
      const icon = (n: string) => `${ASSET_BASE}/assets/icons/${encodeURIComponent(n.toLowerCase())}-${tone}.png`;
      const KNOWN = ["facebook", "x", "linkedin", "instagram", "youtube"];
      return row(`${q.title ? `<div style="margin:0 0 10px;font-family:${f};font-size:12.5px;font-weight:700;color:${p.inkSoft};text-align:center"${ctx.editor ? ` data-ed="${b.id}|title"` : ""}>${inlineCopy(q.title, ctx)}</div>` : ""}
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto"><tr>
          ${nets.filter((x: any) => KNOWN.includes(String(x.network).toLowerCase())).map((x: any) => `
            <td style="padding:0 7px"><a href="${esc(safeUrl(x.href) || "#")}" target="_blank" style="text-decoration:none">
              <img src="${esc(icon(x.network))}" width="${sz}" height="${sz}" alt="${esc(x.network)}" style="display:block;width:${sz}px;height:${sz}px;border:0"></a></td>`).join("")}
        </tr></table>`, { id: b.id, pt: 12, pb: 12, bg: sec.bg });
    }

    case "quote": {
      if (!q.text) return "";
      const style = String(q.style || "panel");
      const qs = Number(q.size) > 0 ? Number(q.size) : 15;
      // `cite` was the old single attribution line. Documents saved before this
      // block grew a name and a role still carry it, so it stands in for the
      // role rather than being dropped on the floor.
      const who = String(q.name ?? "").trim();
      const role = String(q.role ?? "").trim() || String(q.cite ?? "").trim();

      // The plain rule-down-the-left version, unchanged, for anyone who wants it.
      if (style === "bar") {
        return row(`<div style="padding:16px 18px;background-color:${p.tileBg};border-left:3px solid ${p.onTile};border-radius:8px">
            ${text(`“${inlineCopy(q.text, ctx)}”`, ctx, { size: qs, lh: 1.5, color: p.ink, weight: 500, ed: ed("text") })}
            ${who || role ? text([who, role].filter(Boolean).join(" — "), ctx, { size: 12.5, mt: 8 }) : ""}
          </div>`, { id: b.id, pt: 10, pb: 10, bg: sec.bg });
      }

      // The filled panel. Its colour is the sender's, so every line on it is
      // measured against THAT surface and not against the card the block sits
      // on — the accent included, because the quotation mark is drawn in it and
      // a mark that matches its panel is a mark nobody sees.
      const fill = hexColor(q.panelBg) || p.primary;
      const qInk = readable("#ffffff", fill);
      const qSoft = readable("#ffffff", fill, 3.5);
      const qMark = readable(p.accent, fill, 3);
      const pad = 26;
      const panel = `
        <table role="presentation" width="100%" height="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${fill}" style="height:100%;background-color:${fill};border-radius:6px">
          <tr><td valign="top" style="padding:${pad}px">
            ${isNoProp(q.mark) ? "" : `<div style="margin:0 0 14px;font-family:${f};font-size:46px;line-height:.7;font-weight:800;color:${qMark}">&#8221;</div>`}
            ${text(inlineCopy(q.text, ctx), ctx, { size: qs, lh: 1.6, color: qInk, weight: 400, align: q.align, ed: ed("text") })}
            ${who ? `<div style="margin:18px 0 0;font-family:${f};font-size:13px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:${qInk};text-align:${q.align || "left"}"${ctx.editor ? ` data-ed="${b.id}|name"` : ""}>${esc(who)}</div>` : ""}
            ${role ? `<div style="margin:4px 0 0;font-family:${f};font-size:12.5px;line-height:1.45;color:${qSoft};text-align:${q.align || "left"}"${ctx.editor ? ` data-ed="${b.id}|role"` : ""}>${esc(role)}</div>` : ""}
          </td></tr>
        </table>`;

      const src = resizeUrl(String(q.photo || "").trim(), 600, 600);
      if (style === "card" || !src) return row(panel, { id: b.id, pt: 12, pb: 12, bg: sec.bg });

      const pw = Math.min(320, Math.max(140, Number(q.photoWidth) > 0 ? Number(q.photoWidth) : 230));
      const radius = q.shape === "circle" ? pw : q.shape === "round" ? 10 : 6;
      // `height:100%` on the portrait makes it match the panel beside it instead
      // of ending short and leaving a step — the same trick the speaker cards use.
      // Pinned square, like the speaker cards: `resizeUrl` above asked the CDN for
      // a square crop, so the height is not a guess — and letting it run `auto`
      // left a strip of card under the portrait beside a taller panel. `.fluid`
      // releases the pin on a phone, where the two stack anyway.
      const photo = imageLink(
        `<img class="fluid" src="${esc(src)}" width="${pw}" height="${pw}" alt="${esc(who || "")}" style="display:block;width:${pw}px;max-width:${pw}px;height:${pw}px;border:0;border-radius:${radius}px">`,
        ctx, q.href);
      const gap = 14;
      const cells = [
        `<td class="stack" width="${pw}" valign="top" style="width:${pw}px;padding:0 ${gap}px 0 0">${photo}</td>`,
        `<td class="stack" valign="top" style="padding:0">${panel}</td>`,
      ];
      if (String(q.side || "left") === "right") cells.reverse();
      return row(
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${cells.join("")}</tr></table>`,
        { id: b.id, pt: 12, pb: 12, bg: sec.bg },
      );
    }

    case "image": {
      if (!q.url) return "";
      // Unset means the 10px this block has always drawn, so every document saved
      // before the control existed renders the same bytes. A radius is the one
      // decoration Word (Outlook on Windows) drops outright, so "circle" is an
      // enhancement the layout must never depend on.
      const irad = String(q.radius ?? "").trim() === "" ? 10 : Math.max(0, Math.min(999, num(q.radius, 10)));
      // A `display:block` image is placed by its own margins, not by the cell's
      // `align` — so both are set: the margin for the clients that honour it, and
      // the cell attribute for Word, which does not. Left emits neither, which is
      // exactly the markup this block has always produced.
      const ial = String(q.align || "left");
      const imarg = ial === "center" ? "margin:0 auto;" : ial === "right" ? "margin:0 0 0 auto;" : "";
      return row(link(`<img src="${esc(safeUrl(q.url) || "")}" width="${num(q.width, INNER)}" alt="${esc(q.alt || "")}" style="display:block;${imarg}width:100%;max-width:${num(q.width, INNER)}px;height:auto;border:0;border-radius:${irad}px">`, q.href), { id: b.id, pt: 10, pb: 10, align: ial });
    }

    case "features": {
      const tiles = (q.items || []).map((x: any, n: number) => ({
        icon: safeUrl(String(x?.icon ?? "").trim()) || "",
        head: String(x?.title ?? "").trim(),
        body: String(x?.text ?? "").trim(),
        n,
      })).filter((x: any) => x.icon || x.head || x.body);
      if (!tiles.length) return "";
      const al = String(q.align || "center");
      // The surface the tiles actually paint on — the section band when it has one,
      // the card otherwise. Every ink and the glyph variant are settled against it,
      // not against the document's card, which is the mistake house rule 5 exists for.
      const surf = sec.bg || p.cardBg;
      const fink = readable(p.ink, surf, 4.6);
      const fsoft = readable(p.inkSoft, surf, 4.6);
      const fcols = Math.min(Math.max(2, Math.min(4, num(q.cols, 3))), Math.max(1, tiles.length));
      const fgut = 14;
      const fw = Math.floor((INNER - fgut * (fcols - 1)) / fcols);
      const isz = [40, 56, 72].includes(num(q.iconSize, 56)) ? num(q.iconSize, 56) : 56;
      // The icon band is reserved for the whole grid, not per tile: a tile with no
      // artwork still prints its words, and reserving the band keeps its first line
      // level with its neighbours' instead of riding up alone. Reserved as PADDING
      // rather than an empty box, so there is no content-free element sitting in
      // the mail (the geometry audit counts those as blank space, correctly).
      const band = tiles.some((x: any) => x.icon) ? isz + 12 : 0;
      // Equal heights by construction — the caption is measured against the LONGEST
      // entry in this grid and every tile is pinned to it. Percentage heights are
      // not reliable in table cells, which is why nothing here uses one.
      //
      // Measured at the PHONE cell width as well as the desktop one, and the taller
      // answer wins. A caption that fits two lines in a 219px desktop cell takes
      // three in the 149px a `.half` cell has at 360px, and pinning to the desktop
      // figure alone let the longest tile grow past its neighbours there — the rows
      // were level on a desktop and ragged on a phone, which is the half nobody looks
      // at. 149px = 46% (the `.half` width) of the card's inner width at 360px.
      const PHONE_HALF = 149;
      const capAt = (cw: number) => captionHeight(tiles.map((x: any) => ({ name: x.head, bio: x.body })), cw, { bio: true });
      const fcap = Math.max(capAt(fw), capAt(PHONE_HALF));
      const fh = band + fcap;
      const marg = al === "center" ? "0 auto 12px" : al === "right" ? "0 0 12px auto" : "0 0 12px";
      // A cell's `height` is its CONTENT height — padding is ADDED to it — so every
      // tile subtracts back out whatever padding it carries, and lands on the same
      // outer box of `fh`. `captionHeight` already counts an 11px/13px inset (it is
      // the speaker card's), so that inset is applied for real rather than left as
      // slack: without it every tile stood 24px taller than its own contents.
      const tile = (x: any) => {
        const pt = x.icon ? 11 : 11 + band;      // an iconless tile reserves the band
        const ch = fh - 24 - (x.icon ? 0 : band);
        return `<table role="presentation" width="100%" height="100%" cellpadding="0" cellspacing="0" border="0" style="height:100%">
        <tr><td valign="top" align="${al}" height="${ch}" style="height:${ch}px;padding:${pt}px 6px 13px;text-align:${al}">
          ${x.icon ? `<img src="${esc(iconFor(x.icon, surf))}" width="${isz}" height="${isz}" alt="" style="display:block;margin:${marg};width:${isz}px;height:${isz}px;border:0">` : ""}
          ${/* 13.5 / 11.5px at these line heights is not a style choice — it is the
                type scale `captionHeight` is calibrated against (the same one the
                speaker card's name and bio use). Setting the caption a point larger
                made the helper under-count its wrapping, and the longest tile grew
                past the row it was supposed to be level with. 1.4 rather than the
                card's 1.45 for the same reason: the helper counts 16px a line, and
                11.5 x 1.45 is 16.7, so three lines drifted 2px clear of the pin. */""}
          ${x.head ? `<div style="font-family:${f};font-size:13.5px;font-weight:700;line-height:1.3;color:${fink};text-align:${al}">${esc(x.head)}</div>` : ""}
          ${x.body ? `<div style="margin:${x.head ? 8 : 0}px 0 0;font-family:${f};font-size:11.5px;line-height:1.4;color:${fsoft};text-align:${al}"${ctx.editor ? ` data-ed="${b.id}|items.${x.n}.text"` : ""}>${esc(x.body)}</div>` : ""}
        </td></tr></table>`;
      };
      // `fluidGrid` flows the tiles continuously — three-up on desktop, two-up on
      // a phone across the WHOLE grid, so five tiles read (1,2)(3,4)(5) with the
      // odd last tile centred, instead of breaking after the third and stranding
      // it left (which `gridRows`' per-desktop-row tables did on a phone).
      return row(
        `${q.title ? heading(inlineCopy(q.title, ctx), ctx, { size: 19, mb: 16, raw: true, align: al, color: fink, ed: ed("title") }) : ""}
         ${fluidGrid(tiles, fcols, fw, fgut, tile, al as any)}`,
        { id: b.id, pt: 20, pb: 4, bg: sec.bg },
      );
    }

    case "resources": {
      // Cards of downloadable resources — cover image, title, link. Modelled on
      // `features`: the same fluidGrid flow (3-up desktop, 2-up phone, odd tile
      // centred) and the same pinned-height discipline so titles and links line
      // up across a row. The artwork is a real cover, not a house glyph, and the
      // whole card links out. Image height is left natural (covers share an
      // aspect) rather than forced — a forced width+height distorts in Outlook,
      // which ignores object-fit.
      const tiles = (q.items || []).map((x: any, n: number) => ({
        image: safeUrl(String(x?.image ?? "").trim()) || "",
        head: String(x?.title ?? "").trim(),
        url: safeUrl(String(x?.url ?? "").trim()) || "",
        n,
      })).filter((x: any) => x.image || x.head);
      // A heading with no cards yet still renders (a section being built) — unlike
      // the tile-only blocks, because the heading is the block's own rich field.
      if (!tiles.length && !String(q.title ?? "").trim()) return "";
      const al = String(q.align || "left");
      const surf = sec.bg || p.cardBg;
      const rink = readable(p.ink, surf, 4.6);
      const racc = readable(p.accent, surf, 4.5);
      const rcols = Math.min(Math.max(2, Math.min(4, num(q.cols, 3))), Math.max(1, tiles.length));
      const rgut = 16;
      const rw = Math.floor((INNER - rgut * (rcols - 1)) / rcols);
      const linkLabel = String(q.linkLabel ?? "Know more").trim();
      const marg = al === "center" ? "0 auto 12px" : al === "right" ? "0 0 12px auto" : "0 0 12px";
      // Title flows naturally — NO pinned height. Pinning it (to keep links level
      // across a row) risks a title taller than the pin overflowing onto the link
      // below, which is worse than an uneven row; the reference EDM lets it flow
      // too. Cards break to the next row cleanly because fluidGrid aligns cells to
      // the top.
      const tile = (x: any) => {
        const inner =
          `${x.image ? `<img src="${esc(x.image)}" width="${rw}" alt="${esc(x.head)}" style="display:block;width:100%;height:auto;border:0;border-radius:4px;margin:${marg}">` : ""}` +
          `${x.head ? `<div style="font-family:${f};font-size:15px;font-weight:700;line-height:1.4;color:${rink};text-align:${al}"${ctx.editor ? ` data-ed="${b.id}|items.${x.n}.title"` : ""}>${esc(x.head)}</div>` : ""}` +
          `${x.url && linkLabel ? `<div style="text-align:${al};padding-top:10px"><span style="font-family:${f};font-size:13px;font-weight:600;color:${racc};text-decoration:underline">${esc(linkLabel)}</span></div>` : ""}`;
        return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td valign="top" align="${al}" style="padding:0 4px 12px;text-align:${al}">${
          x.url ? `<a href="${esc(x.url)}" target="_blank" style="text-decoration:none;color:inherit;display:block">${inner}</a>` : inner
        }</td></tr></table>`;
      };
      return row(
        `${q.title ? heading(inlineCopy(q.title, ctx), ctx, { size: 19, mb: 16, raw: true, align: al, color: rink, ed: ed("title") }) : ""}
         ${fluidGrid(tiles, rcols, rw, rgut, tile, al as any)}`,
        { id: b.id, pt: 20, pb: 4, bg: sec.bg },
      );
    }

    case "circles": {
      // Round callouts SIDE BY SIDE, with a real gutter — they never overlap.
      // Overlapping them needs absolute positioning or a negative margin, and
      // Outlook's Word engine honours neither: the design would hold in Apple Mail,
      // fall apart into a stack of squares in Outlook and land somewhere else again
      // in Gmail. A gutter reads identically everywhere, which is the point.
      const ring = (q.items || []).map((x: any, n: number) => ({ t: String(x?.text ?? "").trim(), n }))
        .filter((x: any) => x.t).slice(0, 4);
      if (!ring.length) return "";
      const csurf = sec.bg || p.cardBg;
      const cgut = 14;
      const WANT: Record<string, number> = { small: 130, medium: 160, large: 196 };
      // The circle can never be wider than the column it sits in, or four of them
      // push the mail past the card edge.
      const d = Math.min(WANT[String(q.size || "medium")] ?? WANT.medium,
        Math.floor((INNER - cgut * (ring.length - 1)) / ring.length));
      // Text does NOT reflow to a curve — there is no shape-outside in email HTML —
      // so the copy has to fit the square that sits INSIDE the circle. That square
      // has a side of d/√2 ≈ 0.71d; call the usable box 0.66d to keep the last line
      // clear of the curve. At the medium 160px circle that is a 105px box: about
      // 12 characters a line over 5 lines, so ~60 characters. A longer caption drops
      // ONE type step (×0.85, never below 11.5px — the phone type floor) which buys
      // roughly 50% more, and is clipped with an ellipsis beyond that rather than
      // spilling past the edge.
      const box = d * 0.66;
      const capacity = (fs: number) =>
        Math.max(4, Math.floor(box / (fs * 0.58))) * Math.max(1, Math.floor(box / (fs * 1.3)));
      const BASE_FS: Record<string, number> = { small: 13, medium: 15, large: 17 };
      const fs0 = BASE_FS[String(q.size || "medium")] ?? BASE_FS.medium;
      const longest = Math.max(...ring.map((x: any) => x.t.length));
      const cfs = longest > capacity(fs0) ? Math.max(11.5, Math.round(fs0 * 0.85 * 10) / 10) : fs0;
      const room = capacity(cfs);
      const clip = (t: string) => (t.length <= room ? t : `${t.slice(0, Math.max(1, room - 1)).trimEnd()}…`);
      const tone = String(q.tone || "accent");
      // Three skins, each ink measured against the surface it lands on: the fill for
      // the two filled tones, the section itself for the outline one.
      const skin = tone === "outline"
        ? { bg: "", ink: readable(p.ink, csurf, 4.6), bd: readable(p.accent, csurf, 3) }
        : tone === "tile"
          ? { bg: p.tileBg, ink: readable(p.inkTile || p.ink, p.tileBg, 4.6), bd: p.tileBg }
          : { bg: p.accent, ink: readable(p.accentInk || "#ffffff", p.accent), bd: p.accent };
      // No padding on the round cell: padding is added OUTSIDE a content-box width in
      // table cells, which would make the box wider than it is tall — an ellipse, not
      // a circle. The inset lives on an inner div instead.
      const circle = (x: any) => `<table role="presentation" align="center" width="${d}" cellpadding="0" cellspacing="0" border="0" style="width:${d}px;margin:0 auto;table-layout:fixed">
        <tr><td${skin.bg ? ` bgcolor="${skin.bg}"` : ""} width="${d}" height="${d}" align="center" valign="middle" style="width:${d}px;height:${d}px;padding:0;${skin.bg ? `background-color:${skin.bg};` : ""}border:2px solid ${skin.bd};border-radius:${d}px;text-align:center">
          <div style="padding:0 ${Math.round(d * 0.14)}px;font-family:${f};font-size:${cfs}px;line-height:1.28;font-weight:700;color:${skin.ink};text-align:center"${ctx.editor ? ` data-ed="${b.id}|items.${x.n}.text"` : ""}>${esc(clip(x.t))}</div>
        </td></tr></table>`;
      // One row on desktop; one circle per row on a phone, because a 160px disc at
      // half a phone's width is smaller than the words inside it.
      return row(gridRows(ring, ring.length, d, cgut, circle, { mobile: "one" }),
        { id: b.id, pt: 18, pb: 2, bg: sec.bg });
    }

    case "ribbon": {
      const flag = String(q.flag ?? "").trim();
      const tag = String(q.hashtag ?? "").trim();
      // Either side empty simply isn't drawn; with neither, the block is nothing at
      // all (house rule 7 — never an empty frame).
      if (!flag && !tag) return "";
      const rsurf = sec.bg || p.cardBg;
      const rtone = String(q.tone || "accent");
      const fill = rtone === "dark" ? "#12151c" : rtone === "light" ? p.tileBg : p.accent;
      // The tab's ink is settled against the TAB, the hashtag's against the section
      // behind it — two different surfaces, so two different measurements.
      const tabInk = readable(rtone === "accent" ? (p.accentInk || "#ffffff") : rtone === "dark" ? "#ffffff" : p.ink, fill);
      const tagInk = readable(p.onCard, rsurf, 4.6);
      // A real notched flag needs a background image or a clip-path, and Outlook
      // renders neither — it would degrade to a plain rectangle there anyway. So it
      // IS a plain solid tab, with the small radius the buttons already use.
      const tab = flag
        ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
             <td bgcolor="${fill}" style="background-color:${fill};border-radius:4px;padding:7px 14px;font-family:${f};font-size:12px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:${tabInk}">${esc(flag)}</td>
           </tr></table>`
        : "";
      return row(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
          <td align="left" valign="middle" style="padding:0">${tab}</td>
          <td align="right" valign="middle" style="padding:0;font-family:${f};font-size:14px;font-weight:800;letter-spacing:.04em;color:${tagInk};text-align:right">${esc(tag)}</td>
        </tr></table>`, { id: b.id, pt: 14, pb: 14, bg: sec.bg });
    }

    case "contacts": {
      // A row with a label but no details would render an empty line — that is the
      // blank band that used to sit above the footer. Only rows with real contact
      // details are shown, and with none the whole section (label included)
      // disappears rather than leaving an orphaned heading.
      const items = (q.items || []).filter((c: any) => c?.name || c?.email || c?.phone);
      if (!items.length) return "";
      // "For Delegation / For Sponsorship" rows: name | email | phone, each part
      // its own block on mobile (the house mailers stack these).
      // The divider is a GLYPH, not a border, so it is a text node the contrast
      // audit measures — drawn in the hairline colour it cleared AA on nothing,
      // section background or not. It takes the row's own ink instead.
      const sep = `<span class="mobile-none" style="padding:0 6px;color:${p.inkWash}">|</span>`;
      const groups = items.map((c: any) => {
        const bits = [
          c.name ? `<span class="stackline" style="font-weight:700;color:${p.ink}">${esc(c.name)}</span>` : "",
          c.email ? `<a class="stackline" href="mailto:${esc(String(c.email).replace(/[\s"<>]/g, ""))}" style="text-decoration:none;font-weight:700;color:${p.onTile}">${esc(c.email)}</a>` : "",
          c.phone ? `<a class="stackline" href="tel:${esc(String(c.phone).replace(/[^\d+]/g, ""))}" style="text-decoration:none;font-weight:700;color:${p.onTile}">${esc(c.phone)}</a>` : "",
        ].filter(Boolean);
        return `
        ${c.role ? `<div style="font-family:${f};font-size:15px;font-weight:700;line-height:1.5;color:${p.ink};padding:14px 0 6px;text-align:center">${esc(c.role)}</div>` : ""}
        <div style="font-family:${f};font-size:13px;line-height:1.9;color:${p.inkWash};text-align:center">
          ${bits.join(sep)}
        </div>`;
      }).join("");
      const label = q.title
        ? `<div style="width:36px;height:3px;background-color:${p.onTile};font-size:0;line-height:0;margin:0 auto 12px">&nbsp;</div>
           <div style="margin:0 0 4px;font-family:${f};font-size:14px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:${p.ink};text-align:center"${ctx.editor ? ` data-ed="${b.id}|title"` : ""}>${inlineCopy(q.title, ctx)}</div>`
        : "";
      return row(label + groups, { id: b.id, align: "center", pt: 18, pb: 20, bg: sec.bg });
    }

    case "divider":
      return `<tr data-block-id="${b.id}"><td style="padding:6px 32px"><div style="height:1px;background-color:${p.line};line-height:1px;font-size:0">&nbsp;</div></td></tr>`;

    case "spacer": {
      const h = num(q.height, 24);
      return `<tr data-block-id="${b.id}"><td style="height:${h}px;line-height:${h}px;font-size:0">&nbsp;</td></tr>`;
    }

    case "footer": {
      // Content is the house footer's — the unsubscribe sentence, the portal name
      // and the Times Center address, and nothing else. Styling is this mailer's:
      // same Verdana stack and palette inks as everything above it.
      return `<tr data-block-id="${b.id}"><td class="pad" align="center" bgcolor="${p.footBg}" style="padding:22px 32px 24px;background-color:${p.footBg};border-top:3px solid ${p.primary};text-align:center">
        <div class="micro" style="margin:0;font-family:${f};font-size:11px;line-height:1.7;color:${p.inkFoot};text-align:center">
          ${esc(q.legal || "If you do not want to receive this mailer, you can")}
          <a href="${esc(q.unsubscribe || "{$$!!unsubscribelink!!$$}")}" style="color:${p.onFoot};font-weight:700">Unsubscribe</a>
          ${esc(q.legalTail || "from our mailing list.")}<br>
          <span id="portal_name">${esc(q.portal || ctx.brand.name)}</span> ${esc(q.address || ADDRESS)}
        </div>
      </td></tr>`;
    }

    case "html":
      return `<tr data-block-id="${b.id}"><td class="pad" style="padding:8px 32px">${sanitiseFragment(q.html || "")}</td></tr>`;

    default:
      return "";
  }
}

// ---- document render --------------------------------------------------------

export function renderCtx(event: EventEntity, doc: Pick<MailerDoc, "theme" | "accent" | "background"> & { imageGuard?: string }): RenderCtx {
  const brand = getBrand(event.portal);
  return {
    event, brand, font: fontStack(brand),
    p: resolvePalette(brand, event, doc.theme || "site", doc.accent, doc.background),
    bareImages: String((doc as any).imageGuard ?? "yes") === "no",
  };
}

/** A block with nothing in it renders to nothing — correct for a real send, but
 *  invisible (and so unselectable) in the studio right after you add it. In
 *  editor mode we stand in a dashed placeholder instead. */
function placeholderRow(b: Block, ctx: RenderCtx): string {
  const s = BLOCK_SCHEMAS[b.type];
  return row(
    `<div style="border:1px dashed ${ctx.p.line};border-radius:8px;padding:18px;text-align:center;font-family:${ctx.font};font-size:12px;color:${ctx.p.inkSoft}">
       ${esc(s?.icon || "")} ${esc(s?.label || b.type)} — empty. Add content in the settings panel.
     </div>`,
    { id: b.id, pt: 8, pb: 8 },
  );
}

/** One-time upgrade for a document LOADED from storage: fills in `tier` on any
 *  sponsors-block item that doesn't have one, by matching its name against the
 *  event's current tier list — so a "Partner logos" block saved before the
 *  field existed groups correctly once reopened, without guessing at every
 *  render (which would also relabel the flat, deliberately ungrouped,
 *  multi-tier grids some canned mailers build, e.g. announcement.ts's "a few
 *  of our partners" teaser). Only call this on a doc that came out of
 *  getSave()/latestSave() — never on one just built fresh from a template. */
export function migrateSponsorTiers(doc: MailerDoc, event: EventEntity): MailerDoc {
  if (!doc?.blocks?.some((b) => b.type === "sponsors" && (b.props?.items || []).some((s: any) => s && !s.tier))) return doc;
  const tierByName = new Map(
    event.sponsorTiers.flatMap((t) => t.sponsors.map((s) => [s.title.trim().toLowerCase(), t.tier])),
  );
  return {
    ...doc,
    blocks: doc.blocks.map((b) => b.type !== "sponsors" ? b : {
      ...b,
      props: {
        ...b.props,
        items: (b.props?.items || []).map((s: any) =>
          !s || s.tier ? s : { ...s, tier: tierByName.get(String(s.title || "").trim().toLowerCase()) || "" }),
      },
    }),
  };
}

/** The deliverable: block document -> email HTML. `editor:true` keeps the
 *  data-block-id hooks the studio needs; the downloadable copy strips them. */
export function renderDoc(doc: MailerDoc, event: EventEntity, opts: { editor?: boolean } = {}): string {
  const ctx = { ...renderCtx(event, doc), editor: !!opts.editor };
  const rows = (doc.blocks || []).map((b) => {
    // A null / non-object / typeless element renders to nothing and is not stood in
    // for by a placeholder either (there is no block to select or edit).
    if (!b || typeof b !== "object" || typeof (b as any).type !== "string") return "";
    const html = renderBlock(b, ctx);
    return html || (opts.editor ? placeholderRow(b, ctx) : "");
  }).join("");
  const html = emailPage(ctx, { subject: doc.subject, preheader: doc.preheader, rows });
  // Belt and braces: the generated markup contains no scripts by construction and
  // all text is escaped, but a final sweep guarantees the promise for every path.
  const swept = html
    .replace(/<\s*script[\s\S]*?<\s*\/\s*script\s*>/gi, "")
    .replace(/<\s*\/?\s*script\b[^>]*>/gi, "");
  // The download carries no editor hooks: block ids and in-place edit handles both go.
  return opts.editor ? swept : swept.replace(/ data-(block-id|ed)="[^"]*"/g, "");
}

/** Does this block render nothing? Used by the studio placeholder and by the AI
 *  enhancer, which needs to know which sections are dead weight. */
export function blockIsEmpty(b: Block, event: EventEntity, doc: Pick<MailerDoc, "theme" | "accent" | "background">): boolean {
  return renderBlock(b, renderCtx(event, doc)) === "";
}

/** A block with explicit props (what the mailer templates build with). */
let seq = 0;
export function blockOf(type: BlockType, props: Record<string, any>): Block {
  seq = (seq + 1) % 1e6;
  return { id: `b${Date.now().toString(36)}${seq.toString(36)}`, type, props };
}

/** A new block of `type`, seeded from the event (what the palette inserts). */
export function makeBlock(type: BlockType, event: EventEntity): Block {
  return blockOf(type, BLOCK_SCHEMAS[type].make(event));
}

/** Block palette for the studio (type + label + icon + field schema). */
export function blockPalette(): { type: BlockType; label: string; icon: string; addable: boolean; fields: Field[] }[] {
  return (Object.keys(BLOCK_SCHEMAS) as BlockType[]).map((type) => ({
    type, label: BLOCK_SCHEMAS[type].label, icon: BLOCK_SCHEMAS[type].icon,
    addable: BLOCK_SCHEMAS[type].addable, fields: BLOCK_SCHEMAS[type].fields,
  }));
}
