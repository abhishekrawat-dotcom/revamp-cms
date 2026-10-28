import type { EventEntity } from "../model/types.ts";
import type { BrandKit } from "../brand/index.ts";
import { esc } from "../templates/base.ts";

// Email HTML is NOT web HTML: no flexbox/grid, no external CSS, no webfont
// guarantees, and Outlook renders with Word. Everything here is a
// role="presentation" table with inline styles, a fixed 750px content column,
// and a small <style> block whose only job is the mobile stack + type scale.

export const WIDTH = 750; // content column width
export const PAD = 32; // horizontal padding of a content row
export const INNER = WIDTH - PAD * 2; // usable width inside a padded row

export interface Palette {
  pageBg: string; cardBg: string; ink: string; inkSoft: string; line: string;
  tileBg: string; heroFrom: string; heroTo: string; heroInk: string;
  accent: string; accentInk: string; primary: string; tier: string;
  /** Accent-tinted section background — what makes the site's colour carry the
   *  design rather than just tint a few words. */
  wash: string;
  /** Border for cards sitting on `wash`. */
  cardEdge: string;
  /** Footer band. */
  footBg: string;
  /** Accent, guaranteed legible as TEXT on the card / on tiles / in the footer. */
  onCard: string;
  onTile: string;
  onFoot: string;
  /** Secondary copy, guaranteed legible on tiles / washes / the footer band. */
  inkTile: string;
  inkWash: string;
  inkFoot: string;
}

/** Context handed to every block renderer. */
export interface RenderCtx {
  event: EventEntity;
  brand: BrandKit;
  p: Palette;
  font: string;
  /** true while rendering for the studio — enables in-place edit handles */
  editor?: boolean;
  /** Leave content images unwrapped. The wrapper exists only to stop Gmail and
   *  Outlook.com painting a save button over every portrait; a sender who would
   *  rather have the cleanest possible markup can turn it off and accept the
   *  button. */
  bareImages?: boolean;
}

// ---- colour helpers ---------------------------------------------------------

/** Multiply a hex colour's channels — used to derive the hero gradient's far end. */
export function shade(hex: string, f: number): string {
  const m = String(hex).match(/^#?([0-9a-f]{6})$/i);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
    .map((v) => Math.max(0, Math.min(255, Math.round(v * f))).toString(16).padStart(2, "0"));
  return `#${c.join("")}`;
}

const isHex = (s?: string) => !!s && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s);

const chan = (hex: string): [number, number, number] => {
  let h = String(hex).replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/** Perceived brightness 0..1 — decides whether text on a colour must be light or dark. */
export function lum(hex: string): number {
  const [r, g, b] = chan(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** Blend two hex colours. t=0 → a, t=1 → b. Used to derive the accent-tinted
 *  washes and borders that give the mail its designed feel. */
export function mix(a: string, b: string, t: number): string {
  const [r1, g1, b1] = chan(a), [r2, g2, b2] = chan(b);
  const to = (x: number, y: number) => Math.max(0, Math.min(255, Math.round(x + (y - x) * t))).toString(16).padStart(2, "0");
  return `#${to(r1, r2)}${to(g1, g2)}${to(b1, b2)}`;
}

/** WCAG contrast ratio between two hex colours (1 = identical, 21 = black/white). */
export function contrast(a: string, b: string): number {
  const rel = (hex: string) => {
    const [r, g, bl] = chan(hex).map((v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const l1 = rel(a), l2 = rel(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/** Nudge `fg` toward black or white until it is legible on `bg`. Accent colours
 *  are used as TEXT in several places; without this, picking a background close
 *  to the accent makes that text vanish. */
export function readable(fg: string, bg: string, min = 4.5): string {
  if (contrast(fg, bg) >= min) return fg;
  const towards = lum(bg) > 0.5 ? "#000000" : "#ffffff";
  for (let t = 0.12; t <= 1.0001; t += 0.12) {
    const c = mix(fg, towards, t);
    if (contrast(c, bg) >= min) return c;
  }
  // The walk failed, and only now does the assumed direction get questioned —
  // every colour it CAN satisfy is unchanged. `lum()` is a brightness guess, and
  // on a mid-luminance fill it points at the pole that cannot reach AA at all:
  // white on a hot pink tops out at 3.48:1 where black reaches 6.03:1, and this
  // used to ship the white. Walk the other way before giving up, then hand back
  // whichever extreme actually measures better.
  const other = towards === "#000000" ? "#ffffff" : "#000000";
  for (let t = 0.12; t <= 1.0001; t += 0.12) {
    const c = mix(fg, other, t);
    if (contrast(c, bg) >= min) return c;
  }
  return contrast("#1a1a1a", bg) >= contrast("#ffffff", bg) ? "#1a1a1a" : "#ffffff";
}

/** A hex colour, or undefined. Sender-typed colours land in a `style` attribute
 *  and in `bgcolor`, so anything that is not a colour is REFUSED rather than
 *  escaped — the same guard the CTA fill already relies on. */
export function hexColor(v: unknown): string | undefined {
  const s = String(v ?? "").trim();
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s) ? s : undefined;
}

/** A section background the sender picked must still be able to CARRY small text.
 *  A saturated mid-tone — e.g. #e0218a — tops out at 4.42:1 for white and less for
 *  black, so NO ink can reach the 4.5:1 AA-small bar on it, and `readable()` hands
 *  back whichever pole is least-bad (house rule 5 says text can never vanish, but a
 *  4.42:1 label is below AA all the same). Nudge only such trap colours — those
 *  where neither pole clears `min` — toward the pole their better ink already heads
 *  for, just far enough that white or black reaches `target` (a hair over the bar,
 *  so the fitted ink lands with margin). Every colour that already carries text is
 *  returned untouched, so the default path and legible custom colours don't move. */
export function legibleSurface(hex: string, min = 4.5, target = 4.6): string {
  const c = hexColor(hex);
  if (!c) return hex;
  const cw = contrast("#ffffff", c), cb = contrast("#000000", c);
  if (Math.max(cw, cb) >= min) return c;
  const towards = cw >= cb ? "#000000" : "#ffffff";
  let out = c;
  for (let t = 0.04; t <= 1.0001; t += 0.04) {
    out = mix(c, towards, t);
    if (Math.max(contrast("#ffffff", out), contrast("#000000", out)) >= target) return out;
  }
  return out;
}

/** Re-derive a palette for a section that carries its OWN background.
 *
 *  Every ink slot in a palette is measured against the mail's card. Paint one
 *  section a colour the sender picked and none of those measurements describe
 *  the surface that text now sits on — which is exactly how dark figures ended
 *  up on a dark card twice already (house rule 5). So a section with its own
 *  background renders from a palette whose surfaces AND inks are derived from
 *  that colour instead.
 *
 *  Each ink is fitted against all three surfaces the section can paint — the
 *  background itself, the tile shade and the wash — because blocks reuse one ink
 *  across more than one of them (a stat figure on a tile, a session title on the
 *  band, and on a phone the tile dissolves and the figure lands on the band).
 *  The direction of the nudge is taken from the section colour once, so fitting
 *  for one surface can never undo another. */
export function onSurface(p: Palette, bg: string): Palette {
  if (!hexColor(bg)) return p;
  const isDark = lum(bg) < 0.45;
  // The band keeps the sender's colour — `legibleSurface` already guaranteed it
  // carries black OR white at AA — but the tile and the wash are DERIVED shades,
  // and mixing a saturated mid-tone with the accent can land on a colour that
  // NEITHER pole clears: a red band with a blueish accent derives a `#d71a29`
  // tile where black tops out at 4.07:1 and white lower still, and a small caps
  // label on that tile shipped below AA. `lum()` is a brightness guess and on such
  // a colour it points at the pole that cannot reach 4.5 at all (white on red),
  // which is the pole the ink then walked toward.
  //
  // So the ink pole is taken from the band — the one surface that stays put — as
  // whichever of black/white actually measures better ON IT, and every derived
  // surface is nudged toward the opposite pole until that SAME pole clears the
  // target on it too. One ink pole then reads on all three surfaces, so no hue at
  // full saturation can leave a label below AA. A surface that already clears is
  // returned untouched, so legible custom colours (and the tile/wash a safe dark
  // or light band derives) don't move.
  const towards = contrast("#000000", bg) >= contrast("#ffffff", bg) ? "#000000" : "#ffffff";
  const away = towards === "#000000" ? "#ffffff" : "#000000";
  const legibleTile = (s: string, target = 4.6): string => {
    if (contrast(towards, s) >= target) return s;
    let out = s;
    for (let t = 0.04; t <= 1.0001; t += 0.04) {
      out = mix(s, away, t);
      if (contrast(towards, out) >= target) return out;
    }
    return out;
  };
  const tileBg = legibleTile(mix(bg, p.primary, isDark ? 0.16 : 0.1));
  const wash = legibleTile(mix(bg, p.primary, isDark ? 0.1 : 0.06));
  const surfaces = [bg, tileBg, wash];
  const worst = (c: string) => Math.min(...surfaces.map((s) => contrast(c, s)));
  const fit = (c: string, min = 4.5): string => {
    if (worst(c) >= min) return c;
    for (let t = 0.12; t <= 1.0001; t += 0.12) {
      const x = mix(c, towards, t);
      if (worst(x) >= min) return x;
    }
    // Every surface now admits `towards` at the target, so the better pole here is
    // `towards` and it clears — take the better one rather than the one we happened
    // to be walking toward.
    return worst("#000000") >= worst("#ffffff") ? "#000000" : "#ffffff";
  };
  const soft = fit(mix(bg, towards, 0.62), 4.6);
  // The accent is used as TEXT here (headings, times, links), so it is fitted the
  // same way instead of being trusted because it is "the brand colour".
  const accentInk = fit(p.primary);
  return {
    ...p,
    cardBg: bg,
    tileBg,
    wash,
    line: mix(bg, towards, 0.16),
    cardEdge: mix(bg, towards, 0.12),
    ink: fit(p.ink, 4.6),
    inkSoft: soft,
    inkTile: soft,
    inkWash: soft,
    onCard: accentInk,
    onTile: accentInk,
    tier: accentInk,
  };
}

/** Theme mode: "site" follows the event's own microsite, else an explicit override. */
export type ThemeMode = "site" | "light" | "dark";

/** The palette a mailer renders with. When the event's microsite carries a real
 *  accent colour (API `themecolor`), it drives the hero band and highlights so
 *  the mail looks like the event's own site rather than a generic portal template. */
export function resolvePalette(
  brand: BrandKit, event: EventEntity, theme: ThemeMode = "site",
  accentOverride?: string, background?: string,
): Palette {
  const c = brand.colors;
  const site = isHex(accentOverride) ? accentOverride! : (isHex(event.siteAccent) ? event.siteAccent! : undefined);
  const primary = site || c.primary;

  // An explicit background colour takes over the whole mail: the card becomes
  // that colour, the surround is a shade of it, and text/borders/washes are
  // derived so the result stays legible whatever the user picks.
  if (isHex(background)) {
    const bg = background!;
    const isDark = lum(bg) < 0.45;
    const towards = isDark ? "#ffffff" : "#000000";
    const tile = mix(bg, primary, isDark ? 0.16 : 0.1);
    const foot = mix(bg, "#000000", isDark ? 0.22 : 0.04);
    const wash0 = mix(bg, primary, isDark ? 0.1 : 0.06);
    const soft0 = readable(mix(bg, towards, 0.62), bg, 4.6);
    return {
      onCard: readable(primary, bg),
      onTile: readable(primary, tile),
      onFoot: readable(primary, foot),
      inkTile: readable(soft0, tile, 4.6),
      inkWash: readable(soft0, wash0, 4.6),
      inkFoot: readable(soft0, foot, 4.6),
      pageBg: mix(bg, "#000000", isDark ? 0.38 : 0.07),
      cardBg: bg,
      ink: readable(isDark ? "#ffffff" : c.ink, bg, 4.6),
      inkSoft: readable(mix(bg, towards, 0.62), bg, 4.6),
      line: mix(bg, towards, 0.16),
      tileBg: mix(bg, primary, isDark ? 0.16 : 0.1),
      wash: mix(bg, primary, isDark ? 0.1 : 0.06),
      cardEdge: mix(bg, towards, 0.12),
      footBg: mix(bg, "#000000", isDark ? 0.22 : 0.04),
      heroFrom: primary,
      heroTo: shade(primary, 0.6),
      heroInk: lum(primary) > 0.62 ? c.ink : "#ffffff",
      accent: c.accent,
      accentInk: c.accentInk,
      primary,
      tier: primary,
    };
  }

  const dark = theme === "dark" || (theme === "site" && event.siteTheme === "dark");
  // Every surface is derived from the site colour, so the mail reads as the
  // event's own design rather than a white template with coloured words.
  const cardBg = dark ? mix(primary, "#0f1220", 0.94) : "#ffffff";
  const pageBg = dark ? mix(primary, "#07080f", 0.9) : mix(primary, "#eef1f6", 0.93);
  const tileBg = dark ? mix(primary, cardBg, 0.86) : mix(primary, "#ffffff", 0.9);
  const footBg = dark ? mix(primary, "#0a0c15", 0.88) : mix(primary, "#f4f6fa", 0.9);
  const wash0 = dark ? mix(primary, cardBg, 0.9) : mix(primary, "#ffffff", 0.945);
  const soft0 = readable(dark ? mix(primary, "#c3c9db", 0.86) : c.inkSoft, cardBg, 4.6);
  return {
    onCard: readable(primary, cardBg),
    onTile: readable(primary, tileBg),
    onFoot: readable(primary, footBg),
    inkTile: readable(soft0, tileBg, 4.6),
    inkWash: readable(soft0, wash0, 4.6),
    inkFoot: readable(soft0, footBg, 4.6),
    pageBg,
    cardBg,
    ink: readable(dark ? "#ffffff" : c.ink, cardBg, 4.6),
    inkSoft: readable(dark ? mix(primary, "#c3c9db", 0.86) : c.inkSoft, cardBg, 4.6),
    line: dark ? mix(primary, cardBg, 0.78) : mix(primary, "#e6eaf2", 0.9),
    tileBg,
    wash: dark ? mix(primary, cardBg, 0.9) : mix(primary, "#ffffff", 0.945),
    cardEdge: dark ? mix(primary, cardBg, 0.7) : mix(primary, "#ffffff", 0.82),
    footBg,
    heroFrom: site || c.bgFrom,
    heroTo: site ? shade(site, 0.6) : c.bgTo,
    heroInk: lum(site || c.bgFrom) > 0.62 ? c.ink : "#ffffff",
    accent: c.accent,
    accentInk: c.accentInk,
    primary,
    tier: primary,
  };
}

/** The ET house mailers (see the reference templates in the repo root) use a
 *  Verdana stack with no webfonts at all — matched here so generated mail sits
 *  alongside what the team already sends, and renders identically everywhere. */
export function fontStack(_brand: BrandKit): string {
  return "Verdana, Geneva, 'Helvetica Neue', Helvetica, Arial, sans-serif";
}

// ---- small formatters -------------------------------------------------------

export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/** "2026-09-10 09:30:00" -> "9:30 AM" */
export function hhmm(raw?: string): string {
  if (!raw) return "";
  const d = new Date(String(raw).replace(" ", "T"));
  if (isNaN(d.getTime())) return "";
  const h = d.getHours(), m = d.getMinutes();
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}

/** Whole days until the event starts (undefined when unknown / already started). */
export function daysToGo(event: EventEntity): number | undefined {
  if (!event.startDate) return undefined;
  const d = new Date(event.startDate.replace(" ", "T"));
  if (isNaN(d.getTime())) return undefined;
  const days = Math.ceil((d.getTime() - Date.now()) / 86400000);
  return days > 0 ? days : undefined;
}

export const whereOf = (e: EventEntity) => e.venue || e.city || "";
export const dateVenue = (e: EventEntity) => [e.dateLabel, whereOf(e)].filter(Boolean).join("  •  ");
/** Where banners, logos and the footer link to. */
export const siteUrl = (e: EventEntity) => e.micrositeUrl || e.ctaUrl || "";

// ---- structural primitives (each returns one or more <tr>) -------------------

/** A padded content row inside the card. `pt`/`pb` tweak only the vertical
 *  padding so the horizontal gutter always stays in step with PAD. */
export function row(inner: string, o: { bg?: string; align?: string; pt?: number; pb?: number; id?: string } = {}): string {
  const pad = `${o.pt ?? 24}px ${PAD}px ${o.pb ?? 24}px`;
  const bg = o.bg ? ` bgcolor="${o.bg}"` : "";
  return `<tr${o.id ? ` data-block-id="${o.id}"` : ""}><td class="pad" align="${o.align || "left"}"${bg} style="padding:${pad};${o.bg ? `background-color:${o.bg};` : ""}">${inner}</td></tr>`;
}

/** A full-bleed row (no horizontal padding) — banners and colour bands. */
export function bleedRow(inner: string, o: { bg?: string; id?: string } = {}): string {
  const bg = o.bg ? ` bgcolor="${o.bg}"` : "";
  return `<tr${o.id ? ` data-block-id="${o.id}"` : ""}><td align="center"${bg} style="padding:0;${o.bg ? `background-color:${o.bg};` : ""}">${inner}</td></tr>`;
}

export interface TextOpts {
  size?: number; weight?: number; color?: string; lh?: number;
  align?: string; mt?: number; mb?: number; upper?: boolean; ls?: string;
  italic?: boolean; underline?: boolean;
  /** the caller already escaped and parsed the copy (see inlineCopy) */
  raw?: boolean;
  /** editor-only handle, "blockId|propPath" — lets the studio edit this text in place */
  ed?: string;
}

export function text(html: string, ctx: RenderCtx, o: TextOpts = {}): string {
  const st = [
    `margin:${o.mt ?? 0}px 0 ${o.mb ?? 0}px`,
    `font-family:${ctx.font}`,
    `font-size:${o.size ?? 15}px`,
    `line-height:${o.lh ?? 1.55}`,
    `font-weight:${o.weight ?? 400}`,
    `color:${o.color ?? ctx.p.inkSoft}`,
    `text-align:${o.align || "left"}`,
    o.upper ? "text-transform:uppercase" : "",
    o.italic ? "font-style:italic" : "",
    o.underline ? "text-decoration:underline" : "",
    o.ls ? `letter-spacing:${o.ls}` : "",
  ].filter(Boolean).join(";");
  return `<div${o.ed ? ` data-ed="${esc(o.ed)}"` : ""} style="${st}">${html}</div>`;
}

/** Headings always take plain text (block props flow straight in), so escape. */
export function heading(t: string, ctx: RenderCtx, o: TextOpts = {}): string {
  return `<div class="h2"${o.ed ? ` data-ed="${esc(o.ed)}"` : ""} style="margin:0 0 ${o.mb ?? 12}px;font-family:${ctx.font};font-size:${o.size ?? 24}px;line-height:1.22;font-weight:${o.weight ?? 800};color:${o.color ?? ctx.p.ink};text-align:${o.align || "left"};letter-spacing:-.01em">${o.raw ? t : esc(t)}</div>`;
}

export function eyebrow(t: string, ctx: RenderCtx, align = "left"): string {
  return `<div style="margin:0 0 8px;font-family:${ctx.font};font-size:11.5px;font-weight:800;letter-spacing:.09em;text-transform:uppercase;color:${ctx.p.onCard};text-align:${align}">${esc(t)}</div>`;
}

/** Paragraphs from a plain-text field: newline-separated. */
/** Inline emphasis for copy fields. The text is escaped FIRST and only these
 *  patterns are then turned into tags, so no markup a sender types can reach the
 *  mail — `**bold**`, `*italic*`, `__underline__`, `~~strike~~`, `==highlight==`
 *  and `[label](https://…)`. Anything else stays literal. */
export function inlineCopy(raw: string, ctx: RenderCtx): string {
  const p = ctx.p;
  return esc(String(raw ?? ""))
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>")
    .replace(/__([^_]+)__/g, `<span style="text-decoration:underline">$1</span>`)
    .replace(/~~([^~]+)~~/g, `<span style="text-decoration:line-through">$1</span>`)
    .replace(/==([^=]+)==/g, `<span style="background-color:${p.wash};color:${readable(p.ink, p.wash)};padding:0 3px">$1</span>`)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      `<a href="$2" target="_blank" style="color:${p.onCard};font-weight:700;text-decoration:underline">$1</a>`);
}

export function paragraphs(copy: string, ctx: RenderCtx, o: TextOpts = {}): string {
  const parts = String(copy || "").split(/\n+/).map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return "";
  // Each paragraph carries its own index so in-place edits map back to one line.
  return parts.map((s, i) => text(inlineCopy(s, ctx), ctx,
    { ...o, mt: i ? 12 : (o.mt ?? 0), ed: o.ed ? `${o.ed}#${i}` : undefined })).join("");
}

export interface CtaSkin {
  /** Fill. Anything that is not a hex falls back to the palette accent. */
  bg?: string;
  /** Label colour. Empty = worked out from the fill. Whatever is set still gets
   *  nudged until it clears AA — the choice is honoured, illegibility is not. */
  ink?: string;
  /** Corner radius in px. 0 square · 8 house default · 99 pill. */
  radius?: number | string;
  /** Padding preset. */
  size?: "sm" | "md" | "lg" | string;
  fontSize?: number | string;
  /** Solid fill, or an outline that sits on the mailer background. */
  variant?: "solid" | "outline" | string;
  border?: string;
  borderWidth?: number | string;
  /** "yes" makes the button span the column — the usual mobile-first CTA. */
  full?: string;
  caps?: string;
}

const HEX6 = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const hexOr = (v: unknown, fallback: string) => (HEX6.test(String(v ?? "")) ? String(v) : fallback);

/** Every decoration here is one an email client actually honours: background and
 *  border on the cell, padding and size on the anchor. Deliberately absent:
 *  box-shadow and gradients (widely dropped), and any transition (never runs).
 *  Outlook on Windows additionally squares off the radius — noted in the UI. */
export function ctaButton(label: string, url: string | undefined, ctx: RenderCtx, align = "left", skin: CtaSkin = {}): string {
  const p = ctx.p;
  // Centring needs BOTH margins auto — setting only margin-right left the button
  // hugging the left edge even though the block said "centre".
  const ml = align === "center" || align === "right" ? "auto" : "0";
  const mr = align === "center" || align === "left" ? "auto" : "0";

  const outline = String(skin.variant || "solid") === "outline";
  const accent = hexOr(skin.bg, p.accent);
  // An outline button's label sits on the MAILER's surface, not on a fill — so
  // that is the surface its contrast has to be checked against.
  const surface = outline ? p.cardBg : accent;
  const fill = outline ? "transparent" : accent;
  // House rule 5: contrast is checked, not eyeballed. A chosen ink is respected
  // when it already clears AA and pulled toward black/white when it does not, so
  // no combination of pickers can ship an unreadable button.
  const ink = readable(hexOr(skin.ink, outline ? accent : (p.accentInk || "#ffffff")), surface);
  const bw = outline ? Math.max(1, Math.min(6, Number(skin.borderWidth) || 2)) : Math.max(0, Math.min(6, Number(skin.borderWidth) || 0));
  const bc = hexOr(skin.border, outline ? accent : accent);
  const r = Math.max(0, Math.min(99, Number.isFinite(Number(skin.radius)) ? Number(skin.radius) : 8));
  const PAD: Record<string, string> = { sm: "10px 22px", md: "15px 34px", lg: "19px 46px" };
  const pad = PAD[String(skin.size || "md")] || PAD.md;
  const fs = Math.max(10, Math.min(28, Number(skin.fontSize) || 14));
  const caps = String(skin.caps || "no") === "yes";
  const full = String(skin.full || "no") === "yes";
  const border = bw > 0 ? `border:${bw}px solid ${bc};` : "";

  return `
  <table role="presentation" ${full ? `width="100%" ` : ""}cellpadding="0" cellspacing="0" border="0" align="${align}" style="${full ? "width:100%;" : ""}margin-left:${ml};margin-right:${mr}"><tr>
    <td ${outline ? "" : `bgcolor="${fill}" `}align="center" style="border-radius:${r}px;${outline ? "" : `background-color:${fill};`}${border}">
      <a href="${esc(url || "#")}" target="_blank" style="display:${full ? "block" : "inline-block"};padding:${pad};font-family:${ctx.font};font-size:${fs}px;font-weight:700;letter-spacing:${caps ? ".08em" : ".02em"};${caps ? "text-transform:uppercase;" : ""}color:${ink};text-decoration:none;border-radius:${r}px">${esc(label)}</a>
    </td>
  </tr></table>`;
}

/** Rows of `cols` fixed-width cells, each row CENTRED. Centring (rather than a
 *  filler cell on the right) is what stops a last row of 1-2 items reading as a
 *  ragged left-aligned stub — the classic "raw" look on partner grids. */
export function gridRows<T>(
  items: T[], cols: number, w: number, gut: number, cell: (t: T) => string,
  // `gapY` exists for one layout: a checkerboard has to have NO gap between its
  // rows or it stops reading as a checkerboard. It defaults to the 18px every
  // other grid has always used, so no existing document moves by a pixel.
  o: { mobile?: "one" | "two"; gapY?: number } = {},
): string {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += cols) rows.push(items.slice(i, i + cols));
  // "two" keeps two tiles per row on a phone; "one" stacks them full width.
  // Two-up only helps when a row actually holds two tiles — a lone tile at 48%
  // reads as a mistake, so it goes full width like the one-up layout.
  const cls = (r: unknown[]) => (o.mobile === "two" && r.length > 1 ? "half" : "stack");
  const tcls = o.mobile === "two" ? ' class="gridt"' : "";
  // One gutter value does both axes, so the gap between two tiles side by side and
  // the gap between two rows are the same number — they used to be gut and a
  // hard-coded 18px, which read as a grid with the wrong rhythm.
  // The row table carries an EXPLICIT width: without one, "margin:0 auto" has
  // nothing to centre and a last row holding a single tile sat against the left
  // edge instead of under the middle of the row above it.
  return rows.map((r) => `
    <table role="presentation"${tcls} align="center" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto"><tr>
      ${r.map((it, i) => `<td class="${cls(r)}" width="${w}" valign="top" style="width:${w}px;padding:0 ${i === r.length - 1 ? 0 : gut}px ${o.gapY ?? 18}px 0;height:100%">${cell(it)}</td>`).join("")}
    </tr></table>`).join("");
}

/** A grid that FLOWS instead of chunking into fixed desktop rows.
 *
 *  `gridRows` builds one table per desktop row, so a phone can only re-stack
 *  WITHIN a row: five tiles at three across become desktop [1 2 3][4 5], and on a
 *  phone the first table wraps to (1,2)(3) and the second to (4,5) — a break after
 *  the third tile and a lone tile stranded left. This lays every tile in ONE
 *  centred container of inline-blocks, so the flow is continuous at both widths:
 *  three-up on desktop, two-up on a phone (`.fcell` → 46%), reading (1,2)(3,4)(5)
 *  with the odd last tile centred by the container. Outlook ignores inline-block,
 *  so an MSO-only ghost table rebuilds the fixed columns just for it. */
export function fluidGrid<T>(
  items: T[], cols: number, w: number, gut: number, cell: (t: T) => string,
  align: "left" | "center" | "right" = "center",
): string {
  const pad = Math.round(gut / 2);
  const cells = items.map((it, i) => {
    // Close and reopen the Outlook ghost row every `cols` tiles.
    const rowBreak = i > 0 && i % cols === 0 ? "<!--[if mso]></tr><tr><![endif]-->" : "";
    return `${rowBreak}<!--[if mso]><td width="${w}" valign="top" style="padding:0 ${gut}px 18px 0"><![endif]-->`
      + `<div class="fcell" style="display:inline-block;width:${w}px;max-width:${w}px;vertical-align:top;padding:0 ${pad}px 18px;box-sizing:border-box;text-align:${align}">${cell(it)}</div>`
      + `<!--[if mso]></td><![endif]-->`;
  }).join("");
  // font-size:0 on the container collapses the whitespace between inline-blocks;
  // text-align centres a short last row (a lone tile lands under the middle).
  return `<!--[if mso]><table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" width="100%"><tr><![endif]-->`
    + `<div style="text-align:${align};font-size:0;line-height:0">${cells}</div>`
    + `<!--[if mso]></tr></table><![endif]-->`;
}

/** Column count that lays `n` tiles out without a stubby last row.
 *  1) up to 4 items sit on one row;
 *  2) otherwise prefer the widest count (4 → 3) that divides exactly;
 *  3) failing that, the widest whose last row is at least half full;
 *  4) failing that, `max` — the last row is centred, so it still reads deliberately. */
export function balancedCols(n: number, max = 4): number {
  if (n <= max) return Math.max(1, n);
  for (let c = max; c >= 3; c--) if (n % c === 0) return c;
  for (let c = max; c >= 3; c--) if (n % c >= Math.ceil(c / 2)) return c;
  return max;
}


/** Only http(s)/mailto/tel/merge-tag URLs make it into the mail. A javascript:
 *  or data: URL is dropped — nothing generated here should ever carry one, and a
 *  pasted one must not survive into the download. */
export function safeUrl(u?: string): string | undefined {
  const v = String(u ?? "").trim();
  if (!v) return undefined;
  if (/^\s*(javascript|data|vbscript)\s*:/i.test(v)) return undefined;
  return v;
}

/** Wrap anything in a link when a url is present (banners, logos, logo tiles). */
export function link(inner: string, href?: string): string {
  const safe = safeUrl(href);
  return safe ? `<a href="${esc(safe)}" target="_blank" style="text-decoration:none">${inner}</a>` : inner;
}

/** Wrap a CONTENT image so the inbox does not paint its own chrome over it.
 *
 *  Gmail and Outlook.com overlay a download / "save to Drive" button on any
 *  standalone image big enough to be worth saving — which is every speaker
 *  portrait and partner logo in these mails. It is the client's own chrome, so
 *  no attribute or style suppresses it; what suppresses it is the image sitting
 *  inside an ANCHOR, because a wrapped image reads as layout rather than as a
 *  picture someone might want to keep.
 *
 *  The anchor deliberately goes NOWHERE. Pointing these at the event's page
 *  instead looked harmless and was not: link tracking rewrites every href into
 *  its own `/t/c/<id>?u=…` redirect, so thirty portraits became thirty DISTINCT
 *  tracked URLs in one mail — a link-count and link-to-text signal that pushes a
 *  send towards the spam folder. `href="#"` adds no domain, is already on
 *  `skipHref`'s list so the tracker never rewrites it, and is one repeated value
 *  rather than thirty new ones.
 *
 *  An image that has a link of its OWN keeps it — those are the sender's, and
 *  they are the only links these mails should carry. Small marks (icons, social
 *  glyphs) are left bare: they are under the size the overlay appears at, and
 *  wrapping them would only add markup. */
export function imageLink(inner: string, ctx: RenderCtx, href?: string): string {
  const own = safeUrl(href);
  if (own) return link(inner, own);
  if (ctx.bareImages) return inner;
  return `<a href="#" target="_blank" style="text-decoration:none;cursor:default">${inner}</a>`;
}

// ---- document shell ---------------------------------------------------------

// Note on `.statcell` below, because it has bitten twice: the tile colour and
// border it forces on a phone are the DOCUMENT's, resolved once here. Any cell
// whose ink was measured against some OTHER surface — the solid stats band's own
// accent fill, or a section carrying its own background — must also carry
// `.statkeep`, or the phone repaints the surface out from under ink that was
// never checked against it and the figures disappear.
// Every comment in the <style> block below ships in every mail, so keep the
// reasoning out here where it costs nothing.
export function emailPage(ctx: RenderCtx, o: { subject: string; preheader: string; rows: string }): string {
  const p = ctx.p;
  return `<!doctype html>
<html lang="en" xmlns:o="urn:schemas-microsoft-com:office:office" style="background-color:${p.pageBg}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="x-apple-disable-message-reformatting">
<title>${esc(o.subject)}</title>
<!--[if mso]><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->
<style>
  body,table,td,a{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}
  table,td{mso-table-lspace:0pt;mso-table-rspace:0pt}
  img{-ms-interpolation-mode:bicubic;border:0;outline:none;text-decoration:none}
  a{color:${p.onCard}}
  html,body{background-color:${p.pageBg}}
  /* The card is fluid (width:100%, max-width:${WIDTH}px) so it can never exceed
     the viewport — these queries only change LAYOUT, never prevent overflow. */
  @media only screen and (max-width:760px){
    .pad{padding-left:24px !important;padding-right:24px !important}
    .h1{font-size:27px !important}
  }
  @media only screen and (max-width:700px){
    /* ONEWORLD PORT: on a phone a word longer than the line (an event hashtag, a long link) breaks rather than
       widening the whole mail past the screen (#HealthcareLeadersSummit27 took a reminder to 532px at 390px) */
    td,div,p,a,span{overflow-wrap:anywhere!important;word-break:break-word!important}
    .wrap{width:100% !important;max-width:100% !important}
    .pad{padding-left:18px !important;padding-right:18px !important}
    .stack{display:block !important;width:100% !important;max-width:100% !important;
      padding-right:0 !important;padding-bottom:14px !important}
    /* photos fill the column once cells stack, instead of sitting small and left */
    .fluid{width:100% !important;max-width:100% !important;height:auto !important}
    /* Cells stack one-per-row on phones — the only layout every client renders
       correctly. To stop six speakers becoming an endless scroll, the tile is
       capped and centred instead of blown up to full width. */
    /* A stacked card fills its column. Capping it at 290px and centring made a
       one-per-row card narrower than — and offset from — the paired ones above
       it, which is the other half of the raggedness. */
    .spcard{max-width:100% !important;margin:0 !important}
    /* Two tiles per row on a phone. One-per-row is the safest email layout but it
       turns six speakers or four stats into an endless scroll, so tiles that stay
       legible at half width use this instead of .stack. Outlook desktop ignores
       media queries and keeps the desktop grid either way. */
    /* Wrapped cells align LEFT. Centring them was meant to make a genuinely last
       short row look deliberate, but a desktop row of three wraps to 2 + 1 on a
       phone, so the orphan was centred in the MIDDLE of the list — two aligned
       tiles, then one adrift, repeating. That is the staggered, distorted look a
       real send showed on a phone. Left keeps every tile on one edge and reads as
       a grid with a short last row. Desktop is untouched. */
    .gridt{width:100% !important;text-align:left !important}
    /* 46% + 2% either side = a real gutter between the two tiles and the same
       gap under them, instead of two boxes touching. */
    /* fluidGrid tiles: two per row on a phone, flowing continuously across the
       whole grid (not per desktop row), so N tiles read (1,2)(3,4)(5-centred). */
    .fcell{width:46% !important;max-width:46% !important}
    .half{display:inline-block !important;width:46% !important;max-width:46% !important;
      box-sizing:border-box !important;padding:0 !important;margin:0 2% 12px !important;
      vertical-align:top !important}
    .half .spcard{max-width:100% !important}
    /* equal heights matter for tiles sitting side by side; once a tile is the only
       one on its row the pinned height is just dead space */
    .autoh{height:auto !important}
    /* stats: the band dissolves and each figure becomes its own box */
    .statband{background-color:transparent !important;background:none !important;border:0 !important}
    /* every stats style becomes a discrete box on a phone, two per row, so a
       divided band never collapses into an unreadable strip. .statkeep opts a
       style out of the recolour when it carries its own fill. */
    .statcell{background-color:${p.tileBg} !important;border:1px solid ${p.cardEdge} !important;border-radius:10px !important;padding:14px 8px !important}
    .statcell.statkeep{background-color:transparent !important;border:0 !important}
    /* the portal wordmark keeps its own space beside the hashtag on a phone —
       at full size it alone forces the mail wider than a 320px screen */
    .logom{max-width:150px !important}
    .logom-small{max-width:120px !important}
    .logom-large{max-width:190px !important}
    .logom-xl{max-width:220px !important}
    .h1{font-size:24px !important}
    .h2{font-size:20px !important}
    /* micro caps labels are fine at 10-11px on a desktop card, too small on a phone */
    .micro{font-size:12px !important;letter-spacing:.06em !important}
    /* house convention: hide inline separators and stack the parts they joined */
    .mobile-none{display:none !important}
    .stackline{display:block !important}
  }
  /* Below ~350px the 290px tile cap is wider than the column it sits in, so let
     it go fully fluid — otherwise the tile forces the mail wider than the screen. */
  @media only screen and (max-width:352px){
    .spcard{max-width:100% !important}
    .logom{max-width:130px !important}
    .logom-small{max-width:110px !important}
    .logom-large{max-width:160px !important}
    .logom-xl{max-width:180px !important}
  }
</style>
</head>
<body style="margin:0;padding:0;width:100%;background-color:${p.pageBg}">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${p.pageBg}">${esc(o.preheader)}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${p.pageBg}">
  <tr><td align="center" style="padding:26px 12px">
    <table role="presentation" class="wrap" width="${WIDTH}" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:${WIDTH}px;background-color:${p.cardBg};border-radius:12px;overflow:hidden;font-family:${ctx.font}">
      <tr><td bgcolor="${p.primary}" style="height:4px;line-height:4px;font-size:0;background-color:${p.primary}">&nbsp;</td></tr>
      ${o.rows}
    </table>
  </td></tr>
</table>
</body></html>`;
}
