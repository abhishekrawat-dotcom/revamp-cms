import type { ParamDef } from "../templates/template.ts";
import type { EventEntity, Speaker, Sponsor, Session } from "../model/types.ts";
import { resizeUrl } from "../api/images.ts";
import { blockOf, type Block } from "./blocks.ts";
import { siteUrl, dateVenue, whereOf, ordinal, hhmm, balancedCols } from "./base.ts";
import { getBrand, PORTALS } from "../brand/index.ts";

// Param builders + selection helpers shared by every mailer. Params only seed
// the FIRST version of a document; after that the studio edits blocks directly.

export const THEME_PARAM: ParamDef = {
  key: "theme", label: "Palette", type: "select", default: "site",
  options: [
    { value: "site", label: "Match the event website" },
    { value: "light", label: "Light card · dark text" },
    { value: "dark", label: "Dark card · light text" },
  ],
  hint: "“Match the website” follows the microsite's own light/dark mode and accent colour.",
};

export const ACCENT_PARAM: ParamDef = {
  key: "accent", label: "Accent colour", type: "text",
  hint: "Hex like #08a5ff. Blank = the event website's own accent (from the API), else the portal brand kit.",
};

/** Header banner: the event's key visual, wide-cropped by the CDN and linked to
 *  the microsite. A poster-shaped key visual would be enormous full-width, so we
 *  ask the CDN for a 750×260 crop rather than scaling the original. */
export const BANNER_PARAMS: ParamDef[] = [
  { key: "banner", label: "Header banner", type: "select", default: "auto",
    options: [
      { value: "auto", label: "Event key visual (wide crop)" },
      { value: "none", label: "No banner" },
    ] },
  { key: "bannerUrl", label: "Custom banner URL", type: "image",
    hint: "Overrides the auto banner. Must be a PUBLIC url — uploaded PSD/background assets are local-only." },
];

export function bannerBlocks(event: EventEntity, params: Record<string, any>): Block[] {
  const custom = String(params.bannerUrl || "").trim();
  if (custom) return [blockOf("banner", { url: custom, href: siteUrl(event), alt: event.name })];
  if (String(params.banner ?? "auto") === "none" || !event.keyVisualUrl) return [];
  // The SEO/OG artwork is used at its own aspect ratio: it is already web-sized,
  // and a CDN crop to a fixed 750×400 box was cutting the creative. `width:100%`
  // in the block scales it to the column and lets the height follow.
  return [blockOf("banner", { url: event.keyVisualUrl, href: siteUrl(event), alt: event.name })];
}

/** "For Delegation / For Sponsorship" contact rows — a fixture of every house
 *  mailer. Names are blank by default: the sender fills them in the studio. */
export function contactsBlock(): Block {
  return blockOf("contacts", {
    tint: "yes",
    items: [
      { role: "For Delegation", name: "", email: "", phone: "" },
      { role: "For Sponsorship", name: "", email: "", phone: "" },
    ],
  });
}

/** Slim brand bar: the PORTAL's logo (ETHRWorld, ETCIO…), not the event's square
 *  thumbnail. Portals without a public raster logo fall back to the portal name,
 *  which the block renders as styled text. */
export function logoBlock(event: EventEntity): Block {
  const brand = getBrand(event.portal);
  return blockOf("logobar", {
    logo: brand.logoUrl || "",
    size: "medium",
    // light-ink masthead, used automatically when the mailer sits on a dark card
    logoLight: brand.logoLightUrl || "",
    href: siteUrl(event),
    right: event.hashtag,
  });
}

/** House mailers lead with the event's designed key visual. Fall back to the
 *  colour hero band only when the event has no artwork to lead with. */
export function headerBlocks(event: EventEntity, params: Record<string, any>): Block[] {
  const banner = bannerBlocks(event, params);
  return banner.length ? [logoBlock(event), ...banner] : [logoBlock(event), heroBlock(event)];
}

/** Uppercase, letter-spaced section label — OVERVIEW / PARTNERS / CONTACT US. */
export function sectionLabel(text: string, align = "center"): Block {
  return blockOf("heading", { text, size: 15, caps: "yes", align });
}

export function heroBlock(event: EventEntity, o: { title?: string; sub?: string } = {}): Block {
  return blockOf("hero", {
    ribbon: event.edition ? `${ordinal(event.edition)} Edition` : "",
    title: o.title ?? event.name,
    sub: o.sub ?? (event.tagline || ""),
    meta: dateVenue(event),
  });
}

export function metaBlock(event: EventEntity): Block {
  return blockOf("meta", {
    items: [
      { label: "When", value: event.dateLabel || "Date to be announced" },
      { label: "Where", value: whereOf(event) || "Venue to be announced" },
      ...(event.totalDays ? [{ label: "Format", value: `${event.totalDays} day${event.totalDays > 1 ? "s" : ""}` }] : []),
    ],
  });
}

export function ctaBlock(event: EventEntity, params: Record<string, any>, o: { align?: string; note?: string } = {}): Block {
  return blockOf("button", {
    label: params.ctaLabel || event.ctaLabel || "Register now",
    href: params.ctaUrl || event.ctaUrl || siteUrl(event),
    note: o.note || "",
    align: o.align || "left",
  });
}

export function footerBlock(event: EventEntity): Block {
  return blockOf("footer", {
    // Portal name drives the legal line — ETHRWorld's mail must not sign off as
    // ET BrandEquity. Address + unsubscribe token match the house footer exactly.
    portal: getBrand(event.portal).name,
    unsubscribe: "{$$!!unsubscribelink!!$$}",
    address: "(Times Center), FC - 6, Film City, Sector 16A, Noida - 201301, Uttar Pradesh, India",
  });
}

export const dividerBlock = () => blockOf("divider", {});

export function speakersBlock(
  list: Speaker[],
  o: { title?: string; cols?: number; note?: string; tint?: boolean; style?: string; bio?: boolean; social?: boolean } = {},
): Block {
  return blockOf("speakers", {
    title: o.title ?? "Speakers",
    style: o.style || "cards", shape: "square", showRole: "yes", showCompany: "yes",
    showBio: o.bio ? "yes" : "no", showSocial: o.social ? "yes" : "no",
    cols: String(o.cols ?? 3),
    note: o.note || "",
    tint: o.tint === false ? "no" : "yes",
    // LinkedIn is the one handle the API carries; the other two seed empty and
    // stay out of the render until someone fills them in.
    items: list.map((s) => ({
      name: s.name, role: s.designation, company: s.company, photo: s.photoUrl || "",
      bio: "", linkedin: s.linkedin || "", facebook: "", x: "",
    })),
  });
}

export function sponsorsBlock(list: Sponsor[], title = "", tint = true): Block {
  return blockOf("sponsors", {
    title,
    tint: tint ? "yes" : "no",
    // Balanced from the count so a tier never wraps to a lonely last tile
    // (9 logos become 3/3/3, not 4/4/1). Still editable in the studio.
    cols: String(balancedCols(list.length, 4)),
    style: "cards", logoHeight: "44", showTier: "yes", showName: "no",
    max: "",
    items: list.map((s) => ({ title: s.title, logo: s.logoUrl || "", url: s.url || "" })),
  });
}


/** "1st Day" / "2nd Day" for a session, counted from the earliest date in the
 *  agenda. Empty when the event's agenda carries no dates at all — the sender
 *  fills it, and the layout falls back to one list until they do. */
function dayLabel(start: string | undefined, all: Session[]): string {
  const dayOf = (v?: string) => {
    const d = v ? new Date(v) : null;
    return d && !isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : "";
  };
  const mine = dayOf(start);
  if (!mine) return "";
  const days = [...new Set(all.map((x) => dayOf(x.start)).filter(Boolean))].sort();
  if (days.length < 2) return "";                 // a one-day event needs no split
  const n = days.indexOf(mine) + 1;
  const suffix = n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th";
  return `${n}${suffix} Day`;
}

export function sessionsBlock(list: Session[], o: { title?: string; showSpeakers?: boolean; style?: string } = {}): Block {
  return blockOf("sessions", {
    title: o.title ?? "Agenda",
    style: o.style || "cards",
    max: "",
    showTime: "yes",
    showWho: o.showSpeakers === false ? "no" : "yes",
    items: list.map((s) => ({
      time: [hhmm(s.start), hhmm(s.end)].filter(Boolean).join(" – "),
      title: s.title,
      who: o.showSpeakers === false ? "" : s.speakers.slice(0, 4).map((x) => [x.name, x.company].filter(Boolean).join(", ")).join(" • "),
      // The agenda API carries a start datetime but many events leave it empty,
      // so the day is seeded where it exists and left for the sender where it
      // does not. The day-column layout groups on this.
      day: dayLabel(s.start, list),
    })),
  });
}

// ---- copy defaults ----------------------------------------------------------

export function copyParams(headline: string, intro: string): ParamDef[] {
  return [
    { key: "headline", label: "Headline", type: "text", default: headline },
    { key: "intro", label: "Intro copy", type: "textarea", default: intro, hint: "One paragraph per line." },
  ];
}

export function ctaParams(event: EventEntity): ParamDef[] {
  return [
    { key: "ctaLabel", label: "Button label", type: "text", default: event.ctaLabel || "Register now" },
    { key: "ctaUrl", label: "Button link", type: "text", default: event.ctaUrl || "", hint: "Add your UTM-tagged registration link here." },
  ];
}

/** Two-sentence lede from the event's own copy. Description first: the tagline
 *  already sits in the hero, so leading with it would repeat that line. */
/** ET clones event records between portals, and the copy sometimes keeps the
 *  source event's prose — ETHRWorld's 4078 still carries ETCISO SecuFest's
 *  description. Copy that names a different ET portal is stale by definition, so
 *  it never becomes an overview. */
function namesAnotherPortal(text: string, portal: string): boolean {
  const flat = text.toLowerCase().replace(/[^a-z0-9]/g, "");
  const token = (p: { portal: string; name: string }) => p.name.toLowerCase().replace(/[^a-z0-9]/g, "");
  const mine = new Set(PORTALS.filter((p) => p.portal === portal).map(token));
  return PORTALS.some((p) => p.portal !== portal && !mine.has(token(p)) && token(p).length > 4 && flat.includes(token(p)));
}

export function introFrom(event: EventEntity, max = 320): string {
  // A record whose description belongs to another portal's event is a stale clone,
  // so its tagline/synopsis is suspect too — both come from the same copy. In that
  // case the overview is generated from the event's own facts instead.
  const stale = !!event.description && namesAnotherPortal(event.description, event.portal);
  const ok = (t?: string) => (!stale && t && !namesAnotherPortal(t, event.portal) ? t : "");
  const src = ok(event.description) || ok(event.tagline) || "";
  if (!src) return `${event.name} brings together the industry's decision-makers${event.dateLabel ? ` on ${event.dateLabel}` : ""}.`;
  let out = "";
  for (const s of src.split(/(?<=[.!?])\s+/)) {
    if (out && (out + " " + s).length > max) break;
    out = out ? `${out} ${s}` : s;
    if (out.length > max) break;
  }
  return out.slice(0, max + 40).trim();
}

/** Every mailer carries a short overview paragraph — a line-up or agenda send
 *  with no prose reads as a bare grid. Falls back to the event's own description
 *  (trimmed to a couple of sentences) when the sender hasn't written one. */
export function overviewBlock(event: EventEntity, params: Record<string, any>, fallback?: string): Block | null {
  const copy = String(params.intro ?? "").trim() || fallback || introFrom(event, 240);
  if (!copy) return null;
  // On a thin event the hero sub and the overview both fall back to the tagline,
  // so the same sentence prints twice in adjacent sections. When the overview
  // would just repeat the hero's sub, drop it — every caller wraps this in
  // compact(), so a null simply removes the section.
  if (!String(params.intro ?? "").trim() && !fallback && event.tagline
      && copy.trim() === String(event.tagline).trim()) return null;
  return blockOf("text", { text: copy, size: 15, align: "center" });
}

// ---- selection --------------------------------------------------------------

export function asIdList(v: any): string[] {
  if (!v) return [];
  return (Array.isArray(v) ? v : String(v).split(",")).map((x) => String(x).trim()).filter(Boolean);
}

/** Hand-picked ids win (in pick order); otherwise top N by weightage in the group. */
export function selectSpeakers(event: EventEntity, params: Record<string, any>, fallbackLimit = 6): Speaker[] {
  const ids = asIdList(params.speakerIds);
  if (ids.length) {
    const byId = new Map(event.speakers.map((s) => [String(s.id), s]));
    return ids.map((id) => byId.get(id)).filter(Boolean) as Speaker[];
  }
  let list = event.speakers;
  if (params.group) list = list.filter((s) => s.group === params.group);
  return list.slice(0, Number(params.limit) || fallbackLimit);
}

export function selectSponsors(event: EventEntity, params: Record<string, any>): { tier: string; sponsors: Sponsor[] }[] {
  const ids = asIdList(params.sponsorIds);
  const tiers = asIdList(params.tiers);
  let groups = event.sponsorTiers;
  if (tiers.length) groups = groups.filter((t) => tiers.includes(t.tier));
  if (ids.length) {
    groups = groups
      .map((t) => ({ tier: t.tier, sponsors: t.sponsors.filter((s) => ids.includes(String(s.id))) }))
      .filter((t) => t.sponsors.length);
  }
  return groups;
}

export function selectSessions(event: EventEntity, params: Record<string, any>, fallbackLimit = 6): Session[] {
  const ids = asIdList(params.sessionIds);
  if (ids.length) {
    const byId = new Map(event.sessions.map((s) => [String(s.id), s]));
    return ids.map((id) => byId.get(id)).filter(Boolean) as Session[];
  }
  return [...event.sessions]
    .sort((a, b) => String(a.start || "").localeCompare(String(b.start || "")))
    .slice(0, Number(params.limit) || fallbackLimit);
}

/** The bullet list a mailer shows under "why attend", per the chosen source. */
export function bulletsFor(event: EventEntity, source: string | undefined): string[] {
  switch (source) {
    case "whoShouldAttend": return event.whoShouldAttend;
    case "whyJoin": return event.whyJoin;
    case "none": return [];
    case "keyPoints":
    default: return event.keyPoints.length ? event.keyPoints : event.whyJoin;
  }
}

/** Ticked list from one of the event's own list fields. Renders nothing when the
 *  API has no entries for it, which is how sections disappear rather than showing
 *  an empty frame. */
export function listBlock(items: string[], title: string, style = "ticks"): Block | null {
  const clean = items.map((t) => String(t || "").trim()).filter((t) => t && t.toUpperCase() !== "NA");
  if (!clean.length) return null;
  return blockOf("bullets", { title, style, marker: "✓", items: clean.map((text) => ({ text })) });
}

export const BULLET_SOURCE_PARAM: ParamDef = {
  key: "bulletSource", label: "Bullet list", type: "select", default: "keyPoints",
  options: [
    { value: "keyPoints", label: "Key discussion points" },
    { value: "whyJoin", label: "Why join us" },
    { value: "whoShouldAttend", label: "Who should attend" },
    { value: "none", label: "Hide bullets" },
  ],
};

export const YES_NO = (key: string, label: string, def = "yes", hint?: string): ParamDef => ({
  key, label, type: "select", default: def,
  options: [{ value: "yes", label: "Show" }, { value: "no", label: "Hide" }],
  hint,
});

export const isNo = (v: any) => String(v ?? "") === "no";

/** Drop the empty slots a conditional block list leaves behind. */
export const compact = (blocks: (Block | null | false | undefined)[]): Block[] => blocks.filter(Boolean) as Block[];
