/* The print-ready vector PDF (Books Phase 4, 27 Nov 2026; docs/bookstudio/PLAN.md). Phase 1 kept the AI Studio
   export's PDF of JPEG pictures of the pages; this draws each page as a printer expects it:
     - text as real, selectable, searchable text in the book's own fonts, embedded as subsets (pdf/fonts.ts), each
       line and word exactly where the editor's layout puts them (textEngine.layoutTextLines: the same breaks, lines
       and fit as the canvas and its overflow check), letter spacing as character spacing, justified lines word by
       word; frames clipped as the canvas clips them;
     - shapes, rules and lines as vectors: fill, border (inside the frame, as CSS draws it), dashes, rounded corners,
       ovals and triangles, opacity and rotation;
     - photos from their print copies, placed, zoomed and cropped exactly as the canvas shows them (pdf/images.ts),
       cut to the part that shows, filtered as the canvas filters them, and made no larger than the target ppi at
       their printed size (never enlarged); a plain upright JPEG that needs none of that goes in as it is;
     - charts as vectors from the SVG the canvas shows (pdf/svg.ts), in the chart's font; one that can't be drawn so
       becomes a 300-ppi picture with a warning;
     - running heads and page numbers as the canvas draws them; hidden frames, guides, the overflow outline and word
       counts never.
   Print mode: each page (or spread) is a sheet of its trim plus its bleed, with crop and bleed marks, registration
   targets and a slug line outside the bleed; TrimBox, BleedBox, CropBox and MediaBox say which is which; a page's own
   size is kept (mixed sizes). Review mode: the trim only. Spreads: facing pages on one sheet, sharing the spine (the
   cover and the back cover alone). The colour is RGB: a browser can't make CMYK, and the result says so.
   A font that can't be embedded stops a print PDF (PdfFontError, naming them); a review PDF sets that text in a
   standard font and says so. The PDF is written as it is made (pdf/writer.ts), a page at a time, so a long photo
   book does not fill the browser's memory. */
import { PDFDocument } from 'pdf-lib';
import type { BookElement, BookPage, BookProject, PageDimensions, PageRole } from '../types/bookstudio';
import { getEffectivePageDimensions } from './dimensionEngine';
import { renderInfographicToSvgString } from './infographicEngine';
import { drawnTextOf, layoutTextLines } from './textEngine';
import { parseColor, type Rgba } from './pdf/color';
import { Draw, PT_PER_MM } from './pdf/draw';
import {
  browserFaceDecls,
  FontBook,
  shapeRun,
  styleName,
  type FaceRequest,
  type FaceUse,
  type FetchAnswer,
  type FontEnv,
  type PdfFontReport,
} from './pdf/fonts';
import { browserImagePipeline, imagePlacement, intersect, photoFilter, type ImagePipeline, type OpenedImage, type Rect } from './pdf/images';
import { compileSvg, svgFaces, SvgUnsupported, type CompiledSvg, type ShapeItem, type TextItem } from './pdf/svg';
import { StreamingPdfWriter } from './pdf/writer';

export type { PdfFontReport } from './pdf/fonts';
export { MEASURED_OPTICAL_SIZE } from './pdf/fonts';
export { imagePlacement } from './pdf/images';

/* =====================================================================================================================
   The contract (the export screen, ExportPreflightModal.tsx, codes against these names)
   ===================================================================================================================== */
export interface PdfExportOptions {
  /** print: bleed, marks and the PDF boxes; review: the trim only, no marks */
  mode: 'print' | 'review';
  /** 1-based, inclusive */
  pages: 'all' | { from: number; to: number };
  /** facing pages side by side on one sheet (the cover and the back cover alone) */
  spreads: boolean;
  /** print mode only */
  marks: { crop: boolean; bleed: boolean; registration: boolean; slug: boolean };
  /** photos are made no larger than this at their printed size (default 300), never enlarged */
  targetPpi: number;
}

export interface PdfExportResult {
  blob: Blob;
  pageCount: number;
  fonts: PdfFontReport[];
  images: { count: number; belowTarget: number };
  sizeBytes: number;
  warnings: string[];
  /** the PDF's colours: always RGB (a browser can't make CMYK) */
  colorSpace: 'RGB';
}

/** print mode: thrown when any font the pages use can't be embedded (never another family in its place) */
export class PdfFontError extends Error {
  fonts: PdfFontReport[];
  constructor(fonts: PdfFontReport[]) {
    const names = fonts.map((f) => styleName(f)).join(', ');
    super(`The print PDF can't be made: ${fonts.length === 1 ? 'this font' : 'these fonts'} can't be embedded — ${names}.`);
    this.name = 'PdfFontError';
    this.fonts = fonts;
  }
}

export function defaultPdfOptions(project: BookProject, mode: 'print' | 'review'): PdfExportOptions {
  const ps = project.printSettings || ({} as BookProject['printSettings']);
  const print = mode === 'print';
  const ppi = Number(ps.targetDpi) || 300;
  return {
    mode,
    pages: 'all',
    /* a printer imposes single pages: print-ready starts with them whatever the book's preview setting; review follows it */
    spreads: print ? false : !!ps.exportSpreads,
    marks: {
      crop: print && ps.includeCropMarks !== false,
      bleed: print && ps.includeBleed !== false && (Number(project.dimensions?.bleedMm) || 0) > 0,
      registration: print && !!ps.includeRegistrationMarks,
      slug: print && ps.includeCropMarks !== false,
    },
    targetPpi: Math.max(72, Math.min(1200, ppi)),
  };
}

/* =====================================================================================================================
   What the engine needs from the browser (tests give their own)
   ===================================================================================================================== */
export interface PdfEnvironment {
  fonts: FontEnv;
  images: ImagePipeline;
  /** asks the browser for every face the pages use, so the layout is measured with them */
  prepareFonts(requests: FaceRequest[]): Promise<void>;
  now(): Date;
}

async function browserGet(url: string, signal?: AbortSignal): Promise<FetchAnswer> {
  const authed = typeof window !== 'undefined' ? window.RevampAuth?.authedFetch : undefined;
  const resp = authed ? await authed(url, { signal }) : await fetch(url, { credentials: 'same-origin', signal });
  const type = (resp.headers.get('content-type') || '').toLowerCase();
  if (type.includes('application/json')) {
    let json: Record<string, unknown> | null = null;
    try {
      json = (await resp.json()) as Record<string, unknown>;
    } catch {
      json = null;
    }
    return { status: resp.status, json, header: (k) => resp.headers.get(k) };
  }
  return { status: resp.status, bytes: new Uint8Array(await resp.arrayBuffer()), header: (k) => resp.headers.get(k) };
}

async function browserPrepareFonts(requests: FaceRequest[]): Promise<void> {
  const set = typeof document !== 'undefined' ? document.fonts : undefined;
  if (!set) return;
  let loadedAny = false;
  await Promise.all(
    requests.map(async (r) => {
      const css = `${r.italic ? 'italic ' : ''}${Math.round(r.weight)} 16px "${r.family.replace(/["\\]/g, '')}"`;
      try {
        if (set.check(css)) return;
        loadedAny = true;
        await Promise.race([set.load(css), new Promise((resolve) => setTimeout(resolve, 8000))]);
      } catch {
        /* a family the browser can't read: measured with its fallback, as drawn */
      }
    })
  );
  try {
    await set.ready;
  } catch {
    /* nothing to wait for */
  }
  // textMeasure takes every width again a moment after a font arrives (its refresh timer): wait for that
  if (loadedAny) await new Promise((resolve) => setTimeout(resolve, 80));
}

const BROWSER_ENV: PdfEnvironment = {
  fonts: { browserFaces: browserFaceDecls, get: browserGet },
  images: browserImagePipeline,
  prepareFonts: browserPrepareFonts,
  now: () => new Date(),
};

let override: Partial<PdfEnvironment> | null = null;
/** replaces parts of what the engine takes from the browser (tests); null: the browser's own */
export function setPdfEnvironment(env: Partial<PdfEnvironment> | null): void {
  override = env;
}
function env(): PdfEnvironment {
  return { ...BROWSER_ENV, ...(override || {}) };
}

/* =====================================================================================================================
   Sheets: which pages, on which PDF page, where
   ===================================================================================================================== */
interface PlacedPage {
  index: number;
  number: number;
  page: BookPage;
  dim: PageDimensions;
  side: 'single' | 'left' | 'right';
  /** the page's trim left within the sheet's trim, mm */
  ox: number;
}
interface Sheet {
  pages: PlacedPage[];
  trimW: number;
  trimH: number;
}

const ALONE: PageRole[] = ['front_cover', 'back_cover'];

function chosenIndexes(project: BookProject, pages: PdfExportOptions['pages']): number[] {
  const n = project.pages.length;
  if (pages === 'all' || !pages) return Array.from({ length: n }, (_, i) => i);
  const from = Math.max(1, Math.min(n, Math.round(Number(pages.from) || 1)));
  const to = Math.max(from, Math.min(n, Math.round(Number(pages.to) || n)));
  return Array.from({ length: to - from + 1 }, (_, i) => from - 1 + i);
}

function planSheets(project: BookProject, indexes: number[], spreads: boolean, warn: (w: string) => void): Sheet[] {
  const dimOf = (i: number) => getEffectivePageDimensions(project.pages[i], project.dimensions);
  const single = (i: number): Sheet => {
    const dim = dimOf(i);
    return { pages: [{ index: i, number: i + 1, page: project.pages[i], dim, side: 'single', ox: 0 }], trimW: dim.widthMm, trimH: dim.heightMm };
  };
  if (!spreads) return indexes.map(single);
  const chosen = new Set(indexes);
  const out: Sheet[] = [];
  const isAlone = (i: number) => i === 0 || ALONE.includes(project.pages[i].role);
  for (let k = 0; k < indexes.length; k++) {
    const i = indexes[k];
    /* the editor's spreads: the first page alone, then pages 2–3, 4–5… (a left page has an odd index) */
    if (isAlone(i) || i % 2 === 0 || !chosen.has(i + 1) || i + 1 >= project.pages.length || isAlone(i + 1)) {
      out.push(single(i));
      continue;
    }
    const a = dimOf(i);
    const b = dimOf(i + 1);
    if (Math.abs(a.heightMm - b.heightMm) > 0.05) {
      warn(`Pages ${i + 1} and ${i + 2} are different heights, so they are on separate sheets`);
      out.push(single(i));
      continue;
    }
    out.push({
      pages: [
        { index: i, number: i + 1, page: project.pages[i], dim: a, side: 'left', ox: 0 },
        { index: i + 1, number: i + 2, page: project.pages[i + 1], dim: b, side: 'right', ox: a.widthMm },
      ],
      trimW: a.widthMm + b.widthMm,
      trimH: a.heightMm,
    });
    k += 1;
  }
  return out;
}

/** room outside the bleed for the marks and the slug line (each side), mm */
export const SLUG_MM = 12;
/** the marks start this far outside the bleed, mm */
const MARK_GAP_MM = 2;
const MARK_LEN_MM = 5;
const HAIRLINE_MM = 0.25 / PT_PER_MM;

/* =====================================================================================================================
   Drawing
   ===================================================================================================================== */
const TEXT_TYPES = new Set(['text', 'header', 'footer', 'pageNumber', 'logo']);
const SHAPE_TYPES = new Set(['shape', 'line', 'decorative']);
const INK: Rgba = { r: 0x1c / 255, g: 0x19 / 255, b: 0x17 / 255, a: 1 };
const REGISTRATION: Rgba = { r: 0, g: 0, b: 0, a: 1 };

class Abort extends Error {
  constructor() {
    super('The export was cancelled.');
    this.name = 'AbortError';
  }
}
function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Abort();
}

interface Job {
  doc: PDFDocument;
  fonts: FontBook;
  env: PdfEnvironment;
  options: PdfExportOptions;
  signal?: AbortSignal;
  warnings: string[];
  images: { count: number; belowTarget: number };
  /** pictures already in the PDF: the same cut of the same photo is embedded once */
  embedded: Map<string, { ref: import('pdf-lib').PDFRef }>;
  /** each photo's pixel size, once read */
  sizes: Map<string, { width: number; height: number }>;
  emptyPhotos: number[];
  failedPhotos: string[];
  rasterCharts: string[];
  narrowed: Map<string, { most: number; pages: Set<number> }>;
  fallbackText: Set<string>;
  charts: Map<BookElement, CompiledSvg | SvgUnsupported>;
}

/* ---------- text ---------- */
interface TextPaint {
  use: FaceUse;
  /** the font size in the units drawn in (mm on a page; the chart's own units in a chart) */
  size: number;
  tc: number;
  page: number;
  noLig: boolean;
  /** words are drawn to their measured widths (the editor's layout); charts aren't measured */
  fitToMeasure: boolean;
}

/* Chrome's made-up bold: the outline grown by size × (1/24 at 9 px … 1/32 at 36 px) */
function fakeBoldWidth(sizePt: number): number {
  const t = Math.max(0, Math.min(1, (sizePt - 9) / 27));
  return 1 / 24 + (1 / 32 - 1 / 24) * t;
}

function startText(d: Draw, p: TextPaint, color: Rgba, alpha: number, sizePt: number): void {
  d.beginText();
  d.font(p.use.face.font, p.size);
  if (p.tc) d.charSpacing(p.tc);
  d.fillColor(color);
  d.alpha(alpha, alpha);
  if (p.use.syntheticBold) {
    d.strokeColor(color);
    d.lineWidth(p.size * fakeBoldWidth(sizePt));
    d.lineJoin(1);
    d.renderMode(2);
  }
}

/* words on one baseline, each starting at its x: one TJ for words drawn at the face's own widths, a word of its own
   (narrowed or widened to its measured width) where the face sets it differently from how it was measured */
function drawWords(d: Draw, p: TextPaint, words: Array<{ text: string; x: number; width?: number }>, baseline: number, job: Job, state: { tz: number }): void {
  const face = p.use.face;
  const skew = p.use.syntheticItalic ? 0.25 : 0;
  const space = shapeRun(face, ' ', p.noLig, p.page);
  const runs = words.map((w) => {
    const run = shapeRun(face, w.text, p.noLig, p.page);
    const natural = run.width * p.size + p.tc * run.codes.length;
    let tz = 100;
    if (p.fitToMeasure && w.width !== undefined && natural > 0) {
      const diff = Math.abs(natural - w.width);
      if (diff > Math.max(0.01, w.width * 0.0015)) {
        tz = Math.max(50, Math.min(200, (w.width / natural) * 100));
      }
      /* a standard font in a review PDF is said once, on its own */
      if (tz !== 100 && !face.standard) {
        const key = styleName(face);
        const n = job.narrowed.get(key) || { most: 0, pages: new Set<number>() };
        n.most = Math.max(n.most, Math.abs(100 - tz));
        if (Math.abs(100 - tz) >= 1) n.pages.add(p.page);
        job.narrowed.set(key, n);
      }
    }
    return { w, run, tz };
  });
  let k = 0;
  while (k < runs.length) {
    const tz = runs[k].tz;
    let end = k + 1;
    if (tz === 100) while (end < runs.length && runs[end].tz === 100) end += 1;
    if (state.tz !== tz) {
      d.hScale(tz);
      state.tz = tz;
    }
    const th = tz / 100;
    const x0 = runs[k].w.x;
    d.textMatrix(1, 0, skew, -1, x0, baseline);
    const items: Array<string | number> = [];
    let pen = x0;
    for (let j = k; j < end; j++) {
      const { run } = runs[j];
      for (let g = 0; g < run.codes.length; g++) {
        items.push(run.codes[g]);
        pen += (run.adv[g] * p.size + p.tc) * th;
        if (run.kern[g]) {
          items.push(-run.kern[g] * 1000);
          pen += run.kern[g] * p.size * th;
        }
      }
      if (j + 1 === end && end < runs.length) {
        /* a word set on its own: its space goes with it, so the text reads (and copies) with its spaces */
        for (let g = 0; g < space.codes.length; g++) items.push(space.codes[g]);
      } else if (j + 1 < end) {
        for (let g = 0; g < space.codes.length; g++) {
          items.push(space.codes[g]);
          pen += (space.adv[g] * p.size + p.tc) * th;
        }
        const next = runs[j + 1].w.x;
        items.push((-(next - pen) / (p.size * th)) * 1000);
        pen = next;
      }
    }
    d.showAdjusted(items);
    k = end;
  }
}

async function faceFor(job: Job, family: string, weight: number, italic: boolean): Promise<FaceUse | null> {
  const use = job.fonts.use(family, weight, italic);
  if (use) return use;
  if (job.options.mode === 'print') return null; // (refused before any page is drawn)
  job.fallbackText.add(styleName({ family: family || 'No font', weight, italic }));
  return job.fonts.fallback(weight, italic);
}

async function drawTextFrame(d: Draw, el: BookElement, pageNumber: number, job: Job): Promise<void> {
  const st = el.textStyle;
  if (!st) return;
  if (!drawnTextOf(el, pageNumber).trim()) return;
  const italic = st.fontStyle === 'italic';
  const use = await faceFor(job, st.fontFamily, Number(st.fontWeight) || 400, italic);
  if (!use) return;
  const laid = layoutTextLines(el, { pageNumber, metrics: () => ({ ascent: use.face.ascent, descent: use.face.descent }) });
  if (!laid.lines.length) return;
  const color = parseColor(laid.color) || INK;
  const sizeMm = (Number(laid.sizePt) || 0) * (25.4 / 72);
  if (!(sizeMm > 0)) return;
  const tc = (Number(st.letterSpacingEm) || 0) * sizeMm;
  const alpha = (el.opacity ?? 1) * color.a;
  if (!(alpha > 0)) return;
  d.save();
  d.rotateAbout(el.xMm + el.widthMm / 2, el.yMm + el.heightMm / 2, Number(el.rotation) || 0);
  d.rect(el.xMm, el.yMm, el.widthMm, el.heightMm);
  d.clip();
  const paint: TextPaint = { use, size: sizeMm, tc, page: pageNumber, noLig: tc !== 0, fitToMeasure: true };
  startText(d, paint, color, alpha, Number(laid.sizePt) || 0);
  const state = { tz: 100 };
  for (const line of laid.lines) {
    const words = (line.words && line.words.length ? line.words : [{ text: line.text.trimStart(), xMm: line.xMm, widthMm: line.widthMm }]).map((w) => ({
      text: w.text,
      x: el.xMm + w.xMm,
      width: w.widthMm,
    }));
    drawWords(d, paint, words, el.yMm + line.baselineMm, job, state);
  }
  d.endText();
  d.restore();
}

/* ---------- shapes, rules, lines ---------- */
function outline(d: Draw, kind: string, x: number, y: number, w: number, h: number, r: number): void {
  if (w <= 0 || h <= 0) return;
  if (kind === 'ellipse') d.ellipse(x + w / 2, y + h / 2, w / 2, h / 2);
  else if (kind === 'triangle') {
    d.moveTo(x + w / 2, y);
    d.lineTo(x + w, y + h);
    d.lineTo(x, y + h);
    d.close();
  } else d.roundRect(x, y, w, h, r);
}

function dashFor(style: string | undefined, width: number): { pattern: number[]; cap: 0 | 1 } {
  if (style === 'dashed') return { pattern: [3 * width, 3 * width], cap: 0 };
  if (style === 'dotted') return { pattern: [0, 2 * width], cap: 1 };
  return { pattern: [], cap: 0 };
}

function drawShape(d: Draw, el: BookElement): void {
  const sh = el.shape;
  if (!sh) return;
  const op = el.opacity ?? 1;
  if (!(op > 0)) return;
  const { xMm: x, yMm: y, widthMm: w, heightMm: h } = el;
  d.save();
  d.rotateAbout(x + w / 2, y + h / 2, Number(el.rotation) || 0);
  if (el.type === 'line' || sh.shapeKind === 'rule') {
    /* BookCanvas: a border across the frame's middle, as thick as the stroke (0.4 mm when none is set) */
    const color = parseColor(sh.stroke || '#C6A26B');
    const t = Number(sh.strokeWidthMm) || 0.4;
    if (color && t > 0 && w > 0) {
      d.alpha(op * color.a, op * color.a);
      const mid = y + h / 2;
      if (!sh.dashStyle || sh.dashStyle === 'solid') {
        d.fillColor(color);
        d.rect(x, mid - t / 2, w, t);
        d.fill();
      } else {
        const dash = dashFor(sh.dashStyle, t);
        d.strokeColor(color);
        d.lineWidth(t);
        d.lineCap(dash.cap);
        d.dash(dash.pattern, 0);
        d.moveTo(x + (dash.cap ? t / 2 : 0), mid);
        d.lineTo(x + w - (dash.cap ? t / 2 : 0), mid);
        d.stroke();
      }
    }
    d.restore();
    return;
  }
  const kind = sh.shapeKind;
  const fill = parseColor(sh.fill);
  const bw = Math.max(0, Number(sh.strokeWidthMm) || 0);
  const stroke = bw > 0 ? parseColor(sh.stroke) : null;
  const r = kind === 'ellipse' ? 0 : Math.max(0, Number(sh.cornerRadiusMm) || 0);
  if (fill) {
    /* CSS paints the background under the border; with the frame see-through the border must not double it */
    const inner = stroke && op < 1 && kind !== 'triangle';
    d.alpha(op * fill.a, op * fill.a);
    d.fillColor(fill);
    if (inner) outline(d, kind, x + bw, y + bw, w - 2 * bw, h - 2 * bw, Math.max(0, r - bw));
    else outline(d, kind, x, y, w, h, r);
    d.fill();
  }
  if (stroke && w > 0 && h > 0) {
    const dash = dashFor(sh.dashStyle, bw);
    d.alpha(op * stroke.a, op * stroke.a);
    d.strokeColor(stroke);
    d.lineCap(dash.cap);
    d.dash(dash.pattern, 0);
    if (kind === 'triangle') {
      /* the border inside the triangle: its outline stroked twice as wide, inside it only */
      d.save();
      outline(d, kind, x, y, w, h, 0);
      d.clip();
      d.lineWidth(2 * bw);
      d.lineJoin(0);
      outline(d, kind, x, y, w, h, 0);
      d.stroke();
      d.restore();
    } else {
      /* the border is inside the box (border-box): its middle runs half its width in */
      d.lineWidth(Math.min(bw, w, h));
      outline(d, kind, x + bw / 2, y + bw / 2, w - bw, h - bw, Math.max(0, r - bw / 2));
      d.stroke();
    }
  }
  d.restore();
}

/* ---------- photos ---------- */
function errText(err: unknown): string {
  const m = String((err as Error)?.message || err || 'unknown error').replace(/\s+/g, ' ').trim();
  return m.length > 120 ? `${m.slice(0, 117)}…` : m;
}

function printUrlOf(src: string): string {
  // the full-size copy beside the editor's screen copy (exportEngine.printSourceOf: the same rule)
  return String(src || '').replace(/^(\/api\/books\/asset\/as_[a-f0-9]{20})\/display$/, '$1/print');
}

async function drawPhoto(d: Draw, el: BookElement, pageNumber: number, pageClip: Rect, job: Job, opened: Map<string, OpenedImage>): Promise<void> {
  const im = el.image;
  if (!im) return;
  if (!im.src) {
    job.emptyPhotos.push(pageNumber);
    return;
  }
  const op = el.opacity ?? 1;
  if (!(op > 0)) return;
  const url = printUrlOf(im.src);
  const w = el.widthMm;
  const h = el.heightMm;
  if (!(w > 0 && h > 0)) return;
  let size = job.sizes.get(url);
  let img = opened.get(url) || null;
  try {
    if (!size) {
      checkAbort(job.signal);
      img = await job.env.images.open(url, job.signal);
      opened.set(url, img);
      size = { width: img.width, height: img.height };
      job.sizes.set(url, size);
    }
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') throw err;
    job.failedPhotos.push(`page ${pageNumber} (${el.name || 'photo'}: ${errText(err)})`);
    return;
  }
  const place = imagePlacement(w, h, size.width, size.height, im.fit, im.zoom, im.focalX, im.focalY);
  /* what shows: the frame, and (a frame not turned) the page with its bleed */
  let view: Rect | null = intersect(place, { x: 0, y: 0, w, h });
  if (view && !(Number(el.rotation) || 0)) view = intersect(view, { x: pageClip.x - el.xMm, y: pageClip.y - el.yMm, w: pageClip.w, h: pageClip.h });
  if (!view) return;
  /* the photo's pixels that show, to whole pixels */
  const pxPerMmX = size.width / place.w;
  const pxPerMmY = size.height / place.h;
  const sx = Math.max(0, Math.floor((view.x - place.x) * pxPerMmX + 1e-6));
  const sy = Math.max(0, Math.floor((view.y - place.y) * pxPerMmY + 1e-6));
  const ex = Math.min(size.width, Math.ceil((view.x + view.w - place.x) * pxPerMmX - 1e-6));
  const ey = Math.min(size.height, Math.ceil((view.y + view.h - place.y) * pxPerMmY - 1e-6));
  const crop: Rect = { x: sx, y: sy, w: Math.max(1, ex - sx), h: Math.max(1, ey - sy) };
  const drawn: Rect = { x: place.x + sx / pxPerMmX, y: place.y + sy / pxPerMmY, w: crop.w / pxPerMmX, h: crop.h / pxPerMmY };
  /* its resolution as printed, and the size to keep */
  const ppi = Math.min(pxPerMmX, pxPerMmY) * 25.4;
  const target = job.options.targetPpi || 300;
  job.images.count += 1;
  if (ppi < target - 0.5) job.images.belowTarget += 1;
  const scale = Math.min(1, target / ppi);
  const outW = Math.max(1, Math.round(crop.w * scale));
  const outH = Math.max(1, Math.round(crop.h * scale));
  const filter = photoFilter(im);
  const key = `${url}|${crop.x},${crop.y},${crop.w},${crop.h}|${outW}x${outH}|${filter}`;
  let pic = job.embedded.get(key);
  if (!pic) {
    try {
      if (!img) {
        checkAbort(job.signal);
        img = await job.env.images.open(url, job.signal);
        opened.set(url, img);
      }
      const whole = crop.x === 0 && crop.y === 0 && crop.w === img.width && crop.h === img.height;
      let bytes: Uint8Array;
      let format: 'jpg' | 'png';
      if (img.passThrough && whole && !filter && outW === crop.w && outH === crop.h) {
        bytes = img.passThrough;
        format = 'jpg';
      } else {
        const out = await job.env.images.render(img, crop, outW, outH, filter);
        bytes = out.bytes;
        format = out.format;
      }
      const embedded = format === 'png' ? await job.doc.embedPng(bytes) : await job.doc.embedJpg(bytes);
      await embedded.embed();
      pic = { ref: embedded.ref };
      job.embedded.set(key, pic);
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') throw err;
      job.failedPhotos.push(`page ${pageNumber} (${el.name || 'photo'}: ${errText(err)})`);
      return;
    }
  }
  d.save();
  d.rotateAbout(el.xMm + w / 2, el.yMm + h / 2, Number(el.rotation) || 0);
  d.roundRect(el.xMm, el.yMm, w, h, Math.max(0, Number(im.borderRadiusMm) || 0));
  d.clip();
  if (op < 1) d.alpha(op, op);
  d.image(pic.ref, el.xMm + drawn.x, el.yMm + drawn.y, drawn.w, drawn.h);
  d.restore();
}

/* ---------- charts ---------- */
function chartOf(el: BookElement, job: Job): CompiledSvg | SvgUnsupported {
  let c = job.charts.get(el);
  if (!c) {
    const svg = renderInfographicToSvgString(el.infographic!, Math.round(el.widthMm * 3.2), Math.round(el.heightMm * 3.2));
    try {
      c = compileSvg(svg);
    } catch (err) {
      c = err instanceof SvgUnsupported ? err : new SvgUnsupported(String((err as Error)?.message || err));
    }
    job.charts.set(el, c);
  }
  return c;
}

function emitPath(d: Draw, item: ShapeItem): void {
  for (const c of item.path) {
    if (c[0] === 'M') d.moveTo(c[1], c[2]);
    else if (c[0] === 'L') d.lineTo(c[1], c[2]);
    else if (c[0] === 'C') d.curveTo(c[1], c[2], c[3], c[4], c[5], c[6]);
    else d.close();
  }
}

async function drawChart(d: Draw, el: BookElement, pageNumber: number, job: Job): Promise<void> {
  const data = el.infographic;
  if (!data) return;
  const op = el.opacity ?? 1;
  if (!(op > 0)) return;
  const w = el.widthMm;
  const h = el.heightMm;
  if (!(w > 0 && h > 0)) return;
  const chart = chartOf(el, job);
  d.save();
  d.rotateAbout(el.xMm + w / 2, el.yMm + h / 2, Number(el.rotation) || 0);
  d.rect(el.xMm, el.yMm, w, h);
  d.clip();
  if (chart instanceof SvgUnsupported) {
    /* drawn as a picture at 300 ppi, with a warning */
    const svg = renderInfographicToSvgString(data, Math.round(w * 3.2), Math.round(h * 3.2));
    try {
      const png = await job.env.images.rasterizeSvg(svg, Math.round((w / 25.4) * 300), Math.round((h / 25.4) * 300));
      const pic = await job.doc.embedPng(png);
      await pic.embed();
      if (op < 1) d.alpha(op, op);
      d.image(pic.ref, el.xMm, el.yMm, w, h);
      job.rasterCharts.push(`page ${pageNumber} (${chart.message})`);
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') throw err;
      job.failedPhotos.push(`page ${pageNumber} (chart "${data.title || el.name}")`);
    }
    d.restore();
    return;
  }
  const vb = chart.viewBox;
  const sx = w / vb.w;
  const sy = h / vb.h;
  const s = Math.min(sx, sy);
  if (chart.preserve === 'none') d.cm(sx, 0, 0, sy, el.xMm - vb.x * sx, el.yMm - vb.y * sy);
  else d.cm(s, 0, 0, s, el.xMm + (w - vb.w * s) / 2 - vb.x * s, el.yMm + (h - vb.h * s) / 2 - vb.y * s);
  const chartFamily = data.fontFamily || 'Plus Jakarta Sans';
  for (const item of chart.items) {
    if (item.kind === 'path') {
      const p = item.paint;
      d.save();
      d.cm(...item.m);
      if (p.fill && !(item.arcs && !p.fill)) {
        const a = op * p.fillOpacity * p.fill.a;
        if (a > 0) {
          d.alpha(a, a);
          d.fillColor(p.fill);
          emitPath(d, item);
          d.fill(p.evenOdd);
        }
      }
      if (p.stroke && p.strokeWidth > 0) {
        const a = op * p.strokeOpacity * p.stroke.a;
        if (a > 0) {
          d.alpha(a, a);
          d.strokeColor(p.stroke);
          d.lineWidth(p.strokeWidth);
          d.lineCap(p.cap);
          d.lineJoin(p.join);
          if (item.arcs) {
            d.dash([], 0);
            for (const [a0, a1] of item.arcs.spans) d.arc(item.arcs.cx, item.arcs.cy, item.arcs.r, a0, a1);
          } else {
            const total = p.dash.reduce((t, v) => t + v, 0);
            d.dash(p.dash, total > 0 ? ((p.dashOffset % total) + total) % total : 0);
            emitPath(d, item);
          }
          d.stroke();
        }
      }
      d.restore();
    } else {
      await drawChartText(d, item, chartFamily, pageNumber, op, job);
    }
  }
  d.restore();
}

async function drawChartText(d: Draw, t: TextItem, chartFamily: string, pageNumber: number, op: number, job: Job): Promise<void> {
  if (!t.fill) return;
  const alpha = op * t.opacity * t.fill.a;
  if (!(alpha > 0)) return;
  const use = await faceFor(job, t.family || chartFamily, t.weight, t.italic);
  if (!use) return;
  const noLig = t.letterSpacing !== 0;
  const run = shapeRun(use.face, t.text, noLig, pageNumber);
  const width = run.width * t.size + t.letterSpacing * run.codes.length;
  const x = t.anchor === 'middle' ? t.x - width / 2 : t.anchor === 'end' ? t.x - width : t.x;
  d.save();
  d.cm(...t.m);
  const paint: TextPaint = { use, size: t.size, tc: t.letterSpacing, page: pageNumber, noLig, fitToMeasure: false };
  startText(d, paint, t.fill, alpha, t.size * 0.75);
  drawWords(d, paint, [{ text: t.text, x }], t.y, job, { tz: 100 });
  d.endText();
  d.restore();
}

/* ---------- marks ---------- */
function drawMarks(d: Draw, sheet: Sheet, bleed: number, margin: number, marks: PdfExportOptions['marks'], slug: string, job: Job, pageForGlyphs: number): void {
  const tx = margin;
  const ty = margin;
  const tw = sheet.trimW;
  const th = sheet.trimH;
  const off = bleed + MARK_GAP_MM;
  d.save();
  d.strokeColor(REGISTRATION);
  d.lineWidth(HAIRLINE_MM);
  d.lineCap(0);
  d.dash([], 0);
  const line = (x1: number, y1: number, x2: number, y2: number) => {
    d.moveTo(x1, y1);
    d.lineTo(x2, y2);
    d.stroke();
  };
  if (marks.crop) {
    for (const [cx, sxDir] of [
      [tx, -1],
      [tx + tw, 1],
    ] as const) {
      for (const [cy, syDir] of [
        [ty, -1],
        [ty + th, 1],
      ] as const) {
        line(cx + sxDir * off, cy, cx + sxDir * (off + MARK_LEN_MM), cy);
        line(cx, cy + syDir * off, cx, cy + syDir * (off + MARK_LEN_MM));
      }
    }
    /* a spread's spine, top and bottom */
    if (sheet.pages.length === 2) {
      const sx = tx + sheet.pages[1].ox;
      line(sx, ty - off, sx, ty - off - MARK_LEN_MM);
      line(sx, ty + th + off, sx, ty + th + off + MARK_LEN_MM);
    }
  }
  if (marks.bleed && bleed > 0) {
    const bx = tx - bleed;
    const by = ty - bleed;
    const bw = tw + 2 * bleed;
    const bh = th + 2 * bleed;
    const len = 3;
    for (const [cx, sxDir] of [
      [bx, -1],
      [bx + bw, 1],
    ] as const) {
      for (const [cy, syDir] of [
        [by, -1],
        [by + bh, 1],
      ] as const) {
        line(cx + sxDir * MARK_GAP_MM, cy, cx + sxDir * (MARK_GAP_MM + len), cy);
        line(cx, cy + syDir * MARK_GAP_MM, cx, cy + syDir * (MARK_GAP_MM + len));
      }
    }
  }
  if (marks.registration) {
    const r = 2;
    const at = off + 3;
    /* top and bottom at each page's middle (on a spread, never over the spine's mark), and at the sides */
    const mids = sheet.pages.map((p) => tx + p.ox + p.dim.widthMm / 2);
    const targets: Array<[number, number]> = [
      ...mids.map((x): [number, number] => [x, ty - at]),
      ...mids.map((x): [number, number] => [x, ty + th + at]),
      [tx - at, ty + th / 2],
      [tx + tw + at, ty + th / 2],
    ];
    for (const [cx, cy] of targets) {
      d.ellipse(cx, cy, r, r);
      d.stroke();
      d.ellipse(cx, cy, r / 2.5, r / 2.5);
      d.fillColor(REGISTRATION);
      d.fill();
      line(cx - r * 1.6, cy, cx + r * 1.6, cy);
      line(cx, cy - r * 1.6, cx, cy + r * 1.6);
    }
  }
  d.restore();
  if (marks.slug && slug) {
    const face = job.fonts.anyFace();
    if (face) {
      const size = 6 / PT_PER_MM;
      const use: FaceUse = { face, syntheticBold: false, syntheticItalic: false };
      const paint: TextPaint = { use, size, tc: 0, page: pageForGlyphs, noLig: false, fitToMeasure: false };
      d.save();
      startText(d, paint, REGISTRATION, 1, 6);
      /* below the bottom crop marks, from the trim's left, inside the sheet */
      const baseline = Math.min(ty + th + off + MARK_LEN_MM + 3.2, ty + th + margin - 1);
      drawWords(d, paint, [{ text: slug, x: tx }], baseline, job, { tz: 100 });
      d.endText();
      d.restore();
    }
  }
}

/* =====================================================================================================================
   The export
   ===================================================================================================================== */
function collectFaces(project: BookProject, indexes: number[], job: Pick<Job, 'charts'>): FaceRequest[] {
  const out: FaceRequest[] = [];
  for (const i of indexes) {
    const page = project.pages[i];
    for (const el of page.elements) {
      if (el.hidden) continue;
      if (TEXT_TYPES.has(el.type) && el.textStyle && drawnTextOf(el, i + 1).trim()) {
        out.push({ family: el.textStyle.fontFamily, weight: Number(el.textStyle.fontWeight) || 400, italic: el.textStyle.fontStyle === 'italic' });
      } else if (el.type === 'infographic' && el.infographic) {
        const chart = chartOf(el, job as Job);
        if (!(chart instanceof SvgUnsupported)) out.push(...svgFaces(chart, el.infographic.fontFamily || 'Plus Jakarta Sans'));
      }
    }
  }
  return out;
}

function safeDate(d: Date): string {
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export async function exportBookPdf(
  project: BookProject,
  options: PdfExportOptions,
  onProgress?: (done: number, total: number, what: string) => void,
  signal?: AbortSignal
): Promise<PdfExportResult> {
  const E = env();
  const opts: PdfExportOptions = {
    ...defaultPdfOptions(project, options?.mode === 'review' ? 'review' : 'print'),
    ...(options || {}),
  } as PdfExportOptions;
  const print = opts.mode === 'print';
  const marks = print ? { crop: !!opts.marks?.crop, bleed: !!opts.marks?.bleed, registration: !!opts.marks?.registration, slug: !!opts.marks?.slug } : { crop: false, bleed: false, registration: false, slug: false };
  const progress = (done: number, total: number, what: string) => {
    try {
      onProgress?.(done, total, what);
    } catch {
      /* the screen's own trouble is not the export's */
    }
  };
  checkAbort(signal);
  if (!project.pages.length) throw new Error('This book has no pages to export.');

  const warnings: string[] = [];
  const indexes = chosenIndexes(project, opts.pages);
  const sheets = planSheets(project, indexes, !!opts.spreads, (w) => warnings.push(w));
  const total = indexes.length;
  const now = E.now();

  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.setTitle(project.name || 'Book', { showInWindowTitleBar: true });
  doc.setSubject(`${print ? 'Print-ready PDF' : 'Review PDF'} · colour: RGB (no CMYK conversion)`);
  doc.setCreator('ETB2B EventSphere Books');
  doc.setProducer('ETB2B EventSphere Books (pdf-lib, fontkit)');
  doc.setCreationDate(now);
  doc.setModificationDate(now);

  const job: Job = {
    doc,
    fonts: new FontBook(doc, E.fonts),
    env: E,
    options: opts,
    signal,
    warnings,
    images: { count: 0, belowTarget: 0 },
    embedded: new Map(),
    sizes: new Map(),
    emptyPhotos: [],
    failedPhotos: [],
    rasterCharts: [],
    narrowed: new Map(),
    fallbackText: new Set(),
    charts: new Map(),
  };

  /* 1. fonts: the browser loads them (so the layout is measured with them), then each is fetched and embedded */
  progress(0, total, 'Fonts');
  const requests = collectFaces(project, indexes, job);
  await E.prepareFonts(requests);
  checkAbort(signal);
  await job.fonts.load(requests, signal);
  checkAbort(signal);
  const failures = job.fonts.failures();
  if (failures.length && print) throw new PdfFontError(failures);

  /* 2. the sheets, a page at a time, each written out when done */
  const writer = new StreamingPdfWriter(doc);
  let done = 0;
  const bookPages = project.pages.length;
  for (const sheet of sheets) {
    checkAbort(signal);
    const bleed = print ? Math.max(0, ...sheet.pages.map((p) => Math.max(0, Number(p.dim.bleedMm) || 0))) : 0;
    const anyMark = marks.crop || marks.bleed || marks.registration || marks.slug;
    const slugMm = print && anyMark ? SLUG_MM : 0;
    const margin = bleed + slugMm;
    const W = sheet.trimW + 2 * margin;
    const H = sheet.trimH + 2 * margin;
    const pdfPage = doc.addPage([W * PT_PER_MM, H * PT_PER_MM]);
    const k = PT_PER_MM;
    pdfPage.setMediaBox(0, 0, W * k, H * k);
    pdfPage.setCropBox(0, 0, W * k, H * k);
    pdfPage.setBleedBox(slugMm * k, slugMm * k, (sheet.trimW + 2 * bleed) * k, (sheet.trimH + 2 * bleed) * k);
    pdfPage.setTrimBox(margin * k, margin * k, sheet.trimW * k, sheet.trimH * k);
    const d = new Draw(doc, pdfPage);
    /* millimetres from the sheet's top-left, y down, as the canvas */
    d.cm(k, 0, 0, -k, 0, H * k);

    for (const placed of sheet.pages) {
      const n = placed.number;
      const label = `Page ${n} of ${bookPages}`;
      progress(done, total, label);
      const { page, dim } = placed;
      /* the page's own area: its trim and its bleed, except at a spread's spine */
      const left = placed.side === 'right' ? 0 : bleed;
      const right = placed.side === 'left' ? 0 : bleed;
      const area: Rect = { x: -left, y: -bleed, w: dim.widthMm + left + right, h: dim.heightMm + 2 * bleed };
      d.save();
      d.translate(margin + placed.ox, margin);
      d.rect(area.x, area.y, area.w, area.h);
      d.clip();
      const bg = parseColor(page.backgroundColor || project.designSystem?.colors?.paper || '#FBF9F5');
      if (bg) {
        d.alpha(bg.a, bg.a);
        d.fillColor(bg);
        d.rect(area.x, area.y, area.w, area.h);
        d.fill();
        d.alpha(1, 1);
      }
      const els = page.elements.filter((e) => !e.hidden).sort((a, b) => a.zIndex - b.zIndex);
      const opened = new Map<string, OpenedImage>();
      let saidPhotos = false;
      let saidCharts = false;
      try {
        for (const el of els) {
          if (el.type === 'image') {
            if (!saidPhotos) {
              progress(done, total, `${label}: photos`);
              saidPhotos = true;
            }
            checkAbort(signal);
            await drawPhoto(d, el, n, area, job, opened);
          } else if (el.type === 'infographic') {
            if (!saidCharts) {
              progress(done, total, `${label}: charts`);
              saidCharts = true;
            }
            await drawChart(d, el, n, job);
          } else if (TEXT_TYPES.has(el.type) && el.textStyle) {
            await drawTextFrame(d, el, n, job);
          } else if (SHAPE_TYPES.has(el.type) && el.shape) {
            drawShape(d, el);
          }
        }
      } finally {
        /* the photos this page opened are let go now */
        opened.forEach((img) => E.images.close(img));
        opened.clear();
      }
      d.restore();
      done += 1;
    }
    if (print && anyMark) {
      const nums = sheet.pages.map((p) => p.number);
      const slug = `${project.name || 'Book'} · ${nums.length > 1 ? `Pages ${nums[0]}–${nums[1]}` : `Page ${nums[0]}`} · ${safeDate(now)} · RGB`;
      drawMarks(d, sheet, bleed, margin, marks, slug, job, nums[0]);
    }
    d.commit();
    writer.flushStreams();
  }
  checkAbort(signal);
  progress(total, total, 'Finishing the PDF');

  /* 3. what to say */
  const unique = (xs: number[]) => Array.from(new Set(xs)).sort((a, b) => a - b);
  for (const w of job.fonts.warnings) warnings.push(w);
  job.narrowed.forEach((n, face) => {
    if (n.most >= 1 && n.pages.size)
      warnings.push(
        `${face}: words were set up to ${Math.round(n.most)}% ${'narrower or wider'} than the font's own widths to keep the editor's line breaks (${unique(Array.from(n.pages)).length === 1 ? 'page' : 'pages'} ${unique(Array.from(n.pages)).slice(0, 12).join(', ')}): the screen drew them with a different version of this font than the PDF could embed. Export again; if this note comes back, tell the team which font it names.`
      );
  });
  if (job.fallbackText.size)
    warnings.push(`Set in a standard font (Helvetica), because ${job.fallbackText.size === 1 ? 'this font' : 'these fonts'} can't be embedded: ${Array.from(job.fallbackText).join(', ')}`);
  for (const w of job.fonts.missingWarnings()) warnings.push(w);
  if (job.emptyPhotos.length) {
    const pages = unique(job.emptyPhotos);
    warnings.push(
      `${job.emptyPhotos.length === 1 ? 'A photo frame is empty and prints' : `${job.emptyPhotos.length} photo frames are empty and print`} blank (page${pages.length > 1 ? 's' : ''} ${pages.slice(0, 20).join(', ')})`
    );
  }
  if (job.failedPhotos.length) warnings.push(`Not drawn, because they couldn't be loaded: ${job.failedPhotos.slice(0, 12).join('; ')}${job.failedPhotos.length > 12 ? ' …' : ''}`);
  if (job.rasterCharts.length) warnings.push(`Drawn as a 300 ppi picture, not as vectors: the chart on ${job.rasterCharts.join('; ')}`);

  const blob = await writer.finish();
  return {
    blob,
    pageCount: sheets.length,
    fonts: job.fonts.reports(),
    images: { ...job.images },
    sizeBytes: blob.size,
    warnings,
    colorSpace: 'RGB',
  };
}
