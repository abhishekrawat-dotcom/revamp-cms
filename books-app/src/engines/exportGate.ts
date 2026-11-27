/* The export's gate and its small sums (Books Phase 4, 27 Nov 2026), used by ExportPreflightModal.tsx:
     - what stops a print-ready PDF (the pre-export check's errors), what waits for one tick ("I've checked these
       warnings"), and that a review PDF, the page and spread images and the backup are never stopped;
     - a template's empty photo frames ("Portrait — drop a photo here") are missing photos;
     - the page range, the file names, the progress line and the summary shown after a PDF.
   Pure functions only, with no run-time imports, so functions/lib/books-export.test.js bundles this file alone. */
import type { BookElement, PreflightIssue } from '../types/bookstudio';

/* ---------- the gate ---------- */

export type ExportKind = 'print' | 'review' | 'images' | 'backup';

export interface GateState {
  kind: ExportKind;
  /** the check's errors (they stop a print-ready PDF) */
  errors: PreflightIssue[];
  /** the check's warnings (a print-ready PDF waits for one tick) */
  warnings: PreflightIssue[];
  /** errors stop this export (a print-ready PDF only) */
  blocked: boolean;
  /** warnings wait for "I've checked these warnings" (a print-ready PDF only) */
  needsTick: boolean;
  /** the export may start */
  canExport: boolean;
  /** what the button says: the export, or what to do first */
  buttonLabel: string;
  /** one plain line under the button ('' when there is nothing to say) */
  note: string;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export const TICK_LABEL = "I've checked these warnings";

const EXPORT_LABEL: Record<ExportKind, string> = {
  print: 'Export print-ready PDF',
  review: 'Export review PDF',
  images: 'Export image',
  backup: 'Download backup (.bookstudio.zip)',
};

/**
 * May this export start? A print-ready PDF is stopped by every error of the check, and waits for the tick when there
 * are warnings; a review PDF, the images and the backup always may (the errors are only a note there).
 * `warningsChecked` is whether the tick covers the warnings shown now (see warningsSignature).
 */
export function exportGate(issues: PreflightIssue[], kind: ExportKind, warningsChecked: boolean): GateState {
  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');
  if (kind !== 'print') {
    let note = '';
    if (errors.length && kind !== 'backup') {
      note = `${plural(errors.length, 'problem')} would stop a print-ready PDF. ${
        kind === 'review' ? 'A review PDF' : 'An image'
      } shows the pages as they are now.`;
    }
    return { kind, errors, warnings, blocked: false, needsTick: false, canExport: true, buttonLabel: EXPORT_LABEL[kind], note };
  }
  if (errors.length) {
    return {
      kind,
      errors,
      warnings,
      blocked: true,
      needsTick: warnings.length > 0 && !warningsChecked,
      canExport: false,
      buttonLabel: `Fix ${plural(errors.length, 'problem')} to export`,
      note: `Fix ${errors.length === 1 ? 'it' : 'them'} first: "Go to" takes you to each one. A review PDF can still be exported.`,
    };
  }
  if (warnings.length && !warningsChecked) {
    return {
      kind,
      errors,
      warnings,
      blocked: false,
      needsTick: true,
      canExport: false,
      buttonLabel: 'Check the warnings to export',
      note: `Look through the ${plural(warnings.length, 'warning')}, then tick "${TICK_LABEL}".`,
    };
  }
  return { kind, errors, warnings, blocked: false, needsTick: false, canExport: true, buttonLabel: EXPORT_LABEL.print, note: '' };
}

/** the warnings a tick was given for: a warning that was not there when the box was ticked needs a new tick */
export function warningsSignature(issues: PreflightIssue[]): string {
  return issues
    .filter((i) => i.severity === 'warning')
    .map((i) => i.id)
    .sort()
    .join('|');
}

/* ---------- missing photos ---------- */

/* a template's empty photo frame is named for what it waits for: "Portrait — drop a photo here",
   "Drawing — drop a plan or section here" (data/premiumTemplates.ts) */
const PLACEHOLDER_NAME = /\bdrop (?:a|an|the|your)\b/i;

/** an image frame with no photo in it (hidden frames do not print, so they are never missing) */
export function isMissingPhoto(el: Pick<BookElement, 'type' | 'hidden' | 'image'>): boolean {
  return el.type === 'image' && !el.hidden && !String(el.image?.src || '').trim();
}

/** a template's empty photo frame, still waiting for its photo */
export function isPlaceholderPhotoFrame(el: Pick<BookElement, 'type' | 'hidden' | 'image' | 'name'>): boolean {
  return isMissingPhoto(el) && PLACEHOLDER_NAME.test(String(el.name || ''));
}

/** what the check says about a frame with no photo */
export function missingPhotoText(
  el: Pick<BookElement, 'type' | 'hidden' | 'image' | 'name'>,
  pageNumber: number
): { title: string; detail: string; suggestion: string } {
  const suggestion = 'Add the photo or delete the frame.';
  if (isPlaceholderPhotoFrame(el)) {
    const kind = String(el.name).split(/\s+[—–-]\s+/)[0].trim() || 'Photo';
    return {
      title: `Empty ${kind.toLowerCase()} frame on page ${pageNumber}`,
      detail: `"${el.name}" is a template's frame still waiting for its photo. It would print empty.`,
      suggestion,
    };
  }
  return {
    title: `Missing photo on page ${pageNumber}`,
    detail: `The photo frame "${el.name || 'Photo'}" has no photo in it. It would print empty.`,
    suggestion,
  };
}

/* ---------- the page range ---------- */

export interface PageRangeInput {
  /** every page */
  all: boolean;
  /** the first page, as typed */
  from: string | number;
  /** the last page, as typed */
  to: string | number;
}

export interface PageRangeResult {
  ok: boolean;
  /** what the PDF export is given */
  pages: 'all' | { from: number; to: number };
  /** pages in the range (0 when it is not a range) */
  count: number;
  /** what is wrong, in plain words ('' when ok) */
  error: string;
}

function wholeNumber(v: string | number): number | null {
  const s = String(v ?? '').trim();
  if (!/^\d+$/.test(s)) return null;
  return Number(s);
}

/** the pages to export: every page, or "from" to "to" (both counted from 1, both included) */
export function resolvePageRange(input: PageRangeInput, pageCount: number): PageRangeResult {
  const total = Math.max(0, Math.floor(Number(pageCount) || 0));
  if (total === 0) return { ok: false, pages: 'all', count: 0, error: 'This book has no pages yet.' };
  if (input.all) return { ok: true, pages: 'all', count: total, error: '' };
  const from = wholeNumber(input.from);
  const to = wholeNumber(input.to);
  const bad = (error: string): PageRangeResult => ({ ok: false, pages: 'all', count: 0, error });
  if (from === null || to === null) return bad(`Type page numbers, for example 1 to ${total}.`);
  if (from < 1 || to < 1 || from > total || to > total) {
    return bad(`This book has ${plural(total, 'page')}: choose pages from 1 to ${total}.`);
  }
  if (from > to) return bad(`The first page (${from}) comes after the last (${to}): swap them.`);
  return { ok: true, pages: { from, to }, count: to - from + 1, error: '' };
}

/** the range in words, for the summary: "all 140 pages", "pages 12–20", "page 7" */
export function pageRangeWords(pages: 'all' | { from: number; to: number }, pageCount: number): string {
  if (pages === 'all') return `all ${plural(pageCount, 'page')}`;
  return pages.from === pages.to ? `page ${pages.from}` : `pages ${pages.from}–${pages.to}`;
}

/* ---------- file names ---------- */

/** the book's name as a file name: its own words (any language), without the characters a file name may not hold */
export function safeFileBase(name: string): string {
  const cleaned = String(name || '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s]+|[.\s]+$/g, '');
  const base = cleaned || 'Book';
  return base.length > 120 ? base.slice(0, 120).trim() : base;
}

/** "<Book name> – print-ready.pdf" or "<Book name> – review.pdf" */
export function pdfFileName(bookName: string, mode: 'print' | 'review'): string {
  return `${safeFileBase(bookName)} – ${mode === 'print' ? 'print-ready' : 'review'}.pdf`;
}

const two = (n: number) => String(n).padStart(2, '0');

/** "<Book name> – page 04.png", or for a spread "<Book name> – pages 04–05.jpg" */
export function imageFileName(bookName: string, firstPage: number, lastPage: number | null, ext: 'png' | 'jpg'): string {
  const which = lastPage && lastPage !== firstPage ? `pages ${two(firstPage)}–${two(lastPage)}` : `page ${two(firstPage)}`;
  return `${safeFileBase(bookName)} – ${which}.${ext}`;
}

/** "<Book name>.bookstudio.zip" */
export function backupFileName(bookName: string): string {
  return `${safeFileBase(bookName)}.bookstudio.zip`;
}

/* ---------- while the PDF is made ---------- */

/** "Page 12 of 140: photos"; before the first page, "Getting ready: fonts" */
export function progressLabel(done: number, total: number, what?: string): string {
  const step = String(what || '').trim();
  const t = Math.max(0, Math.floor(Number(total) || 0));
  const d = Math.max(0, Math.floor(Number(done) || 0));
  /* the PDF engine names the page itself ("Page 12 of 140: photos"): shown as it comes, never doubled */
  if (/^Page \d+ of \d+/.test(step)) return step;
  if (t > 0 && d >= 1) return `Page ${Math.min(d, t)} of ${t}${step ? `: ${step}` : ''}`;
  return step ? `Getting ready: ${step}` : 'Getting ready';
}

/** how far along, from 0 to 1 */
export function progressFraction(done: number, total: number): number {
  const t = Number(total) || 0;
  if (!(t > 0)) return 0;
  return Math.max(0, Math.min(1, (Number(done) || 0) / t));
}

/* ---------- afterwards ---------- */

export function formatBytes(bytes: number): string {
  const b = Math.max(0, Number(bytes) || 0);
  if (b < 1024) return `${Math.round(b)} bytes`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  return `${(b / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

const WEIGHT_NAMES: Record<number, string> = {
  100: 'Thin',
  200: 'ExtraLight',
  300: 'Light',
  400: 'Regular',
  500: 'Medium',
  600: 'SemiBold',
  700: 'Bold',
  800: 'ExtraBold',
  900: 'Black',
};

/** "Lora Bold Italic", "Inter Regular", "Lora 450" */
export function fontStyleName(f: { family: string; weight: number; italic: boolean }): string {
  const w = Math.round(Number(f.weight) || 400);
  const weight = WEIGHT_NAMES[w] || String(w);
  if (f.italic) return `${f.family} ${w === 400 ? 'Italic' : `${weight} Italic`}`;
  return `${f.family} ${weight}`;
}

/** the parts of a PDF's report the summary reads (pdfEngine.ts PdfExportResult and PdfFontReport) */
export interface FontReportLike {
  family: string;
  weight: number;
  italic: boolean;
  embedded: boolean;
  reason?: string;
}
export interface PdfResultLike {
  pageCount: number;
  sizeBytes: number;
  fonts: FontReportLike[];
  images: { count: number; belowTarget: number };
  warnings: string[];
}

export interface PdfSummary {
  heading: string;
  fileName: string;
  /** label and value, in order */
  facts: Array<{ label: string; value: string }>;
  /** the fonts embedded, one line each: "Lora Regular, Bold, Italic" */
  fonts: string[];
  /** the PDF's warnings about a font (a weight it did not have, and what it used instead) */
  fontNotes: string[];
  /** fonts that could not be embedded, with why */
  fontsMissing: string[];
  /** the PDF's other warnings */
  warnings: string[];
}

/** a warning about one of the fonts (it names the family, or a weight or style) */
function isFontWarning(w: string, families: string[]): boolean {
  const lower = w.toLowerCase();
  return families.some((f) => f && lower.includes(f.toLowerCase())) || /\b(weight|font|italic|substitut)/i.test(w);
}

/** the short summary shown after a PDF is made */
export function summarizePdf(
  result: PdfResultLike,
  opts: { bookName: string; mode: 'print' | 'review'; targetPpi: number; pages: 'all' | { from: number; to: number }; spreads: boolean; bookPages: number }
): PdfSummary {
  const fonts = Array.isArray(result.fonts) ? result.fonts : [];
  const families = Array.from(new Set(fonts.map((f) => f.family)));
  const byFamily = new Map<string, string[]>();
  for (const f of fonts) {
    if (!f.embedded) continue;
    const style = fontStyleName(f).slice(f.family.length + 1);
    const list = byFamily.get(f.family) || [];
    if (!list.includes(style)) list.push(style);
    byFamily.set(f.family, list);
  }
  const fontLines = Array.from(byFamily.entries()).map(([family, styles]) => `${family}: ${styles.join(', ')}`);
  const fontsMissing = fonts
    .filter((f) => !f.embedded)
    .map((f) => `${fontStyleName(f)}: ${f.reason ? f.reason : "it couldn't be embedded"}`);
  const warnings = (Array.isArray(result.warnings) ? result.warnings : []).map((w) => String(w)).filter((w) => w.trim());
  const fontNotes = warnings.filter((w) => isFontWarning(w, families));
  const other = warnings.filter((w) => !isFontWarning(w, families));

  const imgs = result.images || { count: 0, belowTarget: 0 };
  const target = Math.round(Number(opts.targetPpi) || 300);
  const photos =
    !imgs.count
      ? 'No photos in these pages'
      : imgs.belowTarget
        ? `${imgs.belowTarget} of ${imgs.count} below ${target} ppi`
        : `All ${imgs.count} at ${target} ppi or more`;

  const facts: PdfSummary['facts'] = [
    { label: 'Pages', value: `${pageRangeWords(opts.pages, opts.bookPages)}${opts.spreads ? ', as spreads' : ''} (${plural(result.pageCount, 'PDF page')})` },
    { label: 'File size', value: formatBytes(result.sizeBytes) },
    { label: 'Fonts embedded', value: byFamily.size ? plural(Array.from(byFamily.values()).reduce((a, s) => a + s.length, 0), 'style') : 'None' },
    { label: 'Photos', value: photos },
  ];
  if (warnings.length) facts.push({ label: 'Warnings', value: String(warnings.length) });

  return {
    heading: opts.mode === 'print' ? 'Your print-ready PDF is ready' : 'Your review PDF is ready',
    fileName: pdfFileName(opts.bookName, opts.mode),
    facts,
    fonts: fontLines,
    fontNotes,
    fontsMissing,
    warnings: other,
  };
}

/** when fonts could not be embedded (pdfEngine.ts PdfFontError): which, why, and what to do */
export function fontErrorAdvice(fonts: FontReportLike[], canDesign: boolean): { lines: string[]; fix: string } {
  const missing = (Array.isArray(fonts) ? fonts : []).filter((f) => !f.embedded);
  const lines = missing.map((f) => `${fontStyleName(f)}: ${f.reason ? f.reason : "it couldn't be embedded"}`);
  const fix = canDesign
    ? 'Choose another font for the text styles that use them (Type › Google Fonts & Typography Studio), or check your connection and export again.'
    : 'Ask a Designer to choose another font for the text styles that use them, or check your connection and export again.';
  return { lines, fix };
}
