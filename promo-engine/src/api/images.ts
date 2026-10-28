// Image URL helpers for the ET media CDN (img.etb2bimg.com).
// Raw files live under /files/<path>. The /imgv2/ prefix is an on-demand
// resize service: width-<w>,height-<h>,resize_mode-2 — use it to request
// headshots/logos at exact template dimensions (no local resize step needed).

const HOST = "https://img.etb2bimg.com";

function clean(path: string): string {
  return path.replace(/^\/+/, "");
}

/** Resolve a raw API image path to a full CDN url. Pass-through for absolute urls. */
export function imageUrl(path?: string | null): string | undefined {
  if (!path) return undefined;
  const p = path.trim();
  if (!p) return undefined;
  if (/^https?:\/\//i.test(p)) return p;
  return `${HOST}/files/${clean(p)}`;
}

/** Sponsor logos live under /files/retail_files/ (verified against the live
 *  microsite), NOT the plain /files/ path used for speaker photos/event logos. */
export function sponsorLogoUrl(path?: string | null): string | undefined {
  if (!path) return undefined;
  const p = path.trim();
  if (!p) return undefined;
  if (/^https?:\/\//i.test(p)) return p;
  return `${HOST}/files/retail_files/${clean(p)}`;
}

/** Rewrite an ALREADY-resolved CDN url to an exact-size imgv2 variant. Used by
 *  the mailers, where email HTML can't crop (no object-fit) so the grid tiles
 *  only line up if the CDN returns the exact box. Pass-through for foreign
 *  hosts, data URIs and urls that are already /imgv2/. */
/** imgv2 generates each variant on first request, and a burst of brand-new sizes
 *  comes back 404 — six speaker photos at a never-before-used dimension render as
 *  empty boxes. Snapping to a short ladder means the mail reuses variants that are
 *  already warm (and that ET's own pages request), instead of minting one per
 *  layout width. */
const RUNGS = [80, 120, 160, 200, 220, 260, 300, 360, 440, 560, 750];
export function snapSize(n: number): number {
  const v = Math.max(1, Math.round(n));
  return RUNGS.find((r) => r >= v) ?? RUNGS[RUNGS.length - 1];
}

export function resizeUrl(url?: string | null, width = 200, height = 200, mode = 2): string | undefined {
  if (!url) return undefined;
  const m = url.match(/^https?:\/\/img\.etb2bimg\.com\/files\/(.+)$/i);
  if (!m) return url;
  // Square requests stay square on the ladder; a non-square box keeps its ratio.
  const w = snapSize(width);
  const h = width === height ? w : Math.round(w * (height / width));
  return `${HOST}/imgv2/width-${w},height-${h},resize_mode-${mode}/files/${m[1]}`;
}

/** Resolve + request a resized variant via the imgv2 service. */
export function resizedUrl(
  path: string | undefined,
  width: number,
  height: number,
  mode = 2,
): string | undefined {
  if (!path) return undefined;
  const p = path.trim();
  if (!p) return undefined;
  // If it's already an absolute imgv2 url, leave it alone.
  if (/^https?:\/\//i.test(p)) return p;
  return `${HOST}/imgv2/width-${width},height-${height},resize_mode-${mode}/files/${clean(p)}`;
}
