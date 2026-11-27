import type { BookProject, MasterPage } from '../types/bookstudio';
import { BUILTIN_BOOK_TEMPLATES } from './bookTemplates';
import { CURATED_IMAGE_ASSETS, EDITORIAL_PHOTOS } from './curatedAssets';
import { applyPremiumTemplate } from './premiumTemplates';

export function createDefaultMasterPages(project: {
  paper: string;
  surface: string;
  ink: string;
  mutedInk: string;
  accent: string;
  headingFont: string;
  bodyFont: string;
  captionFont: string;
  numericalFont: string;
  widthMm: number;
  heightMm: number;
}): MasterPage[] {
  const W = project.widthMm;
  const H = project.heightMm;
  const mOut = 18;
  const mIn = 24;
  const contentW = W - mIn - mOut;

  return [
    {
      id: 'master_editorial_text',
      name: 'A — Editorial Text Spread',
      role: 'editorial_text',
      description: 'Running header, hairline divider, automatic page number, and balanced editorial margins.',
      backgroundColor: project.paper,
      isBuiltIn: true,
      elements: [
        {
          id: 'm_ed_hdr',
          name: 'Running Header',
          type: 'header',
          xMm: mOut,
          yMm: 10,
          widthMm: contentW,
          heightMm: 6,
          rotation: 0,
          opacity: 0.65,
          locked: false,
          hidden: false,
          zIndex: 8,
          textRole: 'running_head',
          text: 'FORMS OF SILENCE · ARCHITECTURAL MONOGRAPH',
          textStyle: {
            fontFamily: project.captionFont,
            fontSizePt: 7.5,
            fontWeight: 500,
            color: project.mutedInk,
            lineHeight: 1.2,
            letterSpacingEm: 0.14,
            textAlign: 'left',
            verticalAlign: 'middle',
            paragraphSpacingMm: 0,
            columns: 1,
            columnGapMm: 0,
            insetMm: 0,
            textTransform: 'uppercase',
          },
        },
        {
          id: 'm_ed_rule',
          name: 'Header Hairline',
          type: 'line',
          xMm: mOut,
          yMm: 17,
          widthMm: contentW,
          heightMm: 1,
          rotation: 0,
          opacity: 0.25,
          locked: false,
          hidden: false,
          zIndex: 7,
          shape: {
            shapeKind: 'rule',
            fill: 'transparent',
            stroke: project.ink,
            strokeWidthMm: 0.25,
            cornerRadiusMm: 0,
          },
        },
        {
          id: 'm_ed_folio',
          name: 'Page Number',
          type: 'pageNumber',
          xMm: W - mOut - 18,
          yMm: H - 14,
          widthMm: 18,
          heightMm: 7,
          rotation: 0,
          opacity: 0.75,
          locked: false,
          hidden: false,
          zIndex: 9,
          textRole: 'folio',
          text: '{{page}}',
          textStyle: {
            fontFamily: project.numericalFont,
            fontSizePt: 8.5,
            fontWeight: 500,
            color: project.mutedInk,
            lineHeight: 1.2,
            letterSpacingEm: 0.08,
            textAlign: 'right',
            verticalAlign: 'middle',
            paragraphSpacingMm: 0,
            columns: 1,
            columnGapMm: 0,
            insetMm: 0,
          },
        },
      ],
    },
    {
      id: 'master_chapter_opener',
      name: 'B — Chapter Opener',
      role: 'chapter_opener',
      description: 'Tinted limestone canvas with top accent rule and chapter numeral placeholder.',
      backgroundColor: project.surface,
      isBuiltIn: true,
      elements: [
        {
          id: 'm_ch_accent',
          name: 'Chapter Accent Rule',
          type: 'line',
          xMm: mIn,
          yMm: 16,
          widthMm: 36,
          heightMm: 1.5,
          rotation: 0,
          opacity: 1,
          locked: false,
          hidden: false,
          zIndex: 6,
          shape: {
            shapeKind: 'rule',
            fill: 'transparent',
            stroke: project.accent,
            strokeWidthMm: 0.6,
            cornerRadiusMm: 0,
          },
        },
        {
          id: 'm_ch_folio',
          name: 'Page Number',
          type: 'pageNumber',
          xMm: W - mOut - 18,
          yMm: H - 14,
          widthMm: 18,
          heightMm: 7,
          rotation: 0,
          opacity: 0.75,
          locked: false,
          hidden: false,
          zIndex: 9,
          textRole: 'folio',
          text: '{{page}}',
          textStyle: {
            fontFamily: project.numericalFont,
            fontSizePt: 8.5,
            fontWeight: 500,
            color: project.mutedInk,
            lineHeight: 1.2,
            letterSpacingEm: 0.08,
            textAlign: 'right',
            verticalAlign: 'middle',
            paragraphSpacingMm: 0,
            columns: 1,
            columnGapMm: 0,
            insetMm: 0,
          },
        },
      ],
    },
    {
      id: 'master_full_bleed',
      name: 'C — Full-Bleed Image Plate',
      role: 'full_bleed_image',
      description: 'Edge-to-edge photography plate with understated lower caption footer.',
      backgroundColor: project.paper,
      isBuiltIn: true,
      elements: [
        {
          id: 'm_fb_folio',
          name: 'Page Number',
          type: 'pageNumber',
          xMm: W - mOut - 18,
          yMm: H - 14,
          widthMm: 18,
          heightMm: 7,
          rotation: 0,
          opacity: 0.7,
          locked: false,
          hidden: false,
          zIndex: 9,
          textRole: 'folio',
          text: '{{page}}',
          textStyle: {
            fontFamily: project.numericalFont,
            fontSizePt: 8.5,
            fontWeight: 500,
            color: project.mutedInk,
            lineHeight: 1.2,
            letterSpacingEm: 0.08,
            textAlign: 'right',
            verticalAlign: 'middle',
            paragraphSpacingMm: 0,
            columns: 1,
            columnGapMm: 0,
            insetMm: 0,
          },
        },
      ],
    },
    {
      id: 'master_quote_page',
      name: 'D — Quote & Pause Page',
      role: 'quote_page',
      description: 'Quiet typographic pause with centred accent hairline and generous paper space.',
      backgroundColor: project.surface,
      isBuiltIn: true,
      elements: [
        {
          id: 'm_qt_rule',
          name: 'Centred Ornament Rule',
          type: 'line',
          xMm: W / 2 - 18,
          yMm: H * 0.36,
          widthMm: 36,
          heightMm: 1.5,
          rotation: 0,
          opacity: 0.9,
          locked: false,
          hidden: false,
          zIndex: 5,
          shape: {
            shapeKind: 'rule',
            fill: 'transparent',
            stroke: project.accent,
            strokeWidthMm: 0.5,
            cornerRadiusMm: 0,
          },
        },
      ],
    },
    {
      id: 'master_infographic',
      name: 'E — Data & Infographic Page',
      role: 'infographic',
      description: 'Structured analytical page with running header and source citation footer.',
      backgroundColor: project.paper,
      isBuiltIn: true,
      elements: [
        {
          id: 'm_inf_hdr',
          name: 'Data Section Header',
          type: 'header',
          xMm: mOut,
          yMm: 10,
          widthMm: contentW,
          heightMm: 6,
          rotation: 0,
          opacity: 0.7,
          locked: false,
          hidden: false,
          zIndex: 8,
          textRole: 'running_head',
          text: 'STUDIO METRICS & TECHNICAL DOSSIER',
          textStyle: {
            fontFamily: project.captionFont,
            fontSizePt: 7.5,
            fontWeight: 600,
            color: project.accent,
            lineHeight: 1.2,
            letterSpacingEm: 0.16,
            textAlign: 'left',
            verticalAlign: 'middle',
            paragraphSpacingMm: 0,
            columns: 1,
            columnGapMm: 0,
            insetMm: 0,
            textTransform: 'uppercase',
          },
        },
      ],
    },
  ];
}

export function createProjectFromBookTemplate(
  templateId: string,
  customName?: string
): BookProject {
  const tpl =
    BUILTIN_BOOK_TEMPLATES.find((t) => t.id === templateId) || BUILTIN_BOOK_TEMPLATES[5];
  const pages = tpl.buildPages();
  const ds = structuredClone(tpl.designSystem);
  const dim = structuredClone(tpl.dimensions);
  const masters = createDefaultMasterPages({
    paper: ds.colors.paper,
    surface: ds.colors.surface,
    ink: ds.colors.ink,
    mutedInk: ds.colors.mutedInk,
    accent: ds.colors.primaryAccent,
    headingFont: ds.typography.headingFont,
    bodyFont: ds.typography.bodyFont,
    captionFont: ds.typography.captionFont,
    numericalFont: ds.typography.numericalFont,
    widthMm: dim.widthMm,
    heightMm: dim.heightMm,
  });

  const now = new Date().toISOString();

  /* a Premium Editorial template brings its own master pages, chapters and photos (premiumTemplates.ts) */
  return applyPremiumTemplate({
    id: `proj_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name: customName || tpl.name,
    subtitle: tpl.description,
    category: tpl.category,
    status: 'draft',
    unit: 'mm',
    coverThumbnail: tpl.coverImage,
    dimensions: dim,
    designSystem: ds,
    masterPages: masters,
    chapters: [
      {
        id: 'ch_1',
        number: 1,
        title: 'Chapter I — Materiality & Light',
        subtitle: 'Foundational essays and photographic plates',
        masterPageId: masters[0].id,
        orderIndex: 0,
      },
      {
        id: 'ch_2',
        number: 2,
        title: 'Chapter II — Craft & Spatial Ledger',
        subtitle: 'Technical dossiers and archival plates',
        masterPageId: masters[4].id,
        orderIndex: 1,
      },
    ],
    contentSections: [
      {
        id: 'sec_intro',
        chapterId: 'ch_1',
        title: 'Curatorial Introduction',
        kind: 'body',
        body: 'Architecture is measured less by walls than by the quality of shadow they hold. Across twelve courtyards and coastal ateliers, honest stone, lime plaster, and timber age gracefully with light and monsoon.',
        assignedPageId: pages[3]?.id,
        orderIndex: 0,
      },
      {
        id: 'sec_craft',
        chapterId: 'ch_2',
        title: 'Artisan Studio Field Note',
        kind: 'body',
        body: 'In quiet rural workshops lit by timber-framed windows, stoneware vessels emerge from seventy-hour wood firings where falling ash paints mineral patinas across raw clay. Assign this unassigned section to any page frame without disturbing surrounding photography.',
        orderIndex: 1,
      },
      {
        id: 'sec_quote',
        chapterId: 'ch_1',
        title: 'Closing Architectural Epigraph',
        kind: 'quote',
        body: '“A courtyard is a room whose ceiling is the sky—an instrument calibrated for silence, rain, and shifting afternoon light.”',
        orderIndex: 2,
      },
    ],
    imageAssets: structuredClone(CURATED_IMAGE_ASSETS),
    pages,
    templateReport: null,
    printSettings: {
      bindingType: 'smyth_hardcover',
      paperStockName: '170 gsm Matte Museum Art Paper',
      paperCaliperMm: 0.145,
      coverBoardCaliperMm: 2.5,
      printerToleranceMm: 1.5,
      includeBleed: true,
      includeCropMarks: true,
      includeRegistrationMarks: true,
      colorSpace: 'CMYK_SIMULATED',
      targetDpi: 300,
      exportSpreads: false,
    },
    customDimensionPresets: [],
    createdAt: now,
    updatedAt: now,
  }, tpl.id);
}

export function createInitialSampleProject(): BookProject {
  const project = createProjectFromBookTemplate(
    'tpl_06_architecture_portfolio',
    'Forms of Silence — Architecture & Craft'
  );
  project.id = 'proj_forms_of_silence_sample';
  project.coverThumbnail = EDITORIAL_PHOTOS.courtyard;
  return project;
}
