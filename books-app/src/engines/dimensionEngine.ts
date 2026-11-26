import type {
  BindingType,
  BookElement,
  BookPage,
  DimensionPreset,
  MeasurementUnit,
  PageDimensions,
  PageOrientation,
  PrintSettings,
  ResizeStrategy,
} from '../types/bookstudio';

export const MM_PER_INCH = 25.4;
export const PT_PER_INCH = 72;
export const SCREEN_DPI = 96;
export const PRINT_DPI = 300;

export function mmToUnit(mm: number, unit: MeasurementUnit, dpi = PRINT_DPI): number {
  switch (unit) {
    case 'mm':
      return mm;
    case 'cm':
      return mm / 10;
    case 'in':
      return mm / MM_PER_INCH;
    case 'pt':
      return (mm / MM_PER_INCH) * PT_PER_INCH;
    case 'px':
      return (mm / MM_PER_INCH) * dpi;
  }
}

export function unitToMm(value: number, unit: MeasurementUnit, dpi = PRINT_DPI): number {
  switch (unit) {
    case 'mm':
      return value;
    case 'cm':
      return value * 10;
    case 'in':
      return value * MM_PER_INCH;
    case 'pt':
      return (value / PT_PER_INCH) * MM_PER_INCH;
    case 'px':
      return (value / dpi) * MM_PER_INCH;
  }
}

export function formatMeasurement(mm: number, unit: MeasurementUnit, decimals?: number): string {
  const val = mmToUnit(mm, unit);
  const precision =
    decimals !== undefined ? decimals : unit === 'px' ? 0 : unit === 'in' ? 2 : 1;
  return `${val.toFixed(precision)} ${unit}`;
}

export function formatNumericValue(mm: number, unit: MeasurementUnit): number {
  const val = mmToUnit(mm, unit);
  const factor = unit === 'px' ? 1 : unit === 'in' ? 100 : 10;
  return Math.round(val * factor) / factor;
}

export function inferOrientation(widthMm: number, heightMm: number): PageOrientation {
  if (Math.abs(widthMm - heightMm) <= 2) return 'square';
  return widthMm > heightMm ? 'landscape' : 'portrait';
}

export const BUILTIN_DIMENSION_PRESETS: DimensionPreset[] = [
  { id: 'coffee_portrait', name: 'Portrait Coffee Table Book (240 × 300 mm)', widthMm: 240, heightMm: 300, orientation: 'portrait', category: 'coffee_table' },
  { id: 'coffee_landscape', name: 'Landscape Coffee Table Book (300 × 240 mm)', widthMm: 300, heightMm: 240, orientation: 'landscape', category: 'coffee_table' },
  { id: 'square_book', name: 'Square Art Monograph (280 × 280 mm)', widthMm: 280, heightMm: 280, orientation: 'square', category: 'coffee_table' },
  { id: 'a4_portrait', name: 'A4 Portrait (210 × 297 mm)', widthMm: 210, heightMm: 297, orientation: 'portrait', category: 'standard' },
  { id: 'a4_landscape', name: 'A4 Landscape (297 × 210 mm)', widthMm: 297, heightMm: 210, orientation: 'landscape', category: 'standard' },
  { id: 'a3_portrait', name: 'A3 Portrait (297 × 420 mm)', widthMm: 297, heightMm: 420, orientation: 'portrait', category: 'standard' },
  { id: 'a3_landscape', name: 'A3 Landscape (420 × 297 mm)', widthMm: 420, heightMm: 297, orientation: 'landscape', category: 'standard' },
  { id: 'a5_portrait', name: 'A5 Portrait (148 × 210 mm)', widthMm: 148, heightMm: 210, orientation: 'portrait', category: 'standard' },
  { id: 'a5_landscape', name: 'A5 Landscape (210 × 148 mm)', widthMm: 210, heightMm: 148, orientation: 'landscape', category: 'standard' },
  { id: 'letter', name: 'US Letter (215.9 × 279.4 mm)', widthMm: 215.9, heightMm: 279.4, orientation: 'portrait', category: 'standard' },
  { id: 'tabloid', name: 'US Tabloid (279.4 × 431.8 mm)', widthMm: 279.4, heightMm: 431.8, orientation: 'portrait', category: 'standard' },
  { id: 'panoramic_foldout', name: 'Panoramic Gatefold Insert (420 × 240 mm)', widthMm: 420, heightMm: 240, orientation: 'landscape', category: 'coffee_table' },
];

export interface PaperStockSpec {
  name: string;
  gsm: number;
  caliperMm: number; // thickness per leaf (2 pages) supplied by paper mill
}

export const PAPER_STOCK_SPECS: PaperStockSpec[] = [
  { name: '150 gsm Silk Coated Art Paper', gsm: 150, caliperMm: 0.125 },
  { name: '170 gsm Matte Museum Art Paper', gsm: 170, caliperMm: 0.145 },
  { name: '200 gsm Uncoated Archival Cotton', gsm: 200, caliperMm: 0.215 },
  { name: '130 gsm Satin Editorial Stock', gsm: 130, caliperMm: 0.108 },
  { name: '250 gsm Heavyweight Layflat Photo Board', gsm: 250, caliperMm: 0.34 },
];

export const BINDING_LABELS: Record<BindingType, string> = {
  smyth_hardcover: 'Smyth-Sewn Hardcover (Casebound)',
  perfect: 'PUR Perfect Binding (Softcover)',
  layflat: 'Flush-Mount Layflat Coffee Table',
  saddle_stitch: 'Saddle Stitching (Booklet)',
  wire_o: 'Concealed Wire-O / Swiss Bound',
};

/**
 * Calculates spine width strictly from page count, printer-supplied paper caliper (mm per sheet / 2 pages),
 * hardcover board caliper (if casebound), and printer adhesive/fold tolerance.
 */
export function calculateSpineWidthMm(pageCount: number, print: PrintSettings): {
  spineMm: number;
  textBlockMm: number;
  boardsMm: number;
  warning?: string;
} {
  const leafCount = Math.ceil(Math.max(2, pageCount) / 2);
  const textBlockMm = leafCount * Math.max(0.05, print.paperCaliperMm);
  const boardsMm =
    print.bindingType === 'smyth_hardcover' || print.bindingType === 'layflat'
      ? Math.max(0, print.coverBoardCaliperMm) * 2
      : 0;
  const spineMm =
    print.bindingType === 'saddle_stitch'
      ? 0
      : Number((textBlockMm + boardsMm + Math.max(0, print.printerToleranceMm)).toFixed(2));

  let warning: string | undefined;
  if (print.bindingType === 'saddle_stitch' && pageCount > 64) {
    warning = 'Saddle stitching typically requires ≤ 64 pages and multiples of 4.';
  } else if (print.bindingType === 'saddle_stitch' && pageCount % 4 !== 0) {
    warning = 'Saddle stitching requires total page count to be a multiple of 4.';
  } else if (print.bindingType === 'smyth_hardcover' && pageCount % 8 !== 0) {
    warning = 'Smyth-sewn signatures print most economically in multiples of 8 or 16 pages.';
  }

  return { spineMm, textBlockMm: Number(textBlockMm.toFixed(2)), boardsMm: Number(boardsMm.toFixed(2)), warning };
}

export function getEffectivePageDimensions(
  page: BookPage,
  projectDimensions: PageDimensions
): PageDimensions {
  return page.dimensionsOverride ? page.dimensionsOverride : projectDimensions;
}

/**
 * Non-destructively transforms a page's elements when its physical dimensions change.
 * Never crops, distorts, or deletes content.
 */
export function transformPageElementsForResize(
  elements: BookElement[],
  oldDim: PageDimensions,
  newDim: PageDimensions,
  strategy: ResizeStrategy
): BookElement[] {
  if (strategy === 'preserve') {
    return elements.map((el) => ({ ...el }));
  }

  const sx = newDim.widthMm / Math.max(1, oldDim.widthMm);
  const sy = newDim.heightMm / Math.max(1, oldDim.heightMm);

  if (strategy === 'scale') {
    const uniformFontScale = Math.min(sx, sy);
    return elements.map((el) => ({
      ...el,
      xMm: Number((el.xMm * sx).toFixed(2)),
      yMm: Number((el.yMm * sy).toFixed(2)),
      widthMm: Number((el.widthMm * sx).toFixed(2)),
      heightMm: Number((el.heightMm * sy).toFixed(2)),
      textStyle: el.textStyle
        ? {
            ...el.textStyle,
            fontSizePt: Number(Math.max(6, el.textStyle.fontSizePt * uniformFontScale).toFixed(1)),
          }
        : undefined,
    }));
  }

  // strategy === 'reflow': preserve typography & design properties while mapping into new margins/grid
  const oldContentX = oldDim.margins.inner;
  const oldContentY = oldDim.margins.top;
  const oldContentW = Math.max(10, oldDim.widthMm - oldDim.margins.inner - oldDim.margins.outer);
  const oldContentH = Math.max(10, oldDim.heightMm - oldDim.margins.top - oldDim.margins.bottom);

  const newContentX = newDim.margins.inner;
  const newContentY = newDim.margins.top;
  const newContentW = Math.max(10, newDim.widthMm - newDim.margins.inner - newDim.margins.outer);
  const newContentH = Math.max(10, newDim.heightMm - newDim.margins.top - newDim.margins.bottom);

  return elements.map((el) => {
    const isFullBleed = el.xMm <= 0 && el.widthMm >= oldDim.widthMm - 2;
    if (isFullBleed) {
      return {
        ...el,
        xMm: el.xMm < 0 ? -newDim.bleedMm : 0,
        yMm: el.yMm < 0 ? -newDim.bleedMm : Number(((el.yMm / oldDim.heightMm) * newDim.heightMm).toFixed(2)),
        widthMm: el.xMm < 0 ? newDim.widthMm + newDim.bleedMm * 2 : newDim.widthMm,
        heightMm: Number(((el.heightMm / oldDim.heightMm) * newDim.heightMm).toFixed(2)),
      };
    }

    const relX = (el.xMm - oldContentX) / oldContentW;
    const relY = (el.yMm - oldContentY) / oldContentH;
    const relW = el.widthMm / oldContentW;
    const relH = el.heightMm / oldContentH;

    return {
      ...el,
      xMm: Number(Math.max(newContentX, newContentX + relX * newContentW).toFixed(2)),
      yMm: Number(Math.max(newContentY, newContentY + relY * newContentH).toFixed(2)),
      widthMm: Number(Math.min(newContentW, Math.max(12, relW * newContentW)).toFixed(2)),
      heightMm: Number(Math.min(newContentH, Math.max(8, relH * newContentH)).toFixed(2)),
    };
  });
}

/**
 * Rotates elements' positions 90° clockwise or anticlockwise around the page center (Content Rotation).
 */
export function rotatePageContentElements(
  elements: BookElement[],
  dim: PageDimensions,
  direction: 'cw' | 'ccw'
): BookElement[] {
  const cx = dim.widthMm / 2;
  const cy = dim.heightMm / 2;
  const deltaAngle = direction === 'cw' ? 90 : -90;
  return elements.map((el) => {
    const ex = el.xMm + el.widthMm / 2 - cx;
    const ey = el.yMm + el.heightMm / 2 - cy;
    const rx = direction === 'cw' ? -ey : ey;
    const ry = direction === 'cw' ? ex : -ex;
    return {
      ...el,
      xMm: Number((cx + rx - el.widthMm / 2).toFixed(2)),
      yMm: Number((cy + ry - el.heightMm / 2).toFixed(2)),
      rotation: ((el.rotation || 0) + deltaAngle + 360) % 360,
    };
  });
}
