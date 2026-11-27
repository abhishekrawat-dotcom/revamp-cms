// Photos for the vector PDF (pdfEngine.ts): where a photo sits in its frame exactly as BookCanvas shows it, and the
// browser work of cutting out the part that shows, its filters, and making it no larger than the print needs.
//
// BookCanvas draws a photo as an <img> filling its frame with object-fit (cover or contain) and object-position
// (the focal point, in %), then scaled by the zoom about the frame's centre (transform: scale(zoom)), inside the
// frame's rounded, clipped box. imagePlacement() is that, in mm; pdfEngine cuts out the visible part, keeps it at no
// more than the target ppi at its printed size (never enlarged) and embeds it as JPEG (PNG when it has transparency).
// One photo is decoded at a time and let go as soon as it is drawn.

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** where the whole photo lies, in mm from the frame's top-left (it may reach far outside the frame) */
export function imagePlacement(
  frameW: number,
  frameH: number,
  imgW: number,
  imgH: number,
  fit: 'cover' | 'contain' | string | undefined,
  zoom: number | undefined,
  focalX: number | undefined,
  focalY: number | undefined
): Rect {
  const iw = Math.max(1, imgW);
  const ih = Math.max(1, imgH);
  const s = fit === 'contain' ? Math.min(frameW / iw, frameH / ih) : Math.max(frameW / iw, frameH / ih);
  const rw = iw * s;
  const rh = ih * s;
  const fx = (focalX ?? 50) / 100;
  const fy = (focalY ?? 50) / 100;
  const ox = (frameW - rw) * fx;
  const oy = (frameH - rh) * fy;
  const z = Number(zoom) || 1;
  return { x: frameW / 2 + z * (ox - frameW / 2), y: frameH / 2 + z * (oy - frameH / 2), w: z * rw, h: z * rh };
}

export function intersect(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const r = Math.min(a.x + a.w, b.x + b.w);
  const btm = Math.min(a.y + a.h, b.y + b.h);
  if (r - x <= 1e-6 || btm - y <= 1e-6) return null;
  return { x, y, w: r - x, h: btm - y };
}

/** the CSS filter BookCanvas puts on a photo, in its order ('' for none) */
export function photoFilter(im: { brightness?: number; contrast?: number; grayscale?: number; sepia?: number }): string {
  return [
    im.brightness !== undefined && im.brightness !== 100 ? `brightness(${im.brightness}%)` : '',
    im.contrast !== undefined && im.contrast !== 100 ? `contrast(${im.contrast}%)` : '',
    im.grayscale ? `grayscale(${im.grayscale}%)` : '',
    im.sepia ? `sepia(${im.sepia}%)` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

/** a JPEG's colour channels and EXIF orientation (from its markers), or null when it isn't a JPEG */
export function jpegInfo(b: Uint8Array): { components: number; orientation: number; width: number; height: number } | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  let orientation = 1;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = b[i + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    const len = (b[i + 2] << 8) | b[i + 3];
    if (marker === 0xe1 && len > 14 && b[i + 4] === 0x45 && b[i + 5] === 0x78 && b[i + 6] === 0x69 && b[i + 7] === 0x66) {
      const t = i + 10;
      const le = b[t] === 0x49;
      const u16 = (o: number) => (le ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1]);
      const u32 = (o: number) => (le ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0 : ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0);
      const ifd = t + u32(t + 4);
      const n = ifd + 2 <= b.length ? u16(ifd) : 0;
      for (let k = 0; k < n; k++) {
        const e = ifd + 2 + k * 12;
        if (e + 12 > b.length) break;
        if (u16(e) === 0x0112) orientation = u16(e + 8) || 1;
      }
    }
    if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
      return { components: b[i + 9], orientation, height: (b[i + 5] << 8) | b[i + 6], width: (b[i + 7] << 8) | b[i + 8] };
    }
    if (marker === 0xda) break;
    i += 2 + len;
  }
  return null;
}

/** a photo opened for the PDF */
export interface OpenedImage {
  /** its pixel size as a browser draws it (EXIF orientation applied) */
  width: number;
  height: number;
  mime: string;
  /** the file's bytes, when the PDF may embed them as they are (a plain RGB or grey JPEG, upright) */
  passThrough: Uint8Array | null;
  handle: unknown;
}

export interface ImagePipeline {
  open(url: string, signal?: AbortSignal): Promise<OpenedImage>;
  /** the part (sx, sy, sw, sh in the photo's pixels) at outW × outH, the CSS filter applied: JPEG, or PNG when it has
      transparency */
  render(img: OpenedImage, crop: Rect, outW: number, outH: number, filter: string): Promise<{ bytes: Uint8Array; format: 'jpg' | 'png' }>;
  close(img: OpenedImage): void;
  /** an SVG drawn as a PNG of wPx × hPx (a chart the PDF can't draw as vectors) */
  rasterizeSvg(svg: string, wPx: number, hPx: number): Promise<Uint8Array>;
}

/* ---------- the browser's ---------- */
type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;

function makeCanvas(w: number, h: number): AnyCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

async function canvasBytes(c: AnyCanvas, type: string, quality?: number): Promise<Uint8Array> {
  let blob: Blob | null;
  if ('convertToBlob' in c) blob = await c.convertToBlob({ type, quality });
  else blob = await new Promise<Blob | null>((resolve) => (c as HTMLCanvasElement).toBlob(resolve, type, quality));
  if (!blob) throw new Error('The browser could not encode a picture for the PDF.');
  return new Uint8Array(await blob.arrayBuffer());
}

function release(c: AnyCanvas): void {
  c.width = 0;
  c.height = 0;
}

/* any pixel less than opaque, looked for on a small copy (a photo with a transparent background shows it there) */
function hasTransparency(src: AnyCanvas): boolean {
  const w = Math.min(160, src.width);
  const h = Math.min(160, src.height);
  const probe = makeCanvas(w, h);
  try {
    const ctx = probe.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!ctx) return false;
    ctx.drawImage(src as CanvasImageSource, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    for (let i = 3; i < data.length; i += 4) if (data[i] < 250) return true;
    return false;
  } finally {
    release(probe);
  }
}

async function fetchImageBytes(url: string, signal?: AbortSignal): Promise<{ bytes: Uint8Array; mime: string }> {
  const authed = typeof window !== 'undefined' && url.startsWith('/api/') ? window.RevampAuth?.authedFetch : undefined;
  const resp = authed ? await authed(url, { signal }) : await fetch(url, { credentials: 'same-origin', signal });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const bytes = new Uint8Array(await resp.arrayBuffer());
  return { bytes, mime: (resp.headers.get('content-type') || '').split(';')[0].trim().toLowerCase() };
}

function sniffMime(b: Uint8Array, given: string): string {
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[9] === 0x45) return 'image/webp';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
  return given || 'application/octet-stream';
}

export const browserImagePipeline: ImagePipeline = {
  async open(url, signal) {
    const { bytes, mime: given } = await fetchImageBytes(url, signal);
    const mime = sniffMime(bytes, given);
    const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: mime }));
    const info = mime === 'image/jpeg' ? jpegInfo(bytes) : null;
    const plain = !!info && (info.components === 3 || info.components === 1) && info.orientation <= 1;
    return { width: bitmap.width, height: bitmap.height, mime, passThrough: plain ? bytes : null, handle: bitmap };
  },
  async render(img, crop, outW, outH, filter) {
    const c = makeCanvas(Math.max(1, outW), Math.max(1, outH));
    try {
      const ctx = c.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
      if (!ctx) throw new Error('The browser could not prepare a picture for the PDF.');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      if (filter) ctx.filter = filter;
      ctx.drawImage(img.handle as ImageBitmap, crop.x, crop.y, crop.w, crop.h, 0, 0, c.width, c.height);
      const alpha = img.mime !== 'image/jpeg' && hasTransparency(c);
      const bytes = alpha ? await canvasBytes(c, 'image/png') : await canvasBytes(c, 'image/jpeg', 0.92);
      return { bytes, format: alpha ? 'png' : 'jpg' };
    } finally {
      release(c);
    }
  },
  close(img) {
    try {
      (img.handle as ImageBitmap)?.close?.();
    } catch {
      /* already let go */
    }
    img.handle = null;
  },
  async rasterizeSvg(svg, wPx, hPx) {
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
    const c = makeCanvas(Math.max(1, wPx), Math.max(1, hPx));
    try {
      const pic = await new Promise<HTMLImageElement>((resolve, reject) => {
        const im = new Image();
        im.onload = () => resolve(im);
        im.onerror = () => reject(new Error('The chart could not be drawn as a picture.'));
        im.src = url;
      });
      const ctx = c.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
      if (!ctx) throw new Error('The browser could not prepare a picture for the PDF.');
      ctx.drawImage(pic, 0, 0, c.width, c.height);
      return await canvasBytes(c, 'image/png');
    } finally {
      URL.revokeObjectURL(url);
      release(c);
    }
  },
};
