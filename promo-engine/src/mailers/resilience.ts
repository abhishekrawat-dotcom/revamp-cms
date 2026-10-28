import type { Mailer } from "./mailer.ts";
import type { EventEntity } from "../model/types.ts";
import { blockOf, type Block } from "./blocks.ts";
import { ASSET_BASE } from "../brand/index.ts";
import {
  THEME_PARAM, ACCENT_PARAM, BANNER_PARAMS, bannerBlocks, logoBlock, metaBlock,
  ctaBlock, ctaParams, footerBlock, introFrom, YES_NO, isNo, compact,
} from "./shared.ts";

// The "Road to Resilience" single-session invitation, from the supplied design:
// the composed banner, a Register button, a short block of centred body copy,
// then two accent headings — "Event Details" over the date and venue, and
// "Why Attend?" over a grid of five icon tiles — and the Register button again
// above the footer. Dark throughout.
//
// Where it differs from the reference, and why:
//
//   • **No masthead by default.** The reference opens straight on the banner,
//     and the banner IS the event's composed key visual — it already carries the
//     portal lockup and the event name, so a logo bar above it is the same
//     identity twice in 60px. `showLogo` puts one back for a send that needs the
//     portal wordmark on its own, and the legal footer names the portal either
//     way, so nothing unbranded ships.
//   • **The accent headings are `text` blocks, not `heading` blocks.** The
//     reference sets "Event Details" and "Why Attend?" in the accent colour, and
//     colour is not a field on the `heading` block — its ink is fixed to the
//     palette's body ink. `text` with `tone:"accent"` is the same type at the
//     same weight in the colour the design asks for, and it goes through the
//     same per-surface contrast check, so a pale accent still clears AA.
//   • **The five tiles are the event's own reasons to attend**, taken from
//     `why_join_us` (falling back to key discussion points, then who-should-
//     attend). The reference shows five; an event that publishes four gets four,
//     because rule 7 says a section renders what exists and never invented
//     content. On ETHRWorld 4078 that is a 3 + 1 grid rather than the
//     reference's 3 + 2.
//   • **The icons are decoration, and generic on purpose.** The ET APIs expose
//     no icon artwork and nothing that says which picture belongs to which
//     reason, so `tools/icons.mjs` grew five neutral benefit glyphs (network,
//     insight, learn, growth, award) that cycle across the tiles. They read as
//     categories a sender reassigns in the studio, not as a claim about the
//     sentence beside them — the same concession the stat band's glyph cycle
//     already makes. Every icon ships as a light/dark PNG pair because email
//     clients render neither SVG nor icon fonts.
//   • **The body copy is the event's own description, regrouped.** The reference
//     runs two or three paragraphs; the description arrives as one run of
//     sentences, so `bodyCopy` groups them — a formatting decision that adds,
//     drops and reorders nothing. A one-sentence event stays one paragraph
//     rather than being padded out to fill the design.
//   • **No pricing, no nav, no socials.** The reference has none of them either,
//     and the APIs carry none of the three; there was nothing to add and nothing
//     to fake. The glyph beside each reason is now chosen from that reason's own
//     wording rather than by position — the API says nothing about the mapping,
//     but the sentence does.

/** The glyph for a "Why Attend?" tile, from the house set in
 *  `public/assets/icons/`.
 *
 *  These were cycled at first, on the reasoning that the APIs say nothing about
 *  which picture belongs to which reason. True, but the REASON says something:
 *  a line reading "Network with industry experts" beside a graduation cap is a
 *  worse guess than the same line beside a network glyph, and the words are
 *  right there. So each caption is matched on its own vocabulary, and only a
 *  caption that matches nothing falls back to position — which is exactly the
 *  old behaviour, for exactly the old reason.
 *
 *  Matching is deliberately shallow: these are decoration, and a clever mapping
 *  that is subtly wrong reads worse than an obviously neutral one. The tone
 *  suffix is a starting point only — the block re-picks light or dark from the
 *  surface the tile actually paints on. */
const TILE_ICONS = ["network", "insight", "learn", "growth", "award"];
// Ordered, because the FIRST match wins and the specific has to beat the
// general: "data" appears in half the insight vocabulary, and a line about a
// security masterclass should take the shield rather than the graduation cap.
const ICON_WORDS: [string, RegExp][] = [
  ["shield", /\bsecurit|cyber|threat|risk|resilien|complian|privacy|breach|defen[cs]e|zero.trust/i],
  ["ai", /\bA\.?I\b|artificial intelligence|machine learning|\bLLM|generative|copilot|automat/i],
  ["data", /\bdata\b|analytic|metric|benchmark|dashboard|measur|figures/i],
  ["global", /\bglobal|international|worldwide|cross.border|across (?:asia|europe|india)/i],
  ["certificate", /\bcertificat|accredit|credential|diploma/i],
  ["award", /\baward|recognit|celebrat|honour|honor|winner|excellence|jury/i],
  ["dining", /\bdinner|lunch|cocktail|refreshment|banquet|networking evening/i],
  ["ticket", /\bticket|pass\b|registration|seat|delegate fee|early bird/i],
  ["location", /\bvenue|location|city|hotel|on.?site|in person/i],
  ["clock", /\bagenda|schedule|timing|hours|day one|two.day|full.day/i],
  ["workshop", /\bworkshop|masterclass|hands.on|clinic|lab\b|deep.dive/i],
  ["panel", /\bpanel|roundtable|debate|fireside|discussion|boardroom/i],
  ["keynote", /\bkeynote|address|opening|plenary|headline (?:talk|speaker)/i],
  ["network", /\bnetwork|peer|connect|meet|community|delegate|room|conversation/i],
  ["insight", /\binsight|trend|research|intelligence|discover|understand|landscape/i],
  ["learn", /\blearn|session|training|skill|practice|playbook|framework/i],
  ["growth", /\bgrowth|scale|strategy|transform|future|roadmap|advantage|outcome|impact/i],
];
/** Icons for a whole grid at once, because the choice is not per-tile.
 *
 *  Matching each caption independently put THREE identical glyphs in one row on
 *  a real event — "measured on cost", "these metrics", "measured on customer
 *  satisfaction" all say data — and a grid that repeats a picture reads as
 *  broken, which is worse than the blind cycle this replaced. So a name is used
 *  once: a tile whose best match is taken falls to its next match, and a tile
 *  with none left falls to the house cycle, skipping anything already on screen. */
function tileIcons(texts: string[]): string[] {
  const used = new Set<string>();
  const url = (n: string) => `${ASSET_BASE}/assets/icons/${n}-dark.png`;
  return texts.map((t, i) => {
    const hit = ICON_WORDS.find(([name, re]) => !used.has(name) && re.test(String(t ?? "")))?.[0];
    if (hit) { used.add(hit); return url(hit); }
    const spare = TILE_ICONS.find((n) => !used.has(n)) || TILE_ICONS[i % TILE_ICONS.length];
    used.add(spare);
    return url(spare);
  });
}

/** A centred heading in the ACCENT colour, as the reference sets "Event Details"
 *  and "Why Attend?". See the header note — the `heading` block has no colour
 *  field, and `text` with `tone:"accent"` is contrast-checked against the card
 *  it actually sits on. */
function accentHeading(copy: string): Block {
  return blockOf("text", { text: copy, size: 20, weight: "700", tone: "accent", align: "center", lh: "1.35" });
}

/** Sentence boundary. The closing quote belongs to the sentence it closes —
 *  without the optional mark, `Verifiable Trust.”` starts the NEXT sentence and
 *  the copy can never be broken cleanly anywhere near it. */
const SENTENCE = /(?<=[.!?][”’"']?)\s+/;

/** True when every quotation opened in `s` has been closed again. A full stop
 *  inside a quoted theme — «under the theme “The 2026 CISO Mandate: Autonomous
 *  Defense. Verifiable Trust.”» — is not the end of a thought, so a paragraph
 *  must not break there. That is ETCISO 4078's real description, and it is the
 *  case this guard exists for. */
function quotesClosed(s: string): boolean {
  const open = (s.match(/[“]/g) || []).length;
  const close = (s.match(/[”]/g) || []).length;
  return open === close && (s.match(/"/g) || []).length % 2 === 0;
}

/** The reference runs two or three paragraphs under the banner. `introFrom`
 *  returns ONE run of sentences (and refuses a stale clone's prose outright), so
 *  they are regrouped into paragraphs here. Nothing is added, dropped or
 *  reordered — an event with one sentence to its name still gets one paragraph. */
function bodyCopy(event: EventEntity, want = 3, max = 560): string {
  const src = introFrom(event, max);
  const sentences = src.split(SENTENCE).map((s) => s.trim()).filter(Boolean);
  if (sentences.length < 2) return src;
  const per = Math.ceil(sentences.length / Math.min(want, sentences.length));
  const out: string[] = [];
  for (const s of sentences) {
    const last = out[out.length - 1];
    // A new paragraph only where the quota is used up AND the previous one is a
    // complete thought — otherwise this sentence belongs to the one before it.
    if (!last || (last.split(SENTENCE).length >= per && quotesClosed(last))) out.push(s);
    else out[out.length - 1] = `${last} ${s}`;
  }
  return out.join("\n");
}

/** "NA" is a real value in these API lists — ETBrandEquity 4504's whole
 *  who-should-attend field is one — and it is not a reason to attend anything. */
const usable = (list: string[]) =>
  list.map((t) => String(t || "").trim()).filter((t) => t && t.toUpperCase() !== "NA");

/** The reasons the event itself publishes, per the chosen source. `whyJoin` is
 *  the field the section is actually named after; the other two are there for
 *  events that fill one but not the other. */
function reasons(event: EventEntity, source: string | undefined): string[] {
  if (source === "keyPoints") return usable(event.keyPoints);
  if (source === "whoShouldAttend") return usable(event.whoShouldAttend);
  const why = usable(event.whyJoin);
  return why.length ? why : usable(event.keyPoints);
}

export const resilienceMailer: Mailer = {
  id: "mailer.resilience",
  group: "Invitation",
  label: "Single-session invitation",
  description: "Banner, a Register button, the pitch, then Event Details and a Why Attend? icon grid — the short dark invite for one session.",
  params(event) {
    return [
      // Dark throughout, as the reference is — but still an override, because a
      // portal whose microsite is light may want the mail to match it.
      { ...THEME_PARAM, default: "dark",
        hint: "The reference design is dark throughout, so this one defaults to the dark card rather than to the website's own mode." },
      ACCENT_PARAM,
      ...BANNER_PARAMS,
      { key: "body", label: "Body copy", type: "textarea", default: bodyCopy(event),
        hint: "One paragraph per line. Seeded from the event's own description; copy that names another ET portal is a stale clone and is refused, so a generated line appears instead." },
      { key: "detailsTitle", label: "Details heading", type: "text", default: "Event Details" },
      { key: "whyTitle", label: "Tiles heading", type: "text", default: "Why Attend?" },
      { key: "tileSource", label: "Tiles from", type: "select", default: "whyJoin",
        options: [
          { value: "whyJoin", label: "Why join us" },
          { value: "keyPoints", label: "Key discussion points" },
          { value: "whoShouldAttend", label: "Who should attend" },
        ],
        hint: "The event's own list fields. An event that publishes fewer than the count below gets fewer tiles — nothing is made up to fill the grid." },
      { key: "tileCount", label: "Tiles to show", type: "number", default: 5,
        hint: "The reference shows five: three across, two centred beneath." },
      YES_NO("showMeta", "Date and venue tiles"),
      YES_NO("showLogo", "Masthead above the banner", "no",
        "Off by default — the banner is the event's composed key visual and already carries the lockup."),
      ...ctaParams(event),
    ];
  },
  requires(event) {
    // Half the design is the icon grid, and it is filled from the event's own
    // list fields. With none of them the mail is a banner, a button and a date —
    // which is a different send, so this one greys out rather than shipping a
    // hollow version of itself.
    //
    // Measured through the SAME filter the tiles are built with. Counting raw
    // rows would call a mailer available on an event whose only "reason" is the
    // literal string "NA", and then render the grid empty — availability and the
    // render have to answer the same question.
    const has = usable(event.whyJoin).length || usable(event.keyPoints).length || usable(event.whoShouldAttend).length;
    return { ok: !!has, missing: has ? [] : ["why join us / key discussion points"] };
  },
  build(event, params) {
    const nTiles = Number(params.tileCount ?? 5);
    const tiles = nTiles > 0 ? reasons(event, params.tileSource).slice(0, nTiles) : [];
    const body = String(params.body ?? "").trim() || bodyCopy(event);

    return {
      mailerId: this.id,
      subject: `You're invited | ${event.name}`,
      preheader: [event.dateLabel, event.venue].filter(Boolean).join(" · ") || "Save your seat.",
      theme: params.theme || "dark",
      accent: params.accent || undefined,
      blocks: compact([
        isNo(params.showLogo) ? null : logoBlock(event),
        ...bannerBlocks(event, params),

        // The reference puts the CTA immediately under the banner, before it has
        // said anything — the invite is the point, and a reader who already knows
        // the event should not have to scroll past the pitch to act on it.
        ctaBlock(event, params, { align: "center" }),
        body ? blockOf("text", { text: body, size: 15, align: "center", lh: "1.7" }) : null,

        isNo(params.showMeta) ? null : accentHeading(String(params.detailsTitle ?? "Event Details")),
        isNo(params.showMeta) ? null : metaBlock(event),

        // The label never outlives its grid: an event with nothing in its list
        // fields drops both, rather than leaving "Why Attend?" over a gap.
        tiles.length ? accentHeading(String(params.whyTitle ?? "Why Attend?")) : null,
        tiles.length ? blockOf("features", {
          title: "", cols: "3", iconSize: "56", align: "center", tint: "no",
          // The reason goes in the tile's CAPTION, not its title. Only the caption
          // is measured for wrapping when the block levels the tiles in a row —
          // the title is allowed one line — and these lines run to a full sentence
          // on some events. The tile's title stays for a sender who wants a short
          // label above a longer caption.
          items: (() => { const icons = tileIcons(tiles);
            return tiles.map((t, i) => ({ icon: icons[i], title: "", text: t })); })(),
        }) : null,

        ctaBlock(event, params, { align: "center" }),
        footerBlock(event),
      ]),
    };
  },
};
