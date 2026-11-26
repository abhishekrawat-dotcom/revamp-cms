import type {
  AlignAction,
  BookElement,
  BookPage,
  BookProject,
  BookTemplate,
  BookTemplateCategory,
  DesignSystem,
  InfographicCategory,
  InfographicData,
  InfographicTemplate,
  InfographicVisualVariant,
  PageDimensions,
} from '../types/bookstudio';
import { CURATED_IMAGE_ASSETS, EDITORIAL_PHOTOS } from '../data/curatedAssets';
import { BUILTIN_INFOGRAPHIC_TEMPLATES } from '../data/infographicTemplates';
import { createDefaultMasterPages } from '../data/sampleProject';
import { inferOrientation } from './dimensionEngine';

// ---------------------------------------------------------------------------
// 1. INDESIGN PRECISION ALIGN & DISTRIBUTE ENGINE
// ---------------------------------------------------------------------------

export function alignAndDistributeElements(
  elements: BookElement[],
  selectedIds: string[],
  action: AlignAction,
  pageDim: PageDimensions
): BookElement[] {
  if (selectedIds.length === 0) return elements;
  const selSet = new Set(selectedIds);
  const selected = elements.filter((e) => selSet.has(e.id) && !e.locked);
  if (selected.length === 0) return elements;

  const isSingle = selected.length === 1;
  const minX = isSingle ? pageDim.margins.outer : Math.min(...selected.map((e) => e.xMm));
  const maxX = isSingle
    ? pageDim.widthMm - pageDim.margins.inner
    : Math.max(...selected.map((e) => e.xMm + e.widthMm));
  const minY = isSingle ? pageDim.margins.top : Math.min(...selected.map((e) => e.yMm));
  const maxY = isSingle
    ? pageDim.heightMm - pageDim.margins.bottom
    : Math.max(...selected.map((e) => e.yMm + e.heightMm));

  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const maxW = Math.max(...selected.map((e) => e.widthMm));
  const maxH = Math.max(...selected.map((e) => e.heightMm));

  const patchMap = new Map<string, Partial<BookElement>>();

  if (action === 'distribute_h' && selected.length >= 3) {
    const sorted = [...selected].sort((a, b) => a.xMm - b.xMm);
    const totalW = sorted.reduce((s, e) => s + e.widthMm, 0);
    const span = maxX - minX;
    const gap = (span - totalW) / (sorted.length - 1);
    let cursor = minX;
    for (const el of sorted) {
      patchMap.set(el.id, { xMm: Number(cursor.toFixed(1)) });
      cursor += el.widthMm + gap;
    }
  } else if (action === 'distribute_v' && selected.length >= 3) {
    const sorted = [...selected].sort((a, b) => a.yMm - b.yMm);
    const totalH = sorted.reduce((s, e) => s + e.heightMm, 0);
    const span = maxY - minY;
    const gap = (span - totalH) / (sorted.length - 1);
    let cursor = minY;
    for (const el of sorted) {
      patchMap.set(el.id, { yMm: Number(cursor.toFixed(1)) });
      cursor += el.heightMm + gap;
    }
  } else {
    for (const el of selected) {
      switch (action) {
        case 'left':
          patchMap.set(el.id, { xMm: Number(minX.toFixed(1)) });
          break;
        case 'center_h':
          patchMap.set(el.id, { xMm: Number((centerX - el.widthMm / 2).toFixed(1)) });
          break;
        case 'right':
          patchMap.set(el.id, { xMm: Number((maxX - el.widthMm).toFixed(1)) });
          break;
        case 'top':
          patchMap.set(el.id, { yMm: Number(minY.toFixed(1)) });
          break;
        case 'center_v':
          patchMap.set(el.id, { yMm: Number((centerY - el.heightMm / 2).toFixed(1)) });
          break;
        case 'bottom':
          patchMap.set(el.id, { yMm: Number((maxY - el.heightMm).toFixed(1)) });
          break;
        case 'match_width':
          patchMap.set(el.id, { widthMm: Number(maxW.toFixed(1)) });
          break;
        case 'match_height':
          patchMap.set(el.id, { heightMm: Number(maxH.toFixed(1)) });
          break;
      }
    }
  }

  return elements.map((el) => {
    const patch = patchMap.get(el.id);
    return patch ? { ...el, ...patch } : el;
  });
}

// ---------------------------------------------------------------------------
// 2. UNLIMITED PROCEDURAL TEMPLATE & INFOGRAPHIC SYNTHESIZER
// ---------------------------------------------------------------------------

function seededRand(seed: number): () => number {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

const PALETTES = [
  { name: 'Travertine & Bronze', paper: '#FBF9F5', surface: '#EFECE4', ink: '#1B1917', muted: '#69645D', accent: '#A67C46', sec: '#37474F', darkCover: true },
  { name: 'Swiss Blueprint', paper: '#FFFFFF', surface: '#F1F4F8', ink: '#0F172A', muted: '#475569', accent: '#1D4ED8', sec: '#0F766E', darkCover: true },
  { name: 'Botanical Forest', paper: '#FAFBF8', surface: '#EBF0E8', ink: '#15221B', muted: '#516357', accent: '#2D6A4F', sec: '#B07D3C', darkCover: true },
  { name: 'Terracotta Atelier', paper: '#FCF9F5', surface: '#F2E8DF', ink: '#231A15', muted: '#705D52', accent: '#B45309', sec: '#374151', darkCover: false },
  { name: 'Obsidian Gallery', paper: '#F7F7F5', surface: '#E6E6E2', ink: '#121214', muted: '#5A5A60', accent: '#8C6D46', sec: '#2D3748', darkCover: true },
  { name: 'Nordic Slate', paper: '#F9FAFB', surface: '#E9EEF2', ink: '#111827', muted: '#4B5563', accent: '#0E7490', sec: '#64748B', darkCover: false },
  { name: 'Burgundy Archive', paper: '#FBF8F3', surface: '#EFE7DC', ink: '#1E1717', muted: '#6B5C5C', accent: '#7F1D1D', sec: '#927042', darkCover: true },
  { name: 'Indigo Consulting', paper: '#FFFFFF', surface: '#EEF2F6', ink: '#101828', muted: '#475467', accent: '#1E3A5F', sec: '#C28B4E', darkCover: true },
];

const FONT_SYSTEMS = [
  { display: 'Playfair Display', heading: 'Playfair Display', body: 'Lora', caption: 'Plus Jakarta Sans', quote: 'Cormorant Garamond', num: 'JetBrains Mono' },
  { display: 'Cormorant Garamond', heading: 'Cormorant Garamond', body: 'Source Serif 4', caption: 'DM Sans', quote: 'Cormorant Garamond', num: 'IBM Plex Mono' },
  { display: 'Plus Jakarta Sans', heading: 'Plus Jakarta Sans', body: 'DM Sans', caption: 'DM Sans', quote: 'Playfair Display', num: 'JetBrains Mono' },
  { display: 'Manrope', heading: 'Manrope', body: 'Public Sans', caption: 'IBM Plex Mono', quote: 'Source Serif 4', num: 'IBM Plex Mono' },
  { display: 'Fraunces', heading: 'Fraunces', body: 'Crimson Pro', caption: 'Plus Jakarta Sans', quote: 'Fraunces', num: 'JetBrains Mono' },
  { display: 'Bodoni Moda', heading: 'Bodoni Moda', body: 'Lora', caption: 'Tenor Sans', quote: 'Bodoni Moda', num: 'DM Mono' },
  { display: 'Archivo', heading: 'Archivo', body: 'IBM Plex Sans', caption: 'IBM Plex Mono', quote: 'Lora', num: 'IBM Plex Mono' },
  { display: 'Bricolage Grotesque', heading: 'Bricolage Grotesque', body: 'DM Sans', caption: 'Plus Jakarta Sans', quote: 'Fraunces', num: 'JetBrains Mono' },
  { display: 'Cinzel', heading: 'EB Garamond', body: 'EB Garamond', caption: 'DM Sans', quote: 'EB Garamond', num: 'IBM Plex Mono' },
  { display: 'Outfit', heading: 'Outfit', body: 'Plus Jakarta Sans', caption: 'DM Sans', quote: 'Source Serif 4', num: 'JetBrains Mono' },
];

const TRIM_FORMATS = [
  { label: 'Portrait Coffee Table', w: 240, h: 300 },
  { label: 'A4 Report Portrait', w: 210, h: 297 },
  { label: 'A4 Landscape Briefing', w: 297, h: 210 },
  { label: 'Square Art Monograph', w: 280, h: 280 },
  { label: 'US Letter Executive', w: 215.9, h: 279.4 },
  { label: 'Landscape Coffee Table', w: 300, h: 240 },
];

const BOOK_THEMES = [
  { title: 'Monograph on Coastal Stone', cat: 'Architecture & Interior Design' as BookTemplateCategory, kind: 'book' as const, subtitle: 'Material craft, shaded courtyards, and climatic proportion' },
  { title: 'Annual Sustainability & ESG Review', cat: 'Consulting & ESG' as BookTemplateCategory, kind: 'report' as const, subtitle: 'Verified carbon pathways, circular manufacturing, and governance' },
  { title: 'Global Sector Outlook Report', cat: 'Reports & Research' as BookTemplateCategory, kind: 'report' as const, subtitle: 'Macro demand vectors, benchmark quartiles, and 2030 forecasts' },
  { title: 'Atelier Luxury Brand Book', cat: 'Luxury & Premium Editorial' as BookTemplateCategory, kind: 'book' as const, subtitle: 'Heritage craftsmanship, archival commissions, and visual identity' },
  { title: 'Executive Financial & Impact Dossier', cat: 'Reports & Research' as BookTemplateCategory, kind: 'report' as const, subtitle: 'Audited performance indicators, capital allocation, and regional mix' },
  { title: 'Museum Sculpture & Light Catalogue', cat: 'Art, Culture & Heritage' as BookTemplateCategory, kind: 'book' as const, subtitle: 'Curatorial essays, provenance notes, and exhibition plates' },
  { title: 'Corporate Strategy & M&A Playbook', cat: 'Consulting & ESG' as BookTemplateCategory, kind: 'report' as const, subtitle: 'Value-creation levers, synergy waterfalls, and integration roadmap' },
  { title: 'Urban Infrastructure Masterplan', cat: 'Reports & Research' as BookTemplateCategory, kind: 'report' as const, subtitle: 'Mobility corridors, hydraulic resilience, and phased capital plan' },
  { title: 'Centenary Institutional Chronicle', cat: 'Corporate & Institutional' as BookTemplateCategory, kind: 'book' as const, subtitle: 'Ten decades of industrial engineering, civic patronage, and people' },
  { title: 'Interior Craft & Timber Almanac', cat: 'Architecture & Interior Design' as BookTemplateCategory, kind: 'book' as const, subtitle: 'Bespoke joinery, daylighting studies, and tactile domestic spaces' },
  { title: 'AI & Deep-Tech Research Paper', cat: 'Reports & Research' as BookTemplateCategory, kind: 'report' as const, subtitle: 'Empirical architecture benchmarks, latency envelopes, and safety' },
  { title: 'Private Equity Portfolio Compendium', cat: 'Consulting & ESG' as BookTemplateCategory, kind: 'report' as const, subtitle: 'Fund vintage attribution, EBITDA bridges, and founder spotlights' },
];

const PHOTOS_LIST = [
  EDITORIAL_PHOTOS.courtyard,
  EDITORIAL_PHOTOS.interior,
  EDITORIAL_PHOTOS.craft,
  EDITORIAL_PHOTOS.panorama,
  EDITORIAL_PHOTOS.sculpture,
];

export function generateUnlimitedPublicationBatch(
  batchIndex: number,
  count = 12,
  filterKind: 'all' | 'book' | 'report' = 'all'
): BookTemplate[] {
  const results: BookTemplate[] = [];
  const rand = seededRand(10007 + batchIndex * 7919);

  for (let i = 0; i < count; i++) {
    const themePool =
      filterKind === 'all'
        ? BOOK_THEMES
        : BOOK_THEMES.filter((t) => t.kind === filterKind);
    const theme = themePool[Math.floor(rand() * themePool.length)];
    const pal = PALETTES[Math.floor(rand() * PALETTES.length)];
    const fonts = FONT_SYSTEMS[Math.floor(rand() * FONT_SYSTEMS.length)];
    const trim =
      theme.kind === 'report'
        ? TRIM_FORMATS[[1, 2, 4][Math.floor(rand() * 3)]]
        : TRIM_FORMATS[[0, 3, 5][Math.floor(rand() * 3)]];
    const inf =
      BUILTIN_INFOGRAPHIC_TEMPLATES[Math.floor(rand() * BUILTIN_INFOGRAPHIC_TEMPLATES.length)];
    const coverPhoto = PHOTOS_LIST[Math.floor(rand() * PHOTOS_LIST.length)];
    const secondPhoto = PHOTOS_LIST[Math.floor(rand() * PHOTOS_LIST.length)];
    const editionNum = batchIndex * count + i + 33;

    const ds: DesignSystem = {
      name: `${theme.title} · ${pal.name}`,
      approved: true,
      sourceTemplateName: `Generated Edition #${editionNum}`,
      colors: {
        paper: pal.paper,
        surface: pal.surface,
        ink: pal.ink,
        mutedInk: pal.muted,
        primaryAccent: pal.accent,
        secondaryAccent: pal.sec,
        palette: [pal.paper, pal.surface, pal.ink, pal.accent, pal.sec, pal.muted],
      },
      typography: {
        primaryFont: fonts.heading,
        secondaryFont: fonts.body,
        displayFont: fonts.display,
        headingFont: fonts.heading,
        bodyFont: fonts.body,
        captionFont: fonts.caption,
        quoteFont: fonts.quote,
        numericalFont: fonts.num,
        scale: {
          displayPt: theme.kind === 'report' ? 32 : 38,
          headingPt: 20,
          subheadingPt: 12,
          bodyPt: 10,
          captionPt: 8.5,
          quotePt: 16,
          folioPt: 8.5,
        },
        minApprovedBodyPt: 8.5,
      },
      spacing: { baselineMm: 4, paragraphGapMm: 4, sectionGapMm: 10, imageCaptionGapMm: 3 },
      grid: {
        columns: theme.kind === 'report' ? 3 : 2,
        gutterMm: 6,
        margins: { top: 18, bottom: 20, inner: 22, outer: 18 },
      },
    };

    const dim: PageDimensions = {
      widthMm: trim.w,
      heightMm: trim.h,
      orientation: inferOrientation(trim.w, trim.h),
      rotation: 0,
      margins: ds.grid.margins,
      gutterMm: 12,
      bleedMm: 3,
      safeAreaMm: 6,
      columns: ds.grid.columns,
      columnGapMm: 6,
      baselineGridMm: 4,
      spreadMode: 'facing',
      presetName: trim.label,
    };

    const tplId = `gen_pub_${batchIndex}_${i}_${editionNum}`;
    const fullName = `${theme.title} — ${pal.name} #${editionNum}`;

    results.push({
      id: tplId,
      name: fullName,
      category: theme.cat,
      documentKind: theme.kind,
      description: `${trim.label} (${trim.w}×${trim.h}mm) · ${fonts.display} + ${fonts.body} · Includes ${inf.name} data spread.`,
      tags: [theme.kind, pal.name.toLowerCase(), fonts.display.toLowerCase(), 'unlimited'],
      coverImage: coverPhoto,
      dimensions: dim,
      designSystem: ds,
      buildPages: () =>
        buildPublicationPagesFromBlueprint({
          title: theme.title,
          subtitle: theme.subtitle,
          editionLine: `${theme.kind === 'report' ? 'EXECUTIVE REPORT' : 'COLLECTOR EDITION'} · SERIES ${editionNum}`,
          dim,
          ds,
          darkCover: pal.darkCover,
          coverPhoto,
          secondPhoto,
          infographicData: {
            ...structuredClone(inf.defaultData),
            fontFamily: fonts.caption,
            backgroundColor: pal.surface,
            textColor: pal.ink,
            accentColor: pal.accent,
            secondaryColor: pal.sec,
          },
          chapters: [
            {
              heading: theme.kind === 'report' ? 'Executive Summary & Key Findings' : 'Chapter I — Material Proportions',
              body: `${theme.subtitle}. Crafted with precision physical margins (${dim.margins.top}mm top, ${dim.margins.inner}mm inside binding gutter) and calibrated typographic hierarchy in ${fonts.display} and ${fonts.body}. Double-click any frame to replace copy or drag new photography directly into locked frames.`,
              quote: '“Clarity of grid and restraint of ornament allow both evidence and photography to breathe.”',
            },
            {
              heading: theme.kind === 'report' ? 'Performance Telemetry & Outlook' : 'Chapter II — Archival Plates & Ledger',
              body: 'Every frame on this spread uses independent physical millimeter coordinates compatible with press bleed, crop marks, and mixed-format foldout inserts. Add unlimited pages or regenerate data visuals directly from the Infographic Studio.',
              quote: '“Precision in print is an expression of respect for the reader.”',
            },
          ],
        }),
    });
  }

  return results;
}

const INFO_VARIANTS: Array<{ variant: InfographicVisualVariant; category: InfographicCategory; suffix: string }> = [
  { variant: 'kpi_grid', category: 'Data & Statistics', suffix: 'Executive KPI Matrix' },
  { variant: 'horizontal_bars', category: 'Data & Statistics', suffix: 'Ranked Benchmark Bars' },
  { variant: 'vertical_bars', category: 'Data & Statistics', suffix: 'Multi-Period Column Chart' },
  { variant: 'donut_ring', category: 'Data & Statistics', suffix: 'Share Allocation Donut' },
  { variant: 'line_trend', category: 'Data & Statistics', suffix: 'Multi-Year Growth Trajectory' },
  { variant: 'horizontal_timeline', category: 'Timeline & History', suffix: 'Strategic Milestone Timeline' },
  { variant: 'phased_gantt', category: 'Timeline & History', suffix: 'Execution Gantt Schedule' },
  { variant: 'process_steps', category: 'Process & Workflow', suffix: 'Five-Stage Operating Flow' },
  { variant: 'swot_matrix', category: 'Comparison & Analysis', suffix: 'Strategic SWOT Matrix' },
  { variant: 'market_quadrant', category: 'Comparison & Analysis', suffix: 'Competitive Quadrant Map' },
  { variant: 'regional_bars', category: 'Geography & Mapping', suffix: 'Regional Performance Split' },
  { variant: 'esg_pillars', category: 'Sustainability & Impact', suffix: 'ESG Impact Scorecard' },
  { variant: 'tech_stack', category: 'Technology & Innovation', suffix: 'Layered Architecture Stack' },
  { variant: 'value_chain', category: 'Business & Corporate', suffix: 'Value Chain Breakdown' },
  { variant: 'fact_sheet', category: 'Editorial Specials', suffix: 'Editorial Dossier Fact Sheet' },
];

const INFO_TOPICS = [
  { topic: 'FY26 Revenue by Division', unit: '$M', labels: ['Core Platform', 'Advisory', 'Enterprise', 'Licensing', 'Services'] },
  { topic: 'Global Decarbonization Progress', unit: '%', labels: ['Solar Grid', 'Fleet EV', 'Green Steel', 'Thermal Heat', 'Logistics'] },
  { topic: 'Capital Allocation Mix', unit: '%', labels: ['R&D Labs', 'Capex', 'M&A Reserve', 'Dividends', 'Working Cap'] },
  { topic: 'Architectural Material Footprint', unit: 'kg', labels: ['Limestone', 'Cross-Lam Timber', 'Recycled Steel', 'Lime Plaster', 'Glazing'] },
  { topic: 'Regional Market Expansion', unit: '%', labels: ['APAC', 'EMEA', 'North America', 'MENA', 'LATAM'] },
  { topic: 'Supply Chain Resilience Index', unit: 'pts', labels: ['Tier-1 Audits', 'Dual Sourcing', 'Buffer Days', 'Lead Time', 'Compliance'] },
  { topic: 'Reader & Subscriber Retention', unit: '%', labels: ['Print Collector', 'Institutional', 'Museum Shop', 'Digital Archive', 'Patron'] },
  { topic: 'Infrastructure Phase Delivery', unit: '%', labels: ['Survey & EIA', 'Foundations', 'Precast Deck', 'MEP Systems', 'Commissioning'] },
];

export function generateUnlimitedInfographicBatch(
  batchIndex: number,
  count = 12
): InfographicTemplate[] {
  const rand = seededRand(50021 + batchIndex * 6133);
  const out: InfographicTemplate[] = [];

  for (let i = 0; i < count; i++) {
    const vSpec = INFO_VARIANTS[Math.floor(rand() * INFO_VARIANTS.length)];
    const tSpec = INFO_TOPICS[Math.floor(rand() * INFO_TOPICS.length)];
    const pal = PALETTES[Math.floor(rand() * PALETTES.length)];
    const fonts = FONT_SYSTEMS[Math.floor(rand() * FONT_SYSTEMS.length)];
    const num = batchIndex * count + i + 53;

    const items = tSpec.labels.map((lbl, idx) => ({
      id: `gitem_${num}_${idx}`,
      label: lbl,
      value: Math.round(22 + rand() * 76),
      secondaryValue: Math.round(15 + rand() * 60),
      unit: tSpec.unit,
      yearOrStep: `202${2 + idx}`,
      description: `${lbl} benchmark metric`,
    }));

    const data: InfographicData = {
      templateId: `gen_inf_${batchIndex}_${i}_${num}`,
      variant: vSpec.variant,
      title: `${tSpec.topic}`,
      subtitle: `${vSpec.suffix} · ${pal.name}`,
      categoryLabel: vSpec.category,
      sourceNote: `BOOKSTUDIO Vector Generator · Series #${num}`,
      fontFamily: fonts.caption,
      backgroundColor: pal.surface,
      textColor: pal.ink,
      accentColor: pal.accent,
      secondaryColor: pal.sec,
      items,
      showLegend: true,
      showValues: true,
    };

    out.push({
      id: data.templateId,
      name: `${tSpec.topic} — ${vSpec.suffix}`,
      category: vSpec.category,
      variant: vSpec.variant,
      description: `Live editable vector ${vSpec.suffix.toLowerCase()} styled in ${pal.name} (${fonts.caption}).`,
      tags: ['unlimited', vSpec.category.toLowerCase(), pal.name.toLowerCase()],
      defaultWidthMm: 176,
      defaultHeightMm: 112,
      defaultData: data,
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// 3. SHARED BLUEPRINT -> EDITABLE PAGES & PROJECT BUILDER (USED BY AI + PROCEDURAL)
// ---------------------------------------------------------------------------

export interface PublicationBlueprintInput {
  title: string;
  subtitle: string;
  editionLine: string;
  dim: PageDimensions;
  ds: DesignSystem;
  darkCover: boolean;
  coverPhoto: string;
  secondPhoto: string;
  infographicData: InfographicData;
  chapters: Array<{ heading: string; body: string; quote?: string }>;
}

export function buildPublicationPagesFromBlueprint(bp: PublicationBlueprintInput): BookPage[] {
  const { dim, ds } = bp;
  const W = dim.widthMm;
  const H = dim.heightMm;
  const m = dim.margins;
  const contentW = Math.max(50, W - m.inner - m.outer);
  const ts = Date.now();
  const coverTextColor = bp.darkCover ? ds.colors.paper : ds.colors.ink;
  const coverBg = bp.darkCover ? ds.colors.ink : ds.colors.paper;

  const pages: BookPage[] = [
    // Page 1: Cover
    {
      id: `pg_cov_${ts}`,
      orderIndex: 0,
      label: 'Front Cover',
      role: 'front_cover',
      backgroundColor: coverBg,
      elements: [
        {
          id: `el_cov_img_${ts}`,
          name: 'Cover Hero Plate',
          type: 'image',
          xMm: 0,
          yMm: 0,
          widthMm: W,
          heightMm: Math.round(H * 0.58),
          rotation: 0,
          opacity: 1,
          locked: false,
          hidden: false,
          zIndex: 1,
          image: {
            src: bp.coverPhoto,
            alt: bp.title,
            fit: 'cover',
            zoom: 1,
            focalX: 50,
            focalY: 50,
            naturalWidth: 1408,
            naturalHeight: 1056,
            originalCrop: { zoom: 1, focalX: 50, focalY: 50, fit: 'cover' },
          },
        },
        {
          id: `el_cov_ed_${ts}`,
          name: 'Edition Kicker',
          type: 'text',
          xMm: m.outer,
          yMm: Math.round(H * 0.62),
          widthMm: contentW,
          heightMm: 9,
          rotation: 0,
          opacity: 0.9,
          locked: false,
          hidden: false,
          zIndex: 2,
          textRole: 'caption',
          text: bp.editionLine,
          textStyle: {
            fontFamily: ds.typography.captionFont,
            fontSizePt: 8.5,
            fontWeight: 600,
            color: ds.colors.primaryAccent,
            lineHeight: 1.2,
            letterSpacingEm: 0.16,
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
          id: `el_cov_t_${ts}`,
          name: 'Cover Title',
          type: 'text',
          xMm: m.outer,
          yMm: Math.round(H * 0.67),
          widthMm: contentW,
          heightMm: 38,
          rotation: 0,
          opacity: 1,
          locked: false,
          hidden: false,
          zIndex: 3,
          textRole: 'display',
          text: bp.title,
          textStyle: {
            fontFamily: ds.typography.displayFont,
            fontSizePt: ds.typography.scale.displayPt,
            fontWeight: 500,
            color: coverTextColor,
            lineHeight: 1.08,
            letterSpacingEm: -0.01,
            textAlign: 'left',
            verticalAlign: 'top',
            paragraphSpacingMm: 4,
            columns: 1,
            columnGapMm: 5,
            insetMm: 0,
          },
        },
        {
          id: `el_cov_sub_${ts}`,
          name: 'Cover Subtitle',
          type: 'text',
          xMm: m.outer,
          yMm: Math.round(H * 0.85),
          widthMm: contentW,
          heightMm: 22,
          rotation: 0,
          opacity: 0.78,
          locked: false,
          hidden: false,
          zIndex: 4,
          textRole: 'caption',
          text: bp.subtitle,
          textStyle: {
            fontFamily: ds.typography.bodyFont,
            fontSizePt: 10,
            fontWeight: 400,
            color: coverTextColor,
            lineHeight: 1.45,
            letterSpacingEm: 0,
            textAlign: 'left',
            verticalAlign: 'top',
            paragraphSpacingMm: 2,
            columns: 1,
            columnGapMm: 5,
            insetMm: 0,
          },
        },
      ],
    },
    // Page 2: Contents & Abstract
    {
      id: `pg_toc_${ts}`,
      orderIndex: 1,
      label: 'Contents & Overview',
      role: 'table_of_contents',
      backgroundColor: ds.colors.surface,
      elements: [
        {
          id: `el_toc_h_${ts}`,
          name: 'Contents Heading',
          type: 'text',
          xMm: m.outer,
          yMm: m.top + 8,
          widthMm: contentW,
          heightMm: 20,
          rotation: 0,
          opacity: 1,
          locked: false,
          hidden: false,
          zIndex: 2,
          textRole: 'heading',
          text: 'Contents & Structure',
          textStyle: {
            fontFamily: ds.typography.headingFont,
            fontSizePt: 22,
            fontWeight: 500,
            color: ds.colors.ink,
            lineHeight: 1.15,
            letterSpacingEm: 0,
            textAlign: 'left',
            verticalAlign: 'top',
            paragraphSpacingMm: 4,
            columns: 1,
            columnGapMm: 5,
            insetMm: 0,
          },
        },
        {
          id: `el_toc_r_${ts}`,
          name: 'Accent Divider',
          type: 'line',
          xMm: m.outer,
          yMm: m.top + 30,
          widthMm: contentW,
          heightMm: 2,
          rotation: 0,
          opacity: 1,
          locked: false,
          hidden: false,
          zIndex: 2,
          shape: {
            shapeKind: 'rule',
            fill: 'transparent',
            stroke: ds.colors.primaryAccent,
            strokeWidthMm: 0.4,
            cornerRadiusMm: 0,
          },
        },
        {
          id: `el_toc_list_${ts}`,
          name: 'Table of Contents',
          type: 'text',
          xMm: m.outer,
          yMm: m.top + 40,
          widthMm: contentW,
          heightMm: Math.max(80, H - m.top - m.bottom - 52),
          rotation: 0,
          opacity: 1,
          locked: false,
          hidden: false,
          zIndex: 3,
          textRole: 'body',
          text: bp.chapters
            .map((ch, idx) => `0${idx + 1}   ${ch.heading}\n`)
            .join('\n') + `\n0${bp.chapters.length + 1}   Data Visualization & Vector Dossier`,
          textStyle: {
            fontFamily: ds.typography.bodyFont,
            fontSizePt: 11,
            fontWeight: 400,
            color: ds.colors.ink,
            lineHeight: 1.75,
            letterSpacingEm: 0.01,
            textAlign: 'left',
            verticalAlign: 'top',
            paragraphSpacingMm: 5,
            columns: 1,
            columnGapMm: 5,
            insetMm: 0,
          },
        },
      ],
    },
  ];

  // Dynamic chapter spreads
  bp.chapters.forEach((ch, idx) => {
    const isEven = idx % 2 === 0;
    pages.push({
      id: `pg_ch_${idx}_${ts}`,
      orderIndex: pages.length,
      label: ch.heading.slice(0, 28),
      role: idx === 0 ? 'chapter_opener' : 'editorial_text',
      backgroundColor: ds.colors.paper,
      elements: [
        {
          id: `el_ch_k_${idx}_${ts}`,
          name: 'Section Index',
          type: 'text',
          xMm: m.inner,
          yMm: m.top + 4,
          widthMm: contentW,
          heightMm: 8,
          rotation: 0,
          opacity: 1,
          locked: false,
          hidden: false,
          zIndex: 2,
          textRole: 'caption',
          text: `SECTION 0${idx + 1} · ${bp.title.toUpperCase()}`,
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
          id: `el_ch_h_${idx}_${ts}`,
          name: 'Section Heading',
          type: 'text',
          xMm: m.inner,
          yMm: m.top + 15,
          widthMm: contentW,
          heightMm: 22,
          rotation: 0,
          opacity: 1,
          locked: false,
          hidden: false,
          zIndex: 2,
          textRole: 'heading',
          text: ch.heading,
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
            columnGapMm: 5,
            insetMm: 0,
          },
        },
        {
          id: `el_ch_img_${idx}_${ts}`,
          name: 'Editorial Plate',
          type: 'image',
          xMm: m.inner,
          yMm: m.top + 42,
          widthMm: isEven ? contentW : Math.round(contentW * 0.48),
          heightMm: isEven ? Math.round((H - m.top - m.bottom) * 0.42) : Math.round((H - m.top - m.bottom) * 0.65),
          rotation: 0,
          opacity: 1,
          locked: false,
          hidden: false,
          zIndex: 1,
          image: {
            src: idx % 2 === 0 ? bp.secondPhoto : bp.coverPhoto,
            alt: ch.heading,
            fit: 'cover',
            zoom: 1,
            focalX: 50,
            focalY: 50,
            naturalWidth: 1408,
            naturalHeight: 1056,
            originalCrop: { zoom: 1, focalX: 50, focalY: 50, fit: 'cover' },
          },
        },
        {
          id: `el_ch_b_${idx}_${ts}`,
          name: 'Section Editorial Copy',
          type: 'text',
          xMm: isEven ? m.inner : m.inner + Math.round(contentW * 0.52),
          yMm: isEven ? m.top + 48 + Math.round((H - m.top - m.bottom) * 0.42) : m.top + 42,
          widthMm: isEven ? contentW : Math.round(contentW * 0.48),
          heightMm: isEven ? Math.max(50, Math.round((H - m.top - m.bottom) * 0.36)) : Math.round((H - m.top - m.bottom) * 0.65),
          rotation: 0,
          opacity: 1,
          locked: false,
          hidden: false,
          zIndex: 3,
          textRole: 'body',
          text: ch.body + (ch.quote ? `\n\n${ch.quote}` : ''),
          textStyle: {
            fontFamily: ds.typography.bodyFont,
            fontSizePt: ds.typography.scale.bodyPt,
            fontWeight: 400,
            color: ds.colors.ink,
            lineHeight: 1.55,
            letterSpacingEm: 0,
            textAlign: 'left',
            verticalAlign: 'top',
            paragraphSpacingMm: 4,
            columns: isEven ? Math.min(2, dim.columns) : 1,
            columnGapMm: dim.columnGapMm,
            insetMm: 0,
          },
        },
        {
          id: `el_ch_f_${idx}_${ts}`,
          name: 'Page Number',
          type: 'pageNumber',
          xMm: W - m.outer - 16,
          yMm: H - 14,
          widthMm: 16,
          heightMm: 6,
          rotation: 0,
          opacity: 0.7,
          locked: false,
          hidden: false,
          zIndex: 4,
          textRole: 'folio',
          text: '{{page}}',
          textStyle: {
            fontFamily: ds.typography.numericalFont,
            fontSizePt: 8.5,
            fontWeight: 500,
            color: ds.colors.mutedInk,
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
    });
  });

  // Dedicated Live Infographic Spread
  pages.push({
    id: `pg_inf_${ts}`,
    orderIndex: pages.length,
    label: 'Data & Infographic',
    role: 'infographic',
    backgroundColor: ds.colors.paper,
    elements: [
      {
        id: `el_inf_k_${ts}`,
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
        text: 'LIVE VECTOR DATA DOSSIER · CLICK TO EDIT DATA',
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
        id: `el_inf_v_${ts}`,
        name: bp.infographicData.title,
        type: 'infographic',
        xMm: m.outer,
        yMm: m.top + 18,
        widthMm: contentW,
        heightMm: Math.min(135, H - m.top - m.bottom - 42),
        rotation: 0,
        opacity: 1,
        locked: false,
        hidden: false,
        zIndex: 2,
        infographic: bp.infographicData,
      },
      {
        id: `el_inf_n_${ts}`,
        name: 'Source Footnote',
        type: 'text',
        xMm: m.outer,
        yMm: H - m.bottom - 14,
        widthMm: contentW,
        heightMm: 10,
        rotation: 0,
        opacity: 0.8,
        locked: false,
        hidden: false,
        zIndex: 3,
        textRole: 'caption',
        text: bp.infographicData.sourceNote || 'Prepared in BOOKSTUDIO Publishing Engine.',
        textStyle: {
          fontFamily: ds.typography.captionFont,
          fontSizePt: 8.5,
          fontWeight: 400,
          color: ds.colors.mutedInk,
          lineHeight: 1.35,
          letterSpacingEm: 0.02,
          textAlign: 'left',
          verticalAlign: 'bottom',
          paragraphSpacingMm: 0,
          columns: 1,
          columnGapMm: 4,
          insetMm: 0,
        },
      },
    ],
  });

  return pages;
}

export function createProjectFromBookTemplateObject(tpl: BookTemplate): BookProject {
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
  return {
    id: `proj_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name: tpl.name,
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
        title: tpl.documentKind === 'report' ? 'Section I — Executive Summary' : 'Chapter I — Opening Folio',
        masterPageId: masters[0]?.id,
        orderIndex: 0,
      },
      {
        id: 'ch_2',
        number: 2,
        title: tpl.documentKind === 'report' ? 'Section II — Data & Analysis' : 'Chapter II — Plates & Data',
        masterPageId: masters[4]?.id,
        orderIndex: 1,
      },
    ],
    contentSections: [
      {
        id: `sec_${Date.now()}`,
        chapterId: 'ch_1',
        title: 'Primary Editorial Brief',
        kind: 'body',
        body: tpl.description,
        orderIndex: 0,
      },
    ],
    imageAssets: structuredClone(CURATED_IMAGE_ASSETS),
    pages,
    templateReport: null,
    printSettings: {
      bindingType: tpl.documentKind === 'report' ? 'perfect' : 'smyth_hardcover',
      paperStockName: '170 gsm Matte Museum Art Paper',
      paperCaliperMm: 0.145,
      coverBoardCaliperMm: tpl.documentKind === 'report' ? 0 : 2.5,
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
  };
}
