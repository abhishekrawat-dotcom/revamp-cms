export type MeasurementUnit = 'mm' | 'in' | 'cm' | 'pt' | 'px';

export type PageOrientation = 'portrait' | 'landscape' | 'square' | 'custom';
export type PageRotation = 0 | 90 | 180 | 270;
export type SpreadMode = 'single' | 'facing' | 'landscape_spread' | 'full_bleed' | 'custom_spread';
export type BindingType = 'perfect' | 'smyth_hardcover' | 'layflat' | 'saddle_stitch' | 'wire_o';
export type ResizeStrategy = 'scale' | 'reflow' | 'preserve';

export type PageRole =
  | 'front_cover'
  | 'inside_front_cover'
  | 'title_page'
  | 'copyright'
  | 'foreword'
  | 'introduction'
  | 'table_of_contents'
  | 'chapter_opener'
  | 'editorial_text'
  | 'image_led'
  | 'full_bleed_image'
  | 'image_gallery'
  | 'two_column'
  | 'three_column'
  | 'quote_page'
  | 'timeline'
  | 'infographic'
  | 'interview'
  | 'case_study'
  | 'acknowledgements'
  | 'closing_page'
  | 'back_cover'
  | 'blank'
  | 'section_divider'
  | 'custom';

export interface PageMargins {
  top: number;    // mm
  bottom: number; // mm
  inner: number;  // mm (binding side)
  outer: number;  // mm (fore-edge)
}

export interface PageDimensions {
  widthMm: number;
  heightMm: number;
  orientation: PageOrientation;
  rotation: PageRotation;
  margins: PageMargins;
  gutterMm: number;
  bleedMm: number;
  safeAreaMm: number;
  columns: number;
  columnGapMm: number;
  baselineGridMm: number;
  spreadMode: SpreadMode;
  presetName?: string;
}

export interface DimensionPreset {
  id: string;
  name: string;
  widthMm: number;
  heightMm: number;
  orientation: PageOrientation;
  category: 'standard' | 'coffee_table' | 'custom';
}

export type ElementType =
  | 'text'
  | 'image'
  | 'shape'
  | 'line'
  | 'infographic'
  | 'pageNumber'
  | 'header'
  | 'footer'
  | 'decorative'
  | 'logo';

export type TextRole =
  | 'display'
  | 'heading'
  | 'subheading'
  | 'body'
  | 'caption'
  | 'quote'
  | 'folio'
  | 'running_head';

export interface TextStyle {
  fontFamily: string;
  fontSizePt: number;
  fontWeight: number;
  fontStyle?: 'normal' | 'italic';
  color: string;
  lineHeight: number;
  letterSpacingEm: number;
  textAlign: 'left' | 'center' | 'right' | 'justify';
  verticalAlign: 'top' | 'middle' | 'bottom';
  paragraphSpacingMm: number;
  columns: number;
  columnGapMm: number;
  insetMm: number;
  textTransform?: 'none' | 'uppercase' | 'lowercase' | 'capitalize';
  dropCap?: boolean;
}

export interface ImageProps {
  src: string;
  assetId?: string;
  alt: string;
  fit: 'cover' | 'contain';
  zoom: number;        // 1.0 = 100%
  focalX: number;      // 0..100 (%)
  focalY: number;      // 0..100 (%)
  naturalWidth?: number;
  naturalHeight?: number;
  brightness?: number; // 100 default
  contrast?: number;   // 100 default
  grayscale?: number;  // 0..100
  sepia?: number;      // 0..100
  borderRadiusMm?: number;
  captionText?: string;
  originalCrop?: {
    zoom: number;
    focalX: number;
    focalY: number;
    fit: 'cover' | 'contain';
  };
}

export interface ShapeProps {
  shapeKind: 'rectangle' | 'ellipse' | 'triangle' | 'frame' | 'rule' | 'ornament';
  fill: string;
  stroke: string;
  strokeWidthMm: number;
  cornerRadiusMm: number;
  dashStyle?: 'solid' | 'dashed' | 'dotted';
}

export interface InfographicItem {
  id: string;
  label: string;
  value: number;
  secondaryValue?: number;
  unit?: string;
  category?: string;
  yearOrStep?: string;
  description?: string;
  color?: string;
}

export type InfographicVisualVariant =
  | 'kpi_grid'
  | 'horizontal_bars'
  | 'vertical_bars'
  | 'donut_ring'
  | 'radial_gauges'
  | 'line_trend'
  | 'stat_highlights'
  | 'survey_bars'
  | 'horizontal_timeline'
  | 'vertical_timeline'
  | 'milestone_zigzag'
  | 'journey_arc'
  | 'roadmap_tracks'
  | 'phased_gantt'
  | 'process_steps'
  | 'circular_workflow'
  | 'linear_pipeline'
  | 'decision_tree'
  | 'lifecycle_ring'
  | 'before_after'
  | 'two_col_comparison'
  | 'swot_matrix'
  | 'pros_cons'
  | 'market_quadrant'
  | 'feature_matrix'
  | 'india_map_data'
  | 'world_map_data'
  | 'regional_bars'
  | 'location_pins'
  | 'city_grid'
  | 'org_hierarchy'
  | 'concentric_ecosystem'
  | 'stakeholder_map'
  | 'business_canvas'
  | 'strategy_pyramid'
  | 'value_chain'
  | 'tech_stack'
  | 'ai_workflow'
  | 'network_mesh'
  | 'innovation_funnel'
  | 'esg_pillars'
  | 'carbon_breakdown'
  | 'impact_scorecard'
  | 'fact_sheet'
  | 'profile_data';

export interface InfographicData {
  templateId: string;
  variant: InfographicVisualVariant;
  title: string;
  subtitle: string;
  categoryLabel: string;
  sourceNote: string;
  fontFamily: string;
  backgroundColor: string;
  textColor: string;
  accentColor: string;
  secondaryColor: string;
  items: InfographicItem[];
  showLegend: boolean;
  showValues: boolean;
}

export interface BookElement {
  id: string;
  name: string;
  type: ElementType;
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
  rotation: number;
  opacity: number;
  locked: boolean;
  hidden: boolean;
  groupId?: string;
  masterElementId?: string;
  overriddenFromMaster?: boolean;
  zIndex: number;
  contentSectionId?: string;
  textRole?: TextRole;
  text?: string;
  textStyle?: TextStyle;
  image?: ImageProps;
  shape?: ShapeProps;
  infographic?: InfographicData;
}

export interface BookPage {
  id: string;
  orderIndex: number;
  label: string;
  role: PageRole;
  chapterId?: string;
  masterPageId?: string;
  detachedFromMaster?: boolean;
  backgroundColor: string;
  dimensionsOverride?: PageDimensions | null;
  elements: BookElement[];
}

export interface MasterPage {
  id: string;
  name: string;
  role: PageRole;
  description: string;
  backgroundColor: string;
  elements: BookElement[];
  isBuiltIn?: boolean;
}

export interface TypographySystem {
  primaryFont: string;
  secondaryFont: string;
  displayFont: string;
  headingFont: string;
  bodyFont: string;
  captionFont: string;
  quoteFont: string;
  numericalFont: string;
  scale: {
    displayPt: number;
    headingPt: number;
    subheadingPt: number;
    bodyPt: number;
    captionPt: number;
    quotePt: number;
    folioPt: number;
  };
  minApprovedBodyPt: number;
}

export interface DesignSystem {
  name: string;
  approved: boolean;
  sourceTemplateName?: string;
  colors: {
    paper: string;
    surface: string;
    ink: string;
    mutedInk: string;
    primaryAccent: string;
    secondaryAccent: string;
    palette: string[];
  };
  typography: TypographySystem;
  spacing: {
    baselineMm: number;
    paragraphGapMm: number;
    sectionGapMm: number;
    imageCaptionGapMm: number;
  };
  grid: {
    columns: number;
    gutterMm: number;
    margins: PageMargins;
  };
}

export interface BookChapter {
  id: string;
  number: number;
  title: string;
  subtitle?: string;
  masterPageId?: string;
  orderIndex: number;
}

export interface ContentSection {
  id: string;
  chapterId?: string;
  title: string;
  kind: 'heading' | 'subheading' | 'body' | 'caption' | 'quote' | 'interview';
  body: string;
  assignedPageId?: string;
  assignedElementId?: string;
  orderIndex: number;
}

export interface ImageAsset {
  id: string;
  name: string;
  url: string;
  widthPx: number;
  heightPx: number;
  sizeBytes?: number;
  mimeType: string;
  category: string;
  tags: string[];
  uploadedAt: string;
  source?: 'uploaded' | 'curated';
  /** the full-size copy exports draw (uploaded photos; the editor shows `url`, a copy at most 2400 px) */
  printUrl?: string;
  /** a small copy for the photo library */
  thumbUrl?: string;
}

export interface TemplateAnalysisReport {
  id: string;
  analyzedAt: string;
  sourceFiles: string[];
  sourceFormat: 'image' | 'pdf' | 'idml' | 'mixed';
  summary: string;
  pageSize: {
    widthMm: number;
    heightMm: number;
    orientation: PageOrientation;
    recommendedPreset: string;
  };
  colourPalette: {
    paper: string;
    surface: string;
    ink: string;
    mutedInk: string;
    primaryAccent: string;
    secondaryAccent: string;
    swatches: string[];
  };
  typography: {
    displayFont: string;
    headingFont: string;
    bodyFont: string;
    captionFont: string;
    quoteFont: string;
    numericalFont: string;
    displaySizePt: number;
    headingSizePt: number;
    bodySizePt: number;
    captionSizePt: number;
    notes: string;
  };
  gridSystem: {
    columns: number;
    columnGapMm: number;
    baselineMm: number;
    margins: PageMargins;
  };
  pageLayoutCategories: string[];
  imagePlacementPatterns: string[];
  textHierarchy: string[];
  decorativePatterns: string[];
  chapterOpeningStyle: string;
  masterPageRecommendations: Array<{
    name: string;
    role: PageRole;
    description: string;
  }>;
  approved: boolean;
}

export interface PrintSettings {
  bindingType: BindingType;
  paperStockName: string;
  paperCaliperMm: number;    // thickness per sheet (2 pages) in mm, printer-supplied
  coverBoardCaliperMm: number; // per board for hardcover
  printerToleranceMm: number;  // adhesive/glue/fold allowance supplied by printer
  includeBleed: boolean;
  includeCropMarks: boolean;
  includeRegistrationMarks: boolean;
  colorSpace: 'RGB' | 'CMYK_SIMULATED';
  targetDpi: number;
  exportSpreads: boolean;
}

export interface BookProject {
  id: string;
  ownerId?: string;
  name: string;
  subtitle: string;
  category: string;
  status: 'draft' | 'in_review' | 'print_ready' | 'archived';
  unit: MeasurementUnit;
  coverThumbnail: string;
  dimensions: PageDimensions;
  designSystem: DesignSystem;
  masterPages: MasterPage[];
  chapters: BookChapter[];
  contentSections: ContentSection[];
  imageAssets: ImageAsset[];
  pages: BookPage[];
  templateReport?: TemplateAnalysisReport | null;
  printSettings: PrintSettings;
  customDimensionPresets: DimensionPreset[];
  createdAt: string;
  updatedAt: string;
}

/** One book as the dashboard lists it (GET /api/books/list): the studio loads the whole book when it is opened. */
export interface BookSummary {
  id: string;
  name: string;
  status: BookProject['status'];
  subtitle: string;
  category: string;
  unit: MeasurementUnit;
  coverThumbnail: string;
  dimensions: { widthMm: number; heightMm: number };
  pageCount: number;
  wordCount?: number;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}

export interface ProjectVersion {
  id: string;
  projectId: string;
  label: string;
  summary: string;
  pageCount: number;
  totalWords: number;
  createdAt: string;
  createdBy?: string;
  /** the version's contents: sent when it is kept; a list of versions comes without it (storageService.loadProjectVersion) */
  snapshot?: {
    dimensions: PageDimensions;
    designSystem: DesignSystem;
    pages: BookPage[];
    masterPages: MasterPage[];
    chapters: BookChapter[];
    contentSections: ContentSection[];
  };
}

export interface GoogleFontItem {
  family: string;
  category: 'serif' | 'sans-serif' | 'display' | 'monospace' | 'handwriting';
  weights: number[];
  hasItalic: boolean;
  isVariable: boolean;
  scripts: string[];
  styleTag: 'editorial' | 'luxury' | 'modern' | 'architectural' | 'heritage' | 'technical' | 'calligraphic';
  license: string;
}

export interface TypographyPreset {
  id: string;
  name: string;
  style: string;
  typography: TypographySystem;
}

export interface UserFontCollection {
  id: string;
  name: string;
  fonts: string[];
  presets: TypographyPreset[];
  updatedAt: string;
}

export type BookTemplateCategory =
  | 'Premium Editorial'
  | 'Luxury & Premium Editorial'
  | 'Architecture & Interior Design'
  | 'Corporate & Institutional'
  | 'Art, Culture & Heritage'
  | 'Reports & Research'
  | 'Consulting & ESG';

export type InDesignTool =
  | 'select'
  | 'direct_select'
  | 'type'
  | 'frame_image'
  | 'rect'
  | 'ellipse'
  | 'line'
  | 'infographic'
  | 'hand'
  | 'zoom';

export type AlignAction =
  | 'left'
  | 'center_h'
  | 'right'
  | 'top'
  | 'center_v'
  | 'bottom'
  | 'distribute_h'
  | 'distribute_v'
  | 'match_width'
  | 'match_height';

export interface BookTemplate {
  id: string;
  name: string;
  category: BookTemplateCategory;
  documentKind?: 'book' | 'report';
  description: string;
  tags: string[];
  coverImage: string;
  dimensions: PageDimensions;
  designSystem: DesignSystem;
  buildPages: () => BookPage[];
}

export type InfographicCategory =
  | 'Data & Statistics'
  | 'Timeline & History'
  | 'Process & Workflow'
  | 'Comparison & Analysis'
  | 'Geography & Mapping'
  | 'Business & Corporate'
  | 'Technology & Innovation'
  | 'Sustainability & Impact'
  | 'Editorial Specials';

export interface InfographicTemplate {
  id: string;
  name: string;
  category: InfographicCategory;
  variant: InfographicVisualVariant;
  description: string;
  tags: string[];
  defaultWidthMm: number;
  defaultHeightMm: number;
  defaultData: InfographicData;
}

export interface CustomSavedTemplate {
  id: string;
  templateKind: 'page' | 'spread' | 'infographic' | 'component' | 'book' | 'mixed_format';
  collectionName: string;
  category: string;
  title: string;
  description: string;
  tags: string[];
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface PreflightIssue {
  id: string;
  severity: 'error' | 'warning' | 'info';
  category:
    | 'missing_image'
    | 'missing_font'
    | 'text_overflow'
    | 'low_resolution'
    | 'safe_area'
    | 'bleed'
    | 'page_sequence'
    | 'empty_frame'
    | 'mixed_format'
    | 'font_embedding'
    | 'binding'
    | 'design_consistency';
  pageId?: string;
  pageNumber?: number;
  elementId?: string;
  title: string;
  detail: string;
  suggestion: string;
}

export interface AiEditorialSuggestion {
  id: string;
  category:
    | 'layout'
    | 'image_placement'
    | 'overflow'
    | 'consistency'
    | 'typography'
    | 'chapter_opener'
    | 'infographic'
    | 'copy_fit';
  title: string;
  rationale: string;
  targetPageId?: string;
  targetElementId?: string;
  actionType:
    | 'apply_layout_preset'
    | 'adjust_typography'
    | 'resolve_overflow'
    | 'insert_infographic'
    | 'update_text'
    | 'advisory_only';
  actionPayload?: Record<string, unknown>;
}
