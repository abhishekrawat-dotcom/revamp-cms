import type { Mailer } from "./mailer.ts";
import type { EventEntity } from "../model/types.ts";
import { blockOf, type Block } from "./blocks.ts";
import { ordinal, whereOf } from "./base.ts";
import {
  THEME_PARAM, ACCENT_PARAM, BANNER_PARAMS, bannerBlocks, logoBlock, sectionLabel,
  speakersBlock, ctaParams, footerBlock, introFrom, selectSpeakers, YES_NO, isNo, compact,
} from "./shared.ts";

// The "Decrypt" programme teaser, from the supplied design: an edition flag and
// hashtag on one row, the composed banner, a ruled section heading over three
// round callouts, a "Meet the Jury" checkerboard, a photo-and-copy band, a
// circular badge, a closing paragraph and a "Stay Tuned!" button.
//
// Where it differs from the reference, and why:
//
//   • **"The jury" is the event's speaker list.** There is no jury endpoint on
//     the ET APIs — `/v1/activity/speaker/list` is the only roster an event
//     exposes, and on an awards programme it is the people the design calls the
//     jury. So the grid is seeded from it and headed with the roster's OWN group
//     label — "Architects of Change", "Eminent Leaders", "Speakers" — which is
//     the one name for these people the API actually supplies. A mixed grid falls
//     back to a neutral heading, and the mail never claims a title nobody gave.
//   • **The three callouts are the event's own discussion points.** The reference
//     circles read like programme milestones, and the APIs carry no milestone,
//     deadline or phase of any kind — but they do carry PROSE the event wrote
//     about itself (`key_discussion_points`, `why_join_us`), which is nearer in
//     meaning than the headline figures this first seeded from. Numbers had the
//     right shape and the wrong content: they simply repeated the stats band.
//     Stats stay as the fallback, and an event with neither drops the callouts
//     and their heading together rather than shipping three empty rings.
//   • **The band's photo is the event's own artwork, not a person.** The
//     reference shows a photograph beside the copy. The only pictures the APIs
//     carry are the key visual and speaker portraits, and putting a named
//     speaker beside prose they did not say would attribute it to them — so it
//     seeds with the event's logo/key visual and `bandPhoto` takes the real
//     photograph.
//   • **THREE THINGS THE REFERENCE BAND HAS AND THIS ONE DOES NOT**, all of them
//     `mosaic` — the only block that puts a picture beside a heading and prose.
//     It now carries a section background, breaks its copy into paragraphs and
//     can draw a rule under a centred heading, so the band matches the
//     reference. The colour itself is a SETTING, not a seed: no ET endpoint
//     carries a per-section palette, so inventing one would be this platform
//     asserting a brand colour nobody chose.
//   • **The badge centres**, now that the `image` block honours `align`.
//   • **No masthead by default**, for the same reason as the invitation send:
//     the banner is the event's composed key visual and already carries the
//     lockup, and the legal footer names the portal regardless.

/** The flag on the ribbon. The edition is what the reference prints, and the
 *  APIs parse one out of the event name where it exists; where it does not, the
 *  date is the next most useful thing to flag — and this design puts the date
 *  nowhere else, so it is not a repeat. */
function flagFor(event: EventEntity): string {
  return event.edition ? `${ordinal(event.edition)} Edition` : (event.dateLabel || "");
}

/** Circle captions, in the order of how much they say.
 *
 *  The reference circles hold a SENTENCE about the format, and the APIs do carry
 *  sentences — `key_discussion_points` and `why_join_us` are prose the event
 *  itself published, and every event probed had between four and twelve of them.
 *  Seeding from stats instead was reaching for the field with the right SHAPE
 *  ("26+ Speakers" is short) rather than the right MEANING, and produced three
 *  circles that repeated the numbers band further down the mail.
 *
 *  A circle is not a paragraph, so anything past what fits the inscribed square
 *  is cut at a word boundary rather than allowed to spill past the curve — and
 *  points that only make sense in full are skipped rather than truncated into
 *  nonsense. Stats remain the last resort, and no stats means no circles at all:
 *  three invented milestones would be worse than three fewer rings. */
const CIRCLE_CHARS = 90;
function calloutsFrom(event: EventEntity): string[] {
  const all = [...(event.keyPoints || []), ...(event.whyJoin || [])]
    .map((x) => String(x ?? "").trim())
    .filter((x) => x.length > 12 && x.length <= CIRCLE_CHARS * 1.6);
  // Points that fit WHOLE come first, in their own order. Taking the first three
  // and cutting them produced "…compensate for inefficient back…" — a circle
  // ending mid-thought reads as broken, and an event with a dozen points usually
  // has three short ones further down the list. Truncation is what is left when
  // it does not.
  const whole = all.filter((x) => x.length <= CIRCLE_CHARS);
  const cut = all.filter((x) => x.length > CIRCLE_CHARS)
    .map((x) => x.slice(0, x.lastIndexOf(" ", CIRCLE_CHARS)).replace(/[,;:]$/, "") + "…");
  const prose = [...whole, ...cut];
  if (prose.length >= 3) return prose.slice(0, 3);
  return (event.stats || [])
    .map((s) => [s.value, s.label].filter(Boolean).join(" ").trim())
    .filter(Boolean)
    .slice(0, 3);
}

/** What the event calls its own people. `group` is the only label the roster
 *  carries and it is filled on every event probed ("Architects of Change",
 *  "Eminent Leaders", "Speakers"), so the grid can be headed with the event's own
 *  word instead of "Jury" — a title the APIs never gave anyone. Several groups
 *  means the grid is mixed, and only then does a neutral heading beat a wrong
 *  specific one. */
function rosterTitle(event: EventEntity, shown: { group?: string }[]): string {
  const groups = [...new Set(shown.map((s) => String(s.group ?? "").trim()).filter(Boolean))];
  return groups.length === 1 ? `Meet the **${groups[0]}**` : "Meet the **Line-up**";
}

/** The circular badge. The APIs expose no badge, seal or stamp of any kind; the
 *  nearest thing an event has is its own square mark, and `logoUrl` falls back to
 *  the composed key visual when there isn't one — which is the picture the banner
 *  is already showing, and does not read as a badge at 150px. So it seeds only
 *  where the event really has a mark of its own, and the sender fills the slot
 *  otherwise. */
function badgeFor(event: EventEntity): string {
  const logo = String(event.logoUrl ?? "").trim();
  return logo && logo !== String(event.keyVisualUrl ?? "").trim() ? logo : "";
}

/** The closing line under the badge. Every fact in it is the event's own; the
 *  only editorial is the promise this mail makes about itself, which is what a
 *  teaser is for. */
function outroFor(event: EventEntity): string {
  const when = [event.dateLabel, whereOf(event)].filter(Boolean).join(", ");
  return `The full programme is on its way.${when ? ` Save the date — ${when}.` : ""}`;
}

export const decryptMailer: Mailer = {
  id: "mailer.decrypt",
  group: "Programme",
  label: "Programme teaser",
  description: "Edition flag, banner, circle callouts, a jury checkerboard and a colour band — the “more to come” send for an awards or council programme.",
  params(event) {
    return [
      THEME_PARAM, ACCENT_PARAM,
      ...BANNER_PARAMS,
      { key: "flag", label: "Edition flag", type: "text", default: flagFor(event),
        hint: "The edition the APIs parse out of the event name. Events with no edition fall back to the date, which this design shows nowhere else. Empty hides the tab." },
      { key: "topicsTitle", label: "Callouts heading", type: "text", default: "At a glance" },
      { key: "callouts", label: "Circle callouts", type: "textarea", default: calloutsFrom(event).join("\n"),
        hint: "One per line, a few words each — text does not wrap around a curve. Seeded from the event's own figures because the APIs carry no programme milestones or deadlines; replace them with the real ones." },
      { key: "juryTitle", label: "Grid heading", type: "text", default: "",
        hint: "Empty uses what the event calls these people itself (their roster group). The APIs expose no jury, so nothing here claims one." },
      { key: "juryCount", label: "People to show", type: "number", default: 8,
        hint: "The checkerboard alternates photo and name tiles four across, so multiples of four fill their rows exactly." },
      { key: "bandTitle", label: "Band heading", type: "text", default: event.tagline || event.name },
      { key: "bandColour", label: "Band colour", type: "color",
        default: event.siteAccent || "",
        hint: "Hex, defaulting to the event microsite's own accent so the band matches the site it links to. Whatever you pick, the heading, copy and button are re-measured against it." },
      { key: "bandText", label: "Band copy", type: "textarea", default: introFrom(event, 420),
        hint: "Seeded from the event's own description. The block renders it as one run — line breaks do not become separate paragraphs there." },
      { key: "bandPhoto", label: "Band photograph", type: "image", default: event.logoUrl || event.keyVisualUrl || "",
        hint: "Seeded with the event's own artwork. A photograph of a person is yours to supply — seeding a named speaker here would attribute the copy beside it to them." },
      { key: "badge", label: "Badge image", type: "image", default: badgeFor(event),
        hint: "The circular mark above the closing line. The APIs carry no badge or seal, so this seeds with the event's own square mark where it has one distinct from the banner — and stays empty where it does not, because the same picture twice in one mail is worse than one fewer. Only a square image reads as a circle." },
      { key: "outro", label: "Closing line", type: "textarea", default: outroFor(event) },
      YES_NO("showLogo", "Masthead above the banner", "no",
        "Off by default — the banner is the event's composed key visual and already carries the lockup."),
      { ...ctaParams(event)[0], default: "Stay Tuned!" },
      ctaParams(event)[1],
    ];
  },
  requires(event) {
    // The checkerboard is the spine of this design. One person is not a
    // checkerboard, so it takes at least two before the mail is offered.
    const ok = event.speakers.length >= 2;
    return { ok, missing: ok ? [] : ["speakers (2+) for the jury grid"] };
  },
  build(event, params) {
    const nJury = Number(params.juryCount ?? 8);
    const jury = nJury > 0 ? selectSpeakers(event, params, nJury).slice(0, nJury) : [];
    const callouts = String(params.callouts ?? "").split(/\n+/).map((s) => s.trim()).filter(Boolean);
    const bandPhoto = String(params.bandPhoto ?? "").trim();
    const bandText = String(params.bandText ?? "").trim();
    const badge = String(params.badge ?? "").trim();
    const outro = String(params.outro ?? "").trim();
    const flag = String(params.flag ?? "").trim();
    const cta = String(params.ctaLabel || "Stay Tuned!").trim() || "Stay Tuned!";
    const href = String(params.ctaUrl || event.ctaUrl || event.micrositeUrl || "");

    const blocks: (Block | null)[] = [
      isNo(params.showLogo) ? null : logoBlock(event),
      // The flag row sits above the artwork, as the reference has it. The block
      // draws nothing when both halves are empty, so an event with neither an
      // edition nor a hashtag simply opens on the banner.
      flag || event.hashtag ? blockOf("ribbon", { flag, hashtag: event.hashtag || "", tone: "accent", tint: "no" }) : null,
      ...bannerBlocks(event, params),

      // The heading never outlives its circles: no stats, no callouts, no label.
      callouts.length ? sectionLabel(String(params.topicsTitle ?? "At a glance")) : null,
      callouts.length ? blockOf("circles", {
        size: "medium", tone: "accent", tint: "no",
        items: callouts.map((text) => ({ text })),
      }) : null,

      jury.length ? speakersBlock(jury, {
        title: String(params.juryTitle ?? "").trim() || rosterTitle(event, jury),
        style: "checker", cols: 4, tint: false,
      }) : null,

      // The photo-and-copy band. `mosaic` is the one block that puts a picture
      // beside a heading and prose; see the header note for what it cannot draw.
      bandPhoto || bandText ? blockOf("mosaic", {
        title: String(params.bandTitle ?? ""), text: bandText,
        label: "", href: "", side: "left", align: "left",
        // The reference runs this band on a strong colour. It is the sender's to
        // pick — no ET endpoint carries a per-section palette — and every mark on
        // it (copy, heading rule, button) is re-measured against whatever they
        // choose, so a dark pick cannot swallow its own text.
        ...(String(params.bandColour ?? event.siteAccent ?? "").trim()
          ? { tint: "custom", tintColor: String(params.bandColour ?? event.siteAccent).trim() }
          : {}),
        items: bandPhoto ? [{ url: bandPhoto, alt: event.name }] : [],
      }) : null,

      // 999 is the block's "circle" radius.
      badge ? blockOf("image", { url: badge, href: event.micrositeUrl || "", alt: event.name, width: 150, radius: "999", align: "center" }) : null,
      outro ? blockOf("text", { text: outro, size: 15, align: "center", lh: "1.7" }) : null,
      cta && href ? blockOf("button", { label: cta, href, align: "center", variant: "solid", caps: "yes", radius: 99 }) : null,
      footerBlock(event),
    ];

    return {
      mailerId: this.id,
      subject: jury.length ? `Meet the jury | ${event.name}` : `More to come | ${event.name}`,
      preheader: "Who's on the panel, what's on the programme, and what happens next.",
      theme: params.theme || "site",
      accent: params.accent || undefined,
      blocks: compact(blocks),
    };
  },
};
