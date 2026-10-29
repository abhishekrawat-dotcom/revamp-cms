// Canonical Event model. Templates ONLY ever read from this — never from raw API
// shapes. Normalizers (see normalize.ts) map the ET API payloads onto this.

export interface Speaker {
  id: number;
  name: string;
  designation: string;
  company: string;
  photoUrl?: string; // resolved, resizable CDN url
  group?: string; // e.g. "Keynote Speakers", "Speakers"
  weightage: number; // a position index (1,2,3,…) — LOWER is earlier; matches the site's own order
  linkedin?: string;
}

export interface Sponsor {
  id: number;
  title: string;
  logoUrl?: string; // resolved CDN url
  tier: string; // group_name, e.g. "Presenting Partners"
  url?: string;
  weightage: number; // a position index (1,2,3,…) — LOWER is earlier; matches the site's own order
}

export interface SponsorTier {
  tier: string;
  sponsors: Sponsor[];
}

export interface Session {
  id: number;
  title: string;
  start?: string;
  end?: string;
  description?: string;
  speakers: Speaker[];
}

/** The facts an AWARD has and an event cannot express. Hangs off `EventEntity`
 *  as an optional sub-object (see `EventEntity.award`) rather than living in a
 *  parallel entity type, because every template and mailer is a function of
 *  `EventEntity`: a separate type would mean none of the 12 existing sends could
 *  render an award at all, while an optional sub-object means they all can, and
 *  one that reads `event.award?.nominationsCloseLabel` can print "nominations
 *  close on 15 August, 2026" without any other part of the model changing.
 *
 *  A sub-object rather than flattened fields, because the shape is also the
 *  answer to "is this an award?" (`if (event.award)`) — and because an award's
 *  submission deadline sitting at the top level next to `dateLabel` is an
 *  invitation to print the deadline as the event date. They are deliberately
 *  not neighbours. */
export interface AwardFacts {
  /** The award-listing row's `entity_id` — identifies the AWARD. */
  awardId: number;
  /** The award-listing row's `event_id` — the microsite the content came from.
   *  Kept so a caller can re-fetch; never pass `awardId` to a microsite call. */
  micrositeEventId?: number;

  phase: "upcoming" | "live" | "past";
  /** The award's own public page (`link`), distinct from the microsite. */
  awardUrl?: string;
  slug?: string;

  /** The CEREMONY — when the award is given. Never the submission deadline. */
  ceremonyDate?: string;
  ceremonyDateLabel?: string;

  /** A real boolean on this API (unlike the event flags, which are "1"/1). */
  nominationsOpen: boolean;
  nominationsOpenDate?: string; // nomination_start_date
  nominationsCloseDate?: string; // nomination_end_date / last_submission_datetime
  nominationsCloseLabel?: string; // "15 August, 2026" — the DEADLINE, not the event
  nominateUrl?: string; // link_nomination
  winnersUrl?: string; // link_winners
  /** Relative path the API offers for the winners list. Nothing here calls it. */
  winnersEndpoint?: string;

  editions?: number; // total_editions, omitted when 0
  winners?: number; // total_winners
  uniqueWinners?: number; // unique_winners
  categories?: number; // unique_cat_cnt
}

export interface EventEntity {
  portal: string;
  entityId: number;

  name: string;
  edition?: number; // parsed from name/description when present
  tagline?: string; // synopsis
  description?: string;
  hashtag: string; // derived from brand + year when API has none

  startDate?: string; // ISO
  endDate?: string;
  dateLabel?: string; // human "10-13 September, 2026"
  totalDays?: number;

  venue?: string;
  city?: string;

  presenter?: string; // presenting sponsor, if resolvable
  ctaLabel: string;
  ctaUrl?: string; // short_url

  logoUrl?: string;
  keyVisualUrl?: string; // background image (hero banner or promo image)
  keyVisualMode?: "hero" | "wash"; // hero = clean banner shown as-is; wash = blur+tint a busy poster
  /** ONEWORLD PORT (owner C): the event's composed mail banner — the site's hero picture with its logo unit, date
   *  and venue drawn in, 750px wide — set by Oneworld only while it is current for the event's inputs. Every
   *  mailer's top banner defaults to it over the bare key visual; absent, every mailer is the platform's. */
  bannerUrl?: string;
  micrositeUrl?: string; // public event page (branding_url) — what banners/logos link to

  // ---- website theme (so a mailer can match the event's own microsite) ----
  siteAccent?: string; // accent hex parsed out of the API's `themecolor` blob
  siteTheme?: "dark" | "light"; // the microsite's own light/dark mode

  whoShouldAttend: string[];
  keyPoints: string[];
  whyJoin: string[];

  stats: { label: string; value: string }[];

  speakers: Speaker[];
  sponsorTiers: SponsorTier[];
  sessions: Session[];

  /** Present ONLY when this entity is an award (see `AwardFacts`). Absent on
   *  every event, so existing templates are unaffected and rule 7 holds: a
   *  section keyed on it renders nothing for an event. */
  award?: AwardFacts;
}

// Lightweight listing row (for the portal -> event dropdown).
export interface EventListItem {
  entityId: number;
  title: string;
  dateLabel?: string;
  venue?: string;
  logoUrl?: string;
  speakersCount: number;
  bucket: "active" | "upcoming" | "past";
  portal: string;
  /** ET's IP-vs-sponsored flag on the listing row: 1 = ET's own event, 2 = a
   *  client / sponsored event, 0 = unclassified. Drives the Events-vs-Client
   *  split — the Events tab shows everything that is not a client (≠2), the
   *  Client tab auto-lists the clients (=2). */
  ownership?: number;
  /** True when this client card was added by hand (an off-listing microsite),
   *  as opposed to auto-listed from event-listing. Only hand-added cards can be
   *  removed from the Client shelf. Absent/false on feed rows. */
  manual?: boolean;
}

/** Listing row for the portal -> AWARD picker.
 *
 *  Deliberately NOT an `EventListItem` and deliberately without an `entityId`
 *  field: an award row carries two ids and the microsite calls only accept one
 *  of them, so a single field called `entityId` is the whole bug waiting to
 *  happen. `awardId` identifies the award; `eventId` is what a microsite fetch
 *  takes. Not being assignable to `EventListItem` is the point — an award cannot
 *  drift into a code path that would then fetch content on the wrong id. */
export interface AwardListItem {
  portal: string;
  awardId: number;
  eventId?: number;
  /** True when `eventId` resolved — i.e. this award has content to render. */
  hasMicrosite: boolean;

  title: string;
  /** The CEREMONY date. The API's own `date_str` is NOT used: on rows with
   *  nominations open it holds the submission deadline, not the event date. */
  dateLabel?: string;
  venue?: string;
  logoUrl?: string;
  bucket: "active" | "upcoming" | "past";

  nominationsOpen: boolean;
  nominationsCloseLabel?: string;
  editions?: number;
  winnersCount?: number;
  categoriesCount?: number;
}
