/* The page and spread images (PNG, JPG) and the backup (.bookstudio.zip). The print-ready and review PDFs are
   pdfEngine.ts's (Books Phase 4: vector text, embedded fonts); the old PDF made of JPEG pictures of the pages is gone.
   Text is drawn from textEngine's layoutTextLines, the layout the canvas shows and the fit is measured with, so an image
   wraps exactly as the screen does: the real font's widths, letter spacing, breaks after hyphens and at dashes,
   paragraph gaps, justified lines, balanced columns and vertical alignment. Never drawn: word counts, guides, the red
   "doesn't fit" outlines, or words that don't fit their frame. */
import JSZip from 'jszip';
import { imagePlacement } from './pdf/images';
import type { BookElement, BookPage, BookProject } from '../types/bookstudio';
import { getEffectivePageDimensions, MM_PER_INCH } from './dimensionEngine';
import { renderInfographicToSvgString } from './infographicEngine';
import { layoutTextLines } from './textEngine';
import { cssFont, PT_TO_MM, type FontSpec } from './textMeasure';
import { backupFileName, imageFileName } from './exportGate';

/* An uploaded photo is shown in the editor from its screen copy (at most 2400 px); an export draws the full-size copy
   the server keeps beside it, so the print resolution is the photo's own. */
export function printSourceOf(src: string): string {
  return String(src || '').replace(/^(\/api\/books\/asset\/as_[a-f0-9]{20})\/display$/, '$1/print');
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    img.src = src;
  });
}

/* the fonts of a page's text, loaded before it is drawn (a canvas draws with whatever has loaded); when one arrives
   only now, the measure's widths are taken again (textMeasure refreshes 30 ms after a font loads) before laying out */
const TEXT_TYPES = new Set(['text', 'header', 'footer', 'pageNumber', 'logo']);
async function loadPageFonts(page: BookPage): Promise<void> {
  const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
  if (!fonts) return;
  const wanted = new Set<string>();
  for (const el of page.elements) {
    if (el.hidden || !TEXT_TYPES.has(el.type) || !el.textStyle?.fontFamily) continue;
    const st = el.textStyle;
    wanted.add(cssFont({ family: st.fontFamily, weight: Number(st.fontWeight) || 400, italic: st.fontStyle === 'italic' }, 16));
  }
  let arrived = false;
  await Promise.all(
    Array.from(wanted).map(async (f) => {
      try {
        if (!fonts.check(f)) {
          await fonts.load(f);
          arrived = true;
        }
      } catch {
        /* a font that can't load is drawn with the fallback, as the screen shows it */
      }
    })
  );
  try {
    await fonts.ready;
  } catch {
    /* nothing more to wait for */
  }
  if (arrived) await new Promise((r) => setTimeout(r, 80));
}

/**
 * Draws one page on a canvas at `dpi`: the page's colour, then its visible frames in their stacking order.
 * Never drawn: word counts, editorial notes, guides, outlines.
 */
export async function renderPageToCanvas(
  page: BookPage,
  pageNumber: number,
  project: BookProject,
  dpi = 180
): Promise<HTMLCanvasElement> {
  const dim = getEffectivePageDimensions(page, project.dimensions);
  const pxPerMm = dpi / MM_PER_INCH;
  const widthPx = Math.round(dim.widthMm * pxPerMm);
  const heightPx = Math.round(dim.heightMm * pxPerMm);

  const canvas = document.createElement('canvas');
  canvas.width = widthPx;
  canvas.height = heightPx;
  const ctx = canvas.getContext('2d')!;

  // Page paper background
  ctx.fillStyle = page.backgroundColor || project.designSystem.colors.paper || '#FBF9F5';
  ctx.fillRect(0, 0, widthPx, heightPx);

  await loadPageFonts(page);
  const sorted = [...page.elements].filter((e) => !e.hidden).sort((a, b) => a.zIndex - b.zIndex);

  for (const el of sorted) {
    await drawElementOnCanvas(ctx, el, pageNumber, pxPerMm);
  }

  return canvas;
}

async function drawElementOnCanvas(
  ctx: CanvasRenderingContext2D,
  el: BookElement,
  pageNumber: number,
  pxPerMm: number
) {
  const x = el.xMm * pxPerMm;
  const y = el.yMm * pxPerMm;
  const w = el.widthMm * pxPerMm;
  const h = el.heightMm * pxPerMm;

  ctx.save();
  ctx.globalAlpha = el.opacity ?? 1;
  if (el.rotation) {
    ctx.translate(x + w / 2, y + h / 2);
    ctx.rotate((el.rotation * Math.PI) / 180);
    ctx.translate(-(x + w / 2), -(y + h / 2));
  }

  if (el.type === 'shape' || el.type === 'line' || el.type === 'decorative') {
    const sh = el.shape;
    if (sh) {
      if (el.type === 'line' || sh.shapeKind === 'rule') {
        ctx.strokeStyle = sh.stroke || '#C6A26B';
        ctx.lineWidth = Math.max(1, (sh.strokeWidthMm || 0.4) * pxPerMm);
        ctx.beginPath();
        ctx.moveTo(x, y + h / 2);
        ctx.lineTo(x + w, y + h / 2);
        ctx.stroke();
      } else if (sh.shapeKind === 'ellipse') {
        ctx.beginPath();
        ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
        if (sh.fill && sh.fill !== 'transparent') {
          ctx.fillStyle = sh.fill;
          ctx.fill();
        }
        if (sh.strokeWidthMm > 0 && sh.stroke !== 'transparent') {
          ctx.strokeStyle = sh.stroke;
          ctx.lineWidth = sh.strokeWidthMm * pxPerMm;
          ctx.stroke();
        }
      } else {
        const r = (sh.cornerRadiusMm || 0) * pxPerMm;
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, r);
        if (sh.fill && sh.fill !== 'transparent') {
          ctx.fillStyle = sh.fill;
          ctx.fill();
        }
        if (sh.strokeWidthMm > 0 && sh.stroke !== 'transparent') {
          ctx.strokeStyle = sh.stroke;
          ctx.lineWidth = sh.strokeWidthMm * pxPerMm;
          ctx.stroke();
        }
      }
    }
  } else if (el.type === 'image' && el.image?.src) {
    try {
      const img = await loadImageElement(printSourceOf(el.image.src));
      ctx.save();
      const radius = (el.image.borderRadiusMm || 0) * pxPerMm;
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, radius);
      ctx.clip();

      const filters: string[] = [];
      if (el.image.brightness && el.image.brightness !== 100) filters.push(`brightness(${el.image.brightness}%)`);
      if (el.image.contrast && el.image.contrast !== 100) filters.push(`contrast(${el.image.contrast}%)`);
      if (el.image.grayscale) filters.push(`grayscale(${el.image.grayscale}%)`);
      if (el.image.sepia) filters.push(`sepia(${el.image.sepia}%)`);
      if (filters.length) ctx.filter = filters.join(' ');

      /* placed as the canvas and the PDF place it (zoom about the frame's centre: pdf/images.ts imagePlacement) */
      const r = imagePlacement(w, h, img.naturalWidth, img.naturalHeight, el.image.fit, el.image.zoom, el.image.focalX, el.image.focalY);
      ctx.drawImage(img, x + r.x, y + r.y, r.w, r.h);
      ctx.restore();
    } catch {
      ctx.fillStyle = '#E5E2DC';
      ctx.fillRect(x, y, w, h);
    }
  } else if (el.type === 'infographic' && el.infographic) {
    try {
      const svgStr = renderInfographicToSvgString(el.infographic, Math.round(w), Math.round(h));
      const svgBlob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(svgBlob);
      const img = await loadImageElement(url);
      ctx.drawImage(img, x, y, w, h);
      URL.revokeObjectURL(url);
    } catch {
      ctx.fillStyle = el.infographic.backgroundColor || '#F4F1EA';
      ctx.fillRect(x, y, w, h);
    }
  } else if (
    (el.type === 'text' ||
      el.type === 'header' ||
      el.type === 'footer' ||
      el.type === 'pageNumber' ||
      el.type === 'logo') &&
    el.textStyle
  ) {
    drawTextFrame(ctx, el, pageNumber, pxPerMm, x, y, w, h);
  }

  ctx.restore();
}

/* letter spacing as CSS draws it (after every character): the canvas's own where the browser has it, else letter by
   letter */
type SpacedContext = CanvasRenderingContext2D & { letterSpacing?: string };
function applyLetterSpacing(ctx: CanvasRenderingContext2D, px: number): boolean {
  const c = ctx as SpacedContext;
  if (!px) return true;
  if (typeof c.letterSpacing !== 'string') return false;
  c.letterSpacing = `${px}px`;
  return true;
}

function drawRun(ctx: CanvasRenderingContext2D, text: string, x: number, baseline: number, spacingPx: number, native: boolean) {
  if (!text) return;
  if (native || !spacingPx) {
    ctx.fillText(text, x, baseline);
    return;
  }
  let cx = x;
  for (const ch of text) {
    ctx.fillText(ch, cx, baseline);
    cx += ctx.measureText(ch).width + spacingPx;
  }
}

/** a text frame's lines where layoutTextLines puts them (mm from the frame's top-left), clipped to the frame */
function drawTextFrame(
  ctx: CanvasRenderingContext2D,
  el: BookElement,
  pageNumber: number,
  pxPerMm: number,
  x: number,
  y: number,
  w: number,
  h: number
) {
  const laid = layoutTextLines(el, { pageNumber });
  if (!laid.lines.length) return;
  const font: FontSpec = laid.font;
  const fontPx = (Number(laid.sizePt) || 0) * PT_TO_MM * pxPerMm;
  if (!(fontPx > 0)) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = laid.color || '#1C1917';
  ctx.font = cssFont(font, fontPx);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const spacingPx = (Number(font.letterSpacingEm) || 0) * fontPx;
  const native = applyLetterSpacing(ctx, spacingPx);
  for (const line of laid.lines) {
    const baseline = y + line.baselineMm * pxPerMm;
    if (line.words && line.words.length) {
      // each word where the layout puts it: a justified line's widened spaces included
      for (const word of line.words) drawRun(ctx, word.text, x + word.xMm * pxPerMm, baseline, spacingPx, native);
    } else {
      drawRun(ctx, line.text, x + line.xMm * pxPerMm, baseline, spacingPx, native);
    }
  }
  ctx.restore();
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/**
 * Exports a single page as PNG or JPG at high print resolution.
 */
export async function exportSinglePageImage(
  page: BookPage,
  pageNumber: number,
  project: BookProject,
  format: 'png' | 'jpg'
): Promise<void> {
  const canvas = await renderPageToCanvas(page, pageNumber, project, 220);
  const mime = format === 'png' ? 'image/png' : 'image/jpeg';
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, mime, 0.95)
  );
  if (!blob) throw new Error('the image is too large for this browser');
  downloadBlob(blob, imageFileName(project.name, pageNumber, null, format));
}

/**
 * Exports a facing-page spread as a combined PNG or JPG.
 */
export async function exportSpreadImage(
  leftPage: BookPage,
  rightPage: BookPage | null,
  leftPageNumber: number,
  project: BookProject,
  format: 'png' | 'jpg'
): Promise<void> {
  const leftCanvas = await renderPageToCanvas(leftPage, leftPageNumber, project, 200);
  if (!rightPage) {
    await exportSinglePageImage(leftPage, leftPageNumber, project, format);
    return;
  }
  const rightCanvas = await renderPageToCanvas(rightPage, leftPageNumber + 1, project, 200);
  const spreadCanvas = document.createElement('canvas');
  spreadCanvas.width = leftCanvas.width + rightCanvas.width;
  spreadCanvas.height = Math.max(leftCanvas.height, rightCanvas.height);
  const ctx = spreadCanvas.getContext('2d')!;
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, spreadCanvas.width, spreadCanvas.height);
  ctx.drawImage(leftCanvas, 0, 0);
  ctx.drawImage(rightCanvas, leftCanvas.width, 0);

  const mime = format === 'png' ? 'image/png' : 'image/jpeg';
  const blob = await new Promise<Blob | null>((resolve) =>
    spreadCanvas.toBlob(resolve, mime, 0.95)
  );
  if (!blob) throw new Error('the image is too large for this browser');
  downloadBlob(blob, imageFileName(project.name, leftPageNumber, leftPageNumber + 1, format));
}

/**
 * Exports a complete Project Backup Package (.bookstudio.zip) preserving editable JSON,
 * design system, master pages, content manuscript, and production specs.
 */
export async function exportProjectBackupPackage(project: BookProject): Promise<void> {
  const zip = new JSZip();
  zip.file('project.json', JSON.stringify(project, null, 2));
  zip.file('design-system.json', JSON.stringify(project.designSystem, null, 2));
  zip.file('master-pages.json', JSON.stringify(project.masterPages, null, 2));
  zip.file(
    'manuscript.txt',
    project.contentSections.map((s) => `## ${s.title}\n${s.body}`).join('\n\n')
  );
  zip.file(
    'README.txt',
    `BOOKSTUDIO Project Backup\nProject: ${project.name}\nPages: ${project.pages.length}\nExported: ${new Date().toISOString()}\n`
  );
  const content = await zip.generateAsync({ type: 'blob' });
  downloadBlob(content, backupFileName(project.name));
}
