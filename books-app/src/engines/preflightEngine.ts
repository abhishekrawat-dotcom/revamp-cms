import type { BookProject, PreflightIssue } from '../types/bookstudio';
import { calculateSpineWidthMm, getEffectivePageDimensions, MM_PER_INCH } from './dimensionEngine';
import { auditProjectFonts } from './fontEngine';
import { countWords, measureTextOverflow } from './textEngine';

/**
 * Runs a complete 11-point Print Production Preflight + Design Consistency Audit.
 */
export function runPreflightCheck(project: BookProject): PreflightIssue[] {
  const issues: PreflightIssue[] = [];
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
    ].map((c) => c.toLowerCase())
  );

  // 1. Font production & embedding checks
  const fontAudit = auditProjectFonts(project);
  for (const f of fontAudit) {
    if (f.status === 'error') {
      issues.push({
        id: `pf_font_missing_${f.family}`,
        severity: 'error',
        category: 'missing_font',
        title: `Font failed to load: ${f.family}`,
        detail: `Used on ${f.pageCount} page(s) across ${f.elementCount} text frame(s), but Google Fonts stylesheet failed to resolve.`,
        suggestion: 'Verify the exact Google Fonts family name or substitute via Global Typography.',
      });
    }
    if (!f.isSystemApproved) {
      issues.push({
        id: `pf_font_consistency_${f.family}`,
        severity: 'warning',
        category: 'design_consistency',
        title: `Off-system font detected: ${f.family}`,
        detail: `${f.elementCount} element(s) use "${f.family}", which is outside the approved book Design System.`,
        suggestion: 'Replace globally via Typography Studio or approve this font in the Design System.',
      });
    }
  }

  // 2. Page sequence & binding checks
  const spine = calculateSpineWidthMm(project.pages.length, project.printSettings);
  if (spine.warning) {
    issues.push({
      id: 'pf_binding_parity',
      severity: 'warning',
      category: 'binding',
      title: 'Binding Signature & Page Count Notice',
      detail: spine.warning,
      suggestion: 'Adjust page count or verify signature imposition with your print vendor.',
    });
  }

  if (project.pages.length < 4) {
    issues.push({
      id: 'pf_page_seq_min',
      severity: 'warning',
      category: 'page_sequence',
      title: 'Short publication page count',
      detail: `Book currently has ${project.pages.length} pages. Most bound coffee table books require at least 16–24 pages.`,
      suggestion: 'Add spreads via the Page Navigator before press export.',
    });
  }

  // 3. Per-page checks (mixed-format, images, DPI, overflow, safe area, bleed, empty frames, color consistency)
  let mixedFormatCount = 0;

  project.pages.forEach((page, idx) => {
    const pageNum = idx + 1;
    const dim = getEffectivePageDimensions(page, project.dimensions);

    if (page.dimensionsOverride) {
      mixedFormatCount += 1;
    }

    for (const el of page.elements) {
      if (el.hidden) continue;

      // Text checks
      if (el.type === 'text') {
        if (countWords(el.text) === 0) {
          issues.push({
            id: `pf_empty_${page.id}_${el.id}`,
            severity: 'warning',
            category: 'empty_frame',
            pageId: page.id,
            pageNumber: pageNum,
            elementId: el.id,
            title: `Empty text frame on Page ${pageNum}`,
            detail: `"${el.name}" contains no editorial copy.`,
            suggestion: 'Assign content from Content Manager or remove the unused frame.',
          });
        } else {
          const ov = measureTextOverflow(el);
          if (ov.isOverflowing) {
            issues.push({
              id: `pf_overflow_${page.id}_${el.id}`,
              severity: 'error',
              category: 'text_overflow',
              pageId: page.id,
              pageNumber: pageNum,
              elementId: el.id,
              title: `Text overflow on Page ${pageNum} (${ov.overflowWords} words)`,
              detail: `"${el.name}" exceeds frame capacity (${ov.estimatedLines}/${ov.maxLines} lines).`,
              suggestion: 'Use Fit Text, Expand Frame, or Continue on Next Page from the Properties panel.',
            });
          }
        }

        if (el.textStyle && !approvedColors.has(el.textStyle.color.toLowerCase())) {
          issues.push({
            id: `pf_color_${page.id}_${el.id}`,
            severity: 'info',
            category: 'design_consistency',
            pageId: page.id,
            pageNumber: pageNum,
            elementId: el.id,
            title: `Custom colour on Page ${pageNum}`,
            detail: `"${el.name}" uses ${el.textStyle.color}, outside the approved palette.`,
            suggestion: 'Keep if intentional, or align with the Design System palette.',
          });
        }
      }

      // Image checks (missing src, effective print DPI, bleed)
      if (el.type === 'image') {
        if (!el.image?.src) {
          issues.push({
            id: `pf_img_missing_${page.id}_${el.id}`,
            severity: 'error',
            category: 'missing_image',
            pageId: page.id,
            pageNumber: pageNum,
            elementId: el.id,
            title: `Missing photograph on Page ${pageNum}`,
            detail: `Image frame "${el.name}" has no assigned photograph.`,
            suggestion: 'Drag an image from the Asset Library into this frame.',
          });
        } else if (el.image.naturalWidth && el.image.naturalHeight) {
          const widthIn = el.widthMm / MM_PER_INCH;
          const heightIn = el.heightMm / MM_PER_INCH;
          const effectiveDpi = Math.min(
            el.image.naturalWidth / Math.max(0.1, widthIn),
            el.image.naturalHeight / Math.max(0.1, heightIn)
          );
          if (effectiveDpi < 150) {
            issues.push({
              id: `pf_dpi_err_${page.id}_${el.id}`,
              severity: 'warning',
              category: 'low_resolution',
              pageId: page.id,
              pageNumber: pageNum,
              elementId: el.id,
              title: `Low effective print resolution (${Math.round(effectiveDpi)} DPI) on Page ${pageNum}`,
              detail: `"${el.name}" is placed at ${Math.round(el.widthMm)}×${Math.round(el.heightMm)} mm with ${el.image.naturalWidth}×${el.image.naturalHeight} px source.`,
              suggestion: 'Replace with a higher-resolution photograph (target 300 DPI) or reduce frame size.',
            });
          }
        }

        // Check edge-touching images without bleed
        const touchesTrimLeft = el.xMm >= 0 && el.xMm <= 1.5;
        const touchesTrimRight = el.xMm + el.widthMm >= dim.widthMm - 1.5 && el.xMm + el.widthMm <= dim.widthMm;
        if ((touchesTrimLeft || touchesTrimRight) && dim.bleedMm > 0) {
          issues.push({
            id: `pf_bleed_${page.id}_${el.id}`,
            severity: 'warning',
            category: 'bleed',
            pageId: page.id,
            pageNumber: pageNum,
            elementId: el.id,
            title: `Full-bleed extension recommended on Page ${pageNum}`,
            detail: `"${el.name}" stops at the trim edge without extending ${dim.bleedMm} mm into the bleed zone.`,
            suggestion: `Extend frame by ${dim.bleedMm} mm past trim edge to prevent white slivers after guillotining.`,
          });
        }
      }

      // Safe-area check for text / folios / infographics
      if (el.type === 'text' || el.type === 'infographic') {
        const safe = dim.safeAreaMm || 6;
        const outsideSafe =
          el.xMm < safe ||
          el.yMm < safe ||
          el.xMm + el.widthMm > dim.widthMm - safe ||
          el.yMm + el.heightMm > dim.heightMm - safe;
        if (outsideSafe) {
          issues.push({
            id: `pf_safe_${page.id}_${el.id}`,
            severity: 'warning',
            category: 'safe_area',
            pageId: page.id,
            pageNumber: pageNum,
            elementId: el.id,
            title: `Element outside safe margin on Page ${pageNum}`,
            detail: `"${el.name}" intrudes within ${safe} mm of the trim edge.`,
            suggestion: 'Move element inside the magenta/cyan safe-area guide.',
          });
        }
      }
    }
  });

  if (mixedFormatCount > 0) {
    issues.push({
      id: 'pf_mixed_format_notice',
      severity: 'info',
      category: 'mixed_format',
      title: `Mixed-format publication (${mixedFormatCount} custom-sized page${mixedFormatCount > 1 ? 's' : ''})`,
      detail:
        'This book contains pages with independent dimensions or orientations (e.g., foldouts, panoramic spreads, or custom inserts).',
      suggestion:
        'Confirm tip-in, gatefold scoring, or French-fold finishing specifications with your bindery prior to press.',
    });
  }

  return issues;
}
