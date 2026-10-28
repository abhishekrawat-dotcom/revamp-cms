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
  assets?: { backgroundUrl?: string; logoUnitUrl?: string };
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

export function footerBar(ctx: TemplateContext): string {
  const { event } = ctx;
  const where = [event.venue || event.city].filter(Boolean).join("");
  const dateVenue = [event.dateLabel, where].filter(Boolean).join("  ·  ");
  return `
    <div class="footer">
      <div class="footer-when">${esc(dateVenue)}</div>
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
