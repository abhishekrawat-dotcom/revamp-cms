import React from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { BookElement } from '../types/bookstudio';

/* A photo's sharpness in print (Books Phase 3, 27 Nov 2026): its pixels over the size it prints at. The maths is the
   pre-export check's (preflightEngine: the smaller of width and height pixels over the frame's inches, so a photo
   filling its frame is measured on the side that limits it), divided by the zoom inside the frame, since zooming in
   prints each pixel larger. Editorial information only: never drawn on a page or exported. */

const MM_PER_INCH = 25.4;

export interface PrintResolution {
  /** pixels per inch at the size the photo prints */
  ppi: number;
  pixelWidth: number;
  pixelHeight: number;
  /** the pixels the photo would need for 300 ppi at this size and zoom */
  neededWidth: number;
  neededHeight: number;
}

/** the photo in an image frame, at its print size; null when the frame has no photo or its pixel size is not known */
export function photoPrintResolution(
  el: Pick<BookElement, 'type' | 'widthMm' | 'heightMm' | 'image'>,
  pixels?: { widthPx?: number; heightPx?: number }
): PrintResolution | null {
  if (el.type !== 'image' || !el.image || !el.image.src) return null;
  const pw = el.image.naturalWidth || pixels?.widthPx || 0;
  const ph = el.image.naturalHeight || pixels?.heightPx || 0;
  if (!pw || !ph) return null;
  const zoom = Math.max(0.1, el.image.zoom || 1);
  const widthIn = Math.max(0.1, el.widthMm / MM_PER_INCH);
  const heightIn = Math.max(0.1, el.heightMm / MM_PER_INCH);
  const ppi = Math.min(pw / widthIn, ph / heightIn) / zoom;
  return {
    ppi,
    pixelWidth: pw,
    pixelHeight: ph,
    neededWidth: Math.ceil(widthIn * zoom * 300),
    neededHeight: Math.ceil(heightIn * zoom * 300),
  };
}

export type PrintQualityLevel = 'too_low' | 'low' | 'fair' | 'good';

/** under 150 ppi: too low; 150–249: low; 250–299: fair; 300 or more: good */
export function printQuality(ppi: number): { level: PrintQualityLevel; label: string } {
  if (ppi < 150) return { level: 'too_low', label: 'Too low for print' };
  if (ppi < 250) return { level: 'low', label: 'Low for print' };
  if (ppi < 300) return { level: 'fair', label: 'Fair for print' };
  return { level: 'good', label: 'Good for print' };
}

/** the largest size a photo prints sharp at (300 ppi), in centimetres */
export function sharpPrintSizeCm(widthPx: number, heightPx: number): { widthCm: number; heightCm: number } {
  return {
    widthCm: Math.round(((widthPx / 300) * MM_PER_INCH) / 10 * 10) / 10,
    heightCm: Math.round(((heightPx / 300) * MM_PER_INCH) / 10 * 10) / 10,
  };
}

const TONE: Record<PrintQualityLevel, string> = {
  too_low: 'bg-[#3A1F1A] border-[#E07A5F]/60 text-[#F7D6CB]',
  low: 'bg-[#33281A] border-[#D4A657]/60 text-[#F2DDB3]',
  fair: 'bg-[#26262B] border-white/[0.14] text-[#D7D4CC]',
  good: 'bg-[#1F2A1C] border-[#8AA678]/50 text-[#CFE3C2]',
};

/** a small badge: "142 ppi · Too low for print" */
export const PrintQualityBadge: React.FC<{ ppi: number; compact?: boolean; title?: string }> = ({ ppi, compact, title }) => {
  const q = printQuality(ppi);
  const warn = q.level === 'too_low' || q.level === 'low';
  return (
    <span
      title={title || `${Math.round(ppi)} pixels per inch where it prints. 300 ppi is sharp; under 150 looks soft or blocky in print.`}
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[11px] leading-tight font-medium whitespace-nowrap ${TONE[q.level]}`}
    >
      {warn ? <AlertTriangle className="w-3 h-3 shrink-0" /> : q.level === 'good' ? <CheckCircle2 className="w-3 h-3 shrink-0" /> : null}
      <span className="font-mono-tabular">{Math.round(ppi)} ppi</span>
      {!compact && <span>· {q.label}</span>}
    </span>
  );
};

/**
 * The warning for a selected image frame: its photo's pixels, its effective resolution where it prints, and what to do
 * when it is low. Renders nothing for a frame without a photo. (For the Properties panel: drop in
 * <PhotoResolutionBadge element={selectedElement} />.)
 */
export const PhotoResolutionBadge: React.FC<{ element: BookElement | null | undefined; pixels?: { widthPx?: number; heightPx?: number } }> = ({
  element,
  pixels,
}) => {
  if (!element) return null;
  const r = photoPrintResolution(element, pixels);
  if (!r) return null;
  const q = printQuality(r.ppi);
  const warn = q.level === 'too_low' || q.level === 'low';
  return (
    <div className="space-y-1" aria-live="polite">
      <div className="flex flex-wrap items-center gap-1.5">
        <PrintQualityBadge ppi={r.ppi} />
        <span className="font-mono-tabular text-[11px] text-[#98958D]">
          {r.pixelWidth}×{r.pixelHeight} px at {Math.round(element.widthMm)}×{Math.round(element.heightMm)} mm
          {(element.image?.zoom || 1) !== 1 ? `, zoom ${Math.round((element.image?.zoom || 1) * 100)}%` : ''}
        </span>
      </div>
      {warn && (
        <p className="text-[11px] leading-relaxed text-[#C8C5BC]">
          For a sharp print at this size, use a photo of at least {r.neededWidth.toLocaleString()}×{r.neededHeight.toLocaleString()} px
          {(element.image?.zoom || 1) > 1 ? ', or zoom out inside the frame' : ''}.
        </p>
      )}
    </div>
  );
};
