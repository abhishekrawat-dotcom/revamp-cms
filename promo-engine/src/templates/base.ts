import type { EventEntity } from "../model/types.ts";
import type { BrandKit } from "../brand/index.ts";
import type { Format } from "./formats.ts";

// Context handed to every template render function.
export interface TemplateContext {
  event: EventEntity;
  brand: BrandKit;
  format: Format;
  params: Record<string, any>;
  // Rasterized PSD units (data URIs), assembled into the template layout.
  // ONEWORLD PORT: qrUrl / qrLabel are the QR tile's code (a data: SVG of the site's registration address) and its
  // caption. Oneworld sets them only while the event's site is published; see qrTile below.
  assets?: { backgroundUrl?: string; logoUnitUrl?: string; qrUrl?: string; qrLabel?: string };
}

export function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// ---- shared chrome fragments -------------------------------------------------

export function editionRibbon(ctx: TemplateContext): string {
  if (!ctx.event.edition) return "";
  return `<div class="ribbon">${esc(ordinal(ctx.event.edition))} Edition</div>`;
}

export function hashtag(ctx: TemplateContext): string {
  return `<div class="hashtag">${esc(ctx.event.hashtag)}</div>`;
}

export function brandLockup(ctx: TemplateContext, opts: { compact?: boolean } = {}): string {
  const { event } = ctx;
  // If a PSD logo unit was supplied, drop it in as the brand lockup.
  if (ctx.assets?.logoUnitUrl) {
    return `<div class="lockup"><img class="lockup-img" src="${esc(ctx.assets.logoUnitUrl)}" alt=""></div>`;
  }
  const presenter = event.presenter
    ? `<div class="lockup-presenter"><span>${esc(event.presenter)}</span> presents</div>`
    : "";
  const tagline = event.tagline && !opts.compact
    ? `<div class="lockup-tagline">${esc(event.tagline)}</div>`
    : "";
  return `
    <div class="lockup">
      ${presenter}
      <div class="lockup-name">${esc(event.name)}</div>
      ${tagline}
    </div>`;
}

// ONEWORLD PORT: Oneworld's QR tile (promo-posts.js qrHtml; promo.css .pp-qr): the site's registration address as
// a code on a white tile with its caption, sized per format as Oneworld's own posts size theirs: 150 / 150 / 104 /
// 201 px for square / portrait / landscape / story (k = 1 / 1 / 0.8 / 1.06). The tile carries its own <style>, so a
// post without a QR is the platform's, byte for byte. `css` is CSS a template needs only while the tile is there
// (the Announcement's button row). The caption line is always written, as the shared contract fixes the tile's DOM
// (.ow-qr > img.ow-qr-code + .ow-qr-t); Oneworld's server never sends an empty caption (it falls back to its own).
const QR_K: Record<string, number> = { "1:1": 1, "4:5": 1, "16:9": 0.8, "9:16": 1.06 };
const QR_BASE_PX: Record<string, number> = { "16:9": 130, "9:16": 190 };
// ONEWORLD PORT: a landscape post is 675 px tall and its templates' bodies already fill it, so Oneworld's stacked
// tile (about 140 px with its caption) would push the footer up by twice the button's height and the body would lose
// text and logos it showed without a QR. In 16:9 the caption sits beside the code instead, and the tile reaches into
// the space the footer already keeps empty above it (about half of its 3cqw top padding) and into the canvas margin
// below it (about 20 px stay clear of the edge): the footer stays the button's height, so the body keeps every line
// and logo it had, and the code keeps its full 104 px. A caption longer than "Scan to register" (Oneworld allows 60
// characters) wraps beside the code instead of pushing the date line into four lines.
const QR_FOOTER_16_9 = ".footer>.ow-qr{flex-direction:row;margin:-1.6cqw 0 -2.6cqw}" +
  ".footer>.ow-qr .ow-qr-t{white-space:normal;overflow-wrap:anywhere;max-width:152px}";
// ONEWORLD PORT: the tile above follows its footer. That is right for every template whose body shrinks to the room
// it is given (min-height:0), as their 16:9 footer always ends on the content box's bottom edge. The Partner
// Spotlight's body does not shrink, so with a logo unit (or a name on two lines) it pushes the footer down to the
// canvas's bottom edge or past it, and a tile that followed would hang off the canvas with its code cut. Such a
// template asks for the tile pinned to the canvas (pin): in 16:9 it stands 18 px above the canvas's bottom edge (its
// 17.6 px shadow stays on the canvas) at the footer's left, wherever the footer ends up. It is stacked as Oneworld's
// own tile, the caption wrapping under the code within the code's width, so its width is known and the date line
// steps right by exactly that width and the footer's own gap. It rises about 140 px, over that body's empty left side.
function qrFooterPinned16x9(tileWidth: string): string {
  return ".footer>.ow-qr{position:absolute;bottom:18px}" +
    `.footer>.ow-qr .ow-qr-t{white-space:normal;overflow-wrap:anywhere;max-width:${tileWidth};text-align:center}` +
    `.footer:has(>.ow-qr) .footer-when{margin-left:calc(${tileWidth} + 3cqw)}`;
}
export function qrTile(ctx: TemplateContext, css = "", pin = false): string {
  const url = ctx.assets?.qrUrl;
  if (!url) return "";
  const ratio = String(ctx.format?.ratio ?? "");
  const k = QR_K[ratio] ?? 1;
  const px = Math.round((QR_BASE_PX[ratio] ?? 150) * k);
  // Oneworld scales the padding, corner, shadow and caption by k unrounded (calc(var(--k) * 8px)); two decimals keep
  // the CSS free of float noise such as 18.020000000000003.
  const u = (n: number) => `${Math.round(n * k * 100) / 100}px`;
  const label = String(ctx.assets?.qrLabel ?? "");
  // the white tile's outer width: the code and its padding on both sides (116.8 px in 16:9)
  const tileWidth = `${Math.round((px + 2 * 8 * k) * 100) / 100}px`;
  const foot = ratio !== "16:9" ? "" : pin ? qrFooterPinned16x9(tileWidth) : QR_FOOTER_16_9;
  return `<style>.ow-qr{display:flex;flex-direction:column;align-items:center;gap:${u(8)};flex:none}` +
    `.ow-qr-code{display:block;width:${px}px;height:${px}px;background:#fff;padding:${u(8)};border-radius:${u(12)};` +
    `box-shadow:0 ${u(4)} ${u(18)} rgba(0,0,0,.18);box-sizing:content-box}` +
    `.ow-qr-t{font-size:${u(17)};font-weight:600;letter-spacing:.03em;white-space:nowrap}` +
    `.footer:has(.ow-qr) .footer-when{flex:1}${foot}${css}</style>` +
    `<div class="ow-qr"><img class="ow-qr-code" src="${esc(url)}" alt="QR code">` +
    `<div class="ow-qr-t">${esc(label)}</div></div>`;
}

// ONEWORLD PORT: `qr` lets a template shape its QR tile. `css` is CSS it needs only while the tile is there (it
// travels inside the tile's <style>, so a post without a QR stays the platform's), and `pin` pins the 16:9 tile to
// the canvas (qrFooterPinned16x9 above).
export function footerBar(ctx: TemplateContext, qr: { css?: string; pin?: boolean } = {}): string {
  const { event } = ctx;
  const where = [event.venue || event.city].filter(Boolean).join("");
  const dateVenue = [event.dateLabel, where].filter(Boolean).join("  ·  ");
  // ONEWORLD PORT: the QR tile leads the footer. It is written straight before footer-when, so with no QR (an empty
  // tile) the string is the platform's, whitespace included.
  return `
    <div class="footer">
      ${qrTile(ctx, qr.css, qr.pin)}<div class="footer-when">${esc(dateVenue)}</div>
      <div class="cta">${esc(event.ctaLabel)}</div>
    </div>`;
}

export function statChip(value: string, label: string): string {
  return `<div class="stat"><div class="stat-v">${esc(value)}</div><div class="stat-l">${esc(label)}</div></div>`;
}

/** White logo chip that falls back to the brand name text if the image 404s,
 *  so a bad asset never renders a broken-image icon. */
export function logoChip(url: string | undefined, title: string, cls = "tl-logo"): string {
  if (!url) return `<div class="${cls} text">${esc(title)}</div>`;
  const onerr = `this.onerror=null;this.remove();this.parentElement.classList.add('text');this.parentElement.textContent=${JSON.stringify(title)};`;
  return `<div class="${cls}"><img src="${esc(url)}" alt="${esc(title)}" onerror="${esc(onerr)}"></div>`;
}

// ---- base stylesheet ---------------------------------------------------------
// Sizing is expressed in `cqw` (container-query width units) so a single set of
// rules scales across 1:1 / 4:5 / 16:9 / 9:16 canvases. Ratio-specific tweaks
// hang off body[data-ratio].

export function baseCss(ctx: TemplateContext): string {
  const c = ctx.brand.colors;
  // Theme toggle: dark => light text on dark frost; light => dark text on light frost.
  const light = ctx.params?.theme === "light";
  const txt = light ? c.ink : "#ffffff";
  const frostBg = light ? "rgba(255,255,255,.74)" : "rgba(8,10,22,.34)";
  const frostBorder = light ? "rgba(0,0,0,.08)" : "rgba(255,255,255,.16)";
  const tileBg = light ? "rgba(0,0,0,.05)" : "rgba(255,255,255,.14)";
  const tileBorder = light ? "rgba(0,0,0,.10)" : "rgba(255,255,255,.28)";
  // Gradient fallback used only when no PSD background is supplied.
  const gradient = `background:
        radial-gradient(120% 90% at 85% 8%, rgba(255,255,255,.18), transparent 55%),
        linear-gradient(155deg, ${c.bgFrom} 0%, ${c.bgTo} 100%);`;

  return `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800;900&display=swap');
  * { margin:0; padding:0; box-sizing:border-box; }
  :root {
    --ink:${c.ink}; --ink-soft:${c.inkSoft}; --surface:${c.surface};
    --primary:${c.primary}; --accent:${c.accent}; --accent-ink:${c.accentInk};
    --tier:${c.tierChip}; --txt:${txt}; --frost-bg:${frostBg}; --frost-border:${frostBorder};
    --tile-bg:${tileBg}; --tile-border:${tileBorder};
  }
  html,body { width:100%; height:100%; }
  body {
    font-family:${ctx.brand.fontFamily};
    color:var(--txt); -webkit-font-smoothing:antialiased;
  }
  .canvas {
    position:relative; width:100%; height:100%; overflow:hidden;
    ${gradient}
  }
  /* PSD background unit (rasterized), shown as-is behind the content */
  .bg { position:absolute; inset:0; background-size:cover; background-position:center; }
  /* light legibility scrim so overlaid text stays readable on any artwork */
  .scrim { position:absolute; inset:0;
    background:linear-gradient(180deg, rgba(0,0,0,.10) 0%, rgba(0,0,0,0) 30%, rgba(0,0,0,.28) 100%); }
  /* content layer holds all chrome + data; cqw units resolve against canvas size */
  .content { position:absolute; inset:0; container-type:size;
    display:flex; flex-direction:column; padding:6cqw; }
  /* PSD logo unit dropped into the lockup slot (capped by container HEIGHT so it
     never dominates / pushes content off-canvas in short 16:9 banners) */
  .lockup-img { max-width:70%; max-height:20cqh; object-fit:contain; object-position:left center;
    filter:drop-shadow(0 .5cqw 1.5cqw rgba(0,0,0,.3)); }
  /* frosted-glass panel: blurs whatever art is behind it so overlaid text stays
     legible on busy backgrounds ("blur the content area") */
  .frost { background:var(--frost-bg); -webkit-backdrop-filter:blur(16px) saturate(1.15);
    backdrop-filter:blur(16px) saturate(1.15); border:1px solid var(--frost-border);
    border-radius:3cqw; box-shadow:0 1.5cqw 4cqw rgba(0,0,0,.28); }
  /* header chrome */
  .ribbon {
    position:absolute; top:0; left:0; z-index:5;
    background:var(--accent); color:var(--accent-ink);
    font-weight:700; font-size:2.4cqw; letter-spacing:.02em;
    padding:1.4cqw 3.4cqw 1.4cqw 2.2cqw;
    clip-path:polygon(0 0,100% 0,84% 100%,0 100%);
  }
  .hashtag {
    position:absolute; top:5cqw; right:6cqw; z-index:5;
    font-weight:700; font-size:2.6cqw; opacity:.92; letter-spacing:.01em;
  }
  .lockup { margin-top:2cqw; }
  .lockup-presenter { font-size:2.4cqw; font-weight:600; opacity:.9; }
  .lockup-presenter span { text-transform:uppercase; letter-spacing:.06em; }
  .lockup-name {
    font-size:6.6cqw; font-weight:700; line-height:1.02; letter-spacing:-.01em;
    margin-top:.6cqw; text-shadow:0 .4cqw 2cqw rgba(0,0,0,.22);
  }
  .lockup-tagline {
    font-size:2.7cqw; font-weight:600; opacity:.92; margin-top:1.4cqw; max-width:80%;
  }
  /* body zone */
  .body { flex:1; display:flex; min-height:0; }
  .headline {
    font-size:6.2cqw; font-weight:700; line-height:1.04; letter-spacing:-.01em;
    text-shadow:0 .4cqw 2cqw rgba(0,0,0,.25);
  }
  .accent-text { color:var(--accent); }
  /* footer chrome */
  .footer {
    display:flex; align-items:center; justify-content:space-between; gap:3cqw;
    padding-top:3cqw;
  }
  .footer-when { font-size:2.7cqw; font-weight:700; opacity:.95; }
  .cta {
    background:var(--accent); color:var(--accent-ink);
    font-weight:700; font-size:2.7cqw;
    padding:1.8cqw 3.6cqw; border-radius:99px; white-space:nowrap;
    box-shadow:0 1cqw 3cqw rgba(0,0,0,.22);
  }
  /* generic surface card */
  .card { background:var(--surface); color:var(--ink); border-radius:3cqw;
    box-shadow:0 2cqw 6cqw rgba(0,0,0,.22); }
  /* stat chips */
  .stat { background:var(--tile-bg); border:1px solid var(--tile-border);
    border-radius:2.4cqw; padding:2.4cqw; backdrop-filter:blur(2px); }
  .stat-v { font-size:5.4cqw; font-weight:700; color:var(--accent); line-height:1; }
  .stat-l { font-size:2.3cqw; font-weight:600; opacity:.9; margin-top:.8cqw;
    text-transform:uppercase; letter-spacing:.04em; }
  /* role / tier chip */
  .chip { display:inline-block; background:var(--tier); color:#fff;
    font-weight:700; font-size:2.2cqw; text-transform:uppercase; letter-spacing:.05em;
    padding:1.1cqw 2.4cqw; border-radius:99px; }
  /* headshot cutout treatment — anchor to top so the face stays visible when cropped */
  .headshot { object-fit:cover; object-position:top center; background:rgba(255,255,255,.1); }
  /* landscape is short & wide: dial type down a touch */
  body[data-ratio="16:9"] .content { padding:4cqw 5cqw; }
  body[data-ratio="16:9"] .lockup-name { font-size:5cqw; }
  body[data-ratio="16:9"] .headline { font-size:5cqw; }
  /* story is tall: give the body room to breathe */
  body[data-ratio="9:16"] .content { padding:8cqw 7cqw; }
  `;
}

// Wrap a template's inner HTML + CSS into a full, self-contained document.
export function page(ctx: TemplateContext, css: string, inner: string): string {
  const bgUrl = ctx.assets?.backgroundUrl;
  const bgLayers = bgUrl
    ? `<div class="bg" style="background-image:url('${bgUrl}')"></div><div class="scrim"></div>`
    : "";
  return `<!doctype html>
<html><head><meta charset="utf-8">
<style>${baseCss(ctx)}${css}</style>
</head>
<body data-ratio="${ctx.format.ratio}">
  <div class="canvas">${bgLayers}<div class="content">${inner}</div></div>
</body></html>`;
}
