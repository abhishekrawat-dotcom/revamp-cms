import type { EventEntity, Speaker, Sponsor, SponsorTier, Session, EventListItem, AwardFacts, AwardListItem } from "./types.ts";
import { imageUrl, sponsorLogoUrl } from "../api/images.ts";
import { getBrand, PORTALS } from "../brand/index.ts";

/** Does this copy name a DIFFERENT ET portal than the one we are sending as?
 *
 *  ET clones event records between portals and the copy comes along — ETHRWorld's
 *  4078 still carries ETCISO SecuFest's prose, and ciso's 4078 still carries the
 *  ETHRWorld name and banner. A field that names another portal's brand is stale
 *  by definition. This is the single source of that judgement: `mailers/shared.ts`
 *  imports it for the render-time overview/banner/headline guards, and
 *  `normalizeEvent` below uses it to drop cloned list fields at the source.
 *
 *  Match is on the brand NAME flattened to alphanumerics, requiring >4 chars so a
 *  short token can't false-positive, and never on one of the sending portal's own
 *  names — ETCISO copy on an ETCISO send is not foreign. */
export function namesAnotherPortal(text: string, portal: string): boolean {
  const flat = String(text ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!flat) return false;
  const token = (p: { portal: string; name: string }) => p.name.toLowerCase().replace(/[^a-z0-9]/g, "");
  const mine = new Set(PORTALS.filter((p) => p.portal === portal).map(token));
  return PORTALS.some((p) => p.portal !== portal && !mine.has(token(p)) && token(p).length > 4 && flat.includes(token(p)));
}

// ---- small parsers for the ET APIs' quirky string encodings ----

function stripHtml(s?: string | null): string {
  if (!s) return "";
  return s
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;|&rsquo;|&lsquo;/gi, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/** "NA" is a real value in these API lists rather than an empty one — ETBrand-
 *  Equity 4504's whole who-should-attend field is `["NA"]`, and 53 of the 91
 *  award microsites carry `key_discussion_points: '["NA"]'` (one of them
 *  lowercase `["na"]`, hence the case fold). It is not a point of discussion and
 *  it is not a reason to attend anything, so it is dropped where the list is
 *  parsed — ONE rule, at the source, for events and awards alike.
 *
 *  This is the rule `mailers/shared.ts` and `mailers/resilience.ts` already
 *  apply inline before rendering; applying it here as well makes the two agree
 *  by construction. Availability checks that count raw rows
 *  (`mailer.discussion`, `generic.who-should-attend`) previously offered a
 *  section whose render was guaranteed empty, which is house rule 7. */
export const usableList = (list: string[]): string[] =>
  list.map((t) => String(t ?? "").trim()).filter((t) => t && t.toUpperCase() !== "NA");

/** Several detail fields are JSON arrays serialized into a string (sometimes
 *  unicode/HTML escaped). Return a clean string[] regardless of shape. */
function parseListField(raw?: string | null): string[] {
  if (!raw) return [];
  let val: unknown = raw;
  if (typeof raw === "string") {
    const t = raw.trim();
    if (!t) return [];
    try {
      val = JSON.parse(t);
    } catch {
      // Fall back: split on common separators used elsewhere in the API.
      return usableList(t.split(/\$#\$|\r?\n/).map(stripHtml));
    }
  }
  if (Array.isArray(val)) return usableList(val.map((x) => stripHtml(String(x))));
  return usableList([stripHtml(String(val))]);
}

/** The APIs write "no date" three different ways — absent, empty, and the MySQL
 *  zero date. `nomination_start_date` also comes back as literal `null`, and
 *  `nomination_end_date` as "0000-00-00 00:00:00" on an award with no window
 *  set yet. One guard, used for every date the model exposes. */
function parseApiDate(raw?: string | null): string | undefined {
  const s = String(raw ?? "").trim();
  if (!s || s === "null" || /^0{4}-0{2}-0{2}/.test(s)) return undefined;
  return s;
}

const ORDINALS: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7,
  eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12,
};

/* ONEWORLD PORT: exported, so Oneworld's events are labelled as the platform labels ET's */
export function parseEdition(...texts: (string | undefined)[]): number | undefined {
  const hay = texts.filter(Boolean).join(" ").toLowerCase();
  const num = hay.match(/(\d+)(?:st|nd|rd|th)\s+edition/);
  if (num) return parseInt(num[1], 10);
  const word = hay.match(/\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth)\s+edition/);
  if (word) return ORDINALS[word[1]];
  return undefined;
}

/** The API's `themecolor` is a "___"-delimited blob, but it does carry the
 *  microsite's real accent hex when the event was themed
 *  ("custom___1___#08a5ff___ge___bootstrap___…"). Empty on unthemed events.
 *
 *  Award microsites are frequently unthemed and send the delimiters with nothing
 *  between them — a bare "___________________________" (48 of 91 award rows) or
 *  "custom___1______ge___…" with the hex slot blank. Both are safe: the search
 *  is for a `#hex`, so a string with no `#` in it yields undefined and the
 *  caller falls back to the brand palette. No underscore run can be mistaken for
 *  a colour. */
function parseThemeColor(raw?: string | null): string | undefined {
  // No \b here: the delimiter is "_", which is a word char, so \b never matches.
  const m = String(raw ?? "").match(/#([0-9a-f]{6}|[0-9a-f]{3})(?![0-9a-f])/i);
  return m ? `#${m[1]}` : undefined;
}

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

/* ONEWORLD PORT: exported, so Oneworld's events are labelled as the platform labels ET's */
export function fmtDateLabel(start?: string, end?: string): string | undefined {
  const s = start ? new Date(start.replace(" ", "T")) : undefined;
  if (!s || isNaN(s.getTime())) return undefined;
  const e = end ? new Date(end.replace(" ", "T")) : undefined;
  const sameMonthMultiDay = e && !isNaN(e.getTime()) && e.getMonth() === s.getMonth() && e.getDate() !== s.getDate();
  if (sameMonthMultiDay) return `${s.getDate()}–${e!.getDate()} ${MONTHS[s.getMonth()]}, ${s.getFullYear()}`;
  return `${s.getDate()} ${MONTHS[s.getMonth()]}, ${s.getFullYear()}`;
}

/* ONEWORLD PORT: exported, so Oneworld's events are labelled as the platform labels ET's */
export function daysBetween(start?: string, end?: string): number | undefined {
  const s = start ? new Date(start.replace(" ", "T")) : undefined;
  const e = end ? new Date(end.replace(" ", "T")) : undefined;
  if (!s || isNaN(s.getTime())) return undefined;
  if (!e || isNaN(e.getTime())) return 1;
  // Count calendar days inclusive (ignore intra-day hours).
  const d0 = Date.UTC(s.getFullYear(), s.getMonth(), s.getDate());
  const d1 = Date.UTC(e.getFullYear(), e.getMonth(), e.getDate());
  return Math.max(1, Math.round((d1 - d0) / 86400000) + 1);
}

// Priority order for stacking sponsor tiers in a ladder (lower = higher up).
// More-specific keys (co-presenting) must precede their substrings (presenting).
const TIER_ORDER = [
  "title", "co-presenting", "presenting", "co-powered", "powered",
  "platinum", "diamond", "gold", "silver", "bronze",
  "associate", "in association", "supporting", "partner",
];
function tierRank(tier: string): number {
  const t = tier.toLowerCase();
  const i = TIER_ORDER.findIndex((k) => t.includes(k));
  return i === -1 ? TIER_ORDER.length : i;
}

// ---- speakers / sponsors / sessions ----

function normalizeSpeaker(raw: any): Speaker {
  return {
    id: raw.id,
    name: stripHtml(raw.speaker_name),
    designation: stripHtml(raw.speaker_desig),
    company: stripHtml(raw.speaker_company),
    photoUrl: imageUrl(raw.speaker_picture),
    group: raw.group?.group_name ? stripHtml(raw.group.group_name) : undefined,
    weightage: Number(raw.speaker_weightage ?? raw.weightage ?? 0),
    linkedin: raw.linkedin_url || undefined,
  };
}

function normalizeSponsor(raw: any): Sponsor {
  return {
    id: raw.sponsor_id,
    title: stripHtml(raw.sponsor_title),
    logoUrl: sponsorLogoUrl(raw.sponsor_logo || raw.sponsor_log_png),
    tier: raw.group?.group_name ? stripHtml(raw.group.group_name) : "Partner",
    url: raw.url || undefined,
    weightage: Number(raw.weightage ?? 0),
  };
}

/* ONEWORLD PORT: exported, so Oneworld's events are labelled as the platform labels ET's */
export function groupSponsors(sponsors: Sponsor[]): SponsorTier[] {
  const byTier = new Map<string, Sponsor[]>();
  for (const s of sponsors) {
    if (!byTier.has(s.tier)) byTier.set(s.tier, []);
    byTier.get(s.tier)!.push(s);
  }
  return [...byTier.entries()]
    // Same convention as speakers (see the comment above normalizeEvent's speaker
    // sort) — weightage is a position index, ascending is the site's own order.
    .map(([tier, list]) => ({ tier, sponsors: list.sort((a, b) => a.weightage - b.weightage) }))
    .sort((a, b) => tierRank(a.tier) - tierRank(b.tier) || a.tier.localeCompare(b.tier));
}

function normalizeSession(raw: any): Session {
  return {
    id: raw.agenda_id,
    title: stripHtml(raw.agenda_title),
    start: raw.agenda_start_datetime || undefined,
    end: raw.agenda_end_datetime || undefined,
    description: stripHtml(raw.agenda_description),
    speakers: Array.isArray(raw.speakers) ? raw.speakers.map(normalizeSpeaker) : [],
  };
}

// ---- main entry ----

export interface RawBundle {
  details: any;
  speakers: any[];
  sponsors: any[];
  agenda: any[];
  /** Row from the event-listing API — carries `seo_image_url` and `link`. The
   *  award path passes its award-listing row here instead: only those two fields
   *  are read, an award row has no `seo_image_url` (so the banner falls back the
   *  same way an event with no listing row does) and its `link` is the award's
   *  own public page. */
  listRow?: any;
}

/** The CDN sometimes returns "host//files/x" — normalise so the resize helper
 *  (which matches "/files/") can rewrite it to an exact-size variant. */
function cleanCdn(url?: string | null): string | undefined {
  const u = String(url ?? "").trim();
  if (!u) return undefined;
  return u.replace(/([^:])\/\/files\//, "$1/files/");
}

export function normalizeEvent(portal: string, bundle: RawBundle): EventEntity {
  const d = bundle.details ?? {};
  const brand = getBrand(portal);

  const name = stripHtml(d.company_name) || `Event ${d.company_id}`;
  const description = stripHtml(d.company_description);
  const edition = parseEdition(d.company_name, d.company_description);
  const startDate = parseApiDate(d.event_start_date);
  const endDate = parseApiDate(d.event_end_date);
  const year = startDate ? new Date(startDate.replace(" ", "T")).getFullYear() : undefined;

  // ASCENDING: `weightage` on this API is a plain position index (1, 2, 3, …), not a
  // "score" where more is more prominent — verified against a live microsite (event
  // 4060): the API's weightage-1 speaker is the SITE's first speaker, weightage-2 is
  // its second, and so on. Sorting descending (as this line briefly did) showed every
  // event's speakers in exactly the reverse of their own site's order.
  const speakers = bundle.speakers.map(normalizeSpeaker).sort((a, b) => a.weightage - b.weightage);
  const sponsors = bundle.sponsors.map(normalizeSponsor);
  const sponsorTiers = groupSponsors(sponsors);
  const sessions = bundle.agenda.map(normalizeSession);

  // Presenting sponsor => the "presented by" line, if resolvable from tiers.
  const presentingTier = sponsorTiers.find((t) => /presenting|title/i.test(t.tier));
  const presenter = presentingTier?.sponsors[0]?.title ?? brand.presenter;

  const totalDays = daysBetween(startDate, endDate);
  const stats: { label: string; value: string }[] = [];
  if (speakers.length) stats.push({ value: `${speakers.length}+`, label: "Speakers" });
  if (sponsors.length) stats.push({ value: `${sponsors.length}+`, label: "Partners" });
  if (totalDays) stats.push({ value: String(totalDays), label: totalDays > 1 ? "Days" : "Day" });
  if (Number(d.total_registrations) > 0) stats.push({ value: `${d.total_registrations}+`, label: "Registrations" });

  const hashtag = `#${brand.hashtagBase}${year ? String(year).slice(-2) : ""}`;

  // A cross-portal CLONE: this record's own name or its overview names a
  // DIFFERENT ET portal than the one we are sending as (ETHRWorld's 4078 carries
  // ETCISO's agenda; ciso's 4078 carries the ETHRWorld name and banner). When it
  // does, the prose lists AND the wide banner came from that other event too, so
  // shipping them prints a mail that names two events. They are dropped here at
  // the source — the sections then fall out cleanly rather than showing another
  // programme's content. Structural facts (name, logo, dates, venue) are kept:
  // the sender sees the name and the guard never fires on a clean record.
  const cloned = namesAnotherPortal(name, portal) || (!!description && namesAnotherPortal(description, portal));
  const dropIfCloned = <T>(v: T): T | undefined => (cloned ? undefined : v);

  return {
    portal,
    entityId: Number(d.company_id),
    name,
    edition,
    tagline: stripHtml(d.synopsis) || undefined,
    description,
    hashtag,
    startDate,
    endDate,
    dateLabel: fmtDateLabel(startDate, endDate),
    totalDays,
    venue: stripHtml(d.event_venue) || undefined,
    city: stripHtml(d.location) || undefined,
    presenter,
    ctaLabel: stripHtml(d.action_name) || "Express Interest",
    ctaUrl: d.short_url ? `https://${String(d.short_url).replace(/^https?:\/\//, "")}` : undefined,
    logoUrl: imageUrl(d.logo_img || d.promo_image),
    // Hero banner: the listing's SEO/OG image is the only WIDE artwork the APIs
    // expose (the details payload's promo_image is the square logo), so prefer it.
    keyVisualUrl: dropIfCloned(cleanCdn(bundle.listRow?.seo_image_url) || imageUrl(d.banner_img || d.mobile_banner_img || d.promo_image)),
    micrositeUrl: d.branding_url || bundle.listRow?.link || undefined,
    siteAccent: parseThemeColor(d.themecolor),
    siteTheme: d.is_dark_light_theme === "light" ? "light" : "dark",
    whoShouldAttend: cloned ? [] : parseListField(d.who_should_attend),
    keyPoints: cloned ? [] : parseListField(d.key_discussion_points),
    whyJoin: cloned ? [] : parseListField(d.why_join_us),
    stats,
    speakers,
    sponsorTiers,
    sessions,
  };
}

// ---- listing rows for the dropdown ----

export function normalizeListItem(raw: any, portal: string, bucket: EventListItem["bucket"]): EventListItem {
  return {
    entityId: raw.entity_id,
    title: stripHtml(raw.title),
    dateLabel: raw.date_str || undefined,
    venue: stripHtml(raw.address) || undefined,
    logoUrl: raw.medium_logo || raw.small_logo || undefined,
    speakersCount: Number(raw.speakers_cnt ?? 0),
    bucket,
    portal,
    ownership: Number(raw.ownership_type ?? 0),
  };
}

// ============================================================================
//  AWARDS
// ============================================================================
//
// THE DATE TRAP, measured across 91 rows on 6 portals. An award row carries four
// date-ish fields and they answer two different questions:
//
//   complete_date / date_time / date_unix   -> the CEREMONY (matches the
//        microsite's own event_end_date; 91/91 non-empty)
//   nomination_start_date / nomination_end_date /
//   last_submission / last_submission_datetime -> the SUBMISSION DEADLINE
//
// `date_str` — the field `normalizeListItem` uses for events — belongs to
// NEITHER reliably: it equals `date_time` on 86 rows and `last_submission` on the
// other 5, and those 5 are exactly the rows with nominations open. So on every
// award a sender would actually be promoting, the event-shaped reading of
// `date_str` prints the nomination deadline as the ceremony date. The award path
// therefore never reads `date_str`.
//
// `last_submission*` exist only while `is_nomination_open` is true (7/7 rows), so
// a closed award's deadline can only come from `nomination_end_date`.

const usefulCount = (raw: unknown): number | undefined => {
  const n = Number(raw ?? 0);
  // 0 means "not published" for every one of these counters (an award that ran
  // has winners; an upcoming one reports 0 for all of them), so it is omitted
  // rather than rendered as a stat tile reading "0 Winners".
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

/** The award phase, from the row's own flags. These are 0/1 NUMBERS here (only
 *  `is_nomination_open` is a real boolean), so they are read for truthiness
 *  rather than compared to `true`. */
function awardPhase(raw: any): AwardFacts["phase"] {
  if (raw?.is_live) return "live";
  if (raw?.is_upcoming) return "upcoming";
  return "past";
}

/** Every award fact, from the award-listing row — the only place they exist. The
 *  microsite payload has none of them (all 170 of its fields were checked; it
 *  carries just `award_id`, which is what ties the two together). */
export function normalizeAwardFacts(raw: any): AwardFacts {
  const ceremonyDate = parseApiDate(raw?.complete_date);
  // Prefer the explicit submission datetime the API sends while nominations are
  // open; fall back to the window's end, which is all a closed award has.
  const closeDate = parseApiDate(raw?.last_submission_datetime) ?? parseApiDate(raw?.nomination_end_date);
  return {
    awardId: Number(raw?.entity_id),
    micrositeEventId: Number(raw?.event_id) > 0 ? Number(raw.event_id) : undefined,
    phase: awardPhase(raw),
    awardUrl: raw?.link || undefined,
    slug: raw?.slug || raw?.url_text || undefined,
    ceremonyDate,
    // House date style, through the same helper the event path uses, so a mail
    // never mixes "24 September, 2026" with the API's "Thu, 24 Sep 2026". The
    // API's own string is the fallback for a row whose ISO date is unusable.
    ceremonyDateLabel: fmtDateLabel(ceremonyDate) ?? (raw?.date_time || undefined),
    // A REAL boolean on this API. `!== false` would make a missing field read as
    // open, so it is coerced positively instead.
    nominationsOpen: raw?.is_nomination_open === true,
    nominationsOpenDate: parseApiDate(raw?.nomination_start_date),
    nominationsCloseDate: closeDate,
    nominationsCloseLabel: fmtDateLabel(closeDate) ?? (raw?.last_submission || undefined),
    nominateUrl: raw?.link_nomination || undefined,
    winnersUrl: raw?.link_winners || undefined,
    winnersEndpoint: raw?.winners_endpoint || undefined,
    editions: usefulCount(raw?.total_editions),
    winners: usefulCount(raw?.total_winners),
    uniqueWinners: usefulCount(raw?.unique_winners),
    categories: usefulCount(raw?.unique_cat_cnt),
  };
}

export interface RawAwardBundle extends RawBundle {
  /** The award-listing row (see `normalizeAwardFacts`). */
  awardRow: any;
}

/** An award as an `EventEntity`, so every existing template and mailer can render
 *  it, plus `award` for the facts an event cannot express.
 *
 *  The bundle MUST have been fetched on the award's `event_id`
 *  (`fetchAwardBundle` enforces that); `normalizeEvent` then does all the real
 *  work unchanged, and this only layers on what the award row knows better. */
export function normalizeAward(portal: string, bundle: RawAwardBundle): EventEntity {
  const row = bundle.awardRow ?? {};
  const base = normalizeEvent(portal, bundle);
  const award = normalizeAwardFacts(row);

  // The award listing's `title` is the public, current name; the microsite's
  // `company_name` disagrees on 43 of 91 rows and is often a stale or unstyled
  // working title ("spott awards 2022", "sharkawards2022", "et retail awards").
  const title = stripHtml(row.title);

  // The ceremony date. The microsite's own event_start_date is the better value
  // when it has one (it carries a time of day); 4 of 51 brandequity awards do
  // not, and for those the award row's `complete_date` is all there is.
  const startDate = base.startDate ?? award.ceremonyDate;
  const endDate = base.endDate ?? award.ceremonyDate;

  // Award-shaped stats FIRST: for a ceremony, editions/categories/winners are the
  // headline numbers, and mailers that cap the row would otherwise cut them in
  // favour of "1 Day". Only counts the API actually published appear.
  const stats: { label: string; value: string }[] = [];
  if (award.editions) stats.push({ value: String(award.editions), label: award.editions > 1 ? "Editions" : "Edition" });
  if (award.categories) stats.push({ value: `${award.categories}`, label: "Categories" });
  if (award.winners) stats.push({ value: `${award.winners}`, label: "Winners" });
  stats.push(...base.stats);

  // The CTA the award itself publishes ("Nominate Now" / "View Winners" /
  // "Winners will be announced soon"), pointed at the matching page rather than
  // at the microsite's registration short_url — a "Nominate Now" button that
  // opens a registration form is the same class of error as the date trap.
  const ctaLabel = stripHtml(row.action_name) || base.ctaLabel;
  const ctaUrl =
    (award.nominationsOpen ? award.nominateUrl : undefined) ??
    award.winnersUrl ??
    award.nominateUrl ??
    base.ctaUrl ??
    award.awardUrl;

  return {
    ...base,
    name: title || base.name,
    edition: base.edition ?? award.editions,
    startDate,
    endDate,
    dateLabel: base.dateLabel ?? award.ceremonyDateLabel,
    // An award row's `address` is a city or venue line and is present where the
    // microsite's is not (42/51 vs 51/51 the other way round on brandequity).
    venue: base.venue ?? (stripHtml(row.address) || undefined),
    ctaLabel,
    ctaUrl,
    micrositeUrl: base.micrositeUrl ?? award.awardUrl,
    stats,
    award,
  };
}

/** Listing row for the award picker. */
export function normalizeAwardListItem(raw: any, portal: string, bucket: AwardListItem["bucket"]): AwardListItem {
  const facts = normalizeAwardFacts(raw);
  return {
    portal,
    awardId: facts.awardId,
    eventId: facts.micrositeEventId,
    hasMicrosite: !!facts.micrositeEventId,
    title: stripHtml(raw.title),
    // NOT `date_str` — see the block comment above.
    dateLabel: facts.ceremonyDateLabel,
    venue: stripHtml(raw.address) || undefined,
    // Award rows send absolute imgv2 urls (120px / 150px squares); the same
    // helper the event path uses passes those through untouched.
    logoUrl: imageUrl(raw.medium_logo || raw.small_logo),
    bucket,
    nominationsOpen: facts.nominationsOpen,
    nominationsCloseLabel: facts.nominationsCloseLabel,
    editions: facts.editions,
    winnersCount: facts.winners,
    categoriesCount: facts.categories,
  };
}
