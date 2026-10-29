import type { Mailer } from "./mailer.ts";
import { blockOf } from "./blocks.ts";
import { dateVenue } from "./base.ts";
import { getBrand } from "../brand/index.ts";
import {
  THEME_PARAM, ACCENT_PARAM, logoBlock, sectionLabel, metaBlock, ctaBlock,
  footerBlock, contactsBlock, dividerBlock, speakersBlock, sponsorsBlock,
  sessionsBlock, copyParams, ctaParams, overviewBlock, selectSpeakers,
  selectSponsors, selectSessions, YES_NO, isNo, compact,
} from "./shared.ts";

// The conference layout, from the reference design added to the repo root
// (mailer-desk.png / mailer-mobile.png): a photograph behind the headline with
// two calls to action, the line-up in a three-up grid, the numbers as a solid
// accent band, the agenda, partners, price tiers, then one last push.
//
// Where it differs from the reference, and why:
//
//   • **The photo hero takes a photograph you supply**, not the event's key
//     visual. That key visual is a COMPOSED BANNER with the event name and
//     strapline already set into it, so laying the headline over it prints two
//     headlines on top of each other — which is exactly what the first build of
//     this did. It goes in above as artwork on its own instead, and the hero
//     stays the brand band unless a plain photograph is given. Outlook on
//     Windows ignores background-image, so the cell also carries a solid dark
//     fill and degrades to the band there rather than to text on white.
//   • **Price tiers are yours.** There is no pricing endpoint on the ET APIs, so
//     this is the one section that is editor-filled — the same concession the
//     Award and Coupon families need. It seeds the SHAPE (two tiers, features, a
//     button) but the price FIGURE stays empty: a price this platform invented
//     is a price someone might send. The tier renders cleanly without one until
//     the sender fills it from the settings.
//   • **Nav bar and photo mosaic are editor-filled.** The APIs carry no site
//     navigation, so the nav links seed as Sponsors / About / Location pointing
//     at the microsite — real destinations, renamed by the sender rather than
//     dead placeholders. The mosaic seeds from the event's OWN speaker photos,
//     so it says something the moment it lands and the sender swaps artwork in
//     rather than filling four blank frames.
//   • **Socials per speaker** are not shown: the API carries LinkedIn only, so a
//     row of five icons would be four dead links.
/** The reference's speaker card carries a bio, and no ET endpoint has one. So the
 *  slot is seeded with an INSTRUCTION rather than invented prose: a sender who
 *  never opens the settings ships a visible "fill this in", not a sentence this
 *  platform made up about a named person. Social handles get no such seed — the
 *  APIs carry LinkedIn only and this event carries none, and an icon pointing
 *  nowhere is worse than an icon missing, so empty ones stay out of the render. */
function bioSeeded(b: any) {
  return {
    ...b,
    props: {
      ...b.props,
      items: (b.props.items || []).map((x: any) => ({ ...x, bio: x.bio || "Add a short bio for this speaker." })),
    },
  };
}

/** The agenda as the reference draws it: centred heading with a rule under it,
 *  the running order in day columns, a line of the sender's copy under each day
 *  heading. Only the last of those needs props the seeder does not set. */
function scheduleBlock(sessions: any[], params: Record<string, any>) {
  const b = sessionsBlock(sessions, { title: "Event **schedule**", showSpeakers: true, style: "days" });
  return {
    ...b,
    props: {
      ...b.props, align: "center",
      day1Text: String(params.day1Text ?? ""), day2Text: String(params.day2Text ?? ""),
    },
  };
}

export const conferenceMailer: Mailer = {
  id: "mailer.conference",
  group: "Conference",
  label: "Full conference programme",
  description: "Photo hero with two CTAs, the line-up, the numbers band, agenda, partners and price tiers — the long-form event send.",
  params(event) {
    return [
      THEME_PARAM, ACCENT_PARAM,
      ...copyParams(event.name, ""),
      { key: "heroPhoto", label: "Hero photograph", type: "text",
        hint: "URL of a PLAIN photograph to put the headline over. Empty keeps the brand band — the event's own key visual already carries the name, so text over it double-prints." },
      { key: "cta2", label: "Second hero button", type: "text", default: "Get tickets",
        hint: "Outline button beside the first. Empty hides it." },
      { key: "speakerCount", label: "Speakers to show", type: "number", default: 6 },
      { key: "sessionCount", label: "Sessions to show", type: "number", default: 6 },
      { key: "outro", label: "Closing line", type: "textarea",
        default: "Seats are limited and the room fills on the day. Register now to keep yours.",
        hint: "Sits under \u201cDon\u2019t miss this event\u201d." },
      { key: "day1Text", label: "First day, intro line", type: "textarea",
        hint: "Under the day heading in the schedule. Yours to write \u2014 the agenda API carries no day summary." },
      { key: "day2Text", label: "Second day, intro line", type: "textarea" },
      YES_NO("showStats", "Numbers band"),
      YES_NO("showPartners", "Partner logos"),
      YES_NO("showNav", "Nav bar", "yes", "Links are yours — the APIs carry no site navigation."),
      YES_NO("showSocial", "Social row above the footer", "yes", "Handles are yours — the APIs carry none."),
      YES_NO("showMosaic", "Photo mosaic", "yes", "Seeded from the event's speaker photos; swap in your own artwork."),
      YES_NO("showPricing", "Price tiers", "yes",
        "No pricing endpoint exists, so these seed as placeholders — change them here or on the block."),
      { key: "priceA", label: "Basic price", type: "text", default: "",
        hint: "No pricing endpoint exists — this is yours to fill. Left empty, the tier shows without a figure rather than shipping an invented price." },
      { key: "priceB", label: "Premium price", type: "text", default: "" },
      { key: "currency", label: "Currency symbol", type: "text", default: "\u20b9" },
      ...ctaParams(event),
    ];
  },
  requires() {
    return { ok: true, missing: [] };
  },
  build(event, params) {
    const nSpk = Number(params.speakerCount ?? 6);
    const speakers = nSpk > 0 ? selectSpeakers(event, params, nSpk).slice(0, nSpk) : [];
    const sessions = selectSessions(event, params, Number(params.sessionCount ?? 6));
    const tiers = isNo(params.showPartners) ? [] : selectSponsors(event, params);
    const stats = isNo(params.showStats) ? [] : (event.stats || []);
    const cta = String(params.ctaLabel || "Register").trim() || "Register";
    const photos = (event.speakers || []).filter((sp) => sp.photoUrl).slice(0, 4);

    return {
      mailerId: this.id,
      subject: `${event.name}${event.dateLabel ? ` — ${event.dateLabel}` : ""}`,
      preheader: `The full programme: speakers, agenda and how to register.`,
      theme: params.theme || "site",
      accent: params.accent || undefined,
      blocks: compact([
        isNo(params.showNav) ? null : blockOf("navbar", {
          logo: getBrand(event.portal).logoLightUrl || getBrand(event.portal).logoUrl || "",
          tone: "dark", label: cta, href: event.micrositeUrl || "",
          items: [
            ...(tiers.length ? [{ label: "Sponsors", href: event.micrositeUrl || "" }] : []),
            { label: "About", href: event.micrositeUrl || "" },
            { label: "Location", href: event.micrositeUrl || "" },
          ],
        }),
        // The nav bar already carries the masthead, so the standalone logo bar
        // would be the same wordmark twice in 60px. Only one of them ships.
        isNo(params.showNav) ? logoBlock(event) : null,
        // The event's key visual goes in as ARTWORK on its own, never behind the
        // headline: it is a composed banner that already carries the event name.
        // ONEWORLD PORT (owner C): the event's composed mail banner when it has one, else the bare key visual.
        event.bannerUrl || event.keyVisualUrl ? blockOf("banner", { url: event.bannerUrl || event.keyVisualUrl, href: event.micrositeUrl || "", alt: event.name }) : null,
        blockOf("hero", {
          ribbon: "", title: event.name, sub: params.intro || "", meta: dateVenue(event),
          // Photo only when the sender supplies one; otherwise the brand band.
          style: String(params.heroPhoto || "").trim() ? "photo" : "gradient",
          photo: String(params.heroPhoto || "").trim(), align: "center",
          cta1: cta, cta1href: event.micrositeUrl || "",
          cta2: String(params.cta2 ?? "").trim(), cta2href: event.micrositeUrl || "",
        }),

        sectionLabel("About the event"),
        overviewBlock(event, params),

        // The reference's collage beside a block of copy. Seeded from the
        // event's own speaker portraits so it is never four empty frames.
        isNo(params.showMosaic) || !photos.length ? null : blockOf("mosaic", {
          // "The big The Experience Economy 2.0" — the name often starts with the
          // same article the line does.
          title: `The big **${event.name.replace(/^the\s+/i, "")}**`, text: params.intro || "",
          label: "More info", href: event.micrositeUrl || "", side: "left",
          items: photos.map((sp: any) => ({ url: sp.photoUrl, alt: sp.name })),
        }),

        speakers.length ? sectionLabel("The line-up") : null,
        // Bio line and social icons on, as the reference has. Both are
        // sender-filled: the APIs carry no bio and only LinkedIn, so a speaker
        // with nothing typed in shows neither rather than an empty line.
        speakers.length ? bioSeeded(speakersBlock(speakers, { title: "", cols: 3, bio: true, social: true })) : null,
        speakers.length && event.micrositeUrl
          ? blockOf("button", { label: "More speakers", href: event.micrositeUrl, align: "center", variant: "solid", caps: "yes", radius: 4 })
          : null,

        // The reference puts the numbers on a solid accent band — the `solid`
        // stats layout is exactly that, so it is a setting rather than new code.
        // Icons above each figure, as the reference has.
        stats.length ? blockOf("stats", {
          items: stats.slice(0, 3), style: "solid", icons: "yes",
          title: `**${event.name}** in numbers`,
        }) : null,

        sessions.length ? dividerBlock() : null,
        // The reference splits the running order into day columns, so that is the
        // layout this template asks for. It degrades to one column by itself
        // when the event's agenda carries no dates.
        sessions.length ? scheduleBlock(sessions, params) : null,
        sessions.length && event.micrositeUrl
          ? blockOf("button", { label: "Book your seat now", href: event.micrositeUrl, align: "center", variant: "solid", caps: "yes", radius: 4 })
          : null,

        tiers.length ? dividerBlock() : null,
        tiers.length ? sponsorsBlock(tiers.flatMap((t) => t.sponsors), "Event sponsors") : null,

        // Off by default: an empty price table is worse than none, and only the
        // sender knows the numbers.
        // On by default now, with PLACEHOLDER figures the sender replaces. The
        // APIs carry no pricing, so this is dummy content by definition — it is
        // labelled as such in the settings hint rather than presented as fact.
        isNo(params.showPricing) ? null : blockOf("pricing", {
          title: "Event **Price** List", align: "center", currency: String(params.currency ?? "\u20b9"),
          items: [
            { name: "Basic", price: String(params.priceA ?? ""),
              features: "Full event access\nSession recordings\nLunch & networking\nDelegate kit",
              label: cta, href: event.micrositeUrl || "", highlight: "no" },
            { name: "Premium", price: String(params.priceB ?? ""),
              features: "Everything in Basic\nFront-row seating\nSpeaker dinner\nWorkshop access\nPriority Q&A",
              label: cta, href: event.micrositeUrl || "", highlight: "yes" },
          ],
        }),

        dividerBlock(),
        blockOf("heading", { text: "Don't miss this event", size: 24, align: "center" }),
        blockOf("text", { text: params.outro || "", align: "center", size: 13.5 }),
        ctaBlock(event, params, { align: "center" }),
        metaBlock(event),
        contactsBlock(),
        isNo(params.showSocial) ? null : blockOf("social", {
          title: "", tone: "auto", size: "20",
          items: ["facebook", "x", "linkedin", "instagram", "youtube"]
            .map((network) => ({ network, href: `https://${event.portal}.economictimes.indiatimes.com/` })),
        }),
        footerBlock(event),
      ]),
    };
  },
};
