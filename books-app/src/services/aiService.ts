import type {
  AiEditorialSuggestion,
  BookElement,
  BookPage,
  BookTemplate,
  BookTemplateCategory,
  DesignSystem,
  InfographicData,
  InfographicVisualVariant,
  PageDimensions,
  TemplateAnalysisReport,
} from '../types/bookstudio';
import { EDITORIAL_PHOTOS } from '../data/curatedAssets';
import { inferOrientation } from '../engines/dimensionEngine';
import { buildPublicationPagesFromBlueprint } from '../engines/unlimitedTemplateEngine';
import { apiSend } from './api';

export async function analyzeUploadedTemplates(payload: {
  files: Array<{ name: string; mimeType: string; base64: string }>;
  idmlMetadata?: Record<string, unknown> | null;
  bookBrief?: string;
}): Promise<TemplateAnalysisReport> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = await apiSend('POST', '/ai/analyze-template', payload);
  const r = data.report;
  return {
    id: `rpt_${Date.now()}`,
    analyzedAt: new Date().toISOString(),
    sourceFiles: payload.files.map((f) => f.name),
    sourceFormat: payload.idmlMetadata
      ? 'idml'
      : payload.files.some((f) => f.mimeType === 'application/pdf')
        ? 'pdf'
        : 'image',
    summary: r.summary,
    pageSize: {
      widthMm: Number(r.pageSize?.widthMm) || 240,
      heightMm: Number(r.pageSize?.heightMm) || 300,
      orientation:
        r.pageSize?.orientation === 'landscape' ||
        r.pageSize?.orientation === 'square' ||
        r.pageSize?.orientation === 'portrait'
          ? r.pageSize.orientation
          : 'portrait',
      recommendedPreset: r.pageSize?.recommendedPreset || 'Portrait Coffee Table Book',
    },
    colourPalette: r.colourPalette,
    typography: r.typography,
    gridSystem: r.gridSystem,
    pageLayoutCategories: r.pageLayoutCategories || [],
    imagePlacementPatterns: r.imagePlacementPatterns || [],
    textHierarchy: r.textHierarchy || [],
    decorativePatterns: r.decorativePatterns || [],
    chapterOpeningStyle: r.chapterOpeningStyle || 'Full-bleed photographic opener with serif display title',
    masterPageRecommendations: r.masterPageRecommendations || [],
    approved: false,
  };
}

export async function fetchTypographyPairings(payload: {
  style: string;
  bookCategory?: string;
  currentFonts?: Record<string, string>;
}): Promise<
  Array<{
    name: string;
    rationale: string;
    displayFont: string;
    headingFont: string;
    secondaryFont: string;
    bodyFont: string;
    captionFont: string;
    quoteFont: string;
    numericalFont: string;
  }>
> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = await apiSend('POST', '/ai/typography-pairing', payload);
  return data.pairings || [];
}

export async function askEditorialAssistant(payload: {
  prompt: string;
  mode: string;
  designSystem: DesignSystem;
  currentPage: BookPage;
  bookSummary: Record<string, unknown>;
  selectedElement?: BookElement | null;
}): Promise<{ summary: string; suggestions: AiEditorialSuggestion[] }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = await apiSend('POST', '/ai/editorial-assistant', payload);
  const suggestions: AiEditorialSuggestion[] = (data.suggestions || []).map(
    (s: Record<string, unknown>, i: number) => ({
      id: String(s.id || `sug_${Date.now()}_${i}`),
      category: (s.category as AiEditorialSuggestion['category']) || 'layout',
      title: String(s.title || 'Editorial Recommendation'),
      rationale: String(s.rationale || ''),
      targetPageId: payload.currentPage.id,
      targetElementId: payload.selectedElement?.id,
      actionType: (s.actionType as AiEditorialSuggestion['actionType']) || 'advisory_only',
      actionPayload: {
        recommendedFontSizePt: s.recommendedFontSizePt,
        recommendedLineHeight: s.recommendedLineHeight,
        recommendedInfographicVariant: s.recommendedInfographicVariant,
        rewrittenText: s.rewrittenText,
      },
    })
  );
  return { summary: String(data.summary || ''), suggestions };
}

export async function fetchAiTemplateRecommendations(payload: {
  brief: string;
  bookCategory: string;
  contentWordCount: number;
  imageCount: number;
  dataComplexity: string;
  availableBookTemplates: Array<{ id: string; name: string; category: string }>;
  availableInfographics: Array<{ id: string; name: string; category: string }>;
}): Promise<{
  bookRecommendations: Array<{ templateId: string; reason: string }>;
  infographicRecommendations: Array<{ templateId: string; reason: string }>;
}> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = await apiSend('POST', '/ai/recommend-templates', payload);
  return {
    bookRecommendations: data.bookRecommendations || [],
    infographicRecommendations: data.infographicRecommendations || [],
  };
}

const VALID_BOOK_CATEGORIES: BookTemplateCategory[] = [
  'Luxury & Premium Editorial',
  'Architecture & Interior Design',
  'Corporate & Institutional',
  'Art, Culture & Heritage',
  'Reports & Research',
  'Consulting & ESG',
];

export async function generateAiPublicationTemplate(payload: {
  prompt: string;
  documentKind: 'book' | 'report';
  trimPreset: string;
  widthMm: number;
  heightMm: number;
  chapterCount: number;
  aesthetic: string;
}): Promise<BookTemplate> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = await apiSend('POST', '/ai/generate-publication-template', payload);

  const widthMm = Math.max(140, Math.min(420, Number(payload.widthMm || data.widthMm) || 210));
  const heightMm = Math.max(140, Math.min(420, Number(payload.heightMm || data.heightMm) || 297));
  const columns = Math.max(
    1,
    Math.min(6, Math.round(Number(data.columns) || (payload.documentKind === 'report' ? 3 : 2)))
  );
  const category: BookTemplateCategory = VALID_BOOK_CATEGORIES.includes(data.category)
    ? data.category
    : payload.documentKind === 'report'
      ? 'Reports & Research'
      : 'Architecture & Interior Design';

  const margins = {
    top: payload.documentKind === 'report' ? 16 : 20,
    bottom: payload.documentKind === 'report' ? 18 : 22,
    inner: 20,
    outer: 16,
  };

  const dim: PageDimensions = {
    widthMm,
    heightMm,
    orientation: inferOrientation(widthMm, heightMm),
    rotation: 0,
    margins,
    gutterMm: 10,
    bleedMm: 3,
    safeAreaMm: 6,
    columns,
    columnGapMm: 5,
    baselineGridMm: 4,
    spreadMode: 'facing',
    presetName: payload.trimPreset,
  };

  const pal = data.palette || {};
  const f = data.fonts || {};
  const paper = pal.paper || '#FAF8F5';
  const surface = pal.surface || '#F2EFE9';
  const ink = pal.ink || '#18181B';
  const mutedInk = pal.mutedInk || '#57534E';
  const primaryAccent = pal.primaryAccent || '#9A6B3F';
  const secondaryAccent = pal.secondaryAccent || '#2D4A53';

  const ds: DesignSystem = {
    name: data.paletteName || `${data.title} System`,
    approved: true,
    sourceTemplateName: 'AI Publication Architect',
    colors: {
      paper,
      surface,
      ink,
      mutedInk,
      primaryAccent,
      secondaryAccent,
      palette: [paper, surface, ink, mutedInk, primaryAccent, secondaryAccent],
    },
    typography: {
      primaryFont: f.displayFont || 'Cormorant Garamond',
      secondaryFont: f.captionFont || 'Plus Jakarta Sans',
      displayFont: f.displayFont || 'Cormorant Garamond',
      headingFont: f.headingFont || 'Cormorant Garamond',
      bodyFont: f.bodyFont || 'Source Serif 4',
      captionFont: f.captionFont || 'Plus Jakarta Sans',
      quoteFont: f.quoteFont || 'Cormorant Garamond',
      numericalFont: f.numericalFont || 'JetBrains Mono',
      scale: {
        displayPt: payload.documentKind === 'report' ? 32 : 38,
        headingPt: 22,
        subheadingPt: 11,
        bodyPt: 10,
        captionPt: 8.5,
        quotePt: 16,
        folioPt: 8.5,
      },
      minApprovedBodyPt: 8.5,
    },
    spacing: {
      baselineMm: 4,
      paragraphGapMm: 3.5,
      sectionGapMm: 10,
      imageCaptionGapMm: 3,
    },
    grid: {
      columns,
      gutterMm: 5,
      margins,
    },
  };

  const photoPool = [
    EDITORIAL_PHOTOS.courtyard,
    EDITORIAL_PHOTOS.interior,
    EDITORIAL_PHOTOS.panorama,
    EDITORIAL_PHOTOS.craft,
    EDITORIAL_PHOTOS.sculpture,
  ];
  const seedIdx = Math.abs(String(data.title || '').length) % photoPool.length;
  const coverPhoto = photoPool[seedIdx];
  const secondPhoto = photoPool[(seedIdx + 2) % photoPool.length];

  const rawInfo = data.infographic || {};
  const infographicData: InfographicData = {
    templateId: `ai_inf_${Date.now()}`,
    variant: (rawInfo.variant as InfographicVisualVariant) || 'horizontal_bars',
    title: rawInfo.title || `${data.title} — Key Metrics`,
    subtitle: rawInfo.subtitle || 'Live Editable Vector Graphic',
    categoryLabel:
      rawInfo.categoryLabel || (payload.documentKind === 'report' ? 'Executive Data' : 'Editorial Data'),
    sourceNote: rawInfo.sourceNote || '',
    fontFamily: ds.typography.captionFont,
    backgroundColor: ds.colors.surface,
    textColor: ds.colors.ink,
    accentColor: ds.colors.primaryAccent,
    secondaryColor: ds.colors.secondaryAccent,
    items:
      Array.isArray(rawInfo.items) && rawInfo.items.length > 0
        ? rawInfo.items.map((item: Record<string, unknown>, idx: number) => ({
            id: `ai_it_${Date.now()}_${idx}`,
            label: String(item.label || `Metric ${idx + 1}`),
            value: Number(item.value) || 50,
            secondaryValue: item.secondaryValue !== undefined ? Number(item.secondaryValue) : undefined,
            unit: item.unit ? String(item.unit) : '%',
            yearOrStep: item.yearOrStep ? String(item.yearOrStep) : undefined,
            description: item.description ? String(item.description) : undefined,
          }))
        : [
            { id: 'ai_it_1', label: 'Primary Index', value: 84, unit: '%' },
            { id: 'ai_it_2', label: 'Efficiency Gain', value: 67, unit: '%' },
            { id: 'ai_it_3', label: 'Adoption Rate', value: 92, unit: '%' },
            { id: 'ai_it_4', label: 'Target Horizon', value: 78, unit: '%' },
          ],
    showLegend: true,
    showValues: true,
  };

  const chapters =
    Array.isArray(data.chapters) && data.chapters.length > 0
      ? data.chapters.map((c: Record<string, unknown>, i: number) => ({
          heading: String(c.heading || `Section ${i + 1}`),
          body: String(c.body || 'Editorial analysis and narrative overview.'),
          quote: c.quote ? String(c.quote) : undefined,
        }))
      : [
          { heading: 'Executive Context', body: data.description || payload.prompt },
          { heading: 'Strategic Findings', body: 'Detailed editorial commentary and analysis.' },
        ];

  const tplId = `ai_tpl_${Date.now()}`;
  return {
    id: tplId,
    name: String(data.title || 'AI Custom Publication'),
    category,
    documentKind: payload.documentKind,
    description: String(data.description || data.subtitle || payload.prompt),
    tags: ['ai-generated', payload.documentKind, payload.aesthetic.toLowerCase()],
    coverImage: coverPhoto,
    dimensions: dim,
    designSystem: ds,
    buildPages: () =>
      buildPublicationPagesFromBlueprint({
        title: String(data.title || 'AI Custom Publication'),
        subtitle: String(data.subtitle || ''),
        editionLine: String(
          data.editionLine ||
            (payload.documentKind === 'report' ? 'EXECUTIVE REPORT · 2026' : 'FIRST EDITION · MONOGRAPH')
        ),
        dim,
        ds,
        darkCover: Boolean(data.darkCover),
        coverPhoto,
        secondPhoto,
        infographicData,
        chapters,
      }),
  };
}

export async function generateAiInfographic(payload: {
  prompt: string;
  rawData?: string;
  preferredVariant?: string;
  designSystem?: DesignSystem;
}): Promise<InfographicData> {
  const ds = payload.designSystem;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = await apiSend('POST', '/ai/generate-infographic', {
      prompt: payload.prompt,
      rawData: payload.rawData || '',
      preferredVariant: payload.preferredVariant || 'auto',
      themeColors: ds
        ? {
            paper: ds.colors.paper,
            surface: ds.colors.surface,
            ink: ds.colors.ink,
            primaryAccent: ds.colors.primaryAccent,
            secondaryAccent: ds.colors.secondaryAccent,
            captionFont: ds.typography.captionFont,
          }
        : undefined,
    });

  return {
    templateId: `ai_inf_${Date.now()}`,
    variant: (data.variant as InfographicVisualVariant) || 'horizontal_bars',
    title: String(data.title || 'Custom Vector Infographic'),
    subtitle: String(data.subtitle || 'Live Editable Data Graphic'),
    categoryLabel: String(data.categoryLabel || 'AI Data Graphic'),
    sourceNote: String(data.sourceNote || ''),
    fontFamily: ds?.typography.captionFont || 'Plus Jakarta Sans',
    backgroundColor: ds?.colors.surface || '#F4F1EC',
    textColor: ds?.colors.ink || '#18181B',
    accentColor: ds?.colors.primaryAccent || '#A67C52',
    secondaryColor: ds?.colors.secondaryAccent || '#2D4A53',
    items: (Array.isArray(data.items) ? data.items : []).map(
      (item: Record<string, unknown>, idx: number) => ({
        id: `ai_item_${Date.now()}_${idx}`,
        label: String(item.label || `Item ${idx + 1}`),
        value: Number(item.value) || 0,
        secondaryValue: item.secondaryValue !== undefined ? Number(item.secondaryValue) : undefined,
        unit: item.unit ? String(item.unit) : '',
        yearOrStep: item.yearOrStep ? String(item.yearOrStep) : undefined,
        description: item.description ? String(item.description) : undefined,
      })
    ),
    showLegend: true,
    showValues: true,
  };
}

export async function requestAiAutoFlowPlan(payload: {
  rawData: string;
  preserveExactText: boolean;
  autoExtendPages: boolean;
  projectTitle: string;
  pagesSchema: import('../engines/autoFlowEngine').AutoFlowPageSchema[];
}): Promise<import('../engines/autoFlowEngine').AutoFlowPlan> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = await apiSend('POST', '/ai/auto-flow-data', payload);
  return {
    documentTitle: String(data.documentTitle || payload.projectTitle),
    documentSubtitle: data.documentSubtitle ? String(data.documentSubtitle) : undefined,
    summary: String(data.summary || 'Content mapped across layout frames.'),
    textUpdates: Array.isArray(data.textUpdates) ? data.textUpdates : [],
    imageUpdates: Array.isArray(data.imageUpdates) ? data.imageUpdates : [],
    infographicUpdates: Array.isArray(data.infographicUpdates) ? data.infographicUpdates : [],
    additionalPages: Array.isArray(data.additionalPages) ? data.additionalPages : [],
  };
}


