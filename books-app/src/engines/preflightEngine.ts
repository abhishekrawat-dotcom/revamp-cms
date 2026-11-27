import type { BindingType, BookElement, BookProject, PageDimensions, PreflightIssue } from '../types/bookstudio';
import { getEffectivePageDimensions, MM_PER_INCH } from './dimensionEngine';
import { auditProjectFonts } from './fontEngine';
import { countWords, measureTextOverflow } from './textEngine';
import { groupOfFrame, isBookLabel, isPlaceholderText } from './pourEngine';
import { isMissingPhoto, missingPhotoText } from './exportGate';

/* The pre-export check (Books Phase 4, 27 Nov 2026: it is the print-ready PDF's gate, exportGate.ts).
   Errors stop a print-ready PDF; warnings wait for one tick ("I've checked these warnings"); notes (info) never stop
   anything. A review PDF and the images are never stopped. What is what, and why:

   errors — the PDF would print wrong, or could not be made:
     - a photo frame with no photo, a template's empty "Portrait — drop a photo here" frames included (it prints empty);
     - a font that could not load (it cannot be embedded), or a text frame with words and no font;
     - text that doesn't fit its frame, measured with the real font (exports print only what fits);
     - a page whose size cannot be printed: not a real size, under 20 mm, or larger than a PDF page can be;
   warnings — it can be right, but a person should look:
     - an odd number of pages, or for saddle stitching not a multiple of 4: the printer adds blank pages where they
       choose. A warning, not an error: a designer may mean it (covers printed apart), and a printer can add the blanks;
     - photos below 250 ppi as placed, zoom counted (the photo badges' "Too low" and "Low");
     - text frames and charts inside the safe margin (the trim may cut them; running heads and page numbers sit in
       the margins by design);
     - photos and coloured boxes that stop at the trim instead of running into the bleed (a white sliver after
       cutting); frames entirely off the page and its bleed (they won't print);
     - pages of another size than the book (fold-outs and inserts need the printer's say);
     - empty text frames and frames still holding a template's sample words;
     - sewn hardcovers not in multiples of 8, saddle stitching over 64 pages, and books under 4 pages.
   notes — fonts outside the design system and colours outside its palette (design consistency, not print). */

export interface PreflightOptions {
  /** the template's own words (pourEngine.collectPlaceholderTexts): frames still holding them are listed */
  placeholders?: Set<string>;
}

/** the largest side a PDF page may have: 200 inches (14,400 points) */
export const MAX_PDF_SIDE_MM = 5080;
/** the smallest page side the check accepts as a real page */
export const MIN_PAGE_SIDE_MM = 20;
/** room the print-ready PDF may add around a page for its marks (each side) */
const MARKS_ROOM_MM = 15;

const BINDING_NAME: Record<BindingType, string> = {
  perfect: 'perfect binding',
  smyth_hardcover: 'a sewn hardcover',
  layflat: 'lay-flat binding',
  saddle_stitch: 'saddle stitching',
  wire_o: 'wire-o binding',
};

const TEXT_TYPES = new Set(['text', 'header', 'footer', 'pageNumber']);
/* running heads and page numbers sit in the margins by design, so the safe margin is checked for text frames and charts */
const SAFE_TYPES = new Set(['text', 'infographic']);

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const mm = (v: number) => `${Math.round(v * 10) / 10}`;

/** why a page size can't be a PDF page ('' when it can) */
function sizeProblem(dim: PageDimensions): string {
  const w = Number(dim.widthMm);
  const h = Number(dim.heightMm);
  const b = Number(dim.bleedMm ?? 0);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return 'its width or height is not a size';
  if (!Number.isFinite(b) || b < 0) return 'its bleed is not a size';
  if (w < MIN_PAGE_SIDE_MM || h < MIN_PAGE_SIDE_MM) return `it is ${mm(w)} × ${mm(h)} mm, smaller than ${MIN_PAGE_SIDE_MM} mm a side`;
  const room = 2 * (b + MARKS_ROOM_MM);
  if (w + room > MAX_PDF_SIDE_MM || h + room > MAX_PDF_SIDE_MM) {
    return `it is ${mm(w)} × ${mm(h)} mm: with its bleed and marks that is larger than a PDF page can be (${MAX_PDF_SIDE_MM} mm a side)`;
  }
  return '';
}

/** a frame's words, shortened for a sentence */
function quoteOf(text?: string): string {
  const one = String(text || '').replace(/\s+/g, ' ').trim();
  return one.length > 48 ? `${one.slice(0, 45).trim()}…` : one;
}

/**
 * The pre-export check: print problems (errors), things to look at (warnings) and design notes (info), each with the
 * page and frame to go to where there is one.
 */
export function runPreflightCheck(project: BookProject, options: PreflightOptions = {}): PreflightIssue[] {
  const issues: PreflightIssue[] = [];
  const placeholders = options.placeholders;
  const approvedColors = new Set(
    [
      project.designSystem.colors.paper,
      project.designSystem.colors.surface,
      project.designSystem.colors.ink,
      project.designSystem.colors.mutedInk,
      project.designSystem.colors.primaryAccent,
      project.designSystem.colors.secondaryAccent,
      ...project.designSystem.colors.palette,
      '#FFFFFF',
      '#000000',
      'transparent',
    ].map((c) => String(c || '').toLowerCase())
  );

  /* ---------- 1 fonts ---------- */
  const firstUse = (family: string): { pageId: string; pageNumber: number; elementId: string } | null => {
    for (let i = 0; i < project.pages.length; i++) {
      const el = project.pages[i].elements.find(
        (e) => !e.hidden && (e.textStyle?.fontFamily === family || e.infographic?.fontFamily === family)
      );
      if (el) return { pageId: project.pages[i].id, pageNumber: i + 1, elementId: el.id };
    }
    return null;
  };
  for (const f of auditProjectFonts(project)) {
    if (f.status === 'error') {
      issues.push({
        id: `pf_font_missing_${f.family}`,
        severity: 'error',
        category: 'missing_font',
        ...(firstUse(f.family) || {}),
        title: `Font can't load: ${f.family}`,
        detail: `It is used in ${plural(f.elementCount, 'frame')} on ${plural(f.pageCount, 'page')}. A font that can't load can't be embedded in the PDF.`,
        suggestion:
          'Check your connection and open this check again. If it still can\'t load, a Designer chooses another font for the text styles that use it (Type › Google Fonts & Typography Studio).',
      });
    }
    if (!f.isSystemApproved) {
      issues.push({
        id: `pf_font_consistency_${f.family}`,
        severity: 'info',
        category: 'design_consistency',
        title: `Font outside the design system: ${f.family}`,
        detail: `${plural(f.elementCount, 'frame')} use "${f.family}", which is not one of the book's design system fonts.`,
        suggestion: 'Keep it if it is meant, or replace it in Typography Studio.',
      });
    }
  }

  /* ---------- 2 page count and binding ---------- */
  const count = project.pages.length;
  const binding = project.printSettings?.bindingType;
  const bindingName = (binding && BINDING_NAME[binding]) || 'the binding';
  if (count > 0 && count % 2 === 1) {
    issues.push({
      id: 'pf_binding_odd',
      severity: 'warning',
      category: 'binding',
      title: `Odd number of pages (${count})`,
      detail: `A bound book has an even number of pages: every sheet has a front and a back. With ${count}, the printer would add a blank page where they choose.`,
      suggestion: `Add a page or delete one, so the book has ${count + 1}${count > 1 ? ` or ${count - 1}` : ''} pages.`,
    });
  } else if (binding === 'saddle_stitch' && count % 4 !== 0) {
    const down = count - (count % 4);
    issues.push({
      id: 'pf_binding_parity',
      severity: 'warning',
      category: 'binding',
      title: `Saddle stitching needs a multiple of 4 pages (this book has ${count})`,
      detail: 'Each folded sheet makes 4 pages, so the printer would add blank pages where they choose.',
      suggestion: `Add or delete pages to reach ${down + 4}${down > 0 ? ` or ${down}` : ''}.`,
    });
  }
  if (binding === 'saddle_stitch' && count > 64) {
    issues.push({
      id: 'pf_binding_saddle_long',
      severity: 'warning',
      category: 'binding',
      title: `${count} pages is a lot for saddle stitching`,
      detail: 'Saddle-stitched books are usually 64 pages or fewer; thicker ones bulge at the spine.',
      suggestion: 'Ask your printer, or choose another binding in Document Setup.',
    });
  }
  if (binding === 'smyth_hardcover' && count % 2 === 0 && count % 8 !== 0) {
    issues.push({
      id: 'pf_binding_signatures',
      severity: 'warning',
      category: 'binding',
      title: `${count} pages: not a multiple of 8 for ${bindingName}`,
      detail: 'Sewn books are printed in sections of 8 or 16 pages; other counts cost more or add blank pages.',
      suggestion: `Ask your printer, or add or delete pages to reach ${count + (8 - (count % 8))}${count > 8 ? ` or ${count - (count % 8)}` : ''}.`,
    });
  }
  if (count > 0 && count < 4) {
    issues.push({
      id: 'pf_page_seq_min',
      severity: 'warning',
      category: 'page_sequence',
      title: `Only ${plural(count, 'page')}`,
      detail: 'Bound books usually have 16 pages or more.',
      suggestion: 'Add pages from the page bar at the bottom, if this is meant to be a book.',
    });
  }

  /* ---------- 3 the book's own size ---------- */
  const bookProblem = sizeProblem(project.dimensions);
  if (bookProblem) {
    issues.push({
      id: 'pf_size_book',
      severity: 'error',
      category: 'mixed_format',
      title: "The book's page size can't be printed",
      detail: `The page size is set so that ${bookProblem}.`,
      suggestion: 'A Designer sets a real page size in Document Setup & Trim Size.',
    });
  }

  /* ---------- 4 each page ---------- */
  project.pages.forEach((page, idx) => {
    const pageNum = idx + 1;
    const dim = getEffectivePageDimensions(page, project.dimensions);
    const at = (el?: BookElement) => ({ pageId: page.id, pageNumber: pageNum, ...(el ? { elementId: el.id } : {}) });

    if (page.dimensionsOverride) {
      const problem = sizeProblem(dim);
      if (problem) {
        issues.push({
          id: `pf_size_${page.id}`,
          severity: 'error',
          category: 'mixed_format',
          ...at(),
          title: `Page ${pageNum}'s size can't be printed`,
          detail: `This page has its own size, and ${problem}.`,
          suggestion: "A Designer sets a real size for this page in Document Setup, or gives it the book's size again.",
        });
      } else if (
        Math.abs(dim.widthMm - project.dimensions.widthMm) > 0.5 ||
        Math.abs(dim.heightMm - project.dimensions.heightMm) > 0.5
      ) {
        issues.push({
          id: `pf_mixed_${page.id}`,
          severity: 'warning',
          category: 'mixed_format',
          ...at(),
          title: `Page ${pageNum} is not the book's size`,
          detail: `It is ${mm(dim.widthMm)} × ${mm(dim.heightMm)} mm; the book is ${mm(project.dimensions.widthMm)} × ${mm(project.dimensions.heightMm)} mm.`,
          suggestion: 'Check with your printer that they can bind it (a fold-out or an insert, for example).',
        });
      }
    }

    for (const el of page.elements) {
      if (el.hidden) continue;

      /* words */
      if (TEXT_TYPES.has(el.type) && el.textStyle) {
        const words = countWords(el.text);
        if (el.type === 'text' && words === 0) {
          issues.push({
            id: `pf_empty_${page.id}_${el.id}`,
            severity: 'warning',
            category: 'empty_frame',
            ...at(el),
            title: `Empty text frame on page ${pageNum}`,
            detail: `"${el.name}" has no words, so it prints nothing.`,
            suggestion: 'Type in it, pour the manuscript into it, or delete the frame.',
          });
        } else if (words > 0 || el.type === 'pageNumber') {
          if (!String(el.textStyle.fontFamily || '').trim()) {
            issues.push({
              id: `pf_font_none_${page.id}_${el.id}`,
              severity: 'error',
              category: 'missing_font',
              ...at(el),
              title: `No font chosen on page ${pageNum}`,
              detail: `"${el.name}" has words but no font, so none can be embedded.`,
              suggestion: 'A Designer chooses a font for this frame in the Properties panel.',
            });
          }
          const ov = measureTextOverflow(el);
          if (ov.isOverflowing) {
            issues.push({
              id: `pf_overflow_${page.id}_${el.id}`,
              severity: 'error',
              category: 'text_overflow',
              ...at(el),
              title: `Text doesn't fit on page ${pageNum}: ${plural(ov.overflowWords, 'word')}`,
              detail: `"${el.name}" needs ${ov.estimatedLines} lines and holds ${ov.maxLines} (measured with its font). Only what fits would print.`,
              suggestion:
                'Select the frame and use the box in the Properties panel: continue on the next page, shorten with ETB2B AI or edit the words yourself. A Designer can also shrink the type, tighten the spacing or make the frame taller.',
            });
          }
          if (words > 0 && groupOfFrame(el) && !isBookLabel(el, page) && isPlaceholderText(el.text, placeholders, el)) {
            issues.push({
              id: `pf_sample_${page.id}_${el.id}`,
              severity: 'warning',
              category: 'empty_frame',
              ...at(el),
              title: `Template words on page ${pageNum}`,
              detail: `"${el.name}" still says "${quoteOf(el.text)}", which would print as it is.`,
              suggestion: 'Replace them with your own words, or pour the manuscript into the frame.',
            });
          }
        }

        if (el.type === 'text' && !approvedColors.has(String(el.textStyle.color || '').toLowerCase())) {
          issues.push({
            id: `pf_color_${page.id}_${el.id}`,
            severity: 'info',
            category: 'design_consistency',
            ...at(el),
            title: `Colour outside the palette on page ${pageNum}`,
            detail: `"${el.name}" uses ${el.textStyle.color}, which is not in the design system's palette.`,
            suggestion: 'Keep it if it is meant, or use a palette colour.',
          });
        }
      }

      /* photos: missing, and their resolution as placed */
      if (el.type === 'image') {
        if (isMissingPhoto(el)) {
          issues.push({
            id: `pf_img_missing_${page.id}_${el.id}`,
            severity: 'error',
            category: 'missing_image',
            ...at(el),
            ...missingPhotoText(el, pageNum),
          });
        } else if (el.image && el.image.naturalWidth && el.image.naturalHeight) {
          const widthIn = el.widthMm / MM_PER_INCH;
          const heightIn = el.heightMm / MM_PER_INCH;
          // zoomed in inside its frame, each pixel prints larger (the photo badge's maths, PhotoResolutionBadge.tsx)
          const zoom = Math.max(0.1, el.image.zoom || 1);
          const effectiveDpi = Math.min(
            el.image.naturalWidth / Math.max(0.1, widthIn),
            el.image.naturalHeight / Math.max(0.1, heightIn)
          ) / zoom;
          if (effectiveDpi < 250) {
            const tooLow = effectiveDpi < 150;
            issues.push({
              id: `pf_dpi_${tooLow ? 'err' : 'low'}_${page.id}_${el.id}`,
              severity: 'warning',
              category: 'low_resolution',
              ...at(el),
              title: `${tooLow ? 'Photo resolution too low' : 'Low photo resolution'} on page ${pageNum}: ${Math.round(effectiveDpi)} ppi`,
              detail: `"${el.name}" is placed at ${Math.round(el.widthMm)} × ${Math.round(el.heightMm)} mm from a ${el.image.naturalWidth} × ${el.image.naturalHeight} px photo${zoom !== 1 ? `, zoomed to ${Math.round(zoom * 100)}%` : ''}. Print looks sharp from about 300 ppi${tooLow ? '; under 150 it looks soft' : ''}.`,
              suggestion:
                zoom > 1
                  ? 'Use a larger photo, zoom out inside the frame, or make the frame smaller.'
                  : 'Use a larger photo, or make the frame smaller.',
            });
          }
        }
      }

      /* the trim, the bleed and beyond */
      const right = el.xMm + el.widthMm;
      const bottom = el.yMm + el.heightMm;
      const bleed = Math.max(0, Number(dim.bleedMm) || 0);
      if (el.xMm >= dim.widthMm + bleed || right <= -bleed || el.yMm >= dim.heightMm + bleed || bottom <= -bleed) {
        issues.push({
          id: `pf_offpage_${page.id}_${el.id}`,
          severity: 'warning',
          category: 'bleed',
          ...at(el),
          title: `Frame off the page on page ${pageNum}`,
          detail: `"${el.name}" lies outside the page and its bleed, so it won't print.`,
          suggestion: 'Move it onto the page if it should print, or delete it.',
        });
        continue;
      }

      const fillsArea =
        el.type === 'image' ||
        ((el.type === 'shape' || el.type === 'decorative') &&
          !!el.shape &&
          el.shape.shapeKind !== 'rule' &&
          !!el.shape.fill &&
          el.shape.fill !== 'transparent');
      if (fillsArea && bleed > 0) {
        const near = 1.5;
        const edges: string[] = [];
        if (el.xMm >= 0 && el.xMm <= near) edges.push('left');
        if (right <= dim.widthMm && right >= dim.widthMm - near) edges.push('right');
        if (el.yMm >= 0 && el.yMm <= near) edges.push('top');
        if (bottom <= dim.heightMm && bottom >= dim.heightMm - near) edges.push('bottom');
        if (edges.length) {
          issues.push({
            id: `pf_bleed_${page.id}_${el.id}`,
            severity: 'warning',
            category: 'bleed',
            ...at(el),
            title: `Stops at the page edge on page ${pageNum}`,
            detail: `"${el.name}" ends at the ${edges.join(', ')} edge instead of running ${mm(bleed)} mm into the bleed, so a thin white line may show after cutting.`,
            suggestion: `Pull the frame ${mm(bleed)} mm past the edge, into the bleed.`,
          });
        }
      }

      /* the safe margin, for words and charts */
      if (SAFE_TYPES.has(el.type)) {
        const safe = dim.safeAreaMm || 6;
        if (el.xMm < safe || el.yMm < safe || right > dim.widthMm - safe || bottom > dim.heightMm - safe) {
          issues.push({
            id: `pf_safe_${page.id}_${el.id}`,
            severity: 'warning',
            category: 'safe_area',
            ...at(el),
            title: `Inside the safe margin on page ${pageNum}`,
            detail: `"${el.name}" comes within ${mm(safe)} mm of the page edge, where cutting can trim it.`,
            suggestion: 'Move it inside the safe-area guide.',
          });
        }
      }
    }
  });

  return issues;
}
