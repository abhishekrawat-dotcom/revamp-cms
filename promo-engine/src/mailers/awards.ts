import type { Mailer } from "./mailer.ts";
import type { EventEntity } from "../model/types.ts";
import type { ParamDef } from "../templates/template.ts";
import { blockOf, type Block } from "./blocks.ts";
import { ordinal, whereOf, siteUrl } from "./base.ts";
import {
  THEME_PARAM, ACCENT_PARAM, logoBlock, sectionLabel, footerBlock, speakersBlock,
  sponsorsBlock, selectSpeakers, selectSponsors, introFrom, YES_NO, isNo, compact,
} from "./shared.ts";
// ONEWORLD PORT (owner C): the composed mail banner, which takes the square mark's place when the event has one.
import { composedBannerBlock } from "./shared.ts";

// ============================================================================
//  THE AWARD FAMILY — five sends across one award's lifecycle
// ============================================================================
//
// An award is an `EventEntity` with `.award` set, so every existing mailer can
// already render one. What none of them can do is know WHICH PHASE the award is
// in, and that is the whole reason this is a family of five rather than one
// template with a guess inside it:
//
//   nominations  open        → "enter your work"        (11 of 133 rows)
//   deadline     open        → "entries close on X"     (11 of 133 rows)
//   jury         3+ roster   → "who decides"            (69 of 91 have a roster)
//   ceremony     not past    → "come to the night"      (14 of 133 rows)
//   winners      winners>0   → "it has been decided"    (102 of 133 rows)
//
// Each one's `requires()` is keyed on the fact that makes it true, so the
// catalog greys out a nominations send on a closed award and a winners send on
// an award that has none — instead of one template printing "Nominate now" on a
// programme that finished in June.
//
// ---------------------------------------------------------------------------
//  WHAT AN AWARD DOES NOT HAVE, and what these do instead
// ---------------------------------------------------------------------------
//
//   • **NO WIDE ARTWORK — this is the biggest departure from every event
//     template in the repo.** Measured on 133 award rows across 12 portals: not
//     one carries `seo_image_url`, and `banner_img`/`mobile_banner_img` are
//     empty on all 91 award microsites. `keyVisualUrl` is the SQUARE logo — on
//     all five test awards it is byte-identical to `logoUrl`. So `bannerBlocks`
//     is NOT used anywhere in this family: it would stretch a square mark across
//     the 750px column. Every send is built on a **square mark at 140–190px,
//     centred**, a **colour band** (the `hero` block's own brand gradient) and
//     **type**. The deadline send goes further and leads on `lozenges`, which is
//     nothing but type and colour — the one block that needs no picture at all.
//     ONEWORLD PORT (owner C): Oneworld composes a WIDE mail banner for each event
//     (EventEntity.bannerUrl, 750px, drawn from the site's own hero picture).
//     When an event has one it takes the mark's place through
//     composedBannerBlock; the square mark itself is still never stretched.
//
//   • **WINNERS CANNOT BE NAMED.** `winners_endpoint` exists on 102 rows and
//     answers 401 "No Token Passed" — it wants a JWT this deployment has not
//     got. Category NAMES are not exposed anywhere either. So the winners send
//     uses the COUNTS and links to `winnersUrl`, and says in as many words that
//     the list is on the site. It never prints a name, and it never implies it
//     is showing one.
//
//   • **`uniqueWinners` IS NEVER PRINTED.** Present on 88 rows; on 53 of them it
//     equals `winners` exactly (so it is a second tile saying the same number),
//     and on 28 it is smaller than the CATEGORY count — Shark Awards 2026
//     publishes 175 winners across 72 categories and 4 unique winners, which
//     cannot all be true. Filtering to the rows where it is both distinct and
//     ≥ categories leaves 7, and every one of those has `categories: 1`, i.e.
//     a broken category count rather than a meaningful unique figure. There is
//     no reading of this field that is right often enough to send, so the
//     counts band carries editions / categories / winners and nothing else.
//
//   • **NO COUNTDOWN.** `nomination_end_date` postdates the ceremony on 10 of
//     133 rows (ET Human Capital Awards 2027: entries close 31 October 2027 for
//     a 26 February 2027 ceremony), so "days left" computed from it is nonsense
//     on those. Email has no live countdown either — a figure baked in at build
//     time is already wrong when the mail is opened. The deadline send therefore
//     prints the DATE, large, and never a number of days.
//
//   • **THE DEADLINE AND THE CEREMONY ARE ALWAYS LABELLED.** They are two dates
//     and they are not in a reliable order, so no date in this family is ever
//     shown bare: it is either in a `meta` tile with its own label, or on a line
//     that begins "Ceremony ·". `ceremonyLine()` is the only thing that puts a
//     date in a hero, and it says the word.
//
//   • **THE MICROSITE PROSE IS NOT TRUSTED BY DEFAULT.** Award microsites are
//     heavily stale-cloned: ciso/331 ("Enterprise Security Awards") carries a
//     synopsis about "creativity, craft, and design" and a `whoShouldAttend` of
//     Property Developers and Builders. `introFrom`'s portal-name guard does not
//     catch that, because the copy names no portal — it is simply another
//     event's. So `awardIntro()` accepts the description ONLY when it contains a
//     distinctive word from the award's own name, and otherwise composes a
//     sentence from the award ROW's facts, which are the ones that are right.
//     The test is deliberately asymmetric: it rejects some good copy (auto/352's
//     description is about EV awards but never says "ETEV") and that costs a
//     generated sentence, where accepting bad copy costs a lie.
//
//   • **`whoShouldAttend` IS NOT USED AT ALL**, for the same reason — an
//     eligibility list is exactly the claim a stale clone gets wrong, and
//     331's is wrong today.
//
//   • **`keyPoints` IS NOT USED EITHER.** On auto/352 it holds the CATEGORY
//     names ("EV Manufacturer of the Year", "Battery & Energy Storage
//     Innovation"); on brandequity/330, /291 and hr/342 it is empty. One section
//     cannot be headed "why enter" on one award and "the categories" on another,
//     so the why-enter list comes from `why_join_us` alone — which on every
//     award that has it reads as entrant benefits ("Industry Recognition",
//     "Enhanced Reputation", "Benchmark Your Initiatives").
//
//   • **"Speakers" ARE THE JURY, but only usually.** The roster's own `group` is
//     the only word the API gives these people, and ciso/331's roster is
//     ["Jury Members", "Chief Guest"] — a chief guest is not a juror. So the
//     grid heading is the group name when the roster is of one group and a
//     neutral "line-up" when it is mixed, and no send composes a sentence about
//     what the jury does. (Same rule as `decrypt.ts`, which reached it first.)
//
//   • **HOW TO ENTER is the one editor-filled section**, the same concession
//     `conference.ts` makes for price tiers: there is no entry-process, fee or
//     category endpoint. It seeds the SHAPE of the instruction — three steps
//     that name no fee, no form and no category — and the hint says so.
//
//   • **THE CEREMONY SEND'S BUTTON MAY SAY "NOMINATE NOW", AND THAT IS RIGHT.**
//     An award row publishes exactly one action (`action_name` + the matching
//     link) and there is no delegate-registration URL on it at all, so a
//     save-the-date send on an award whose entries are still open points at the
//     only page the award has. `normalizeAward` resolves that pair already and
//     nothing here re-derives it — inventing a "Register to attend" link would
//     be inventing a page.
//
//   • **KNOWN BLOCK LIMIT, NOT WORKED AROUND: the `solid` stats layout goes ONE
//     per row on a phone**, where `band` goes two. Measured at 390px:
//     `mailer.conference` (solid, 3 stats) → 1/1/1, `mailer.announcement`
//     (band) → 2/1. The README says every stat layout is "two per row on a
//     phone", so the block and the documentation disagree. The winners send
//     still uses `solid` — it is the one send whose figures ARE the message, and
//     conference established the usage — but the fix belongs in `blocks.ts`,
//     which this work may not touch. Reported rather than routed around.
//
// ---------------------------------------------------------------------------
//  ON AN ORDINARY EVENT (no `.award`)
// ---------------------------------------------------------------------------
//  Every `requires()` REFUSES: an event has no phase, no deadline and no
//  winners, so all five are greyed out with "this event is not an award". They
//  do not merely degrade, because a "Call for nominations" offered on a
//  conference is an invitation to send one. `build()` is nevertheless written
//  null-safe throughout (`event.award?.…`), so the studio's own
//  build-it-anyway path yields a plain, honest event mail rather than throwing
//  or printing "undefined".
//
// ---------------------------------------------------------------------------
//  WHAT WAS DELIBERATELY NOT BUILT
// ---------------------------------------------------------------------------
//  A **shortlist / nominees** send (the nominee list does not exist on any
//  endpoint), a **categories** send (only a count is published, never a name),
//  and a **winners LIST** send (the 401 above). Each would have to invent its
//  own content, which is the one thing this platform does not do.

// ---------------------------------------------------------------------------
//  Award facts → copy
// ---------------------------------------------------------------------------

/** Words in an award's name that say nothing about WHICH award it is. */
const GENERIC = new Set(["the", "economic", "times", "award", "awards", "edition", "annual", "india", "indian"]);

function nameTokens(name: string): string[] {
  return String(name ?? "").toLowerCase().split(/[^a-z0-9]+/)
    .filter((w) => w.length > 3 && !GENERIC.has(w) && !/^\d+$/.test(w));
}

/** Does this prose actually name the award it is attached to?
 *
 *  The stale-clone guard in `introFrom` catches copy that names a DIFFERENT ET
 *  PORTAL. Award microsites fail a step earlier than that: the copy names no
 *  portal at all, it is simply another event's. Requiring one distinctive word
 *  from the award's own name is the cheapest test that catches both, and it is
 *  measured — it passes brandequity/330, /291, hr/342, hr/366, health/373 and
 *  retail/363, and rejects ciso/331, whose synopsis belongs to a design award. */
function prosePassesNameTest(text: string, name: string): boolean {
  const flat = String(text ?? "").toLowerCase();
  const toks = nameTokens(name);
  return toks.length > 0 && toks.some((w) => flat.includes(w));
}

/** "Ceremony  •  3 July, 2026  •  Grand Hyatt, BKC, Mumbai".
 *
 *  The word is always there. An award carries two dates that are not reliably in
 *  order, so a bare date line in a hero is the exact mistake this family exists
 *  to avoid. */
export function ceremonyLine(event: EventEntity): string {
  const when = event.dateLabel || event.award?.ceremonyDateLabel || "";
  if (!when) return whereOf(event);
  return ["Ceremony", when, whereOf(event)].filter(Boolean).join("  •  ");
}

/** Whole sentences up to `max`, without cutting at an abbreviation.
 *
 *  `introFrom` in shared.ts splits on `(?<=[.!?])\s+`, which reads the full stop
 *  in "enable India Inc." as the end of a sentence — hr/366's overview came out
 *  as "…Our mission is to enable India Inc." and stopped there. This family
 *  trims its own prose so an award's copy is not cut mid-clause; the shared
 *  helper is left alone (it is not this family's to change, and every existing
 *  mailer's bytes depend on it). */
const ABBREV = /\b(?:Inc|Ltd|Pvt|Co|Corp|Pte|Plc|Sr|Jr|Mr|Mrs|Ms|Dr|Prof|St|No|vs|etc|approx)\.$/i;
function trimSentences(src: string, max: number): string {
  let out = "";
  for (const s of String(src).trim().split(/(?<=[.!?])\s+/)) {
    const next = out ? `${out} ${s}` : s;
    const done = out.length >= max && !ABBREV.test(out);
    if (done || (out && next.length > max && !ABBREV.test(out))) break;
    out = next;
    if (out.length > max + 120) break;   // hard stop: a paragraph with no full stops in it
  }
  return out.trim();
}

/** A sentence built only from the award ROW, angled at what this send is for.
 *
 *  One `generatedIntro` produced the winners sentence in the JURY mail on every
 *  past award, because "past + winners" was the only branch that matched — an
 *  accurate sentence answering a question that send is not asking. The angle is
 *  passed in by each template instead of inferred from the phase alone. */
type Angle = "nominations" | "programme" | "winners";
function generatedIntro(event: EventEntity, angle: Angle): string {
  const a = event.award;
  const where = whereOf(event);
  const when = event.dateLabel || a?.ceremonyDateLabel || "";
  const at = [when ? `on ${when}` : "", where ? `in ${where}` : ""].filter(Boolean).join(" ");
  if (!a) return introFrom(event, 240);
  const past = a.phase === "past";

  if (angle === "nominations" && a.nominationsCloseLabel) {
    return `${event.name} is open for entries until ${a.nominationsCloseLabel}.`
      + (at ? ` The winners are announced at the ceremony ${at}.` : "");
  }
  if (angle === "winners" && a.winners) {
    const across = a.categories ? ` across ${a.categories} categor${a.categories > 1 ? "ies" : "y"}` : "";
    return `${a.winners} winner${a.winners > 1 ? "s" : ""}${across} were announced${at ? ` ${at}` : ""}.`;
  }
  const edition = a.editions && a.editions > 1
    ? ` This ${past ? "was" : "is"} the ${ordinal(a.editions)} edition.` : "";
  if (at) return `${event.name} ${past ? "was decided" : "is decided"} at the ceremony ${at}.${edition}`;
  return `${event.name}.${edition}`.trim();
}

/** The overview paragraph. The microsite's own description when it demonstrably
 *  belongs to this award; the award row's facts otherwise.
 *
 *  This does NOT go through `introFrom`: that helper's stale-clone guard rejects
 *  copy naming a different ET PORTAL, and award microsites fail one step earlier
 *  than that — ciso/331's synopsis names no portal, it is simply a design
 *  award's. The name test below is strictly stronger for an award (any copy that
 *  names another portal's event will not carry this award's own distinctive
 *  words either), so it stands alone. */
export function awardIntro(event: EventEntity, angle: Angle = "programme", max = 260): string {
  const src = String(event.description ?? "").trim();
  if (src && prosePassesNameTest(src, event.name)) {
    const trimmed = trimSentences(src, max);
    if (trimmed && prosePassesNameTest(trimmed, event.name)) return trimmed;
  }
  return generatedIntro(event, angle);
}

/** Editions / categories / winners — the three counts an award publishes that
 *  mean something. Zeroes are already omitted upstream (`usefulCount`), so an
 *  award that has not run yet yields an empty list and its band drops out
 *  entirely rather than printing "0 Winners". `uniqueWinners` is excluded on
 *  purpose; see the header. */
export function countStats(event: EventEntity): { value: string; label: string }[] {
  const a = event.award;
  if (!a) return [];
  return compactItems([
    a.editions ? { value: String(a.editions), label: a.editions > 1 ? "Editions" : "Edition" } : null,
    a.categories ? { value: String(a.categories), label: a.categories > 1 ? "Categories" : "Category" } : null,
    a.winners ? { value: String(a.winners), label: a.winners > 1 ? "Winners" : "Winner" } : null,
  ]);
}

const compactItems = <T,>(xs: (T | null | undefined | false)[]): T[] => xs.filter(Boolean) as T[];

/** The counts band, or nothing.
 *
 *  TWO figures minimum, not one. A band is a comparison — a row of numbers you
 *  read across — and health/373 has published exactly one count, which drew a
 *  full-width band 110px tall containing "6 EDITIONS" and a great deal of air.
 *  A single fact belongs in the sentence, and it already is in one: every
 *  overview line in this family names the edition when the award publishes it.
 *  Nothing is lost and a weak section disappears. */
function countsBand(stats: { value: string; label: string }[], style: "band" | "solid"): Block | null {
  if (stats.length < 2) return null;
  return blockOf("stats", { items: stats, style, title: "" });
}

/** Date tiles, every one of them labelled. `nominationsOpen` decides the TENSE
 *  of the first tile — "Nominations close" while the window is open, "closed"
 *  after — because both are literally true of the same date and only one of them
 *  is true today. */
function dateTiles(event: EventEntity): { label: string; value: string }[] {
  const a = event.award;
  const when = event.dateLabel || a?.ceremonyDateLabel || "";
  const where = whereOf(event);
  return compactItems([
    a?.nominationsCloseLabel
      ? { label: a.nominationsOpen ? "Nominations close" : "Nominations closed", value: a.nominationsCloseLabel }
      : null,
    when ? { label: "Ceremony", value: when } : null,
    where ? { label: "Where", value: where } : null,
  ]);
}

/** What the event calls its own people — the roster's `group`, which is the only
 *  name the API ever gives them. A mixed roster ("Jury Members" + "Chief Guest")
 *  gets the neutral word rather than a specific one that is wrong for some of
 *  the faces in the grid. */
function rosterWord(shown: { group?: string }[]): string {
  const groups = [...new Set(shown.map((s) => String(s.group ?? "").trim()).filter(Boolean))];
  return groups.length === 1 ? groups[0] : "Line-up";
}
const rosterTitle = (shown: { group?: string }[]) => `Meet the **${rosterWord(shown)}**`;

/** The square mark. Never a banner: an award has no wide artwork at all, so the
 *  only picture it owns is this, and it is square. Capped well under the column
 *  width and centred, because a 750px square is a wall. */
function markBlock(event: EventEntity, params: Record<string, any>, width: number): Block | null {
  if (isNo(params.showMark)) return null;
  const url = String(params.mark ?? event.logoUrl ?? event.keyVisualUrl ?? "").trim();
  if (!url) return null;
  return blockOf("image", {
    url, href: siteUrl(event) || event.award?.awardUrl || "", alt: event.name,
    width, align: "center", radius: "12",
  });
}

const MARK_PARAM = (event: EventEntity): ParamDef => ({
  key: "mark", label: "Award mark", type: "image", default: event.logoUrl || event.keyVisualUrl || "",
  hint: "The award's own square logo. Awards publish no wide artwork of any kind — no banner, no OG image — so this is shown small and centred rather than stretched across the column.",
});

const SHOW_MARK = YES_NO("showMark", "Award mark", "yes");

/** Button label + link, defaulted to whatever the AWARD publishes for its own
 *  phase. `normalizeAward` already resolves that ("Nominate Now" → the
 *  nomination form, "View Winners" → the winners list), so nothing here
 *  re-derives it; a template that needs one specific destination passes it. */
function ctaFor(event: EventEntity, o: { label?: string; url?: string } = {}): ParamDef[] {
  return [
    { key: "ctaLabel", label: "Button label", type: "text", default: o.label || event.ctaLabel || "Find out more" },
    { key: "ctaUrl", label: "Button link", type: "text", default: o.url || event.ctaUrl || siteUrl(event) || "",
      hint: "Defaults to the page this award's own phase points at — the nomination form while entries are open, the winners list once they are decided. Add UTM tags here." },
  ];
}

function ctaButton(params: Record<string, any>, fallbackUrl: string, o: { label?: string } = {}): Block | null {
  const label = String(params.ctaLabel ?? o.label ?? "").trim();
  const href = String(params.ctaUrl ?? "").trim() || fallbackUrl;
  if (!label || !href) return null;
  return blockOf("button", { label, href, align: "center", variant: "solid", caps: "yes", radius: 8, size: "lg" });
}

/** The house contact rows, with the roles an AWARD actually has. The shared
 *  `contactsBlock()` says "For Delegation", which is the wrong question to ask
 *  about a nomination. */
const awardContacts = () => blockOf("contacts", {
  title: "Contact us", tint: "yes",
  items: [
    { role: "For Nominations", name: "", email: "", phone: "" },
    { role: "For Sponsorship", name: "", email: "", phone: "" },
  ],
});

/** The jury/line-up grid, or nothing. Shared by four of the five sends. */
function rosterBlock(event: EventEntity, params: Record<string, any>, n: number, style: string, cols: number): Block | null {
  if (n <= 0) return null;
  const shown = selectSpeakers(event, params, n).slice(0, n);
  if (!shown.length) return null;
  return speakersBlock(shown, { title: rosterTitle(shown), style, cols, tint: false });
}

const NOT_AN_AWARD = { ok: false, missing: ["an award (this event has no award record)"] };

// ---------------------------------------------------------------------------
//  1 · CALL FOR NOMINATIONS
// ---------------------------------------------------------------------------

export const awardNominationsMailer: Mailer = {
  id: "mailer.award-nominations",
  group: "Awards",
  label: "Call for nominations",
  description: "Entries are open: the deadline, why to enter, how to enter and the jury — the long ask, for an award taking submissions.",
  params(event) {
    const a = event.award;
    return [
      THEME_PARAM, ACCENT_PARAM,
      MARK_PARAM(event), SHOW_MARK,
      { key: "headline", label: "Headline", type: "text", default: event.name || "" },
      { key: "heroSub", label: "Line under the headline", type: "text",
        default: a?.nominationsCloseLabel ? `Nominations are open until ${a.nominationsCloseLabel}.` : "Nominations are open.",
        hint: "The DEADLINE, not the ceremony. The ceremony sits on its own labelled line below it." },
      { key: "intro", label: "Overview copy", type: "textarea", default: awardIntro(event, "nominations"),
        hint: "Seeded from the microsite description only when that description names this award; otherwise composed from the award's own dates and counts. Award microsites are frequently stale clones of other events." },
      { key: "whyTitle", label: "Why-enter heading", type: "text", default: "Why enter" },
      { key: "why", label: "Why enter", type: "textarea", default: (event.whyJoin || []).join("\n"),
        hint: "One per line, seeded from the award's own “why join us” list. Empty and the section — heading included — is not in the mail at all." },
      { key: "stepsTitle", label: "How-to-enter heading", type: "text", default: "How to enter" },
      { key: "steps", label: "How to enter", type: "textarea",
        default: [
          "Pick the categories your work fits.",
          "Prepare the entry — the brief, the results and the supporting material.",
          "Submit it before the closing date above.",
        ].join("\n"),
        hint: "YOURS. The ET APIs publish no entry process, no fee and no category list, so this seeds the shape of the instruction and names none of the three. Empty hides it." },
      { key: "juryCount", label: "Jury members to show", type: "number", default: 4,
        hint: "0 hides the grid. The heading uses whatever the roster calls these people." },
      YES_NO("showStats", "Editions / categories / winners band", "yes",
        "Only counts the award has actually published appear; an award running for the first time shows no band."),
      ...ctaFor(event, { label: event.ctaLabel || "Nominate Now", url: event.award?.nominateUrl || event.ctaUrl }),
    ];
  },
  requires(event) {
    const a = event.award;
    if (!a) return NOT_AN_AWARD;
    const missing: string[] = [];
    if (!a.nominationsOpen) missing.push("open nominations (this award is not taking entries)");
    if (!a.nominateUrl) missing.push("a nomination link");
    return { ok: !missing.length, missing };
  },
  build(event, params) {
    const a = event.award;
    const why = String(params.why ?? "").split(/\n+/).map((s) => s.trim()).filter(Boolean);
    const steps = String(params.steps ?? "").split(/\n+/).map((s) => s.trim()).filter(Boolean);
    const stats = isNo(params.showStats) ? [] : countStats(event);
    const tiles = dateTiles(event);
    const href = a?.nominateUrl || event.ctaUrl || siteUrl(event) || "";
    const jury = rosterBlock(event, params, Number(params.juryCount ?? 4), "circle", 4);

    return {
      mailerId: this.id,
      subject: a?.nominationsCloseLabel
        ? `Nominations are open — ${event.name} (until ${a.nominationsCloseLabel})`
        : `Nominations are open — ${event.name}`,
      preheader: "Who can enter, why it is worth entering, and the closing date.",
      theme: params.theme || "site",
      accent: params.accent || undefined,
      blocks: compact([
        logoBlock(event),
        // ONEWORLD PORT (owner C, O3 = b): the composed banner (it carries the logo unit the mark repeats) in
        // place of the square mark when the event has one; the band and its button below stay.
        composedBannerBlock(event, params) ?? markBlock(event, params, 180),
        blockOf("hero", {
          ribbon: event.edition ? `${ordinal(event.edition)} Edition` : "",
          title: String(params.headline ?? event.name),
          sub: String(params.heroSub ?? ""),
          // Labelled, always. The deadline is in the sub-line above and in its
          // own tile below; this line says "Ceremony" so the two cannot merge.
          meta: ceremonyLine(event),
          style: "gradient", align: "center",
          cta1: String(params.ctaLabel || "Nominate Now"), cta1href: href,
          cta2: "", cta2href: "",
        }),
        tiles.length ? blockOf("meta", { items: tiles, tint: "tile" }) : null,
        blockOf("text", { text: String(params.intro ?? ""), size: 15, align: "center" }),

        // Heading and content share one guard, so a label can never outlive its
        // section (house rule 7 / the geometry suite).
        why.length ? sectionLabel(String(params.whyTitle ?? "Why enter")) : null,
        why.length ? blockOf("bullets", { title: "", style: "ticks", marker: "✓", items: why.map((text) => ({ text })) }) : null,

        steps.length ? sectionLabel(String(params.stepsTitle ?? "How to enter")) : null,
        steps.length ? blockOf("bullets", { title: "", style: "numbered", items: steps.map((text) => ({ text })) }) : null,

        countsBand(stats, "band"),

        jury,

        ctaButton(params, href, { label: "Nominate Now" }),
        awardContacts(),
        footerBlock(event),
      ]),
    };
  },
};

// ---------------------------------------------------------------------------
//  2 · DEADLINE REMINDER
// ---------------------------------------------------------------------------

export const awardDeadlineMailer: Mailer = {
  id: "mailer.award-deadline",
  group: "Awards",
  label: "Nominations close soon",
  description: "The short urgent one: the closing date as a statement, one line of copy and a single button. No grids, no numbers, no countdown.",
  params(event) {
    const a = event.award;
    return [
      THEME_PARAM, ACCENT_PARAM,
      MARK_PARAM(event), SHOW_MARK,
      { key: "headline", label: "Headline", type: "text", default: event.name || "" },
      { key: "line1", label: "Statement line 1", type: "text", default: "Nominations close" },
      { key: "line2", label: "Statement line 2", type: "text", default: a?.nominationsCloseLabel || "",
        hint: "The closing DATE. Deliberately not a number of days: `nomination_end_date` postdates the ceremony on some awards, and a countdown baked into an email is already wrong when the mail is opened." },
      { key: "line3", label: "Statement line 3", type: "text", default: "Enter now." },
      { key: "copy", label: "The one line of copy", type: "textarea",
        default: deadlineCopy(event),
        hint: "One sentence. This send has a single job; anything more and it is the call-for-nominations send." },
      ...ctaFor(event, { label: event.ctaLabel || "Nominate Now", url: event.award?.nominateUrl || event.ctaUrl }),
    ];
  },
  requires(event) {
    const a = event.award;
    if (!a) return NOT_AN_AWARD;
    const missing: string[] = [];
    if (!a.nominationsOpen) missing.push("open nominations (this award is not taking entries)");
    if (!a.nominationsCloseLabel) missing.push("a closing date to be urgent about");
    if (!a.nominateUrl) missing.push("a nomination link");
    return { ok: !missing.length, missing };
  },
  build(event, params) {
    const a = event.award;
    const href = a?.nominateUrl || event.ctaUrl || siteUrl(event) || "";
    const lines = [params.line1, params.line2, params.line3]
      .map((x) => String(x ?? "").trim()).filter(Boolean);
    const copy = String(params.copy ?? "").trim();

    return {
      mailerId: this.id,
      subject: a?.nominationsCloseLabel
        ? `Last call: ${event.name} nominations close ${a.nominationsCloseLabel}`
        : `Last call: ${event.name} nominations close soon`,
      preheader: a?.nominationsCloseLabel ? `Entries close ${a.nominationsCloseLabel}.` : "Entries close soon.",
      theme: params.theme || "site",
      accent: params.accent || undefined,
      blocks: compact([
        logoBlock(event),
        // Smaller than the other four: this send is type-led, and the mark is
        // here to identify the award at a glance, not to be the design.
        // ONEWORLD PORT (owner C, O3 = b): the composed banner (it carries the logo unit the mark repeats) in
        // place of the square mark when the event has one; the band and its button below stay.
        composedBannerBlock(event, params) ?? markBlock(event, params, 140),
        blockOf("heading", { text: String(params.headline ?? event.name), size: 22, align: "center" }),
        // The urgency is carried by TYPE AND COLOUR, because an award has no
        // artwork to carry it with. `lozenges` is the one block that needs no
        // picture at all.
        lines.length ? blockOf("lozenges", {
          items: lines.map((text) => ({ text })),
          style: "alternate", layout: "center", size: "26", radius: "99", caps: "no",
        }) : null,
        copy ? blockOf("text", { text: copy, size: 15, align: "center", lh: "1.7" }) : null,
        ctaButton(params, href, { label: "Nominate Now" }),
        footerBlock(event),
      ]),
    };
  },
};

/** One sentence naming both dates, each with its own word. Composed rather than
 *  taken from the microsite, because this is the send where a wrong date costs
 *  the most. */
function deadlineCopy(event: EventEntity): string {
  const a = event.award;
  const close = a?.nominationsCloseLabel;
  const when = event.dateLabel || a?.ceremonyDateLabel || "";
  const where = whereOf(event);
  const first = close
    ? `Entries for ${event.name} close on ${close}.`
    : `Entries for ${event.name} close soon.`;
  if (!when) return first;
  return `${first} The winners are announced at the ceremony on ${when}${where ? ` in ${where}` : ""}.`;
}

// ---------------------------------------------------------------------------
//  3 · THE JURY
// ---------------------------------------------------------------------------

export const awardJuryMailer: Mailer = {
  id: "mailer.award-jury",
  group: "Awards",
  label: "Meet the jury",
  description: "Who decides — the roster in a photo grid under its own name, with the award's editions/categories/winners for scale.",
  params(event) {
    return [
      THEME_PARAM, ACCENT_PARAM,
      MARK_PARAM(event), SHOW_MARK,
      { key: "headline", label: "Headline", type: "text", default: event.name || "" },
      { key: "intro", label: "Overview copy", type: "textarea", default: awardIntro(event, "programme") },
      { key: "juryTitle", label: "Grid heading", type: "text", default: "",
        hint: "Empty uses what the roster calls these people itself (its own group — “Grand Jury”, “Jury Members”). A roster of several groups gets a neutral heading instead: the API never labels anyone a juror, and a “Chief Guest” in the grid is not one." },
      { key: "juryCount", label: "People to show", type: "number", default: 9 },
      { key: "juryStyle", label: "Grid layout", type: "select", default: "cards",
        options: [
          { value: "cards", label: "Photo cards (bordered)" },
          { value: "circle", label: "Circular portraits" },
          { value: "rows", label: "Photo left, details right" },
          { value: "checker", label: "Checkerboard" },
        ] },
      YES_NO("showStats", "Editions / categories / winners band", "yes"),
      ...ctaFor(event),
    ];
  },
  requires(event) {
    if (!event.award) return NOT_AN_AWARD;
    // Three, not two: a grid of two portraits is a pair, not a panel, and this
    // send's entire claim is that a panel decided it.
    const ok = (event.speakers || []).length >= 3;
    return { ok, missing: ok ? [] : ["a roster of 3+ (this award publishes no jury)"] };
  },
  build(event, params) {
    const n = Number(params.juryCount ?? 9);
    const shown = n > 0 ? selectSpeakers(event, params, n).slice(0, n) : [];
    const style = String(params.juryStyle || "cards");
    const stats = isNo(params.showStats) ? [] : countStats(event);
    const href = event.ctaUrl || siteUrl(event) || "";
    const intro = String(params.intro ?? "").trim();

    return {
      mailerId: this.id,
      subject: shown.length ? `Meet the ${rosterWord(shown).toLowerCase()} | ${event.name}` : `The line-up | ${event.name}`,
      preheader: "The people deciding this edition, and the scale of the programme they are judging.",
      theme: params.theme || "site",
      accent: params.accent || undefined,
      blocks: compact([
        logoBlock(event),
        // ONEWORLD PORT (owner C, O3 = b): the composed banner (it carries the logo unit the mark repeats) in
        // place of the square mark when the event has one; the band and its button below stay.
        composedBannerBlock(event, params) ?? markBlock(event, params, 170),
        blockOf("hero", {
          ribbon: event.edition ? `${ordinal(event.edition)} Edition` : "",
          title: String(params.headline ?? event.name), sub: "",
          meta: ceremonyLine(event), style: "gradient", align: "center",
          cta1: "", cta1href: "", cta2: "", cta2href: "",
        }),
        intro ? blockOf("text", { text: intro, size: 15, align: "center" }) : null,
        shown.length ? speakersBlock(shown, {
          title: String(params.juryTitle ?? "").trim() || rosterTitle(shown),
          style, cols: style === "circle" || style === "checker" ? 4 : style === "rows" ? 2 : 3,
          tint: false,
        }) : null,
        countsBand(stats, "band"),
        ctaButton(params, href),
        footerBlock(event),
      ]),
    };
  },
};

// ---------------------------------------------------------------------------
//  4 · CEREMONY INVITATION
// ---------------------------------------------------------------------------
//
// The gap the other four leave. An award whose entries have closed but whose
// night has not happened is served by none of them — the nominations sends are
// wrong (closed), the winners send is wrong (nothing decided) — and there are 14
// such rows against 11 with nominations open. It also gives an OPEN award a
// second, different ask: enter your work is not the same mail as come and watch.

export const awardCeremonyMailer: Mailer = {
  id: "mailer.award-ceremony",
  group: "Awards",
  label: "Ceremony invitation",
  description: "Save the date for the night itself: when and where, where nominations stand, the jury and the partners.",
  params(event) {
    return [
      THEME_PARAM, ACCENT_PARAM,
      MARK_PARAM(event), SHOW_MARK,
      { key: "headline", label: "Headline", type: "text", default: event.name || "" },
      { key: "heroSub", label: "Line under the headline", type: "text", default: "Save the date.",
        hint: "The ceremony date sits on its own labelled line below this, never bare." },
      { key: "intro", label: "Overview copy", type: "textarea", default: awardIntro(event, "programme") },
      { key: "juryCount", label: "Jury members to show", type: "number", default: 8 },
      YES_NO("showStats", "Editions / categories / winners band", "yes"),
      YES_NO("showPartners", "Partner logos", "yes"),
      ...ctaFor(event),
    ];
  },
  requires(event) {
    const a = event.award;
    if (!a) return NOT_AN_AWARD;
    const missing: string[] = [];
    if (a.phase === "past") missing.push("an award that has not been held yet");
    if (!(event.dateLabel || a.ceremonyDateLabel)) missing.push("a ceremony date");
    return { ok: !missing.length, missing };
  },
  build(event, params) {
    const stats = isNo(params.showStats) ? [] : countStats(event);
    const tiers = isNo(params.showPartners) ? [] : selectSponsors(event, params);
    const partners = tiers.flatMap((t) => t.sponsors);
    const tiles = dateTiles(event);
    const href = event.ctaUrl || siteUrl(event) || "";
    const jury = rosterBlock(event, params, Number(params.juryCount ?? 8), "circle", 4);
    const intro = String(params.intro ?? "").trim();

    return {
      mailerId: this.id,
      subject: event.dateLabel ? `Save the date — ${event.name}, ${event.dateLabel}` : `Save the date — ${event.name}`,
      preheader: "The ceremony: when, where, and who is deciding.",
      theme: params.theme || "site",
      accent: params.accent || undefined,
      blocks: compact([
        logoBlock(event),
        // ONEWORLD PORT (owner C, O3 = b): the composed banner (it carries the logo unit the mark repeats) in
        // place of the square mark when the event has one; the band and its button below stay.
        composedBannerBlock(event, params) ?? markBlock(event, params, 180),
        blockOf("hero", {
          ribbon: event.edition ? `${ordinal(event.edition)} Edition` : "",
          title: String(params.headline ?? event.name), sub: String(params.heroSub ?? ""),
          meta: ceremonyLine(event), style: "gradient", align: "center",
          cta1: String(params.ctaLabel || ""), cta1href: href, cta2: "", cta2href: "",
        }),
        tiles.length ? blockOf("meta", { items: tiles, tint: "tile" }) : null,
        intro ? blockOf("text", { text: intro, size: 15, align: "center" }) : null,
        countsBand(stats, "band"),
        jury,
        partners.length ? sponsorsBlock(partners, "Our partners") : null,
        ctaButton(params, href),
        awardContacts(),
        footerBlock(event),
      ]),
    };
  },
};

// ---------------------------------------------------------------------------
//  5 · WINNERS ANNOUNCED
// ---------------------------------------------------------------------------

export const awardWinnersMailer: Mailer = {
  id: "mailer.award-winners",
  group: "Awards",
  label: "Winners announced",
  description: "It has been decided: the winners/categories/editions band, the jury that chose, and one link to the published list.",
  params(event) {
    return [
      THEME_PARAM, ACCENT_PARAM,
      MARK_PARAM(event), SHOW_MARK,
      { key: "headline", label: "Headline", type: "text", default: event.name || "" },
      { key: "heroSub", label: "Line under the headline", type: "text", default: "The winners are in." },
      { key: "intro", label: "Overview copy", type: "textarea", default: winnersCopy(event),
        hint: "The winners themselves cannot be listed here: the API's `winners_endpoint` answers 401 without a JWT this deployment does not hold, and category names are not published at all. So this send carries the counts and links to the list — it must never read as though it were naming anyone." },
      { key: "juryCount", label: "Jury members to show", type: "number", default: 8 },
      YES_NO("showStats", "Editions / categories / winners band", "yes"),
      YES_NO("showPartners", "Partner logos", "yes"),
      ...ctaFor(event, { label: event.ctaLabel || "View Winners", url: event.award?.winnersUrl || event.ctaUrl }),
    ];
  },
  requires(event) {
    const a = event.award;
    if (!a) return NOT_AN_AWARD;
    const missing: string[] = [];
    if (!a.winners) missing.push("a published winner count (nothing has been decided yet)");
    if (!a.winnersUrl) missing.push("a winners page to link to");
    return { ok: !missing.length, missing };
  },
  build(event, params) {
    const a = event.award;
    const stats = isNo(params.showStats) ? [] : countStats(event);
    const tiers = isNo(params.showPartners) ? [] : selectSponsors(event, params);
    const partners = tiers.flatMap((t) => t.sponsors);
    const href = a?.winnersUrl || event.ctaUrl || siteUrl(event) || "";
    const jury = rosterBlock(event, params, Number(params.juryCount ?? 8), "circle", 4);
    const intro = String(params.intro ?? "").trim();

    return {
      mailerId: this.id,
      // The category count is only in the subject when the award published one:
      // "across every categories" is what an `|| "every"` fallback produces.
      subject: a?.winners
        ? (a.categories
          ? `The winners: ${event.name} — ${a.winners} across ${a.categories} categor${a.categories > 1 ? "ies" : "y"}`
          : `The winners: ${event.name} — all ${a.winners} of them`)
        : `The winners: ${event.name}`,
      preheader: "The night is done. Here is the scale of it, and where the full list lives.",
      theme: params.theme || "site",
      accent: params.accent || undefined,
      blocks: compact([
        logoBlock(event),
        // ONEWORLD PORT (owner C, O3 = b): the composed banner (it carries the logo unit the mark repeats) in
        // place of the square mark when the event has one; the band and its button below stay.
        composedBannerBlock(event, params) ?? markBlock(event, params, 180),
        blockOf("hero", {
          ribbon: event.edition ? `${ordinal(event.edition)} Edition` : "",
          title: String(params.headline ?? event.name), sub: String(params.heroSub ?? ""),
          meta: ceremonyLine(event), style: "gradient", align: "center",
          cta1: String(params.ctaLabel || "View Winners"), cta1href: href, cta2: "", cta2href: "",
        }),
        // The counts ARE the story here, so they get the solid band rather than
        // the hairline one — this is the only send in the family that leads on a
        // number, and `requires()` guarantees there is at least one.
        countsBand(stats, "solid"),
        intro ? blockOf("text", { text: intro, size: 15, align: "center" }) : null,
        jury,
        partners.length ? sponsorsBlock(partners, "Our partners") : null,
        ctaButton(params, href, { label: "View Winners" }),
        footerBlock(event),
      ]),
    };
  },
};

/** The winners paragraph. Counts and dates only, and it says out loud where the
 *  names are — because they are not here and cannot be. */
function winnersCopy(event: EventEntity): string {
  const a = event.award;
  const when = event.dateLabel || a?.ceremonyDateLabel || "";
  const where = whereOf(event);
  const at = [when ? `on ${when}` : "", where ? `in ${where}` : ""].filter(Boolean).join(" ");
  if (!a?.winners) return awardIntro(event, "winners");
  const across = a.categories ? ` across ${a.categories} categor${a.categories > 1 ? "ies" : "y"}` : "";
  // The edition is deliberately NOT restated here: it is the first tile in the
  // band directly above, and "This was the 9th edition" under a tile reading
  // "9 EDITIONS" is the same fact twice in two inches.
  return `${a.winners} winner${a.winners > 1 ? "s" : ""}${across} were announced at ${event.name}${at ? ` ${at}` : ""}.`
    + ` The full list of winners is published on the award site.`;
}

export const AWARD_MAILERS: Mailer[] = [
  awardNominationsMailer,
  awardDeadlineMailer,
  awardJuryMailer,
  awardCeremonyMailer,
  awardWinnersMailer,
];
