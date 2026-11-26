import { PDFDocument, rgb, StandardFonts, degrees } from 'pdf-lib';
import JSZip from 'jszip';
import type { BookElement, BookPage, BookProject } from '../types/bookstudio';
import { getEffectivePageDimensions, MM_PER_INCH, PT_PER_INCH } from './dimensionEngine';
import { renderInfographicToSvgString } from './infographicEngine';

function mmToPt(mm: number): number {
  return (mm / MM_PER_INCH) * PT_PER_INCH;
}

function hexToRgb01(hex: string): { r: number; g: number; b: number } {
  const clean = (hex || '#1C1917').replace('#', '').trim();
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean.padEnd(6, '0').slice(0, 6);
  const num = parseInt(full, 16);
  if (Number.isNaN(num)) return { r: 0.1, g: 0.1, b: 0.1 };
  return {
    r: ((num >> 16) & 255) / 255,
    g: ((num >> 8) & 255) / 255,
    b: (num & 255) / 255,
  };
}

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

function wrapCanvasText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const paragraphs = text.split('\n');
  const allLines: string[] = [];
  for (const para of paragraphs) {
    if (!para.trim()) {
      allLines.push('');
      continue;
    }
    const words = para.split(/\s+/);
    let current = '';
    for (const w of words) {
      const test = current ? `${current} ${w}` : w;
      if (ctx.measureText(test).width > maxWidth && current) {
        allLines.push(current);
        current = w;
      } else {
        current = test;
      }
    }
    if (current) allLines.push(current);
  }
  return allLines;
}

/**
 * Renders a single BookPage onto a crisp high-resolution HTML5 Canvas.
 * Strictly excludes backend word counts, editorial notes, and workspace guides.
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

      const imgRatio = img.naturalWidth / Math.max(1, img.naturalHeight);
      const frameRatio = w / Math.max(1, h);
      const zoom = el.image.zoom || 1;
      let drawW = w;
      let drawH = h;

      if (el.image.fit === 'contain') {
        if (imgRatio > frameRatio) {
          drawW = w * zoom;
          drawH = (w / imgRatio) * zoom;
        } else {
          drawH = h * zoom;
          drawW = h * imgRatio * zoom;
        }
      } else {
        if (imgRatio > frameRatio) {
          drawH = h * zoom;
          drawW = h * imgRatio * zoom;
        } else {
          drawW = w * zoom;
          drawH = (w / imgRatio) * zoom;
        }
      }

      const fx = (el.image.focalX ?? 50) / 100;
      const fy = (el.image.focalY ?? 50) / 100;
      const dx = x + (w - drawW) * fx;
      const dy = y + (h - drawH) * fy;
      ctx.drawImage(img, dx, dy, drawW, drawH);
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
    const st = el.textStyle;
    const inset = (st.insetMm || 0) * pxPerMm;
    const fontPx = (st.fontSizePt / PT_PER_INCH) * MM_PER_INCH * pxPerMm;
    const lineHeightPx = fontPx * (st.lineHeight || 1.4);
    const rawText =
      el.type === 'pageNumber'
        ? (el.text || '{{page}}').replace('{{page}}', String(pageNumber).padStart(2, '0'))
        : el.text || '';
    const displayText =
      st.textTransform === 'uppercase'
        ? rawText.toUpperCase()
        : st.textTransform === 'lowercase'
          ? rawText.toLowerCase()
          : rawText;

    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();

    ctx.fillStyle = st.color || '#1C1917';
    ctx.font = `${st.fontStyle === 'italic' ? 'italic ' : ''}${st.fontWeight || 400} ${fontPx}px "${st.fontFamily}", serif`;
    ctx.textBaseline = 'top';

    const cols = Math.max(1, st.columns || 1);
    const colGapPx = (st.columnGapMm || 5) * pxPerMm;
    const colW = Math.max(20, (w - inset * 2 - colGapPx * (cols - 1)) / cols);
    const lines = wrapCanvasText(ctx, displayText, colW);

    const maxLinesPerCol = Math.max(1, Math.floor((h - inset * 2) / lineHeightPx));
    let startY = y + inset;
    if (cols === 1) {
      const totalH = lines.length * lineHeightPx;
      if (st.verticalAlign === 'middle') startY = y + Math.max(inset, (h - totalH) / 2);
      if (st.verticalAlign === 'bottom') startY = y + Math.max(inset, h - inset - totalH);
    }

    lines.forEach((line, idx) => {
      const colIdx = Math.min(cols - 1, Math.floor(idx / maxLinesPerCol));
      const rowIdx = idx - colIdx * maxLinesPerCol;
      const colX = x + inset + colIdx * (colW + colGapPx);
      const drawY = startY + rowIdx * lineHeightPx;
      if (drawY > y + h) return;

      let drawX = colX;
      if (st.textAlign === 'center') {
        const lw = ctx.measureText(line).width;
        drawX = colX + (colW - lw) / 2;
      } else if (st.textAlign === 'right') {
        const lw = ctx.measureText(line).width;
        drawX = colX + colW - lw;
      }
      ctx.fillText(line, drawX, drawY);
    });
    ctx.restore();
  }

  ctx.restore();
}

function downloadBlob(blob: Blob, filename: string) {
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
 * Exports Print-Ready PDF (with exact trim size, bleed, crop marks, registration marks)
 * or Standard PDF matching actual physical page dimensions.
 */
export async function exportBookPdf(
  project: BookProject,
  options: { printReady: boolean; dpi?: number }
): Promise<void> {
  if (typeof document !== 'undefined' && document.fonts) {
    await document.fonts.ready;
  }

  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle(project.name);
  pdfDoc.setCreator('BOOKSTUDIO Editorial Publishing Studio');
  pdfDoc.setProducer('BOOKSTUDIO PDF Engine');

  const markMarginMm = options.printReady && project.printSettings.includeCropMarks ? 10 : 0;
  const dpi = options.dpi || (options.printReady ? 220 : 150);

  for (let i = 0; i < project.pages.length; i++) {
    const page = project.pages[i];
    const dim = getEffectivePageDimensions(page, project.dimensions);
    const bleedMm = options.printReady && project.printSettings.includeBleed ? dim.bleedMm : 0;

    const totalWidthMm = dim.widthMm + (bleedMm + markMarginMm) * 2;
    const totalHeightMm = dim.heightMm + (bleedMm + markMarginMm) * 2;

    const pdfPage = pdfDoc.addPage([mmToPt(totalWidthMm), mmToPt(totalHeightMm)]);

    // Fill bleed/background under trim box
    const bg = hexToRgb01(page.backgroundColor || project.designSystem.colors.paper);
    const trimXPt = mmToPt(markMarginMm + bleedMm);
    const trimYPt = mmToPt(markMarginMm + bleedMm);
    const trimWPt = mmToPt(dim.widthMm);
    const trimHPt = mmToPt(dim.heightMm);

    pdfPage.drawRectangle({
      x: mmToPt(markMarginMm),
      y: mmToPt(markMarginMm),
      width: mmToPt(dim.widthMm + bleedMm * 2),
      height: mmToPt(dim.heightMm + bleedMm * 2),
      color: rgb(bg.r, bg.g, bg.b),
    });

    // Render crisp page artwork (preserves exact typography, loaded Google Fonts, cropped images & SVG infographics)
    const pageCanvas = await renderPageToCanvas(page, i + 1, project, dpi);
    const jpegDataUrl = pageCanvas.toDataURL('image/jpeg', 0.94);
    const jpegBytes = await fetch(jpegDataUrl).then((r) => r.arrayBuffer());
    const embedded = await pdfDoc.embedJpg(jpegBytes);

    pdfPage.drawImage(embedded, {
      x: trimXPt,
      y: trimYPt,
      width: trimWPt,
      height: trimHPt,
    });

    // Draw precision vector crop marks and registration marks for print-ready PDF
    if (options.printReady && project.printSettings.includeCropMarks) {
      const markColor = rgb(0.15, 0.15, 0.15);
      const offset = mmToPt(2);
      const len = mmToPt(6);
      const corners = [
        { x: trimXPt, y: trimYPt, dx: -1, dy: -1 },
        { x: trimXPt + trimWPt, y: trimYPt, dx: 1, dy: -1 },
        { x: trimXPt, y: trimYPt + trimHPt, dx: -1, dy: 1 },
        { x: trimXPt + trimWPt, y: trimYPt + trimHPt, dx: 1, dy: 1 },
      ];
      for (const c of corners) {
        pdfPage.drawLine({
          start: { x: c.x + c.dx * offset, y: c.y },
          end: { x: c.x + c.dx * (offset + len), y: c.y },
          thickness: 0.4,
          color: markColor,
        });
        pdfPage.drawLine({
          start: { x: c.x, y: c.y + c.dy * offset },
          end: { x: c.x, y: c.y + c.dy * (offset + len) },
          thickness: 0.4,
          color: markColor,
        });
      }

      if (project.printSettings.includeRegistrationMarks) {
        const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
        pdfPage.drawText(
          `${project.name}  |  Page ${i + 1}  |  Trim ${dim.widthMm}x${dim.heightMm}mm  |  Bleed ${bleedMm}mm`,
          {
            x: trimXPt,
            y: mmToPt(3),
            size: 6,
            font,
            color: rgb(0.35, 0.35, 0.35),
            rotate: degrees(0),
          }
        );
      }
    }
  }

  const pdfBytes = await pdfDoc.save();
  const safeName = project.name.replace(/[^a-zA-Z0-9_-]/g, '_');
  const suffix = options.printReady ? 'PRINT_READY' : 'STANDARD';
  downloadBlob(
    new Blob([new Uint8Array(pdfBytes)], { type: 'application/pdf' }),
    `${safeName}_${suffix}.pdf`
  );
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
  if (!blob) return;
  const safeName = project.name.replace(/[^a-zA-Z0-9_-]/g, '_');
  downloadBlob(blob, `${safeName}_Page_${String(pageNumber).padStart(2, '0')}.${format}`);
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
  if (!blob) return;
  const safeName = project.name.replace(/[^a-zA-Z0-9_-]/g, '_');
  downloadBlob(
    blob,
    `${safeName}_Spread_${String(leftPageNumber).padStart(2, '0')}-${String(leftPageNumber + 1).padStart(2, '0')}.${format}`
  );
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
  const safeName = project.name.replace(/[^a-zA-Z0-9_-]/g, '_');
  downloadBlob(content, `${safeName}.bookstudio.zip`);
}
