// Per-portal brand kits. The ET APIs do NOT return usable brand tokens
// (themecolor is junk, only font_family is reliable), so the visual identity
// for each portal is maintained here and selected by the `portal` header value.

export interface BrandKit {
  portal: string; // matches the API `portal` header value
  name: string; // display name of the portal/brand
  presenter?: string; // default "presented by" line if not overridden per-event
  hashtagBase: string; // e.g. "ETBWS" -> "#ETBWS26"
  fontFamily: string;
  colors: {
    ink: string; // primary text
    inkSoft: string; // secondary text
    surface: string; // card / panel background
    bgFrom: string; // background gradient start
    bgTo: string; // background gradient end
    primary: string; // brand primary
    accent: string; // CTA / highlight accent
    accentInk: string; // text on accent
    tierChip: string; // sponsor tier / role label chip
  };
  // Optional full-bleed background artwork (data URI or file path). Falls back
  // to the gradient when absent. Swap in the real event artwork here.
  backgroundImage?: string;
  /** Public RASTER logo for the portal, used in mailer logo bars. The portal
   *  sites serve SVG mastheads, which email clients don't render, so these are
   *  the verified PNG/JPG equivalents. */
  logoUrl?: string;
  /** Light-ink variant, for mailers on a dark card. */
  logoLightUrl?: string;
}

// Verified public rasters (checked 200 + image content-type). ET Infra and ETBFSI
// publish an SVG masthead only — those portals fall back to the name as text,
// which the logo bar renders when there is no image.
/** Where the rasterised mastheads are published. Mail is read outside this app, so
 *  the logo URL must be absolute and publicly reachable: point MAILER_ASSET_BASE at
 *  wherever you host `assets/logos/` (a CDN bucket, or the app's own public URL).
 *
 *  Resolution order: an explicit MAILER_ASSET_BASE always wins; on Vercel the
 *  deployment's own URL is used, since the mastheads ship in `public/` and are
 *  served from that host — otherwise every mailer would quietly carry
 *  `http://localhost` logo URLs that only work on the machine that made them.
 *  Falls back to the local server, which is right for previewing. */
function assetBase(): string {
  if (process.env.MAILER_ASSET_BASE) return process.env.MAILER_ASSET_BASE;
  /* ONEWORLD PORT: the app's own public address — mastheads and icons are served from it */
  if (process.env.ONEWORLD_PUBLIC_BASE !== "") return process.env.ONEWORLD_PUBLIC_BASE || "https://revamp-cms--revamp-cms.us-east4.hosted.app";
  // Prefer the stable production domain over the per-deployment preview URL.
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  if (vercel) return `https://${vercel}`;
  return `http://localhost:${process.env.PORT || 5173}`;
}
export const ASSET_BASE = assetBase().replace(/\/+$/, "");

/** Portals with a rasterised masthead in assets/logos/. The portals publish SVG
 *  only, which no email client renders, so `tools/logos.mjs` converts each one to a
 *  transparent PNG at 2x the display cap. Re-run that tool when ET refreshes a
 *  masthead; add the portal here when a new PNG appears.
 *  `shipping` is absent on purpose: its masthead URL returns a server error, so it
 *  falls back to the portal name set in type. */
/** Portals with a rasterised masthead in assets/logos/. The portals publish SVG
 *  only, which no email client renders, so `tools/logos.mjs` converts each one to a
 *  transparent PNG at 2x the display cap. Re-run that tool when ET refreshes a
 *  masthead. `shipping` is absent on purpose: its masthead URL returns a server
 *  error, so it falls back to the portal name set in type. */
const LOGO_PORTALS = [
  "agriculture", "auto", "b2b", "bfsi", "brandequity", "cfo",
  "chemicals", "cio", "ciome", "ciosea", "ciso", "climate",
  "construction", "crypto", "datacenters", "defence", "drones", "education",
  "electronics", "energy", "energymea", "enterpriseai", "entrepreneur", "facilities",
  "food", "gcc", "geospatial", "government", "health", "hospitality",
  "hr", "hrme", "hrsea", "infra", "jewellery", "legal",
  "machinetools", "manufacturing", "masterclass", "packaging", "pharma", "rajasthan",
  "realty", "retail", "safety", "salon", "sports", "startup",
  "supplychain", "sustainability", "techmonk", "telecom", "textile", "travel",
  "wastemanagement", "workplace",
];

/** …and the light-ink variant (the portals' own footer logo), for mailers on a dark
 *  card. Four portals publish no footer variant; on a dark background their
 *  dark-ink masthead gets a white plate behind it instead. */
const LOGO_LIGHT_PORTALS = [
  "agriculture", "auto", "b2b", "bfsi", "brandequity", "cfo",
  "chemicals", "cio", "ciome", "ciosea", "ciso", "climate",
  "construction", "crypto", "datacenters", "defence", "drones", "education",
  "electronics", "energy", "energymea", "enterpriseai", "entrepreneur", "facilities",
  "food", "gcc", "geospatial", "government", "health", "hospitality",
  "hr", "hrme", "hrsea", "infra", "jewellery", "legal",
  "machinetools", "manufacturing", "packaging", "pharma", "rajasthan", "realty",
  "retail", "salon", "sports", "supplychain", "sustainability", "telecom",
  "textile", "travel", "wastemanagement", "workplace",
];

/* ONEWORLD PORT: the mastheads are Oneworld's own (templates/_shared/img/portals). Their dark-ground versions
   keep the red ET square red — ET's logo rule — where the portals' own footer variants whitened it; and every
   one of the 56 has one, so LOGO_LIGHT_PORTALS is not used for the address. */
void LOGO_LIGHT_PORTALS;
const PORTAL_LOGOS: Record<string, string> = Object.fromEntries(
  LOGO_PORTALS.map((p) => [p, `${ASSET_BASE}/templates/_shared/img/portals/${p}.png`]),
);

const PORTAL_LOGOS_LIGHT: Record<string, string> = Object.fromEntries(
  LOGO_PORTALS.map((p) => [p, `${ASSET_BASE}/templates/_shared/img/portals/${p}-light.png`]),
);



const BRANDS: Record<string, BrandKit> = {
  brandequity: {
    portal: "brandequity",
    name: "ET Brand Equity",
    presenter: "ET BrandEquity",
    hashtagBase: "ETBWS",
    fontFamily: "'Inter', system-ui, sans-serif",
    colors: {
      ink: "#151226",
      inkSoft: "#5a5570",
      surface: "#ffffff",
      bgFrom: "#2a1a5e",
      bgTo: "#7b3fe4",
      primary: "#6d28d9",
      accent: "#ffd23f",
      accentInk: "#1a1330",
      tierChip: "#ff5da2",
    },
  },
  cio: {
    portal: "cio",
    name: "ETCIO",
    presenter: "ETCIO",
    hashtagBase: "ETCIO",
    fontFamily: "'Inter', system-ui, sans-serif",
    colors: {
      ink: "#1b1400",
      inkSoft: "#6b5a33",
      surface: "#fffaf0",
      bgFrom: "#ff8a1e",
      bgTo: "#ffb347",
      primary: "#e2621b",
      accent: "#5b2a86",
      accentInk: "#ffffff",
      tierChip: "#5b2a86",
    },
  },
  infra: {
    portal: "infra",
    name: "ET Infra",
    presenter: "ET Infra",
    hashtagBase: "ETInfra",
    fontFamily: "'Poppins', 'Inter', system-ui, sans-serif",
    colors: {
      ink: "#141414", inkSoft: "#5b5b5b", surface: "#ffffff",
      bgFrom: "#0b1f3a", bgTo: "#20456e", primary: "#c8102e",
      accent: "#f5b301", accentInk: "#1a1330", tierChip: "#c8102e",
    },
  },
  ciso: {
    portal: "ciso",
    name: "ETCISO",
    presenter: "ETCISO",
    hashtagBase: "ETCISOAC",
    fontFamily: "'Inter', system-ui, sans-serif",
    colors: {
      ink: "#04283a",
      inkSoft: "#3f6b82",
      surface: "#f4fbff",
      bgFrom: "#0a5c8a",
      bgTo: "#12a5c8",
      primary: "#0a7ea4",
      accent: "#f5a623",
      accentInk: "#04283a",
      tierChip: "#0a7ea4",
    },
  },
};

const FALLBACK: BrandKit = {
  portal: "default",
  name: "Economic Times",
  presenter: "The Economic Times",
  hashtagBase: "ETEvent",
  fontFamily: "'Inter', system-ui, sans-serif",
  colors: {
    ink: "#111827",
    inkSoft: "#6b7280",
    surface: "#ffffff",
    bgFrom: "#0f172a",
    bgTo: "#334155",
    primary: "#c8102e",
    accent: "#f5a623",
    accentInk: "#1a1330",
    tierChip: "#c8102e",
  },
};

export function getBrand(portal: string): BrandKit {
  const kit = BRANDS[portal];
  if (kit) return { ...kit, logoUrl: PORTAL_LOGOS[portal], logoLightUrl: PORTAL_LOGOS_LIGHT[portal] };
  // Portals without a hand-tuned kit still have a real display name in PORTALS —
  // use it, so an ETHRWorld mailer signs off as ETHRWorld and not "Economic Times".
  const name = PORTALS.find((p) => p.portal === portal)?.name;
  return { ...FALLBACK, portal, name: name ?? FALLBACK.name, presenter: name ?? FALLBACK.presenter,
    logoUrl: PORTAL_LOGOS[portal], logoLightUrl: PORTAL_LOGOS_LIGHT[portal] };
}

// Portals offered in the front-end dropdown. Configured brands get their real
// name; the rest fall back to a neutral kit but still work against the APIs.
export const PORTALS: { portal: string; name: string; configured: boolean }[] = [
  { portal: "brandequity", name: "ET BrandEquity", configured: true },
  { portal: "cio", name: "ETCIO", configured: true },
  { portal: "ciso", name: "ETCISO", configured: true },
  { portal: "infra", name: "ET Infra", configured: true },
  { portal: "cfo", name: "ETCFO", configured: false },
  { portal: "hr", name: "ETHRWorld", configured: false },
  { portal: "retail", name: "ETRetail", configured: false },
  { portal: "health", name: "ETHealthworld", configured: false },
  { portal: "auto", name: "ETAuto", configured: false },
  { portal: "telecom", name: "ETTelecom", configured: false },
  { portal: "bfsi", name: "ETBFSI", configured: false },
  { portal: "energy", name: "ETEnergyworld", configured: false },
  { portal: "government", name: "ETGovernment", configured: false },
  { portal: "legal", name: "ETLegalWorld", configured: false },
  { portal: "realty", name: "ETRealty", configured: false },
  { portal: "education", name: "ET Education", configured: false },
  { portal: "manufacturing", name: "ET Manufacturing", configured: false },
  { portal: "supplychain", name: "ET Supply Chain", configured: false },
  { portal: "travel", name: "ETTravelWorld", configured: false },
  { portal: "hospitality", name: "ET HospitalityWorld", configured: false },
  { portal: "b2b", name: "ET B2B", configured: false },
  // Regional editions, verticals and masterclasses — every slug below was checked
  // against the listing API. Those with no events right now still resolve, so they
  // sit at the end of the picker rather than being hidden.
  { portal: "masterclass", name: "ET Masterclass", configured: false },
  { portal: "hrsea", name: "ETHRWorld Southeast Asia", configured: false },
  { portal: "hrme", name: "ETHRWorld Middle East", configured: false },
  { portal: "ciosea", name: "ETCIO Southeast Asia", configured: false },
  { portal: "ciome", name: "ETCIO Middle East", configured: false },
  { portal: "pharma", name: "ETPharma", configured: false },
  { portal: "gcc", name: "ET GCC", configured: false },
  { portal: "enterpriseai", name: "ET EnterpriseAI", configured: false },
  { portal: "techmonk", name: "TechMonk", configured: false },
  { portal: "entrepreneur", name: "ET Entrepreneur", configured: false },
  { portal: "datacenters", name: "ET Data Centers", configured: false },
  { portal: "electronics", name: "ET Electronics", configured: false },
  { portal: "energymea", name: "ET EnergyWorld MEA", configured: false },
  { portal: "sustainability", name: "ET Sustainability", configured: false },
  { portal: "workplace", name: "ET Workplace", configured: false },
  { portal: "agriculture", name: "ET Agriculture", configured: false },
  { portal: "chemicals", name: "ET Chemicals", configured: false },
  { portal: "climate", name: "ET Climate", configured: false },
  { portal: "construction", name: "ET Construction", configured: false },
  { portal: "crypto", name: "ET Crypto", configured: false },
  { portal: "defence", name: "ET Defence", configured: false },
  { portal: "drones", name: "ET Drones", configured: false },
  { portal: "facilities", name: "ET Facilities", configured: false },
  { portal: "food", name: "ET Food", configured: false },
  { portal: "geospatial", name: "ET Geospatial", configured: false },
  { portal: "jewellery", name: "ET Jewellery", configured: false },
  { portal: "machinetools", name: "ET MachineTools", configured: false },
  { portal: "packaging", name: "ET Packaging", configured: false },
  { portal: "rajasthan", name: "ET Rajasthan", configured: false },
  { portal: "safety", name: "ET Safety", configured: false },
  { portal: "salon", name: "ET Salon", configured: false },
  { portal: "shipping", name: "ET Shipping", configured: false },
  { portal: "sports", name: "ET Sports", configured: false },
  { portal: "startup", name: "ET Startup", configured: false },
  { portal: "textile", name: "ETTextile", configured: false },
  { portal: "wastemanagement", name: "ET Waste Management", configured: false },
];
