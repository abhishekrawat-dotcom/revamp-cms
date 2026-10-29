/* ONEWORLD PORT — a PSD's background and logo unit, read in the browser.
   The platform read an uploaded PSD on its server (src/psd/extract.ts extractUnits: @webtoon/psd to parse, sharp to
   composite and trim). Oneworld's server takes at most 32 MiB a request and runs in 512 MiB shared by 80 requests,
   while a real 50-170 MB PSD needs 250 MiB to 1.4 GiB there (map-psd §8-§9). So the social posts studio reads the PSD
   in the tab, with the same library (vendored byte for byte, promo-engine/vendor/webtoon-psd) and the same rules:
   leavesOf and classify are the platform's (extract.ts:23-27, 62-70). What changed, each marked ONEWORLD PORT:
     - size guards, before anything is decoded: a canvas over 100 Mpx or 16,384 px a side, or a layer that would be
       decoded over 64 Mpx, is refused with PsdTooLarge instead of running the tab out of memory;
     - each role is drawn on a canvas (Porter-Duff "over", bottom to top, as sharp's composite did; within 2/255 of
       it on real PSDs, map-psd F8) the size of its own layers' box, not the whole canvas, so a small logo on a big
       canvas keeps every pixel; the logo's canvas is that box plus a 4 px transparent margin (inside the PSD's
       canvas) for the server's trim; the background keeps the full canvas, as it is full bleed by its rule;
     - a unit whose canvas is longer than maxEdge (3840 px, the largest post drawn at 2×) is scaled down once;
     - no trim: the server trims the logo with sharp's trim({ threshold: 1 }) exactly as the platform did.
   psdUnits() answers { canvasWidth, canvasHeight, background, logo, roles }, the logo with its layers' box and the
   area its picture covers (box plus the margin) on the PSD's canvas; it throws an Error named PsdTooLarge or
   PsdUnreadable whose message is the sentence the studio shows. Bundled into assets/vendor/promo-social.js. */
import Psd from "../../vendor/webtoon-psd/index.js";

export type Role = "background" | "logo" | "text" | "ignore";

/** The longest edge a unit is kept at: the 9:16 story drawn at 2× is 2160 × 3840 (formats.ts; the platform's scale 2). */
export const MAX_EDGE = 3840;

export const PSD_LIMITS = {
  /** the platform's own upload cap (server.ts:492, express.raw "120mb"); the upload screen checks it before reading */
  maxFileBytes: 120 * 1024 * 1024,
  /** a canvas over either is refused before any layer is decoded */
  maxCanvasPixels: 100000000,
  maxSide: 16384,
  /** one layer decodes to width × height × 4 bytes in the tab; over this it is refused before its decode */
  maxLayerPixels: 64000000,
  maxEdge: MAX_EDGE,
};

const TOO_LARGE = "This PSD is too large to read in the browser. Save a flattened copy of at most 64 megapixels and 16,384 px a side (8,000 × 8,000 px fits), or upload the background and logo as pictures.";
const UNREADABLE = "This PSD could not be read. Save it again from Photoshop with Maximize Compatibility on, or upload the background and logo as pictures.";

/* ONEWORLD PORT: the logo window keeps this many transparent pixels around its layers (inside the canvas), where
   the platform kept the whole canvas around them. The server trims it with sharp against its top-left pixel, as the
   platform trimmed the whole canvas: the margin keeps that pixel the same one the platform used (transparent, unless
   a logo layer covers the canvas's own corner), and keeps a few pixels of the same canvas around the art for the
   trim's 3 × 3 smoothing, so the trimmed logo comes out as the platform's. */
const TRIM_MARGIN = 4;

export interface Box { x: number; y: number; width: number; height: number; }
export interface PsdUnit { blob: Blob; width: number; height: number; }
export interface PsdUnits {
  canvasWidth: number; canvasHeight: number;
  background: PsdUnit | null;
  /** box: where the logo's layers sit on the PSD's canvas (the union of their visible parts), in canvas pixels before
   *  any scaling: the place to compare with the platform's trimmed logo. area: the part of the canvas the picture
   *  covers, which is box plus up to TRIM_MARGIN transparent pixels on each side, inside the canvas; width and
   *  height are area's, scaled down when it is longer than maxEdge. */
  logo: (PsdUnit & { box: Box; area: Box }) | null;
  /** how many leaf layers took each role (for checks against the platform; no layer table is kept) */
  roles: Record<Role, number>;
}

function fail(name: "PsdTooLarge" | "PsdUnreadable", detail?: string): Error {
  const e: any = new Error(name === "PsdTooLarge" ? TOO_LARGE : UNREADABLE);
  e.name = name;
  if (detail) e.detail = detail;
  return e;
}
const why = (e: any) => String((e && e.message) || e || "");

function leavesOf(psd: any): any[] {
  const out: any[] = [];
  (function walk(n: any) { for (const c of n.children ?? []) { if (!c.children) out.push(c); else walk(c); } })(psd);
  return out;
}

/* ONEWORLD PORT: the platform's classify closure (extract.ts:62-70) as a function of the layer and the canvas size,
   so it can be exported and checked alone; the rules and thresholds are unchanged. No screen ever filled the
   overrides map (the "reassign" step, map-psd §1); it stays, read as own keys only, so a layer named "constructor"
   or "toString" is not handed a role by Object's prototype. */
export function classify(l: any, W: number, H: number, overrides: Record<string, Role> = {}): Role {
  const area = W * H;
  if (Object.prototype.hasOwnProperty.call(overrides, l.name) && overrides[l.name]) return overrides[l.name];
  if (l.isHidden || !l.width || !l.height) return "ignore";
  if (l.text) return "text"; // details come from the API
  const fullBleed = l.width >= W * 0.9 && l.height >= H * 0.85 && (l.left ?? 0) <= W * 0.1 && (l.top ?? 0) <= H * 0.1;
  if (fullBleed) return "background";
  if (l.width * l.height >= area * 0.03) return "logo"; // sizable art = logo/branding
  return "ignore"; // small shapes: buttons, icons, badges
}

// ONEWORLD PORT: the canvas guard, from the file's own header (PSD and PSB keep height, then width, at bytes 14-21),
// so a 20,000 × 20,000 file is refused before the library reads a byte of its layers
function checkCanvas(W: number, H: number): void {
  if (!(W > 0) || !(H > 0)) throw fail("PsdUnreadable", "no canvas size");
  if (W > PSD_LIMITS.maxSide || H > PSD_LIMITS.maxSide || W * H > PSD_LIMITS.maxCanvasPixels) {
    throw fail("PsdTooLarge", `canvas ${W}×${H}`);
  }
}
function headerSize(buf: ArrayBuffer): { width: number; height: number } {
  let v: DataView;
  try { v = new DataView(buf); } catch (e) { throw fail("PsdUnreadable", why(e)); }
  if (v.byteLength < 26 || v.getUint32(0) !== 0x38425053 /* "8BPS" */) throw fail("PsdUnreadable", "not a PSD");
  const version = v.getUint16(4);
  if (version !== 1 && version !== 2) throw fail("PsdUnreadable", "unknown PSD version " + version);
  return { height: v.getUint32(14), width: v.getUint32(18) };
}

interface Part { layer: any; dx: number; dy: number; vw: number; vh: number; }
// The layers of one role that reach the canvas, bottom to top, with their visible part (the platform's own clip,
// extract.ts:31-37).
function partsOf(leaves: any[], canvasW: number, canvasH: number): Part[] {
  const parts: Part[] = [];
  for (const l of [...leaves].reverse()) { // bottom-to-top
    if (!l.width || !l.height) continue;
    const dx = Math.max(0, l.left), dy = Math.max(0, l.top);
    const vw = Math.min(l.left + l.width, canvasW) - dx;
    const vh = Math.min(l.top + l.height, canvasH) - dy;
    if (vw <= 0 || vh <= 0) continue; // fully off-canvas
    parts.push({ layer: l, dx, dy, vw, vh });
  }
  return parts;
}

function canvasOf(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  // a canvas the tab cannot hold comes back smaller or without a context
  if (c.width !== w || c.height !== h || !c.getContext("2d")) throw fail("PsdTooLarge", `canvas ${w}×${h} refused by the browser`);
  return c;
}
const free = (c: HTMLCanvasElement) => { c.width = 0; c.height = 0; };
// Each layer decodes on the page's own thread; between layers the page takes its turn (clicks, the status line).
// A message rather than a timer, because a tab in the background holds timers back to once a second or less.
const breathe = () => new Promise<void>((r) => {
  if (typeof MessageChannel !== "function") { setTimeout(r, 0); return; }
  const ch = new MessageChannel();
  ch.port1.onmessage = () => { ch.port1.close(); r(); };
  ch.port2.postMessage(0);
});

// ONEWORLD PORT: sharp's composite (extract.ts:38-47) on a canvas the size of `box`; each layer is drawn at its own
// offset, so whatever lies outside the box is clipped as the platform clipped it to the canvas
async function composite(parts: Part[], box: Box): Promise<HTMLCanvasElement> {
  const c = canvasOf(box.width, box.height);
  const ctx = c.getContext("2d")!;
  try {
    for (const p of parts) {
      const l = p.layer;
      let rgba: Uint8ClampedArray;
      try { rgba = await l.composite(true, true); } catch (e) {
        throw fail(/alloc|memory/i.test(why(e)) ? "PsdTooLarge" : "PsdUnreadable", why(e));
      }
      const lc = canvasOf(l.width, l.height);
      try {
        lc.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.byteLength), l.width, l.height), 0, 0);
        ctx.drawImage(lc, l.left - box.x, l.top - box.y);
      } catch (e: any) {
        throw e && (e.name === "PsdTooLarge" || e.name === "PsdUnreadable") ? e : fail("PsdUnreadable", why(e));
      } finally {
        free(lc); // the layer's pixels can go now; a 30-layer PSD would otherwise hold them all at once
      }
      await breathe();
    }
  } catch (e) { free(c); throw e; }
  return c;
}

// ONEWORLD PORT: scaled once, only when the unit's box is longer than maxEdge
function fit(c: HTMLCanvasElement, maxEdge: number): HTMLCanvasElement {
  const long = Math.max(c.width, c.height);
  if (long <= maxEdge) return c;
  const s = maxEdge / long;
  const out = canvasOf(Math.max(1, Math.round(c.width * s)), Math.max(1, Math.round(c.height * s)));
  const ctx = out.getContext("2d")!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(c, 0, 0, out.width, out.height);
  free(c);
  return out;
}

function pngOf(c: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      c.toBlob((b) => { free(c); if (b) resolve(b); else reject(fail("PsdTooLarge", "the browser could not encode the picture")); }, "image/png");
    } catch (e) { free(c); reject(fail("PsdTooLarge", why(e))); }
  });
}

/** Read a PSD in the tab: its full-bleed background and its logo unit as PNG blobs (the platform's extractUnits). */
export async function psdUnits(input: ArrayBuffer, opts: { maxEdge?: number } = {}): Promise<PsdUnits> {
  const maxEdge = opts && Number(opts.maxEdge) > 0 ? Math.floor(Number(opts.maxEdge)) : MAX_EDGE;
  const buf: ArrayBuffer = input && ArrayBuffer.isView(input)
    ? (input as any).buffer.slice((input as any).byteOffset, (input as any).byteOffset + (input as any).byteLength)
    : input;
  const head = headerSize(buf);
  checkCanvas(head.width, head.height);

  let psd: any;
  try { psd = Psd.parse(buf); } catch (e) { throw fail("PsdUnreadable", why(e)); }
  const W = psd.width, H = psd.height;
  checkCanvas(W, H);
  const leaves = leavesOf(psd);

  const roles: Record<Role, number> = { background: 0, logo: 0, text: 0, ignore: 0 };
  const role = leaves.map((l) => { const r = classify(l, W, H); if (r in roles) roles[r]++; return r; });
  const pick = (r: Role) => leaves.filter((l, i) => role[i] === r);
  const bgParts = partsOf(pick("background"), W, H);
  const logoParts = partsOf(pick("logo"), W, H);
  // ONEWORLD PORT: every layer that will be decoded is checked before the first decode
  for (const p of bgParts.concat(logoParts)) {
    if (p.layer.width * p.layer.height > PSD_LIMITS.maxLayerPixels) throw fail("PsdTooLarge", `layer ${p.layer.width}×${p.layer.height}`);
  }

  let background: PsdUnit | null = null;
  if (bgParts.length) {
    const c = fit(await composite(bgParts, { x: 0, y: 0, width: W, height: H }), maxEdge);
    const width = c.width, height = c.height;
    background = { blob: await pngOf(c), width, height };
  }

  let logo: (PsdUnit & { box: Box; area: Box }) | null = null;
  if (logoParts.length) {
    // ONEWORLD PORT: the logo is drawn in its layers' own box (the union of their visible parts), widened by
    // TRIM_MARGIN inside the canvas, instead of on the whole canvas
    let x0 = W, y0 = H, x1 = 0, y1 = 0;
    for (const p of logoParts) {
      x0 = Math.min(x0, p.dx); y0 = Math.min(y0, p.dy);
      x1 = Math.max(x1, p.dx + p.vw); y1 = Math.max(y1, p.dy + p.vh);
    }
    const box: Box = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
    const ax0 = Math.max(0, x0 - TRIM_MARGIN), ay0 = Math.max(0, y0 - TRIM_MARGIN);
    const ax1 = Math.min(W, x1 + TRIM_MARGIN), ay1 = Math.min(H, y1 + TRIM_MARGIN);
    const area: Box = { x: ax0, y: ay0, width: ax1 - ax0, height: ay1 - ay0 };
    const c = fit(await composite(logoParts, area), maxEdge);
    const width = c.width, height = c.height;
    logo = { blob: await pngOf(c), width, height, box, area };
  }

  return { canvasWidth: W, canvasHeight: H, background, logo, roles };
}
