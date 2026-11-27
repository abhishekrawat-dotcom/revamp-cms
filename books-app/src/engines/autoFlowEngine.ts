import type {
  BookElement,
  BookPage,
  BookProject,
  ContentSection,
  InfographicData,
  InfographicItem,
  InfographicVisualVariant,
} from '../types/bookstudio';
import { getEffectivePageDimensions } from './dimensionEngine';
import { newPageLook } from './masterPageEngine';
import { frameCapacityWords } from './textEngine';

export interface AutoFlowPageSchema {
  pageId: string;
  pageNumber: number;
  label: string;
  role: string;
  textFrames: Array<{
    elementId: string;
    name: string;
    textRole: string;
    approxWords: number;
    currentSnippet: string;
  }>;
  imageFrames: Array<{
    elementId: string;
    name: string;
    sizeMm: string;
  }>;
  infographicFrames: Array<{
    elementId: string;
    name: string;
    variant: string;
    currentTitle: string;
  }>;
}

export interface AutoFlowInfographicPayload {
  variant: InfographicVisualVariant;
  title: string;
  subtitle: string;
  categoryLabel?: string;
  sourceNote?: string;
  items: Array<{
    label: string;
    value: number;
    secondaryValue?: number;
    unit?: string;
    yearOrStep?: string;
    description?: string;
  }>;
}

export interface AutoFlowPlan {
  documentTitle: string;
  documentSubtitle?: string;
  summary: string;
  textUpdates: Array<{
    pageId: string;
    elementId: string;
    text: string;
  }>;
  imageUpdates: Array<{
    pageId: string;
    elementId: string;
    placeholderTitle: string;
    suggestedPhotoBrief: string;
  }>;
  infographicUpdates: Array<
    AutoFlowInfographicPayload & {
      pageId: string;
      elementId: string;
    }
  >;
  additionalPages: Array<{
    label: string;
    kicker?: string;
    heading: string;
    body: string;
    quote?: string;
    imagePlaceholderTitle?: string;
    imagePlaceholderBrief?: string;
    isInfographicPage?: boolean;
    infographic?: AutoFlowInfographicPayload;
  }>;
}

export interface ApplyAutoFlowOptions {
  /** 'placeholders' converts image frames into clean InDesign X-cross placeholders with contextual labels; 'keep_photos' preserves existing photos while updating alt/name metadata */
  imageMode: 'placeholders' | 'keep_photos';
  updateDocumentTitle: boolean;
  /** a Content editor's flow: frames keep their names (a frame's name is part of the design); only words, photos,
      captions and data change */
  keepFrameNames?: boolean;
}

/* how many words the frame holds, measured with its real font (textEngine.frameCapacityWords) */
function estimateFrameWordCapacity(el: BookElement): number {
  if (!el.textStyle) return 40;
  return Math.max(1, frameCapacityWords(el));
}

/**
 * Extracts a compact structural blueprint of every page and frame in the active document
 * so the AI Auto-Flow engine maps user content into the exact existing layout frames.
 */
export function extractLayoutSchemaForAutoFlow(project: BookProject): AutoFlowPageSchema[] {
  return project.pages.map((page, idx) => {
    const textFrames = page.elements
      .filter(
        (el) =>
          !el.hidden &&
          (el.type === 'text' || el.type === 'header' || el.type === 'footer') &&
          el.textRole !== 'folio'
      )
      .map((el) => ({
        elementId: el.id,
        name: el.name,
        textRole: el.textRole || 'body',
        approxWords: estimateFrameWordCapacity(el),
        currentSnippet: (el.text || '').slice(0, 90),
      }));

    const imageFrames = page.elements
      .filter((el) => !el.hidden && el.type === 'image')
      .map((el) => ({
        elementId: el.id,
        name: el.name,
        sizeMm: `${Math.round(el.widthMm)}×${Math.round(el.heightMm)}mm`,
      }));

    const infographicFrames = page.elements
      .filter((el) => !el.hidden && el.type === 'infographic' && el.infographic)
      .map((el) => ({
        elementId: el.id,
        name: el.name,
        variant: el.infographic!.variant,
        currentTitle: el.infographic!.title,
      }));

    return {
      pageId: page.id,
      pageNumber: idx + 1,
      label: page.label,
      role: page.role,
      textFrames,
      imageFrames,
      infographicFrames,
    };
  });
}

function buildStyledInfographicData(
  payload: AutoFlowInfographicPayload,
  project: BookProject,
  existing?: InfographicData
): InfographicData {
  const ds = project.designSystem;
  const items: InfographicItem[] = (payload.items || []).map((it, idx) => ({
    id: `af_item_${Date.now()}_${idx}`,
    label: String(it.label || `Metric ${idx + 1}`),
    value: Number(it.value) || 0,
    secondaryValue: it.secondaryValue !== undefined ? Number(it.secondaryValue) : undefined,
    unit: it.unit || '',
    yearOrStep: it.yearOrStep || undefined,
    description: it.description || undefined,
  }));

  return {
    templateId: existing?.templateId || `af_inf_${Date.now()}`,
    variant: payload.variant || existing?.variant || 'horizontal_bars',
    title: payload.title || existing?.title || 'Key Data Overview',
    subtitle: payload.subtitle || existing?.subtitle || 'Auto-flowed from source data',
    categoryLabel: payload.categoryLabel || existing?.categoryLabel || 'Live Data Graphic',
    sourceNote: payload.sourceNote || existing?.sourceNote || `${project.name} · Live Vector Data`,
    fontFamily: existing?.fontFamily || ds.typography.captionFont,
    backgroundColor: existing?.backgroundColor || ds.colors.surface,
    textColor: existing?.textColor || ds.colors.ink,
    accentColor: existing?.accentColor || ds.colors.primaryAccent,
    secondaryColor: existing?.secondaryColor || ds.colors.secondaryAccent,
    items: items.length > 0 ? items : existing?.items || [],
    showLegend: existing?.showLegend ?? true,
    showValues: existing?.showValues ?? true,
  };
}

/**
 * Clones an existing editorial page from the project so extra auto-flowed sections
 * inherit the exact same layout geometry, columns, typography, image placeholder position, and folio!
 */
function buildAdditionalPagePreservingLayout(
  project: BookProject,
  spec: AutoFlowPlan['additionalPages'][number],
  index: number,
  options: ApplyAutoFlowOptions
): BookPage {
  const ts = `${Date.now()}_${index}`;
  const ds = project.designSystem;
  const dim = project.dimensions;
  const m = dim.margins;
  const W = dim.widthMm;
  const H = dim.heightMm;
  const contentW = Math.max(60, W - m.inner - m.outer);

  // If this additional page is an infographic page, clone existing infographic page layout or construct in matching design system
  if (spec.isInfographicPage && spec.infographic) {
    const prototypeInfoPage = project.pages.find((p) =>
      p.elements.some((e) => e.type === 'infographic')
    );
    if (prototypeInfoPage) {
      const cloned = structuredClone(prototypeInfoPage);
      cloned.id = `pg_af_inf_${ts}`;
      cloned.label = spec.label || spec.infographic.title;
      cloned.elements = cloned.elements.map((el, i) => {
        const nextEl: BookElement = { ...el, id: `el_af_inf_${ts}_${i}` };
        if (nextEl.type === 'infographic') {
          if (!options.keepFrameNames) nextEl.name = spec.infographic!.title;
          nextEl.infographic = buildStyledInfographicData(
            spec.infographic!,
            project,
            nextEl.infographic
          );
        } else if (nextEl.type === 'text' && nextEl.textRole === 'heading') {
          nextEl.text = spec.heading || spec.infographic!.title;
        } else if (nextEl.type === 'text' && nextEl.textRole === 'caption') {
          nextEl.text = spec.kicker || spec.infographic!.sourceNote || nextEl.text;
        }
        return nextEl;
      });
      return cloned;
    }

    return {
      id: `pg_af_inf_${ts}`,
      orderIndex: project.pages.length + index,
      label: spec.label || 'Data Infographic',
      role: 'infographic',
      ...newPageLook(project),
      elements: [
        {
          id: `el_af_ik_${ts}`,
          name: 'Infographic Kicker',
          type: 'text',
          xMm: m.outer,
          yMm: m.top + 4,
          widthMm: contentW,
          heightMm: 8,
          rotation: 0,
          opacity: 1,
          locked: false,
          hidden: false,
          zIndex: 2,
          textRole: 'caption',
          text: (spec.kicker || 'DATA VISUALIZATION · LIVE VECTOR').toUpperCase(),
          textStyle: {
            fontFamily: ds.typography.captionFont,
            fontSizePt: 8,
            fontWeight: 600,
            color: ds.colors.primaryAccent,
            lineHeight: 1.2,
            letterSpacingEm: 0.14,
            textAlign: 'left',
            verticalAlign: 'top',
            paragraphSpacingMm: 0,
            columns: 1,
            columnGapMm: 4,
            insetMm: 0,
            textTransform: 'uppercase',
          },
        },
        {
          id: `el_af_iv_${ts}`,
          name: spec.infographic.title,
          type: 'infographic',
          xMm: m.outer,
          yMm: m.top + 16,
          widthMm: contentW,
          heightMm: Math.min(138, H - m.top - m.bottom - 38),
          rotation: 0,
          opacity: 1,
          locked: false,
          hidden: false,
          zIndex: 2,
          infographic: buildStyledInfographicData(spec.infographic, project),
        },
        {
          id: `el_af_ib_${ts}`,
          name: 'Data Commentary',
          type: 'text',
          xMm: m.outer,
          yMm: Math.min(H - m.bottom - 20, m.top + 160),
          widthMm: contentW,
          heightMm: 18,
          rotation: 0,
          opacity: 0.9,
          locked: false,
          hidden: false,
          zIndex: 3,
          textRole: 'body',
          text: spec.body || spec.infographic.sourceNote || '',
          textStyle: {
            fontFamily: ds.typography.bodyFont,
            fontSizePt: ds.typography.scale.captionPt,
            fontWeight: 400,
            color: ds.colors.mutedInk,
            lineHeight: 1.45,
            letterSpacingEm: 0,
            textAlign: 'left',
            verticalAlign: 'top',
            paragraphSpacingMm: 2,
            columns: 1,
            columnGapMm: 4,
            insetMm: 0,
          },
        },
      ],
    };
  }

  // Clone an existing interior editorial page from the current document to preserve the EXACT layout!
  const editorialCandidates = project.pages.filter(
    (p, idx) =>
      idx > 0 &&
      p.role !== 'front_cover' &&
      p.role !== 'back_cover' &&
      p.role !== 'table_of_contents' &&
      p.role !== 'infographic' &&
      p.elements.some((e) => e.type === 'text')
  );
  const prototype =
    editorialCandidates[index % Math.max(1, editorialCandidates.length)] ||
    project.pages[Math.min(1, project.pages.length - 1)];

  if (prototype) {
    const cloned = structuredClone(prototype);
    cloned.id = `pg_af_${ts}`;
    cloned.label = spec.label || spec.heading;
    let headingAssigned = false;
    let bodyAssigned = false;
    let kickerAssigned = false;
    let quoteAssigned = false;

    cloned.elements = cloned.elements.map((el, i) => {
      const nextEl: BookElement = {
        ...el,
        id: `el_af_${ts}_${i}`,
        masterElementId: undefined,
      };

      if (nextEl.type === 'image' && nextEl.image) {
        const title = spec.imagePlaceholderTitle || `${spec.heading} Photograph`;
        const brief = spec.imagePlaceholderBrief || title;
        if (!options.keepFrameNames) nextEl.name = title;
        nextEl.image = {
          ...nextEl.image,
          src: options.imageMode === 'placeholders' ? '' : nextEl.image.src,
          alt: brief,
          captionText: title,
        };
      } else if (nextEl.type === 'text') {
        if (
          !headingAssigned &&
          (nextEl.textRole === 'heading' || nextEl.textRole === 'display')
        ) {
          nextEl.text = spec.heading;
          headingAssigned = true;
        } else if (
          !kickerAssigned &&
          (nextEl.textRole === 'subheading' || nextEl.textRole === 'caption')
        ) {
          nextEl.text = spec.kicker || spec.label;
          kickerAssigned = true;
        } else if (!quoteAssigned && nextEl.textRole === 'quote' && spec.quote) {
          nextEl.text = spec.quote;
          quoteAssigned = true;
        } else if (!bodyAssigned && nextEl.textRole === 'body') {
          nextEl.text =
            spec.body + (!quoteAssigned && spec.quote ? `\n\n“${spec.quote}”` : '');
          bodyAssigned = true;
        }
      }
      return nextEl;
    });

    // If prototype had no body frame, add one styled cleanly inside margins
    if (!bodyAssigned && spec.body) {
      const pDim = getEffectivePageDimensions(cloned, dim);
      cloned.elements.push({
        id: `el_af_body_${ts}`,
        name: 'Editorial Copy',
        type: 'text',
        xMm: pDim.margins.inner,
        yMm: pDim.margins.top + 32,
        widthMm: Math.max(60, pDim.widthMm - pDim.margins.inner - pDim.margins.outer),
        heightMm: Math.max(60, pDim.heightMm - pDim.margins.top - pDim.margins.bottom - 44),
        rotation: 0,
        opacity: 1,
        locked: false,
        hidden: false,
        zIndex: cloned.elements.length + 2,
        textRole: 'body',
        text: spec.body,
        textStyle: {
          fontFamily: ds.typography.bodyFont,
          fontSizePt: ds.typography.scale.bodyPt,
          fontWeight: 400,
          color: ds.colors.ink,
          lineHeight: 1.55,
          letterSpacingEm: 0,
          textAlign: 'left',
          verticalAlign: 'top',
          paragraphSpacingMm: ds.spacing.paragraphGapMm,
          columns: Math.min(2, pDim.columns),
          columnGapMm: pDim.columnGapMm,
          insetMm: 0,
        },
      });
    }

    return cloned;
  }

  // Fallback clean page in exact project design system
  return {
    id: `pg_af_${ts}`,
    orderIndex: project.pages.length + index,
    label: spec.label || spec.heading,
    role: 'editorial_text',
    ...newPageLook(project),
    elements: [
      {
        id: `el_af_h_${ts}`,
        name: 'Section Heading',
        type: 'text',
        xMm: m.inner,
        yMm: m.top + 6,
        widthMm: contentW,
        heightMm: 22,
        rotation: 0,
        opacity: 1,
        locked: false,
        hidden: false,
        zIndex: 2,
        textRole: 'heading',
        text: spec.heading,
        textStyle: {
          fontFamily: ds.typography.headingFont,
          fontSizePt: ds.typography.scale.headingPt,
          fontWeight: 500,
          color: ds.colors.ink,
          lineHeight: 1.15,
          letterSpacingEm: -0.01,
          textAlign: 'left',
          verticalAlign: 'top',
          paragraphSpacingMm: 3,
          columns: 1,
          columnGapMm: dim.columnGapMm,
          insetMm: 0,
        },
      },
      {
        id: `el_af_img_${ts}`,
        name: spec.imagePlaceholderTitle || 'Editorial Image Placeholder',
        type: 'image',
        xMm: m.inner,
        yMm: m.top + 32,
        widthMm: contentW,
        heightMm: Math.round((H - m.top - m.bottom) * 0.36),
        rotation: 0,
        opacity: 1,
        locked: false,
        hidden: false,
        zIndex: 1,
        image: {
          src: '',
          alt: spec.imagePlaceholderBrief || spec.imagePlaceholderTitle || 'Drop photograph here',
          fit: 'cover',
          zoom: 1,
          focalX: 50,
          focalY: 50,
          originalCrop: { zoom: 1, focalX: 50, focalY: 50, fit: 'cover' },
        },
      },
      {
        id: `el_af_b_${ts}`,
        name: 'Editorial Body',
        type: 'text',
        xMm: m.inner,
        yMm: m.top + 38 + Math.round((H - m.top - m.bottom) * 0.36),
        widthMm: contentW,
        heightMm: Math.max(54, Math.round((H - m.top - m.bottom) * 0.44)),
        rotation: 0,
        opacity: 1,
        locked: false,
        hidden: false,
        zIndex: 3,
        textRole: 'body',
        text: spec.body,
        textStyle: {
          fontFamily: ds.typography.bodyFont,
          fontSizePt: ds.typography.scale.bodyPt,
          fontWeight: 400,
          color: ds.colors.ink,
          lineHeight: 1.55,
          letterSpacingEm: 0,
          textAlign: 'left',
          verticalAlign: 'top',
          paragraphSpacingMm: ds.spacing.paragraphGapMm,
          columns: Math.min(2, dim.columns),
          columnGapMm: dim.columnGapMm,
          insetMm: 0,
        },
      },
    ],
  };
}

/**
 * Applies the AI Auto-Flow plan onto the active BookProject while strictly preserving
 * every coordinate, margin, font family, colour palette, image frame geometry, and infographic frame.
 */
export function applyAutoFlowPlanToProject(
  project: BookProject,
  plan: AutoFlowPlan,
  options: ApplyAutoFlowOptions
): BookProject {
  const textMap = new Map<string, string>();
  plan.textUpdates.forEach((u) => {
    textMap.set(`${u.pageId}::${u.elementId}`, u.text);
  });

  const imageMap = new Map<string, { placeholderTitle: string; suggestedPhotoBrief: string }>();
  plan.imageUpdates.forEach((u) => {
    imageMap.set(`${u.pageId}::${u.elementId}`, {
      placeholderTitle: u.placeholderTitle,
      suggestedPhotoBrief: u.suggestedPhotoBrief,
    });
  });

  const infoMap = new Map<string, AutoFlowInfographicPayload>();
  plan.infographicUpdates.forEach((u) => {
    infoMap.set(`${u.pageId}::${u.elementId}`, u);
  });

  const updatedPages: BookPage[] = project.pages.map((page) => ({
    ...page,
    elements: page.elements.map((el) => {
      const key = `${page.id}::${el.id}`;

      if (textMap.has(key) && (el.type === 'text' || el.type === 'header' || el.type === 'footer')) {
        return {
          ...el,
          text: textMap.get(key)!,
        };
      }

      if (el.type === 'image' && el.image) {
        const imgPatch = imageMap.get(key);
        const nextName = imgPatch?.placeholderTitle || el.name;
        const nextAlt = imgPatch?.suggestedPhotoBrief || el.image.alt;
        return {
          ...el,
          name: options.keepFrameNames ? el.name : nextName,
          image: {
            ...el.image,
            src: options.imageMode === 'placeholders' ? '' : el.image.src,
            alt: nextAlt,
            captionText: nextName,
          },
        };
      }

      if (el.type === 'infographic' && infoMap.has(key)) {
        const infPatch = infoMap.get(key)!;
        return {
          ...el,
          name: options.keepFrameNames ? el.name : infPatch.title || el.name,
          infographic: buildStyledInfographicData(infPatch, project, el.infographic),
        };
      }

      return el;
    }),
  }));

  // Append any extra pages needed to hold all of the user's flowed data in the exact same layout
  const extraPages = (plan.additionalPages || []).map((spec, idx) =>
    buildAdditionalPagePreservingLayout(project, spec, idx, options)
  );

  const allPages = [...updatedPages, ...extraPages].map((pg, i) => ({
    ...pg,
    orderIndex: i,
  }));

  // Sync Content Manager sections so backend editorial word counts reflect flowed data
  const syncedSections: ContentSection[] = [];
  allPages.forEach((pg, pIdx) => {
    pg.elements.forEach((el) => {
      if (el.type === 'text' && el.text && el.text.trim().length > 0) {
        syncedSections.push({
          id: `sec_af_${pIdx}_${el.id}`,
          chapterId: pg.chapterId || project.chapters[0]?.id,
          title: `${pg.label} — ${el.name}`,
          kind:
            el.textRole === 'heading' || el.textRole === 'display'
              ? 'heading'
              : el.textRole === 'subheading'
                ? 'subheading'
                : el.textRole === 'quote'
                  ? 'quote'
                  : el.textRole === 'caption'
                    ? 'caption'
                    : 'body',
          body: el.text,
          assignedPageId: pg.id,
          assignedElementId: el.id,
          orderIndex: syncedSections.length,
        });
      }
    });
  });

  return {
    ...project,
    name:
      options.updateDocumentTitle && plan.documentTitle?.trim()
        ? plan.documentTitle.trim()
        : project.name,
    subtitle:
      options.updateDocumentTitle && plan.documentSubtitle?.trim()
        ? plan.documentSubtitle.trim()
        : project.subtitle,
    pages: allPages,
    contentSections: syncedSections.length > 0 ? syncedSections : project.contentSections,
  };
}
