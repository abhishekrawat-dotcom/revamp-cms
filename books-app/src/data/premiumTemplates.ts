import type {
  BookChapter,
  BookElement,
  BookPage,
  BookProject,
  BookTemplate,
  BookTemplateCategory,
  DesignSystem,
  ImageAsset,
  InfographicData,
  InfographicVisualVariant,
  MasterPage,
  PageDimensions,
  PageRole,
  PrintSettings,
  TextRole,
  TextStyle,
} from '../types/bookstudio';

/* Premium Editorial templates (Books Phase 3, 27 Nov 2026): five complete books, each its own layout system — its own
   page size, margins, grid and baseline, palette, a deliberate Google Fonts pairing, running heads and folios — and
   never a re-skin of bookTemplates.ts' one seven-page layout.
     - Each has 14–18 pages and 3–5 master pages built from the same frames as its pages, so a page added from a layout
       fits the book (functions/lib/book-rules.js: a new page copies the book's own frames). A page made from a master
       is linked to it frame by frame (masterElementId); a frame whose words or look differ from the master's is marked
       overridden, so a change to the master never wipes a page's words.
     - Every word is template text ("Winner name", "Organisation name"); every chart carries round sample figures and
       says so (PREMIUM_SAMPLE_NOTE). Portraits are empty frames named "Portrait — drop a photo here" on a quiet tint:
       a sample photo is never shown as a person the book is about.
     - Photos are the sample photos in books/samples/, each frame given the photo's true pixel size.
   applyPremiumTemplate() finishes a book made from one of these (its master pages, chapters, photo library and print
   settings); sampleProject.ts and unlimitedTemplateEngine.ts call it when a book is created from a template. */

export const PREMIUM_CATEGORY: BookTemplateCategory = 'Premium Editorial';
export const PREMIUM_SAMPLE_NOTE = 'Sample figures — replace with your own data before printing.';
export const PORTRAIT_FRAME_NAME = 'Portrait — drop a photo here';
export const DRAWING_FRAME_NAME = 'Drawing — drop a plan or section here';

/* ---------- sample photos (books/samples/: the owner's own export, unchanged) ---------- */

export type PremiumPhotoKey =
  | 'courtyard'
  | 'interior'
  | 'craft'
  | 'panorama'
  | 'sculpture'
  | 'sanctuary'
  | 'stair'
  | 'doorway'
  | 'alpine'
  | 'pavilion';

export interface PremiumPhoto {
  assetId: string;
  url: string;
  widthPx: number;
  heightPx: number;
  sizeBytes: number;
  name: string;
  category: string;
  tags: string[];
}

/** every photo the premium templates may use, with its true pixel size (read with sharp) */
export const PREMIUM_PHOTOS: Record<PremiumPhotoKey, PremiumPhoto> = {
  courtyard: {
    assetId: 'asset_courtyard',
    url: '/books/samples/editorial_arch_courtyard_1795191081985.jpg',
    widthPx: 1200,
    heightPx: 896,
    sizeBytes: 847557,
    name: 'Board-Formed Concrete Courtyard & Pool.jpg',
    category: 'Architecture',
    tags: ['concrete', 'courtyard', 'pool'],
  },
  interior: {
    assetId: 'asset_interior',
    url: '/books/samples/editorial_interior_atelier_1795191082338.jpg',
    widthPx: 896,
    heightPx: 1200,
    sizeBytes: 821270,
    name: 'Travertine Salon & Arched Linen Windows.jpg',
    category: 'Interiors',
    tags: ['salon', 'interior', 'daylight'],
  },
  craft: {
    assetId: 'asset_craft',
    url: '/books/samples/editorial_heritage_craft_1795191081929.jpg',
    widthPx: 1200,
    heightPx: 896,
    sizeBytes: 934175,
    name: 'Master Ceramicist Atelier Vessels.jpg',
    category: 'Craft & Heritage',
    tags: ['workshop', 'ceramics', 'craft'],
  },
  panorama: {
    assetId: 'asset_panorama',
    url: '/books/samples/editorial_coastal_monolith_1795191083844.jpg',
    widthPx: 1376,
    heightPx: 768,
    sizeBytes: 601499,
    name: 'Volcanic Basalt Sea Cliffs Spread.jpg',
    category: 'Landscape',
    tags: ['coast', 'cliffs', 'book'],
  },
  sculpture: {
    assetId: 'asset_sculpture',
    url: '/books/samples/editorial_gallery_sculpture_1795191081975.jpg',
    widthPx: 896,
    heightPx: 1200,
    sizeBytes: 684454,
    name: 'Alabaster Monolith Museum Gallery.jpg',
    category: 'Art & Museum',
    tags: ['sculpture', 'gallery', 'plinth'],
  },
  sanctuary: {
    assetId: 'asset_premium_sanctuary',
    url: '/books/samples/book_cover_sanctuary_1795189626879.jpg',
    widthPx: 896,
    heightPx: 1200,
    sizeBytes: 971980,
    name: 'Forest Pavilion in Morning Mist.jpg',
    category: 'Architecture',
    tags: ['pavilion', 'forest', 'mist', 'timber'],
  },
  stair: {
    assetId: 'asset_premium_stair',
    url: '/books/samples/detail_concrete_stair_1795189625809.jpg',
    widthPx: 1200,
    heightPx: 896,
    sizeBytes: 697527,
    name: 'Spiral Concrete Stair & Oculus.jpg',
    category: 'Architecture',
    tags: ['stair', 'concrete', 'oculus', 'detail'],
  },
  doorway: {
    assetId: 'asset_premium_doorway',
    url: '/books/samples/detail_courtyard_stone_1795189626521.jpg',
    widthPx: 896,
    heightPx: 1200,
    sizeBytes: 961981,
    name: 'Garden Doorway & Stone Path.jpg',
    category: 'Landscape',
    tags: ['garden', 'doorway', 'stone', 'moss'],
  },
  alpine: {
    assetId: 'asset_premium_alpine',
    url: '/books/samples/spread_alpine_monolith_1795189627150.jpg',
    widthPx: 1376,
    heightPx: 768,
    sizeBytes: 830299,
    name: 'Stone Hut Above the Clouds.jpg',
    category: 'Landscape',
    tags: ['mountain', 'hut', 'clouds', 'panorama'],
  },
  pavilion: {
    assetId: 'asset_premium_pavilion',
    url: '/books/samples/spread_timber_pavilion_1795189625503.jpg',
    widthPx: 1200,
    heightPx: 896,
    sizeBytes: 851717,
    name: 'Travertine & Timber Corridor.jpg',
    category: 'Interiors',
    tags: ['corridor', 'travertine', 'timber', 'light'],
  },
};

function photoAsset(p: PremiumPhoto): ImageAsset {
  return {
    id: p.assetId,
    name: p.name,
    url: p.url,
    widthPx: p.widthPx,
    heightPx: p.heightPx,
    sizeBytes: p.sizeBytes,
    mimeType: 'image/jpeg',
    category: p.category,
    tags: [...p.tags],
    uploadedAt: '2026-11-27T09:00:00Z',
    source: 'curated',
  };
}

/* ---------- frames ---------- */

type Box = [number, number, number, number];

interface TextOpts {
  font: string;
  size: number;
  color: string;
  weight?: number;
  italic?: boolean;
  lh?: number;
  ls?: number;
  align?: TextStyle['textAlign'];
  valign?: TextStyle['verticalAlign'];
  cols?: number;
  gap?: number;
  upper?: boolean;
}

function textStyle(o: TextOpts): TextStyle {
  return {
    fontFamily: o.font,
    fontSizePt: o.size,
    fontWeight: o.weight ?? 400,
    fontStyle: o.italic ? 'italic' : 'normal',
    color: o.color,
    lineHeight: o.lh ?? 1.3,
    letterSpacingEm: o.ls ?? 0,
    textAlign: o.align ?? 'left',
    verticalAlign: o.valign ?? 'top',
    paragraphSpacingMm: 0,
    columns: o.cols ?? 1,
    columnGapMm: o.gap ?? 0,
    insetMm: 0,
    textTransform: o.upper ? 'uppercase' : 'none',
  };
}

/* a frame; its id is the key until makePage/makeMaster gives it its full id and layer */
function frame(key: string, name: string, type: BookElement['type'], box: Box, extra: Partial<BookElement>): BookElement {
  return {
    id: key,
    name,
    type,
    xMm: box[0],
    yMm: box[1],
    widthMm: box[2],
    heightMm: box[3],
    rotation: 0,
    opacity: 1,
    locked: false,
    hidden: false,
    zIndex: 0,
    ...extra,
  };
}

function T(key: string, name: string, role: TextRole, box: Box, text: string, o: TextOpts): BookElement {
  return frame(key, name, 'text', box, { textRole: role, text, textStyle: textStyle(o) });
}

/** a running head, or a piece of page furniture the manuscript is never poured into (a plate number) */
function RH(key: string, box: Box, text: string, o: TextOpts, name = 'Running head'): BookElement {
  return frame(key, name, 'header', box, { textRole: 'running_head', text, textStyle: textStyle(o) });
}

function FOLIO(box: Box, o: TextOpts): BookElement {
  return frame('folio', 'Page number', 'pageNumber', box, { textRole: 'folio', text: '{{page}}', textStyle: textStyle(o) });
}

interface PhotoOpts {
  alt: string;
  fx?: number;
  fy?: number;
  zoom?: number;
  gray?: boolean;
}

function IMG(key: string, name: string, box: Box, photo: PremiumPhotoKey, o: PhotoOpts): BookElement {
  const p = PREMIUM_PHOTOS[photo];
  const fx = o.fx ?? 50;
  const fy = o.fy ?? 50;
  const zoom = o.zoom ?? 1;
  return frame(key, name, 'image', box, {
    image: {
      src: p.url,
      assetId: p.assetId,
      alt: o.alt,
      fit: 'cover',
      zoom,
      focalX: fx,
      focalY: fy,
      naturalWidth: p.widthPx,
      naturalHeight: p.heightPx,
      ...(o.gray ? { grayscale: 100, contrast: 106 } : {}),
      originalCrop: { zoom, focalX: fx, focalY: fy, fit: 'cover' },
    },
  });
}

/** an empty photo frame on a quiet tint: the tint is what prints until a photo is dropped in */
function EMPTY(key: string, name: string, box: Box, tint: string, alt: string): BookElement[] {
  return [
    frame(`${key}_tint`, `${name.split(' — ')[0]} tint`, 'shape', box, {
      shape: { shapeKind: 'rectangle', fill: tint, stroke: 'transparent', strokeWidthMm: 0, cornerRadiusMm: 0 },
    }),
    frame(key, name, 'image', box, {
      image: {
        src: '',
        alt,
        fit: 'cover',
        zoom: 1,
        focalX: 50,
        focalY: 50,
        originalCrop: { zoom: 1, focalX: 50, focalY: 50, fit: 'cover' },
      },
    }),
  ];
}

function PORTRAIT(key: string, box: Box, tint: string, alt: string): BookElement[] {
  return EMPTY(key, PORTRAIT_FRAME_NAME, box, tint, alt);
}

function RECT(key: string, name: string, box: Box, fill: string): BookElement {
  return frame(key, name, 'shape', box, {
    shape: { shapeKind: 'rectangle', fill, stroke: 'transparent', strokeWidthMm: 0, cornerRadiusMm: 0 },
  });
}

function DOT(key: string, name: string, box: Box, fill: string): BookElement {
  return frame(key, name, 'shape', box, {
    shape: { shapeKind: 'ellipse', fill, stroke: 'transparent', strokeWidthMm: 0, cornerRadiusMm: 0 },
  });
}

/** a hairline: [x, y, width]; the stroke runs through the middle of its 1 mm frame */
function RULE(key: string, name: string, at: [number, number, number], stroke: string, weightMm = 0.25, opacity = 1): BookElement {
  return frame(key, name, 'line', [at[0], at[1], at[2], 1], {
    opacity,
    shape: { shapeKind: 'rule', fill: 'transparent', stroke, strokeWidthMm: weightMm, cornerRadiusMm: 0 },
  });
}

interface ChartOpts {
  id: string;
  variant: InfographicVisualVariant;
  title: string;
  subtitle: string;
  category: string;
  font: string;
  bg: string;
  ink: string;
  accent: string;
  secondary: string;
  items: Array<{
    label: string;
    value: number;
    unit?: string;
    category?: string;
    yearOrStep?: string;
    description?: string;
    color?: string;
  }>;
}

function CHART(key: string, name: string, box: Box, o: ChartOpts): BookElement {
  const data: InfographicData = {
    templateId: o.id,
    variant: o.variant,
    title: o.title,
    subtitle: o.subtitle,
    categoryLabel: o.category,
    sourceNote: PREMIUM_SAMPLE_NOTE,
    fontFamily: o.font,
    backgroundColor: o.bg,
    textColor: o.ink,
    accentColor: o.accent,
    secondaryColor: o.secondary,
    items: o.items.map((it, i) => ({ id: String(i + 1), ...it })),
    showLegend: true,
    showValues: true,
  };
  return frame(key, name, 'infographic', box, { infographic: data });
}

/* ---------- pages and master pages ---------- */

/** what a frame looks like and holds, without the ids a page gives it */
function frameBody(el: BookElement): string {
  const { id, zIndex, masterElementId, overriddenFromMaster, ...rest } = el;
  void id; void zIndex; void masterElementId; void overriddenFromMaster;
  return JSON.stringify(rest);
}

function makeMaster(tid: string, key: string, name: string, role: PageRole, description: string, bg: string, els: BookElement[]): MasterPage {
  const id = `${tid}_${key}`;
  return {
    id,
    name,
    role,
    description,
    backgroundColor: bg,
    isBuiltIn: true,
    elements: els.map((e, i) => ({ ...e, id: `${id}_${e.id}`, zIndex: i + 1 })),
  };
}

interface PageSpec {
  key: string;
  label: string;
  role: PageRole;
  bg: string;
  chapterId?: string;
  master?: MasterPage;
  els: BookElement[];
}

function makePages(tid: string, specs: PageSpec[]): BookPage[] {
  return specs.map((s, index) => {
    const pid = `${tid}_${s.key}`;
    const elements = s.els.map((e, i) => {
      const out: BookElement = { ...e, id: `${pid}_${e.id}`, zIndex: i + 1 };
      const m = s.master?.elements.find((me) => me.id === `${s.master!.id}_${e.id}`);
      if (m) {
        out.masterElementId = m.id;
        out.overriddenFromMaster = frameBody(m) !== frameBody(out);
      }
      return out;
    });
    return {
      id: pid,
      orderIndex: index,
      label: s.label,
      role: s.role,
      ...(s.chapterId ? { chapterId: s.chapterId } : {}),
      ...(s.master ? { masterPageId: s.master.id } : {}),
      backgroundColor: s.bg,
      elements,
    };
  });
}

function dims(
  W: number,
  H: number,
  margins: PageDimensions['margins'],
  columns: number,
  gutterMm: number,
  baselineGridMm: number,
  presetName: string
): PageDimensions {
  return {
    widthMm: W,
    heightMm: H,
    orientation: Math.abs(W - H) < 1 ? 'square' : W > H ? 'landscape' : 'portrait',
    rotation: 0,
    margins,
    gutterMm,
    bleedMm: 3,
    safeAreaMm: 8,
    columns,
    columnGapMm: gutterMm,
    baselineGridMm,
    spreadMode: 'facing',
    presetName,
  };
}

interface DsSpec {
  name: string;
  paper: string;
  surface: string;
  ink: string;
  mutedInk: string;
  accent: string;
  secondary: string;
  extra: string[];
  display: string;
  heading: string;
  body: string;
  caption: string;
  quote: string;
  numerical: string;
  scale: DesignSystem['typography']['scale'];
  minBodyPt: number;
  baselineMm: number;
  margins: PageDimensions['margins'];
  columns: number;
  gutterMm: number;
}

function designSystem(s: DsSpec): DesignSystem {
  return {
    name: `${s.name} Design System`,
    approved: true,
    sourceTemplateName: s.name,
    colors: {
      paper: s.paper,
      surface: s.surface,
      ink: s.ink,
      mutedInk: s.mutedInk,
      primaryAccent: s.accent,
      secondaryAccent: s.secondary,
      palette: [s.paper, s.surface, s.ink, s.mutedInk, s.accent, s.secondary, ...s.extra],
    },
    typography: {
      primaryFont: s.display,
      secondaryFont: s.body,
      displayFont: s.display,
      headingFont: s.heading,
      bodyFont: s.body,
      captionFont: s.caption,
      quoteFont: s.quote,
      numericalFont: s.numerical,
      scale: s.scale,
      minApprovedBodyPt: s.minBodyPt,
    },
    spacing: {
      baselineMm: s.baselineMm,
      paragraphGapMm: s.baselineMm,
      sectionGapMm: s.baselineMm * 3,
      imageCaptionGapMm: s.baselineMm,
    },
    grid: { columns: s.columns, gutterMm: s.gutterMm, margins: s.margins },
  };
}

interface PremiumSpec {
  id: string;
  name: string;
  description: string;
  /** one line for the library card */
  tagline: string;
  /** the move that makes this book itself */
  signature: string;
  tags: string[];
  documentKind: 'book' | 'report';
  coverImage: string;
  dimensions: PageDimensions;
  designSystem: DesignSystem;
  chapters: BookChapter[];
  print: Partial<PrintSettings>;
  /** page indexes the library shows: the cover, then spreads */
  showcase: number[][];
  build: () => { pages: BookPage[]; masters: MasterPage[] };
}

const WHITE = '#FFFFFF';

/* =====================================================================================================================
   1  AWARDS ANNUAL — 230 × 300 mm. Bodoni Moda and Jost on cool white; the one move: every category opens on a full-bleed
      lapis plate with the category's name set huge in white Bodoni. Everything else stays quiet and centred.
   ===================================================================================================================== */

const AW_ID = 'tpl_premium_awards_annual';
const AW = { W: 230, H: 300 };
const A = {
  paper: '#F8F7F3',
  surface: '#EEEDE6',
  ink: '#16161D',
  muted: '#686775',
  lapis: '#1F2E82',
  brass: '#A88A4E',
  tint: '#E2E5F1',
  pale: '#C4CBEA',
  bodoni: 'Bodoni Moda',
  jost: 'Jost',
};

const aType = {
  rh: { font: A.jost, size: 7.5, color: A.muted, ls: 0.22, upper: true, align: 'center', valign: 'middle', lh: 1.2 } as TextOpts,
  folio: { font: A.jost, size: 8, color: A.muted, ls: 0.06, align: 'center', valign: 'middle', lh: 1.2 } as TextOpts,
  kicker: { font: A.jost, size: 8, weight: 500, color: A.lapis, ls: 0.18, upper: true, lh: 1.3 } as TextOpts,
  body: { font: A.jost, size: 9.5, color: A.ink, lh: 1.55 } as TextOpts,
  text: { font: A.jost, size: 10.5, color: A.ink, lh: 1.6 } as TextOpts,
  caption: { font: A.jost, size: 7.5, color: A.muted, lh: 1.5 } as TextOpts,
  heading: { font: A.bodoni, size: 30, color: A.ink, lh: 1.1 } as TextOpts,
};

const aRH = (text: string) => RH('rh', [20, 10, 190, 5], text, aType.rh);
const aFolio = (color = A.muted) => FOLIO([100, 283, 30, 5], { ...aType.folio, color });

/* text sits on a centred measure of 132 mm (four of the six columns), under the centred running head and folio */
const AX = 49;
const AW_MEASURE = 132;

function aTextFrames(c: { rh: string; heading: string; body: string }): BookElement[] {
  return [
    aRH(c.rh),
    T('heading', 'Heading', 'heading', [AX, 30, AW_MEASURE, 18], c.heading, aType.heading),
    RULE('rule', 'Heading rule', [AX, 51, 24], A.brass, 0.35),
    T('body', 'Body text', 'body', [AX, 60, AW_MEASURE, 150], c.body, aType.text),
    aFolio(),
  ];
}

function aPortraitFrames(c: { kicker: string; name: string; role: string; credit: string }): BookElement[] {
  return [
    ...PORTRAIT('portrait', [20, 22, 150, 190], A.tint, 'Portrait of the winner'),
    T('credit', 'Photo credit', 'caption', [176, 192, 34, 20], c.credit, { ...aType.caption, valign: 'bottom' }),
    T('kicker', 'Award and category', 'subheading', [20, 220, 190, 6], c.kicker, aType.kicker),
    T('name', 'Winner name', 'display', [20, 228, 190, 26], c.name, { font: A.bodoni, size: 34, color: A.ink, lh: 1.0 }),
    RULE('rule', 'Brass rule', [20, 256, 24], A.brass, 0.35),
    T('role', 'Title and organisation', 'caption', [20, 260, 170, 13], c.role, { font: A.jost, size: 9, color: A.muted, lh: 1.4 }),
    aFolio(),
  ];
}

function aCitationFrames(c: {
  rh: string;
  kicker: string;
  body: string;
  quote: string;
  attribution: string;
  facts: [string, string, string];
}): BookElement[] {
  const fact = { font: A.jost, size: 8, color: A.ink, lh: 1.55 } as TextOpts;
  return [
    aRH(c.rh),
    T('kicker', 'Section label', 'subheading', [AX, 28, AW_MEASURE, 6], c.kicker, aType.kicker),
    T('body', 'Citation', 'body', [AX, 38, AW_MEASURE, 92], c.body, aType.text),
    T('quote', 'Pull quote', 'quote', [AX, 136, AW_MEASURE, 84], c.quote, { font: A.bodoni, size: 24, color: A.ink, lh: 1.2, valign: 'bottom' }),
    RULE('qrule', 'Quote rule', [AX, 223, 24], A.brass, 0.35),
    T('attrib', 'Quote attribution', 'caption', [AX, 227, AW_MEASURE, 6], c.attribution, aType.caption),
    RULE('frule', 'Facts rule', [AX, 239, AW_MEASURE], A.ink, 0.2, 0.35),
    T('fact1', 'Fact: category', 'caption', [AX, 245, 42, 14], c.facts[0], fact),
    T('fact2', 'Fact: organisation', 'caption', [AX + 45, 245, 42, 14], c.facts[1], fact),
    T('fact3', 'Fact: city', 'caption', [AX + 90, 245, 42, 14], c.facts[2], fact),
    aFolio(),
  ];
}

function aPlateFrames(c: { kicker: string; name: string; description: string; list: string }): BookElement[] {
  return [
    T('kicker', 'Category number', 'subheading', [20, 24, 190, 6], c.kicker, { ...aType.kicker, color: A.pale }),
    RULE('rule', 'Plate rule', [20, 33, 190], A.pale, 0.25, 0.6),
    T('name', 'Category name', 'display', [18, 106, 194, 116], c.name, {
      font: A.bodoni,
      size: 62,
      color: WHITE,
      lh: 0.98,
      valign: 'bottom',
    }),
    T('desc', 'Category description', 'body', [20, 232, 118, 34], c.description, { font: A.jost, size: 9.5, color: A.pale, lh: 1.5 }),
    T('list', 'Winner and finalists', 'caption', [150, 232, 60, 38], c.list, { font: A.jost, size: 8, color: WHITE, lh: 1.5 }),
    aFolio(A.pale),
  ];
}

function aGalleryFrames(c: { rh: string; caption: string }): BookElement[] {
  return [
    aRH(c.rh),
    IMG('photo1', 'Gallery photograph, wide', [20, 22, 190, 118], 'pavilion', { alt: 'Arrival', fx: 50, fy: 55 }),
    IMG('photo2', 'Gallery photograph, left', [20, 146, 92, 112], 'stair', { alt: 'The foyer', fx: 56, fy: 40 }),
    IMG('photo3', 'Gallery photograph, right', [118, 146, 92, 112], 'courtyard', { alt: 'The courtyard', fx: 58, fy: 60 }),
    T('caption', 'Gallery caption', 'caption', [20, 262, 190, 11], c.caption, aType.caption),
    aFolio(),
  ];
}

function buildAwards(): { pages: BookPage[]; masters: MasterPage[] } {
  const { H } = AW;
  const citationBody =
    'The jury chose Winner name for work that changed how their organisation serves its customers. Replace this paragraph with what the winner did, for whom and over what period, in plain words and in the order it happened.\n\n' +
    'A second paragraph can say what made the work stand out from the other entries: the evidence the jury weighed, the people it reached and what others in the field can learn from it. Keep the citation to about a hundred words.';
  const masters = [
    makeMaster(AW_ID, 'm_text', 'A — Text page', 'editorial_text',
      'Running head, a heading with a brass rule, two columns of text and a centred page number.', A.paper,
      aTextFrames({ rh: 'Awards Annual', heading: 'Heading', body: 'Two columns of text. Replace with your own words.\n\nA second paragraph continues here.' })),
    makeMaster(AW_ID, 'm_portrait', 'B — Winner portrait', 'image_led',
      'A tall portrait frame, the award and category, the winner\'s name in Bodoni and their title.', A.paper,
      aPortraitFrames({ kicker: 'Winner, Category name', name: 'Winner name', role: 'Title, Organisation\nCity', credit: 'Portrait by Photographer name' })),
    makeMaster(AW_ID, 'm_citation', 'C — Citation', 'editorial_text',
      'The jury\'s citation in two columns, a large pull quote and three facts along the foot.', A.paper,
      aCitationFrames({
        rh: 'Category name',
        kicker: 'Citation',
        body: citationBody,
        quote: '“A sentence from the jury that says why this work stood out.”',
        attribution: 'From the jury\'s citation',
        facts: ['Category\nCategory name', 'Organisation\nOrganisation name', 'City\nCity name'],
      })),
    makeMaster(AW_ID, 'm_plate', 'D — Category plate', 'chapter_opener',
      'A full-bleed lapis page: the category\'s name set huge in white, what it recognises and who won.', A.lapis,
      aPlateFrames({ kicker: 'Category', name: 'Category\nname', description: 'One sentence on what this category recognises.', list: 'Winner\nWinner name\n\nFinalists\nFinalist name\nFinalist name' })),
    makeMaster(AW_ID, 'm_gallery', 'E — Gallery', 'image_gallery',
      'One wide and two tall photographs with a single caption line.', A.paper,
      aGalleryFrames({ rh: 'The ceremony', caption: 'Above: arrival. Below: the foyer and the courtyard. Replace with photographs from your ceremony.' })),
  ];
  const [mText, mPortrait, mCitation, mPlate, mGallery] = masters;

  const finalistRow = (i: number, y: number, name: string, note: string): BookElement[] => [
    ...PORTRAIT(`f${i}`, [20, y, 46, 58], A.tint, `Portrait of finalist ${i}`),
    T(`f${i}_name`, `Finalist ${i} name`, 'heading', [74, y + 2, 136, 9], name, { font: A.bodoni, size: 17, color: A.ink, lh: 1.1 }),
    T(`f${i}_role`, `Finalist ${i} title`, 'caption', [74, y + 13, 136, 6], 'Title, Organisation, City', { font: A.jost, size: 8.5, color: A.muted, lh: 1.3 }),
    T(`f${i}_note`, `Finalist ${i} note`, 'body', [74, y + 23, 136, 32], note, aType.body),
  ];
  const juror = (i: number, x: number, y: number): BookElement[] => [
    ...PORTRAIT(`j${i}`, [x, y, 58.5, 64], A.tint, `Portrait of juror ${i}`),
    T(`j${i}_name`, `Juror ${i} name`, 'heading', [x, y + 67, 58.5, 7], 'Juror name', { font: A.bodoni, size: 12, color: A.ink, lh: 1.15 }),
    T(`j${i}_role`, `Juror ${i} title`, 'caption', [x, y + 75, 58.5, 10], 'Title, Organisation', { font: A.jost, size: 7.5, color: A.muted, lh: 1.4 }),
  ];

  const pages = makePages(AW_ID, [
    {
      key: 'p01', label: 'Front cover', role: 'front_cover', bg: A.lapis, chapterId: 'ch_front',
      els: [
        T('kicker', 'Programme name', 'subheading', [20, 24, 190, 6], 'The Programme Name Awards', { ...aType.kicker, color: A.pale }),
        RULE('rule_top', 'Cover rule', [20, 33, 190], A.pale, 0.25, 0.6),
        T('title', 'Book title', 'display', [18, 164, 194, 70], 'Awards\nAnnual', { font: A.bodoni, size: 76, color: WHITE, lh: 0.92, valign: 'bottom' }),
        RULE('rule', 'Brass rule', [20, 241, 30], A.brass, 0.5),
        T('edition', 'Edition', 'subheading', [20, 246, 150, 10], '2026 edition', { font: A.bodoni, size: 16, color: WHITE, lh: 1.1 }),
        T('sub', 'Subtitle', 'body', [20, 260, 150, 16], 'The winners, their work and the jury who chose them', { font: A.jost, size: 9, color: A.pale, lh: 1.45 }),
      ],
    },
    {
      key: 'p02', label: 'Frontispiece', role: 'full_bleed_image', bg: A.paper, chapterId: 'ch_front',
      els: [IMG('photo', 'Frontispiece photograph', [-3, -3, 236, 306], 'sculpture', { alt: 'The award on its plinth', fx: 58, fy: 55 })],
    },
    {
      key: 'p03', label: 'Title page', role: 'title_page', bg: A.paper, chapterId: 'ch_front',
      els: [
        T('kicker', 'Programme name', 'subheading', [20, 104, 190, 6], 'The Programme Name Awards', { ...aType.kicker, align: 'center' }),
        T('title', 'Book title', 'display', [20, 113, 190, 22], 'Awards Annual', { font: A.bodoni, size: 42, color: A.ink, lh: 1.05, align: 'center' }),
        RULE('rule', 'Brass rule', [103, 141, 24], A.brass, 0.35),
        T('edition', 'Edition', 'caption', [20, 147, 190, 7], '2026 edition', { font: A.jost, size: 10, color: A.muted, lh: 1.3, align: 'center' }),
        T('publisher', 'Publisher', 'caption', [20, 262, 190, 7], 'Published by Organisation name', { ...aType.caption, size: 8, align: 'center' }),
      ],
    },
    {
      key: 'p04', label: 'Copyright', role: 'copyright', bg: A.paper, chapterId: 'ch_front',
      els: [
        T('colophon', 'Copyright and colophon', 'caption', [20, 186, 120, 88],
          'Awards Annual, 2026 edition\nPublished by Organisation name, City\n\nText © the authors and Organisation name. Photographs © the photographers. All rights reserved. No part of this book may be reproduced without written permission from the publisher.\n\nFrontispiece: the award. Replace it with a photograph of your trophy.\n\nSet in Bodoni Moda and Jost.\nISBN to be added',
          { ...aType.caption, lh: 1.6, valign: 'bottom' }),
      ],
    },
    {
      key: 'p05', label: 'Contents', role: 'table_of_contents', bg: A.paper, chapterId: 'ch_front',
      els: [
        aRH('Awards Annual'),
        T('heading', 'Heading', 'heading', [20, 30, 190, 18], 'Contents', aType.heading),
        RULE('rule', 'Heading rule', [20, 51, 24], A.brass, 0.35),
        T('entries', 'Contents entries', 'body', [20, 64, 150, 70],
          'Foreword\nCategory one: Emerging Leader\nCategory two: Innovation of the Year\nThe ceremony\nThe jury\nRoll of honour',
          { font: A.bodoni, size: 15, color: A.ink, lh: 1.9 }),
        T('numbers', 'Contents page numbers', 'caption', [170, 64, 40, 70], '6\n7\n11\n14\n16\n17',
          { font: A.bodoni, size: 15, color: A.muted, lh: 1.9, align: 'right' }),
        aFolio(),
      ],
    },
    {
      key: 'p06', label: 'Foreword', role: 'foreword', bg: A.paper, chapterId: 'ch_front', master: mText,
      els: [
        ...aTextFrames({
          rh: 'Awards Annual',
          heading: 'Foreword',
          body:
            'Every year the awards set out to find the work that moved its field forward, and every year the shortlist is harder to choose from. This book records the winners and the finalists, the reasons the jury gave and the evening on which they were announced.\n\n' +
            'Replace this foreword with a note from the chair of the jury or the head of the organisation that runs the programme: why the awards exist, what changed this year, how the entries were judged and who made the programme possible. Two or three short paragraphs are enough.\n\n' +
            'Thank the jury, the partners and everyone who entered, including those who did not make the shortlist. Close with what the programme hopes the winners will do next, and with an invitation to enter next year.',
        }),
        ...PORTRAIT('chair', [AX, 218, 40, 52], A.tint, 'Portrait of the chair of the jury'),
        T('sign_name', 'Signature name', 'heading', [AX + 48, 238, 84, 9], 'Name of the chair', { font: A.bodoni, size: 16, color: A.ink, lh: 1.1 }),
        T('sign_role', 'Signature title', 'caption', [AX + 48, 249, 84, 12], 'Chair of the jury, The Programme Name Awards', { font: A.jost, size: 8.5, color: A.muted, lh: 1.4 }),
      ],
    },
    {
      key: 'p07', label: 'Category one', role: 'chapter_opener', bg: A.lapis, chapterId: 'ch_cat1', master: mPlate,
      els: aPlateFrames({
        kicker: 'Category one',
        name: 'Emerging\nLeader',
        description: 'For a leader early in their career whose work has already changed how their organisation works. Replace with your category\'s own wording.',
        list: 'Winner\nWinner name\n\nFinalists\nFinalist name\nFinalist name',
      }),
    },
    {
      key: 'p08', label: 'Winner portrait', role: 'image_led', bg: A.paper, chapterId: 'ch_cat1', master: mPortrait,
      els: aPortraitFrames({ kicker: 'Winner, Emerging Leader', name: 'Winner name', role: 'Title, Organisation\nCity', credit: 'Portrait by Photographer name' }),
    },
    {
      key: 'p09', label: 'Winner citation', role: 'editorial_text', bg: A.paper, chapterId: 'ch_cat1', master: mCitation,
      els: aCitationFrames({
        rh: 'Emerging Leader',
        kicker: 'Citation',
        body: citationBody,
        quote: '“A sentence from the jury that says why this work stood out, set large enough to read across a room.”',
        attribution: 'From the jury\'s citation',
        facts: ['Category\nEmerging Leader', 'Organisation\nOrganisation name', 'City\nCity name'],
      }),
    },
    {
      key: 'p10', label: 'Finalists', role: 'editorial_text', bg: A.paper, chapterId: 'ch_cat1',
      els: [
        aRH('Emerging Leader'),
        T('heading', 'Heading', 'heading', [20, 30, 190, 18], 'Finalists', aType.heading),
        RULE('rule', 'Heading rule', [20, 51, 24], A.brass, 0.35),
        ...finalistRow(1, 62, 'Finalist name', 'Two sentences on the finalist\'s work and why the jury shortlisted it. Keep each note to about thirty words.'),
        ...finalistRow(2, 132, 'Finalist name', 'Two sentences on the finalist\'s work and why the jury shortlisted it. Keep each note to about thirty words.'),
        ...finalistRow(3, 202, 'Finalist name', 'Two sentences on the finalist\'s work and why the jury shortlisted it. Keep each note to about thirty words.'),
        aFolio(),
      ],
    },
    {
      key: 'p11', label: 'Category two', role: 'chapter_opener', bg: A.lapis, chapterId: 'ch_cat2', master: mPlate,
      els: aPlateFrames({
        kicker: 'Category two',
        name: 'Innovation\nof the Year',
        description: 'For a product, service or way of working, launched in the last two years, that solved a real problem well. Replace with your own wording.',
        list: 'Winner\nWinner name\n\nFinalists\nFinalist name\nFinalist name',
      }),
    },
    {
      key: 'p12', label: 'Winner portrait', role: 'image_led', bg: A.paper, chapterId: 'ch_cat2', master: mPortrait,
      els: aPortraitFrames({ kicker: 'Winner, Innovation of the Year', name: 'Winner name', role: 'Title, Organisation\nCity', credit: 'Portrait by Photographer name' }),
    },
    {
      key: 'p13', label: 'Winner citation', role: 'editorial_text', bg: A.paper, chapterId: 'ch_cat2', master: mCitation,
      els: aCitationFrames({
        rh: 'Innovation of the Year',
        kicker: 'Citation',
        body:
          'Winner name and their team built something the jury agreed it had not seen before. Replace this paragraph with what was made, the problem it solved, who uses it now and how long it took to get there.\n\n' +
          'Use the second paragraph for the detail the jury found most convincing, and for one thing the team said about the work when they were told they had won. Keep the citation to about a hundred words.',
        quote: '“The idea was simple, and the jury kept coming back to it: this is what the category is for.”',
        attribution: 'From the jury\'s citation',
        facts: ['Category\nInnovation of the Year', 'Organisation\nOrganisation name', 'City\nCity name'],
      }),
    },
    {
      key: 'p14', label: 'The ceremony', role: 'full_bleed_image', bg: A.paper, chapterId: 'ch_ceremony',
      els: [IMG('photo', 'Ceremony photograph', [-3, -3, 236, 306], 'interior', { alt: 'The hall before the ceremony', fx: 50, fy: 58 })],
    },
    {
      key: 'p15', label: 'Ceremony gallery', role: 'image_gallery', bg: A.paper, chapterId: 'ch_ceremony', master: mGallery,
      els: aGalleryFrames({ rh: 'The ceremony', caption: 'Above: arrival. Below: the foyer and the courtyard. Replace with photographs from your ceremony.' }),
    },
    {
      key: 'p16', label: 'The jury', role: 'editorial_text', bg: A.paper, chapterId: 'ch_ceremony',
      els: [
        aRH('The jury'),
        T('heading', 'Heading', 'heading', [20, 30, 190, 18], 'The jury', aType.heading),
        RULE('rule', 'Heading rule', [20, 51, 24], A.brass, 0.35),
        T('intro', 'Introduction', 'body', [20, 60, 150, 18],
          'Six judges read every entry and met twice before choosing the winners. Replace this with a note on how your jury worked.',
          aType.body),
        ...juror(1, 20, 84), ...juror(2, 85.75, 84), ...juror(3, 151.5, 84),
        ...juror(4, 20, 178), ...juror(5, 85.75, 178), ...juror(6, 151.5, 178),
        aFolio(),
      ],
    },
    {
      key: 'p17', label: 'Roll of honour', role: 'closing_page', bg: A.paper, chapterId: 'ch_ceremony', master: mText,
      els: aTextFrames({
        rh: 'Roll of honour',
        heading: 'Roll of honour',
        body:
          'Emerging Leader\nWinner: Winner name, Organisation\nFinalists: Finalist name, Organisation; Finalist name, Organisation\n\n' +
          'Innovation of the Year\nWinner: Winner name, Organisation\nFinalists: Finalist name, Organisation; Finalist name, Organisation\n\n' +
          'Category three\nWinner: Winner name, Organisation\nFinalists: Finalist name, Organisation; Finalist name, Organisation\n\n' +
          'Category four\nWinner: Winner name, Organisation\nFinalists: Finalist name, Organisation; Finalist name, Organisation',
      }),
    },
    {
      key: 'p18', label: 'Back cover', role: 'back_cover', bg: A.lapis, chapterId: 'ch_ceremony',
      els: [
        T('title', 'Book title', 'heading', [20, 38, 190, 12], 'Awards Annual', { font: A.bodoni, size: 22, color: WHITE, lh: 1.1 }),
        T('blurb', 'Back cover text', 'body', [20, 56, 130, 30],
          'A record of the year\'s winners, the work that earned their awards and the jury who chose them.',
          { font: A.jost, size: 9.5, color: A.pale, lh: 1.5 }),
        RULE('rule', 'Brass rule', [20, 239, 30], A.brass, 0.5),
        T('publisher', 'Publisher', 'caption', [20, 245, 120, 14], 'Organisation name\nWebsite address', { font: A.jost, size: 8, color: A.pale, lh: 1.5 }),
        RECT('barcode', 'Barcode area', [160, H - 60, 50, 30], WHITE),
        T('barcode_note', 'Barcode note', 'caption', [160, H - 48, 50, 6], 'ISBN barcode', { ...aType.caption, align: 'center' }),
      ],
    },
  ]);
  return { pages, masters };
}

const AWARDS: PremiumSpec = {
  id: AW_ID,
  name: 'Awards Annual',
  description:
    'A book of an awards programme\'s winners: lapis category plates, winner profile spreads with a portrait frame, citation and pull quote, finalists, the jury and the ceremony.',
  tagline: 'Winners, citations, the jury and the night itself, opened by full-bleed lapis category plates.',
  signature: 'Every category opens on a full-bleed lapis plate with its name set huge in white Bodoni.',
  tags: ['awards', 'winners', 'annual', 'jury', 'premium'],
  documentKind: 'book',
  coverImage: PREMIUM_PHOTOS.sculpture.url,
  dimensions: dims(AW.W, AW.H, { top: 22, bottom: 26, inner: 20, outer: 20 }, 6, 5, 4.2, 'Awards Annual 230 × 300'),
  designSystem: designSystem({
    name: 'Awards Annual',
    paper: A.paper,
    surface: A.surface,
    ink: A.ink,
    mutedInk: A.muted,
    accent: A.lapis,
    secondary: A.brass,
    extra: [A.tint, A.pale, WHITE],
    display: A.bodoni,
    heading: A.bodoni,
    body: A.jost,
    caption: A.jost,
    quote: A.bodoni,
    numerical: A.jost,
    scale: { displayPt: 62, headingPt: 30, subheadingPt: 8, bodyPt: 9.5, captionPt: 7.5, quotePt: 22, folioPt: 8 },
    minBodyPt: 9,
    baselineMm: 4.2,
    margins: { top: 22, bottom: 26, inner: 20, outer: 20 },
    columns: 6,
    gutterMm: 5,
  }),
  chapters: [
    { id: 'ch_front', number: 1, title: 'Front matter', subtitle: 'Cover, title, contents and foreword', orderIndex: 0 },
    { id: 'ch_cat1', number: 2, title: 'Category one: Emerging Leader', orderIndex: 1 },
    { id: 'ch_cat2', number: 3, title: 'Category two: Innovation of the Year', orderIndex: 2 },
    { id: 'ch_ceremony', number: 4, title: 'The ceremony and the jury', orderIndex: 3 },
  ],
  print: { bindingType: 'smyth_hardcover', paperStockName: '150 gsm uncoated white', coverBoardCaliperMm: 2.5, exportSpreads: true },
  showcase: [[0], [5, 6], [7, 8]],
  build: buildAwards,
};

/* =====================================================================================================================
   2  LEADERSHIP CONVERSATIONS — 210 × 270 mm. Spectral and Archivo on cool paper with plum. A fixed left margin column
      carries the questions in Archivo while the answers run in Spectral beside them; the one move: each conversation
      breaks for a full-page plum quote set large in Spectral italic.
   ===================================================================================================================== */

const LC_ID = 'tpl_premium_leadership_conversations';
const LC = { W: 210, H: 270 };
const L = {
  paper: '#F4F4F1',
  surface: '#ECE6EA',
  ink: '#1E1A20',
  muted: '#6C6570',
  plum: '#5A2350',
  mauve: '#CDB4C6',
  spectral: 'Spectral',
  archivo: 'Archivo',
};

const lType = {
  rh: { font: L.spectral, size: 9, italic: true, color: L.muted, align: 'center', valign: 'middle', lh: 1.2 } as TextOpts,
  folio: { font: L.archivo, size: 7.5, color: L.muted, ls: 0.08, align: 'center', valign: 'middle', lh: 1.2 } as TextOpts,
  q: { font: L.archivo, size: 8.5, weight: 600, color: L.plum, lh: 1.35 } as TextOpts,
  a: { font: L.spectral, size: 10, color: L.ink, lh: 1.6 } as TextOpts,
  caption: { font: L.archivo, size: 7.5, color: L.muted, lh: 1.45 } as TextOpts,
  kicker: { font: L.archivo, size: 8.5, weight: 500, color: L.plum, lh: 1.3 } as TextOpts,
  heading: { font: L.spectral, size: 26, weight: 300, color: L.ink, lh: 1.1 } as TextOpts,
};

const lRH = (text: string) => RH('rh', [18, 9, 174, 5], text, lType.rh);
const lFolio = (color = L.muted) => FOLIO([90, 254, 30, 5], { ...lType.folio, color });

function lQaFrames(c: { rh: string; q: [string, string, string]; a: [string, string, string] }): BookElement[] {
  return [
    lRH(c.rh),
    T('q1', 'Question 1', 'subheading', [18, 24, 38, 30], c.q[0], lType.q),
    T('a1', 'Answer 1', 'body', [62, 24, 130, 70], c.a[0], lType.a),
    T('q2', 'Question 2', 'subheading', [18, 100, 38, 30], c.q[1], lType.q),
    T('a2', 'Answer 2', 'body', [62, 100, 130, 70], c.a[1], lType.a),
    T('q3', 'Question 3', 'subheading', [18, 176, 38, 30], c.q[2], lType.q),
    T('a3', 'Answer 3', 'body', [62, 176, 130, 66], c.a[2], lType.a),
    lFolio(),
  ];
}

function lOpenerFrames(c: { kicker: string; name: string; role: string; bio: string; intro: string }): BookElement[] {
  return [
    T('kicker', 'Conversation number', 'subheading', [18, 18, 174, 6], c.kicker, lType.kicker),
    ...PORTRAIT('portrait', [18, 28, 112, 150], L.surface, 'Portrait of the leader'),
    T('bio', 'Short bio', 'body', [136, 28, 56, 150], c.bio, { font: L.spectral, size: 9, color: L.ink, lh: 1.55, valign: 'bottom' }),
    T('name', 'Leader name', 'display', [18, 184, 174, 18], c.name, { font: L.spectral, size: 36, weight: 300, color: L.ink, lh: 1.05 }),
    T('role', 'Title and organisation', 'caption', [18, 204, 174, 7], c.role, { font: L.archivo, size: 9, color: L.plum, lh: 1.3 }),
    T('intro', 'Introduction', 'body', [18, 216, 150, 30], c.intro, { font: L.spectral, size: 11, italic: true, color: L.ink, lh: 1.45 }),
    lFolio(),
  ];
}

function lQuoteFrames(c: { quote: string; attribution: string }): BookElement[] {
  return [
    T('quote', 'Quote', 'quote', [22, 40, 166, 166], c.quote, {
      font: L.spectral,
      size: 30,
      italic: true,
      color: L.paper,
      lh: 1.2,
      valign: 'bottom',
    }),
    RULE('rule', 'Quote rule', [22, 212, 24], L.mauve, 0.4),
    T('attrib', 'Attribution', 'caption', [22, 217, 166, 12], c.attribution, { font: L.archivo, size: 9, color: L.mauve, lh: 1.4 }),
    lFolio(L.mauve),
  ];
}

function lTextFrames(c: { rh: string; heading: string; note: string; body: string; sign: string }): BookElement[] {
  return [
    lRH(c.rh),
    T('heading', 'Heading', 'heading', [62, 24, 130, 16], c.heading, lType.heading),
    T('note', 'Margin note', 'caption', [18, 48, 38, 50], c.note, { font: L.archivo, size: 8, color: L.plum, lh: 1.4 }),
    T('body', 'Body text', 'body', [62, 48, 130, 130], c.body, lType.a),
    T('sign', 'Signature', 'caption', [62, 184, 130, 14], c.sign, { font: L.spectral, size: 10, italic: true, color: L.ink, lh: 1.45 }),
    lFolio(),
  ];
}

const LQ: [string, string, string] = [
  'What did your first year in the role teach you?',
  'Which decision are you proudest of?',
  'What would you tell someone stepping into a role like yours?',
];
const LA = {
  one:
    'Replace this with the leader\'s own words. Keep the rhythm of speech: short sentences, the odd aside, the moment they stopped to think before going on. Readers can tell when an answer has been polished into a press release, and they stop believing it.\n\n' +
    'An answer of about a hundred words reads well on this page. Longer ones can carry over to the next page; the question stays in the margin beside it.',
  two:
    'A good answer names a real moment: the meeting, the call, the choice that could have gone the other way. It says who was in the room and what was at stake, without needing the reader to know the organisation already.\n\n' +
    'Edit lightly, so it still sounds like the person who said it, and cut anything that only repeats the question or thanks the team in general terms.',
  three:
    'Close each page on an answer that looks forward: what the leader is working on now, what worries them and what they would still like to change before they hand over the role.\n\n' +
    'If an answer runs long, carry it to the next page rather than shrinking the type. The margin column keeps every question beside its answer, wherever it falls.',
};

function buildLeadership(): { pages: BookPage[]; masters: MasterPage[] } {
  const bio =
    'Leader name has led Organisation name since joining it, after a career across two industries and three cities. Replace this with a bio of about forty words: the role, the path to it and one thing outside work.';
  const masters = [
    makeMaster(LC_ID, 'm_qa', 'A — Questions and answers', 'interview',
      'Questions in the left margin column in Archivo, answers beside them in Spectral; three pairs to a page.', L.paper,
      lQaFrames({ rh: 'Leader name', q: LQ, a: [LA.one, LA.two, LA.three] })),
    makeMaster(LC_ID, 'm_opener', 'B — Conversation opener', 'chapter_opener',
      'A tall portrait frame with a short bio beside it, then the leader\'s name, title and an introduction.', L.paper,
      lOpenerFrames({ kicker: 'Conversation', name: 'Leader name', role: 'Title, Organisation', bio, intro: 'A two-sentence introduction: where the conversation took place and what it set out to ask.' })),
    makeMaster(LC_ID, 'm_quote', 'C — Quote page', 'quote_page',
      'A full plum page holding one line from the conversation, set large in Spectral italic.', L.plum,
      lQuoteFrames({ quote: '“One line from the conversation, set large.”', attribution: 'Leader name, on the subject of the quote' })),
    makeMaster(LC_ID, 'm_text', 'D — Text page', 'editorial_text',
      'A heading and one column of text on the answer column, a margin note and a signature.', L.paper,
      lTextFrames({ rh: 'Leadership Conversations', heading: 'Heading', note: 'A margin note.', body: 'One column of text. Replace with your own words.', sign: 'Name\nTitle' })),
  ];
  const [mQa, mOpener, mQuote, mText] = masters;

  const quick = (i: number, x: number, y: number, answer: string): BookElement[] => [
    ...PORTRAIT(`p${i}`, [x, y, 34, 46], L.surface, `Portrait of leader ${i}`),
    T(`p${i}_name`, `Leader ${i} name`, 'heading', [x + 38, y, 46, 7], 'Leader name', { font: L.spectral, size: 12, color: L.ink, lh: 1.15 }),
    T(`p${i}_role`, `Leader ${i} title`, 'caption', [x + 38, y + 8, 46, 9], 'Title, Organisation', lType.caption),
    T(`p${i}_answer`, `Leader ${i} answer`, 'body', [x + 38, y + 19, 46, 40], answer, { font: L.spectral, size: 9.5, italic: true, color: L.ink, lh: 1.5 }),
  ];

  const pages = makePages(LC_ID, [
    {
      key: 'p01', label: 'Front cover', role: 'front_cover', bg: L.paper, chapterId: 'ch_open',
      els: [
        IMG('photo', 'Cover photograph', [-3, -3, 216, 186], 'interior', { alt: 'Two chairs facing each other in a quiet room', fx: 50, fy: 74 }),
        T('title', 'Book title', 'display', [18, 194, 174, 34], 'Leadership\nConversations', { font: L.spectral, size: 32, weight: 300, color: L.ink, lh: 1.02 }),
        T('sub', 'Subtitle', 'subheading', [18, 231, 130, 14], 'Interviews with leaders on decisions, doubt and the daily work of leading', { font: L.archivo, size: 9, color: L.muted, lh: 1.4 }),
        T('volume', 'Volume', 'caption', [150, 252, 42, 6], 'Volume one', { font: L.archivo, size: 8, color: L.plum, lh: 1.2, align: 'right' }),
      ],
    },
    {
      key: 'p02', label: 'Frontispiece', role: 'full_bleed_image', bg: L.paper, chapterId: 'ch_open',
      els: [IMG('photo', 'Frontispiece photograph', [-3, -3, 216, 276], 'doorway', { alt: 'A doorway opening onto a garden path', fx: 50, fy: 55 })],
    },
    {
      key: 'p03', label: 'Title page', role: 'title_page', bg: L.paper, chapterId: 'ch_open',
      els: [
        T('title', 'Book title', 'display', [62, 90, 130, 30], 'Leadership\nConversations', { font: L.spectral, size: 30, weight: 300, color: L.plum, lh: 1.05 }),
        T('sub', 'Subtitle', 'subheading', [62, 124, 120, 16], 'Interviews with leaders on decisions, doubt and the daily work of leading', { font: L.spectral, size: 12, italic: true, color: L.muted, lh: 1.35 }),
        T('editor', 'Editor', 'caption', [62, 148, 130, 6], 'Edited by Editor name', { font: L.archivo, size: 8.5, color: L.ink, lh: 1.3 }),
        T('publisher', 'Publisher', 'caption', [62, 236, 130, 6], 'Organisation name', { font: L.archivo, size: 8, color: L.muted, lh: 1.3 }),
      ],
    },
    {
      key: 'p04', label: 'Copyright', role: 'copyright', bg: L.paper, chapterId: 'ch_open',
      els: [
        T('colophon', 'Copyright and colophon', 'caption', [62, 180, 130, 62],
          'Leadership Conversations, volume one\nPublished by Organisation name, City\n\nInterviews © the interviewees and Organisation name. Photographs © the photographers. All rights reserved. The conversations have been edited for length and clarity.\n\nSet in Spectral and Archivo.\nISBN to be added',
          { ...lType.caption, lh: 1.6, valign: 'bottom' }),
      ],
    },
    {
      key: 'p05', label: 'Contents', role: 'table_of_contents', bg: L.paper, chapterId: 'ch_open',
      els: [
        lRH('Leadership Conversations'),
        T('heading', 'Heading', 'heading', [62, 24, 130, 16], 'Contents', lType.heading),
        T('entries', 'Contents entries', 'body', [62, 48, 104, 64],
          'Introduction\nLeader name, Title, Organisation\nLeader name, Title, Organisation\nQuick answers\nAfterword',
          { font: L.spectral, size: 12, color: L.ink, lh: 2.1 }),
        T('numbers', 'Contents page numbers', 'caption', [166, 48, 26, 64], '6\n7\n12\n15\n17',
          { font: L.spectral, size: 12, color: L.plum, lh: 2.1, align: 'right' }),
        lFolio(),
      ],
    },
    {
      key: 'p06', label: 'Introduction', role: 'introduction', bg: L.paper, chapterId: 'ch_open', master: mText,
      els: lTextFrames({
        rh: 'Leadership Conversations',
        heading: 'Introduction',
        note: 'How these conversations were recorded and edited.',
        body:
          'This book collects conversations with leaders about the decisions that shaped their organisations and the doubts that came with them. Each one was recorded in person and edited only for length, so the voices stay their own.\n\n' +
          'Replace this introduction with your own: who you spoke to and why, what you asked everyone, and what surprised you when you read the conversations side by side. Say how long each conversation lasted and where it took place.\n\n' +
          'Every conversation opens with a portrait and a short biography, and every one asks a few of the same questions, so readers can compare the answers. Two or three paragraphs are enough before the first conversation begins.',
        sign: 'Editor name\nEditor, Leadership Conversations',
      }),
    },
    {
      key: 'p07', label: 'Conversation one', role: 'chapter_opener', bg: L.paper, chapterId: 'ch_c1', master: mOpener,
      els: lOpenerFrames({
        kicker: 'Conversation one',
        name: 'Leader name',
        role: 'Title, Organisation',
        bio,
        intro: 'We met in the organisation\'s offices on a quiet morning. Replace this with two sentences on where you talked and what you wanted to ask.',
      }),
    },
    {
      key: 'p08', label: 'Questions and answers', role: 'interview', bg: L.paper, chapterId: 'ch_c1', master: mQa,
      els: lQaFrames({ rh: 'Leader name', q: LQ, a: [LA.one, LA.two, LA.three] }),
    },
    {
      key: 'p09', label: 'Questions and answers', role: 'interview', bg: L.paper, chapterId: 'ch_c1', master: mQa,
      els: lQaFrames({
        rh: 'Leader name',
        q: ['When did you last change your mind?', 'How do you spend the first hour of the day?', 'What do you look for when you hire?'],
        a: [LA.two, LA.three, LA.one],
      }),
    },
    {
      key: 'p10', label: 'Quote', role: 'quote_page', bg: L.plum, chapterId: 'ch_c1', master: mQuote,
      els: lQuoteFrames({
        quote: '“A line from the conversation that stayed with you, set large enough to stop a reader turning the page.”',
        attribution: 'Leader name, on the first year in the role',
      }),
    },
    {
      key: 'p11', label: 'Questions and answers with photograph', role: 'interview', bg: L.paper, chapterId: 'ch_c1',
      els: [
        lRH('Leader name'),
        T('q1', 'Question 1', 'subheading', [18, 24, 38, 30], 'What do you want to be remembered for?', lType.q),
        T('a1', 'Answer 1', 'body', [62, 24, 130, 66], LA.three, lType.a),
        IMG('photo', 'Photograph of the place', [62, 96, 130, 96], 'courtyard', { alt: 'The courtyard where the conversation took place', fx: 50, fy: 58 }),
        T('caption', 'Photograph caption', 'caption', [18, 96, 38, 34], 'Where the conversation took place. Replace with your own photograph.', lType.caption),
        T('q2', 'Question 2', 'subheading', [18, 198, 38, 30], 'What comes next?', lType.q),
        T('a2', 'Answer 2', 'body', [62, 198, 130, 44], 'Finish the conversation on its last answer. A short one lands well here, followed by a small closing mark if you like.', lType.a),
        lFolio(),
      ],
    },
    {
      key: 'p12', label: 'Conversation two', role: 'chapter_opener', bg: L.paper, chapterId: 'ch_c2', master: mOpener,
      els: lOpenerFrames({
        kicker: 'Conversation two',
        name: 'Leader name',
        role: 'Title, Organisation',
        bio,
        intro: 'This conversation took place over two afternoons. Replace this with two sentences on where you talked and what you wanted to ask.',
      }),
    },
    {
      key: 'p13', label: 'Questions and answers', role: 'interview', bg: L.paper, chapterId: 'ch_c2', master: mQa,
      els: lQaFrames({ rh: 'Leader name', q: LQ, a: [LA.two, LA.one, LA.three] }),
    },
    {
      key: 'p14', label: 'Quote', role: 'quote_page', bg: L.plum, chapterId: 'ch_c2', master: mQuote,
      els: lQuoteFrames({
        quote: '“Choose the one sentence a reader should carry out of this conversation.”',
        attribution: 'Leader name, on decisions',
      }),
    },
    {
      key: 'p15', label: 'Quick answers', role: 'interview', bg: L.paper, chapterId: 'ch_close',
      els: [
        lRH('Quick answers'),
        T('heading', 'Heading', 'heading', [62, 24, 130, 16], 'Quick answers', lType.heading),
        T('question', 'The question', 'subheading', [62, 42, 130, 14], 'We asked every leader the same question: which book do you keep going back to?', { font: L.spectral, size: 11, italic: true, color: L.muted, lh: 1.4 }),
        ...quick(1, 18, 66, '“Title of a book. It taught me to listen before deciding.”'),
        ...quick(2, 108, 66, '“Title of a book, for the way it explains a hard idea simply.”'),
        ...quick(3, 18, 150, '“Title of a book. I read it again every January.”'),
        ...quick(4, 108, 150, '“Title of a book, because it is honest about failure.”'),
        lFolio(),
      ],
    },
    {
      key: 'p16', label: 'Between conversations', role: 'full_bleed_image', bg: L.paper, chapterId: 'ch_close',
      els: [IMG('photo', 'Full-bleed photograph', [-3, -3, 216, 276], 'pavilion', { alt: 'A long corridor of stone and timber in daylight', fx: 44, fy: 50 })],
    },
    {
      key: 'p17', label: 'Afterword', role: 'closing_page', bg: L.paper, chapterId: 'ch_close', master: mText,
      els: lTextFrames({
        rh: 'Leadership Conversations',
        heading: 'Afterword',
        note: 'Thanks to everyone who gave their time.',
        body:
          'Read side by side, the conversations in this book share more than their subjects expected. Most of them describe a decision made with too little information and defended long after it was made. Replace this afterword with what you learned from them, and what you would ask next time.\n\n' +
          'Thank the people who agreed to be interviewed, those who arranged the conversations, the photographers and everyone who helped make the book. A short paragraph of thanks is enough.',
        sign: 'Editor name\nEditor, Leadership Conversations',
      }),
    },
    {
      key: 'p18', label: 'Back cover', role: 'back_cover', bg: L.plum, chapterId: 'ch_close',
      els: [
        T('quote', 'Back cover quote', 'quote', [22, 66, 166, 60], '“The work of leading is mostly listening, then deciding, then explaining why.”', {
          font: L.spectral, size: 18, italic: true, color: L.paper, lh: 1.3, valign: 'bottom',
        }),
        T('attrib', 'Attribution', 'caption', [22, 130, 166, 6], 'Leader name, Conversation one', { font: L.archivo, size: 8.5, color: L.mauve, lh: 1.3 }),
        T('blurb', 'Back cover text', 'body', [22, 196, 120, 24],
          'Conversations with leaders about the decisions that shaped their organisations, and what they would do differently.',
          { font: L.archivo, size: 9, color: L.paper, lh: 1.5 }),
        T('publisher', 'Publisher', 'caption', [22, 240, 120, 6], 'Organisation name', { font: L.archivo, size: 8, color: L.mauve, lh: 1.3 }),
      ],
    },
  ]);
  return { pages, masters };
}

const LEADERSHIP: PremiumSpec = {
  id: LC_ID,
  name: 'Leadership Conversations',
  description:
    'Interviews with leaders: portrait-led openers with a short bio, question-and-answer pages with the questions in the margin, full-page quotes and a quick-answers page.',
  tagline: 'Portrait-led interviews with the questions in the margin and full-page plum quotes.',
  signature: 'Each conversation breaks for a full-page plum quote set large in Spectral italic.',
  tags: ['interviews', 'leaders', 'q&a', 'portraits', 'premium'],
  documentKind: 'book',
  coverImage: PREMIUM_PHOTOS.interior.url,
  dimensions: dims(LC.W, LC.H, { top: 18, bottom: 22, inner: 18, outer: 18 }, 5, 6, 4.5, 'Leadership Conversations 210 × 270'),
  designSystem: designSystem({
    name: 'Leadership Conversations',
    paper: L.paper,
    surface: L.surface,
    ink: L.ink,
    mutedInk: L.muted,
    accent: L.plum,
    secondary: L.mauve,
    extra: [WHITE],
    display: L.spectral,
    heading: L.spectral,
    body: L.spectral,
    caption: L.archivo,
    quote: L.spectral,
    numerical: L.archivo,
    scale: { displayPt: 36, headingPt: 26, subheadingPt: 8.5, bodyPt: 10, captionPt: 7.5, quotePt: 30, folioPt: 7.5 },
    minBodyPt: 9,
    baselineMm: 4.5,
    margins: { top: 18, bottom: 22, inner: 18, outer: 18 },
    columns: 5,
    gutterMm: 6,
  }),
  chapters: [
    { id: 'ch_open', number: 1, title: 'Opening', subtitle: 'Cover, title, contents and introduction', orderIndex: 0 },
    { id: 'ch_c1', number: 2, title: 'Conversation one: Leader name', orderIndex: 1 },
    { id: 'ch_c2', number: 3, title: 'Conversation two: Leader name', orderIndex: 2 },
    { id: 'ch_close', number: 4, title: 'Closing', subtitle: 'Quick answers and afterword', orderIndex: 3 },
  ],
  print: { bindingType: 'smyth_hardcover', paperStockName: '135 gsm uncoated natural white', coverBoardCaliperMm: 2.5, exportSpreads: true },
  showcase: [[0], [5, 6], [9, 10]],
  build: buildLeadership,
};

/* =====================================================================================================================
   3  LEGACY MONOGRAPH — 300 × 240 mm landscape. Cormorant Garamond and Source Serif 4 on archive-grey paper with
      verdigris. Archive photographs print in black and white, the present in colour. The one move: a running timeline
      along the foot of every page, its verdigris segment and era label marking where in the company's history you are.
   ===================================================================================================================== */

const LG_ID = 'tpl_premium_legacy_monograph';
const LG = { W: 300, H: 240 };
const G = {
  paper: '#F2F2EC',
  surface: '#E4E2DA',
  ink: '#211F1B',
  muted: '#706C63',
  verdigris: '#3B7368',
  archive: '#CFCABD',
  cormorant: 'Cormorant Garamond',
  serif: 'Source Serif 4',
};
/* the grid: 256 mm of text width in three columns; the timeline in three equal eras */
const GX = [22, 108.7, 195.3];
const GCOL = 82.7;
const ERA_X = [22, 107.33, 192.67];
const ERA_W = 85.33;

const gType = {
  era: { font: G.cormorant, size: 11, italic: true, color: G.verdigris, lh: 1.2, valign: 'bottom' } as TextOpts,
  folio: { font: G.serif, size: 8, color: G.muted, align: 'center', valign: 'middle', lh: 1.2 } as TextOpts,
  heading: { font: G.cormorant, size: 26, weight: 600, color: G.ink, lh: 1.05 } as TextOpts,
  stand: { font: G.cormorant, size: 16, italic: true, color: G.ink, lh: 1.3 } as TextOpts,
  body: { font: G.serif, size: 9.5, color: G.ink, lh: 1.55 } as TextOpts,
  caption: { font: G.serif, size: 8, italic: true, color: G.muted, lh: 1.45 } as TextOpts,
};

/** the running timeline: a hairline across the foot, the current era's segment and label, the page number below */
function gFoot(era: { label: string; at: 0 | 1 | 2 } | null): BookElement[] {
  const end = { font: G.serif, size: 7, color: G.muted, lh: 1.2, valign: 'middle' } as TextOpts;
  const out: BookElement[] = [
    RULE('tline', 'Timeline rule', [22, 217, 256], G.muted, 0.2, 0.55),
    RH('tstart', [22, 220, 50, 4.5], 'The founding', end, 'Timeline start'),
    RH('tend', [228, 220, 50, 4.5], 'Today', { ...end, align: 'right' }, 'Timeline end'),
  ];
  if (era) {
    out.push(RULE('tseg', 'Era marker', [ERA_X[era.at], 217, ERA_W], G.verdigris, 0.9));
    out.push(RH('rh', [ERA_X[era.at], 210.5, ERA_W, 5.5], era.label, gType.era, 'Era label'));
  }
  out.push(FOLIO([135, 222, 30, 5], gType.folio));
  return out;
}

const ERAS = {
  one: { label: 'Chapter one: The founding years', at: 0 as const },
  two: { label: 'Chapter two: Growth', at: 1 as const },
  three: { label: 'Chapter three: Today', at: 2 as const },
};

function gEssayFrames(c: { heading: string; stand: string; body: string; era: { label: string; at: 0 | 1 | 2 } | null }): BookElement[] {
  return [
    T('heading', 'Essay heading', 'heading', [22, 18, 170, 14], c.heading, gType.heading),
    T('stand', 'Standfirst', 'subheading', [GX[0], 40, GCOL, 120], c.stand, gType.stand),
    T('body', 'Body text (two columns)', 'body', [GX[1], 40, GCOL * 2 + 4, 160], c.body, { ...gType.body, cols: 2, gap: 4 }),
    ...gFoot(c.era),
  ];
}

function gOpenerFrames(c: { photo: PremiumPhotoKey; fx: number; fy: number; gray: boolean; alt: string; num: string; title: string; years: string; intro: string }): BookElement[] {
  return [
    IMG('photo', 'Chapter photograph', [-3, -3, 153, 246], c.photo, { alt: c.alt, fx: c.fx, fy: c.fy, gray: c.gray }),
    T('num', 'Chapter number', 'subheading', [166, 30, 112, 6], c.num, { font: G.serif, size: 9, color: G.verdigris, lh: 1.3, ls: 0.02 }),
    T('title', 'Chapter title', 'heading', [166, 40, 112, 50], c.title, { font: G.cormorant, size: 40, weight: 500, color: G.ink, lh: 1.0 }),
    T('years', 'Years covered', 'subheading', [166, 94, 112, 9], c.years, { font: G.cormorant, size: 17, italic: true, color: G.muted, lh: 1.2 }),
    T('intro', 'Chapter introduction', 'body', [166, 114, 112, 80], c.intro, gType.body),
    RULE('tline', 'Timeline rule', [166, 217, 112], G.muted, 0.2, 0.55),
  ];
}

function gArchiveFrames(c: { heading: string; cap1: string; cap2: string; era: { label: string; at: 0 | 1 | 2 } }): BookElement[] {
  return [
    T('heading', 'Heading', 'heading', [22, 18, 200, 14], c.heading, gType.heading),
    IMG('a1', 'Archive photograph 1', [22, 38, 126, 126], 'craft', { alt: 'The first workshop', fx: 62, fy: 40, gray: true }),
    IMG('a2', 'Archive photograph 2', [154, 38, 59, 60], 'doorway', { alt: 'The garden door', fx: 50, fy: 45, gray: true }),
    IMG('a3', 'Archive photograph 3', [219, 38, 59, 60], 'stair', { alt: 'The stair hall', fx: 48, fy: 40, gray: true }),
    IMG('a4', 'Archive photograph 4', [154, 104, 124, 60], 'courtyard', { alt: 'The courtyard', fx: 50, fy: 62, gray: true }),
    T('cap1', 'Caption 1', 'caption', [22, 168, 126, 20], c.cap1, gType.caption),
    T('cap2', 'Captions 2 to 4', 'caption', [154, 168, 124, 26], c.cap2, gType.caption),
    ...gFoot(c.era),
  ];
}

function gMilestoneFrames(c: {
  heading: string;
  items: Array<{ year: string; title: string; text: string }>;
  era: { label: string; at: 0 | 1 | 2 };
}): BookElement[] {
  const xs = [22, 87, 152, 217];
  const out: BookElement[] = [
    T('heading', 'Heading', 'heading', [22, 18, 200, 14], c.heading, gType.heading),
    RULE('line', 'Milestone line', [22, 41, 256], G.ink, 0.25, 0.45),
  ];
  c.items.forEach((it, i) => {
    const x = xs[i];
    out.push(
      DOT(`dot${i + 1}`, `Milestone ${i + 1} marker`, [x, 40, 3, 3], G.verdigris),
      T(`year${i + 1}`, `Milestone ${i + 1} year`, 'heading', [x, 48, 61, 12], it.year, { font: G.cormorant, size: 24, weight: 600, color: G.verdigris, lh: 1.0 }),
      T(`title${i + 1}`, `Milestone ${i + 1} title`, 'subheading', [x, 62, 61, 12], it.title, { font: G.serif, size: 10, weight: 600, color: G.ink, lh: 1.3 }),
      T(`text${i + 1}`, `Milestone ${i + 1} text`, 'body', [x, 76, 61, 56], it.text, { font: G.serif, size: 9, color: G.ink, lh: 1.5 }),
    );
  });
  out.push(IMG('band', 'Photograph band', [22, 140, 256, 62], 'pavilion', { alt: 'Light along the corridor', fx: 50, fy: 55, gray: true }));
  out.push(...gFoot(c.era));
  return out;
}

function gFullFrames(c: { photo: PremiumPhotoKey; fx: number; fy: number; alt: string }): BookElement[] {
  return [IMG('photo', 'Full-bleed photograph', [-3, -3, 306, 246], c.photo, { alt: c.alt, fx: c.fx, fy: c.fy })];
}

function buildLegacy(): { pages: BookPage[]; masters: MasterPage[] } {
  const essayBody =
    'Replace this with the chapter\'s story. Begin with a scene: a room, a date, a decision that could have gone another way. The two columns keep lines short enough to read comfortably across a wide page, and the standfirst beside them tells the reader where they are before the story starts.\n\n' +
    'Use the second paragraph for what changed, who made it happen and what it cost. Quote from letters, minutes or interviews where you can, and name your sources in the notes at the back. A history is more convincing when it admits the years that went badly as well as the ones that went well.\n\n' +
    'A third paragraph can follow one person through the period: a founder, an apprentice, a customer who stayed for decades. Readers remember people more readily than dates.\n\n' +
    'Close the period in a fourth, shorter paragraph, and hand the reader on to the next.';
  const milestoneItems = [
    { year: 'Year 1', title: 'The first workshop opens', text: 'One or two sentences on the moment, who was there and why it mattered. Replace with your own milestone.' },
    { year: 'Year 4', title: 'The first order from abroad', text: 'One or two sentences on the moment, who was there and why it mattered. Replace with your own milestone.' },
    { year: 'Year 9', title: 'A second site', text: 'One or two sentences on the moment, who was there and why it mattered. Replace with your own milestone.' },
    { year: 'Year 15', title: 'A new generation', text: 'One or two sentences on the moment, who was there and why it mattered. Replace with your own milestone.' },
  ];
  const masters = [
    makeMaster(LG_ID, 'm_essay', 'A — Essay page', 'three_column',
      'A heading, a standfirst in the first column, two columns of text and the running timeline at the foot.', G.paper,
      gEssayFrames({ heading: 'Essay heading', stand: 'A standfirst of two or three sentences that opens the essay.', body: essayBody, era: ERAS.one })),
    makeMaster(LG_ID, 'm_opener', 'B — Chapter opener', 'chapter_opener',
      'Half the page a full-height photograph, the other half the chapter number, title, years and introduction.', G.paper,
      gOpenerFrames({ photo: 'craft', fx: 62, fy: 40, gray: true, alt: 'An archive photograph', num: 'Chapter', title: 'Chapter title', years: 'Year to year', intro: 'Two or three sentences that introduce the chapter.' })),
    makeMaster(LG_ID, 'm_archive', 'C — Archive grid', 'image_gallery',
      'Four archive photographs in black and white, one large and three small, with catalogue captions.', G.paper,
      gArchiveFrames({ heading: 'From the archive', cap1: 'Caption, with the date and the archive reference.', cap2: 'Captions for the three photographs, in reading order.', era: ERAS.one })),
    makeMaster(LG_ID, 'm_milestones', 'D — Milestones', 'timeline',
      'Four milestones along a line, each with its year, a title and a short text, over a photograph band.', G.paper,
      gMilestoneFrames({ heading: 'Milestones', items: milestoneItems, era: ERAS.one })),
    makeMaster(LG_ID, 'm_full', 'E — Full-bleed photograph', 'full_bleed_image',
      'One photograph to the edges of the page.', G.paper,
      gFullFrames({ photo: 'alpine', fx: 28, fy: 50, alt: 'A full-bleed photograph' })),
  ];
  const [mEssay, mOpener, mArchive, mMilestones, mFull] = masters;

  const pages = makePages(LG_ID, [
    {
      key: 'p01', label: 'Front cover', role: 'front_cover', bg: G.paper, chapterId: 'ch_front',
      els: [
        IMG('photo', 'Cover photograph', [120, -3, 183, 246], 'sanctuary', { alt: 'A timber pavilion in a misty forest', fx: 50, fy: 55 }),
        T('title', 'Book title', 'display', [22, 34, 92, 64], 'A Legacy\nin the Making', { font: G.cormorant, size: 38, weight: 500, color: G.ink, lh: 1.0 }),
        T('sub', 'Subtitle', 'subheading', [22, 102, 86, 30], 'The story of Company name, from its first workshop to the present day', { font: G.serif, size: 11, italic: true, color: G.muted, lh: 1.4 }),
        RULE('rule', 'Cover rule', [22, 193, 24], G.verdigris, 0.5),
        T('company', 'Company name', 'heading', [22, 198, 92, 8], 'Company name', { font: G.cormorant, size: 14, weight: 600, color: G.ink, lh: 1.1 }),
        T('kind', 'Kind of book', 'caption', [22, 208, 92, 6], 'An anniversary history', { font: G.serif, size: 8.5, color: G.muted, lh: 1.2 }),
      ],
    },
    {
      key: 'p02', label: 'Copyright', role: 'copyright', bg: G.paper, chapterId: 'ch_front',
      els: [
        T('colophon', 'Copyright and colophon', 'caption', [22, 140, 120, 70],
          'A Legacy in the Making\nPublished by Company name for its anniversary\n\nText © Company name and the authors. Archive photographs © Company name unless noted. All rights reserved.\n\nSet in Cormorant Garamond and Source Serif 4.\nISBN to be added',
          { font: G.serif, size: 7.5, color: G.muted, lh: 1.6, valign: 'bottom' }),
      ],
    },
    {
      key: 'p03', label: 'Title page', role: 'title_page', bg: G.paper, chapterId: 'ch_front',
      els: [
        T('title', 'Book title', 'display', [40, 72, 220, 22], 'A Legacy in the Making', { font: G.cormorant, size: 36, weight: 500, color: G.ink, lh: 1.05, align: 'center' }),
        T('sub', 'Subtitle', 'subheading', [60, 98, 180, 14], 'The story of Company name, from its first workshop to the present day', { font: G.serif, size: 11, italic: true, color: G.muted, lh: 1.4, align: 'center' }),
        RULE('rule', 'Title rule', [138, 120, 24], G.verdigris, 0.5),
        T('company', 'Company name', 'heading', [40, 182, 220, 8], 'Company name', { font: G.cormorant, size: 13, weight: 600, color: G.ink, lh: 1.1, align: 'center' }),
        T('city', 'City', 'caption', [40, 192, 220, 6], 'City', { font: G.serif, size: 8, color: G.muted, lh: 1.2, align: 'center' }),
      ],
    },
    {
      key: 'p04', label: 'Contents', role: 'table_of_contents', bg: G.paper, chapterId: 'ch_front',
      els: [
        T('heading', 'Heading', 'heading', [22, 18, 166, 14], 'Contents', gType.heading),
        T('entries', 'Contents entries', 'body', [22, 42, 120, 66],
          'Foreword\nThe years at a glance\nChapter one: The founding years\nChapter two: Growth\nChapter three: Today\nThe next chapter',
          { font: G.cormorant, size: 15, color: G.ink, lh: 1.9 }),
        T('numbers', 'Contents page numbers', 'caption', [142, 42, 30, 66], '5\n6\n7\n11\n15\n17',
          { font: G.cormorant, size: 15, color: G.verdigris, lh: 1.9, align: 'right' }),
        IMG('photo', 'Contents photograph', [GX[2], 18, GCOL, 188], 'doorway', { alt: 'A doorway onto the garden', fx: 50, fy: 55 }),
        ...gFoot(null),
      ],
    },
    {
      key: 'p05', label: 'Foreword', role: 'foreword', bg: G.paper, chapterId: 'ch_front',
      els: [
        ...gEssayFrames({
          heading: 'Foreword',
          stand: 'A letter from the chair, written for the anniversary.',
          body:
            'Replace this with a foreword from the chair or the founding family. Say why the book was made now, who it is for and what the company hopes readers will take from its history.\n\n' +
            'A foreword can be personal: a first memory of the company, a person who shaped it, a lesson that has lasted. It need not repeat the history; the chapters tell the story in full.\n\n' +
            'Thank the people who opened their archives, gave interviews and checked the facts, and the families of those who are no longer here to read it.',
          era: null,
        }),
        T('sign', 'Signature', 'caption', [GX[0], 172, GCOL, 20], 'Name of the chair\nChair, Company name', { font: G.cormorant, size: 13, italic: true, color: G.ink, lh: 1.3 }),
      ],
    },
    {
      key: 'p06', label: 'The years at a glance', role: 'timeline', bg: G.paper, chapterId: 'ch_front',
      els: [
        T('heading', 'Heading', 'heading', [22, 18, 200, 14], 'The years at a glance', gType.heading),
        T('intro', 'Introduction', 'body', [22, 36, 170, 12], 'Seven moments from the company\'s history, each told in full in the chapters that follow.', { ...gType.body, color: G.muted }),
        CHART('chart', 'Timeline infographic', [22, 54, 256, 148], {
          id: 'premium_legacy_timeline',
          variant: 'milestone_zigzag',
          title: 'Seven moments',
          subtitle: 'From the founding to the anniversary',
          category: 'Timeline',
          font: G.serif,
          bg: G.paper,
          ink: G.ink,
          accent: G.verdigris,
          secondary: G.muted,
          items: [
            { label: 'Founded', value: 1, yearOrStep: 'Year 1', description: 'Add your date' },
            { label: 'First export', value: 4, yearOrStep: 'Year 4', description: 'Add your date' },
            { label: 'Second site', value: 9, yearOrStep: 'Year 9', description: 'Add your date' },
            { label: 'New generation', value: 15, yearOrStep: 'Year 15', description: 'Add your date' },
            { label: 'New headquarters', value: 24, yearOrStep: 'Year 24', description: 'Add your date' },
            { label: 'New products', value: 33, yearOrStep: 'Year 33', description: 'Add your date' },
            { label: 'Anniversary', value: 40, yearOrStep: 'Year 40', description: 'Add your date' },
          ],
        }),
        ...gFoot(null),
      ],
    },
    {
      key: 'p07', label: 'Chapter one', role: 'chapter_opener', bg: G.paper, chapterId: 'ch_1', master: mOpener,
      els: gOpenerFrames({
        photo: 'craft', fx: 62, fy: 40, gray: true, alt: 'The first workshop',
        num: 'Chapter one',
        title: 'The founding\nyears',
        years: 'Year 1 to Year 15',
        intro: 'How the company began: the people, the first workshop and the first customers. Replace with two or three sentences that set the scene for the chapter.',
      }),
    },
    {
      key: 'p08', label: 'Essay', role: 'three_column', bg: G.paper, chapterId: 'ch_1', master: mEssay,
      els: gEssayFrames({
        heading: 'A workshop and an idea',
        stand: 'It began in one room, with two people and an order they were not sure they could fill. Replace with your own opening.',
        body: essayBody,
        era: ERAS.one,
      }),
    },
    {
      key: 'p09', label: 'From the archive', role: 'image_gallery', bg: G.paper, chapterId: 'ch_1', master: mArchive,
      els: gArchiveFrames({
        heading: 'From the archive',
        cap1: 'The first workshop. Replace with an archive photograph, its date and the archive reference.',
        cap2: 'Above left: the garden door. Above right: the stair hall. Below: the courtyard. Replace each with an archive photograph and its reference.',
        era: ERAS.one,
      }),
    },
    {
      key: 'p10', label: 'Milestones', role: 'timeline', bg: G.paper, chapterId: 'ch_1', master: mMilestones,
      els: gMilestoneFrames({ heading: 'Milestones', items: milestoneItems, era: ERAS.one }),
    },
    {
      key: 'p11', label: 'Chapter two', role: 'chapter_opener', bg: G.paper, chapterId: 'ch_2', master: mOpener,
      els: gOpenerFrames({
        photo: 'courtyard', fx: 40, fy: 55, gray: true, alt: 'The courtyard of the second site',
        num: 'Chapter two',
        title: 'Growth',
        years: 'Year 16 to Year 30',
        intro: 'The years in which the company grew beyond its first home. Replace with two or three sentences that set the scene for the chapter.',
      }),
    },
    {
      key: 'p12', label: 'Essay with photograph', role: 'two_column', bg: G.paper, chapterId: 'ch_2',
      els: [
        T('heading', 'Essay heading', 'heading', [22, 18, 170, 14], 'Room to grow', gType.heading),
        T('body', 'Body text (two columns)', 'body', [GX[0], 40, GCOL * 2 + 4, 160], essayBody, { ...gType.body, cols: 2, gap: 4 }),
        IMG('photo', 'Photograph', [GX[2], 40, GCOL, 132], 'pavilion', { alt: 'The corridor of the new building', fx: 45, fy: 50 }),
        T('caption', 'Photograph caption', 'caption', [GX[2], 176, GCOL, 24], 'The corridor of the new building. Replace with your photograph and its date.', gType.caption),
        ...gFoot(ERAS.two),
      ],
    },
    {
      key: 'p13', label: 'Full-bleed photograph', role: 'full_bleed_image', bg: G.paper, chapterId: 'ch_2', master: mFull,
      els: gFullFrames({ photo: 'alpine', fx: 28, fy: 50, alt: 'A stone hut above the clouds' }),
    },
    {
      key: 'p14', label: 'Quote', role: 'quote_page', bg: G.paper, chapterId: 'ch_2',
      els: [
        T('quote', 'Quote', 'quote', [40, 54, 220, 92], '“We built things slowly, so that they would last.”', {
          font: G.cormorant, size: 34, italic: true, color: G.ink, lh: 1.15, align: 'center', valign: 'bottom',
        }),
        RULE('rule', 'Quote rule', [138, 154, 24], G.verdigris, 0.5),
        T('attrib', 'Attribution', 'caption', [40, 160, 220, 8], 'Founder name, in a letter to the first employees', { font: G.serif, size: 9, italic: true, color: G.muted, lh: 1.3, align: 'center' }),
        ...gFoot(ERAS.two),
      ],
    },
    {
      key: 'p15', label: 'Chapter three', role: 'chapter_opener', bg: G.paper, chapterId: 'ch_3', master: mOpener,
      els: gOpenerFrames({
        photo: 'pavilion', fx: 42, fy: 50, gray: false, alt: 'The headquarters today',
        num: 'Chapter three',
        title: 'Today',
        years: 'Year 31 to the present',
        intro: 'The company as it is now: its people, its places and the work it is proudest of. Replace with two or three sentences that set the scene for the chapter.',
      }),
    },
    {
      key: 'p16', label: 'Then and now', role: 'image_gallery', bg: G.paper, chapterId: 'ch_3',
      els: [
        T('heading', 'Heading', 'heading', [22, 18, 200, 14], 'Then and now', gType.heading),
        IMG('then', 'Then: archive photograph', [22, 38, 126, 150], 'doorway', { alt: 'The garden door, then', fx: 50, fy: 50, gray: true }),
        IMG('now', 'Now: photograph today', [152, 38, 126, 150], 'courtyard', { alt: 'The courtyard, now', fx: 50, fy: 55 }),
        T('cap_then', 'Then: caption', 'caption', [22, 192, 126, 12], 'Then: the garden door. Replace with an archive photograph.', gType.caption),
        T('cap_now', 'Now: caption', 'caption', [152, 192, 126, 12], 'Now: the courtyard today. Replace with a photograph of the same place.', gType.caption),
        ...gFoot(ERAS.three),
      ],
    },
    {
      key: 'p17', label: 'The next chapter', role: 'closing_page', bg: G.paper, chapterId: 'ch_3', master: mEssay,
      els: gEssayFrames({
        heading: 'The next chapter',
        stand: 'What the company has learned, and what it means to carry into the years ahead.',
        body:
          'Replace this with a closing essay: what has stayed the same since the first workshop, what has changed and what the company wants to be known for next.\n\n' +
          'Look ahead plainly. Name the work under way, the places the company hopes to reach and the questions it has not yet answered. A history that ends with an open question invites the reader to come back.\n\n' +
          'End with thanks to the people whose work fills these pages, and to everyone who will write the chapters still to come.',
        era: ERAS.three,
      }),
    },
    {
      key: 'p18', label: 'Back cover', role: 'back_cover', bg: G.surface, chapterId: 'ch_3',
      els: [
        T('title', 'Book title', 'heading', [40, 62, 220, 14], 'A Legacy in the Making', { font: G.cormorant, size: 22, italic: true, color: G.ink, lh: 1.1, align: 'center' }),
        T('blurb', 'Back cover text', 'body', [70, 84, 160, 30],
          'The story of a company told through its people, its places and its archive, published for its anniversary.',
          { ...gType.body, align: 'center' }),
        RULE('rule', 'Back cover rule', [138, 190, 24], G.verdigris, 0.5),
        T('company', 'Company name', 'caption', [40, 196, 220, 8], 'Company name', { font: G.cormorant, size: 12, weight: 600, color: G.ink, lh: 1.2, align: 'center' }),
      ],
    },
  ]);
  return { pages, masters };
}

const LEGACY: PremiumSpec = {
  id: LG_ID,
  name: 'Legacy Monograph',
  description:
    'A company history for an anniversary, in landscape: chapter openers, essays in three columns, an archive photo grid in black and white, milestones, a timeline and then-and-now pages.',
  tagline: 'A company history with a running timeline along the foot of every page.',
  signature: 'A running timeline along the foot of every page marks where in the company\'s history you are.',
  tags: ['history', 'anniversary', 'archive', 'timeline', 'premium'],
  documentKind: 'book',
  coverImage: PREMIUM_PHOTOS.sanctuary.url,
  dimensions: dims(LG.W, LG.H, { top: 18, bottom: 30, inner: 22, outer: 22 }, 12, 4, 4.4, 'Legacy Monograph 300 × 240 landscape'),
  designSystem: designSystem({
    name: 'Legacy Monograph',
    paper: G.paper,
    surface: G.surface,
    ink: G.ink,
    mutedInk: G.muted,
    accent: G.verdigris,
    secondary: G.archive,
    extra: [WHITE],
    display: G.cormorant,
    heading: G.cormorant,
    body: G.serif,
    caption: G.serif,
    quote: G.cormorant,
    numerical: G.cormorant,
    scale: { displayPt: 40, headingPt: 26, subheadingPt: 16, bodyPt: 9.5, captionPt: 8, quotePt: 34, folioPt: 8 },
    minBodyPt: 9,
    baselineMm: 4.4,
    margins: { top: 18, bottom: 30, inner: 22, outer: 22 },
    columns: 12,
    gutterMm: 4,
  }),
  chapters: [
    { id: 'ch_front', number: 1, title: 'Front matter', subtitle: 'Cover, title, contents, foreword and timeline', orderIndex: 0 },
    { id: 'ch_1', number: 2, title: 'Chapter one: The founding years', orderIndex: 1 },
    { id: 'ch_2', number: 3, title: 'Chapter two: Growth', orderIndex: 2 },
    { id: 'ch_3', number: 4, title: 'Chapter three: Today', orderIndex: 3 },
  ],
  print: { bindingType: 'smyth_hardcover', paperStockName: '150 gsm matt art', coverBoardCaliperMm: 2.5, exportSpreads: true },
  showcase: [[0], [5, 6], [7, 8]],
  build: buildLegacy,
};

/* =====================================================================================================================
   4  ARCHITECTURE & PLACE — 280 × 280 mm square. IBM Plex Sans alone, on white with no colour but the photographs'.
      Photographs fill a five-column image field; captions, plate numbers, the running head and the folio live in a
      44 mm column on the left of every page. The one move: each plate's number set large and light in that column,
      level with the top of its photograph.
   ===================================================================================================================== */

const AP_ID = 'tpl_premium_architecture_place';
const AP = { W: 280, H: 280 };
const P = {
  paper: '#FAFAF8',
  surface: '#ECECE8',
  ink: '#171717',
  muted: '#77776F',
  stone: '#9C978B',
  light: '#D9D7D0',
  plex: 'IBM Plex Sans',
};
/* the caption column and the image field */
const PCOL: [number, number] = [14, 44];
const PF = 64;
const PFW = 202;

const pType = {
  plateNo: { font: P.plex, size: 34, weight: 300, color: P.stone, lh: 1.1, ls: -0.02 } as TextOpts,
  caption: { font: P.plex, size: 8, color: P.muted, lh: 1.45 } as TextOpts,
  rh: { font: P.plex, size: 7, color: P.muted, lh: 1.2, valign: 'bottom' } as TextOpts,
  folio: { font: P.plex, size: 8, color: P.ink, lh: 1.2, valign: 'middle' } as TextOpts,
  heading: { font: P.plex, size: 24, weight: 300, color: P.ink, lh: 1.15 } as TextOpts,
  body: { font: P.plex, size: 9, color: P.ink, lh: 1.55 } as TextOpts,
};

const pPlateNo = (key: string, y: number, text: string) => RH(key, [PCOL[0], y - 2, PCOL[1], 17], text, pType.plateNo, 'Plate number');
const pFoot = (): BookElement[] => [
  RH('rh', [PCOL[0], 250, PCOL[1], 5], 'Architecture & Place', pType.rh),
  FOLIO([PCOL[0], 256, PCOL[1], 5], pType.folio),
];

function pPlateFrames(c: { photo: PremiumPhotoKey; fx: number; fy: number; alt: string; no: string; caption: string }): BookElement[] {
  return [
    IMG('photo', 'Plate photograph', [PF, 14, PFW, 246], c.photo, { alt: c.alt, fx: c.fx, fy: c.fy }),
    pPlateNo('no', 14, c.no),
    T('caption', 'Plate caption', 'caption', [PCOL[0], 32, PCOL[1], 64], c.caption, pType.caption),
    ...pFoot(),
  ];
}

function pGridFrames(c: {
  photos: Array<{ photo: PremiumPhotoKey; fx: number; fy: number; alt: string }>;
  no1: string;
  cap1: string;
  no2: string;
  cap2: string;
}): BookElement[] {
  const cells: Box[] = [
    [PF, 14, 99, 120],
    [PF + 103, 14, 99, 120],
    [PF, 140, 99, 120],
    [PF + 103, 140, 99, 120],
  ];
  return [
    ...cells.map((b, i) => IMG(`g${i + 1}`, `Grid photograph ${i + 1}`, b, c.photos[i].photo, { alt: c.photos[i].alt, fx: c.photos[i].fx, fy: c.photos[i].fy })),
    pPlateNo('no1', 14, c.no1),
    T('cap1', 'Captions, top row', 'caption', [PCOL[0], 32, PCOL[1], 64], c.cap1, pType.caption),
    pPlateNo('no2', 140, c.no2),
    T('cap2', 'Captions, bottom row', 'caption', [PCOL[0], 158, PCOL[1], 64], c.cap2, pType.caption),
    ...pFoot(),
  ];
}

function pTextFrames(c: { heading: string; note: string; body: string }): BookElement[] {
  return [
    T('heading', 'Heading', 'heading', [PF, 14, PFW, 22], c.heading, pType.heading),
    T('note', 'Margin note', 'caption', [PCOL[0], 44, PCOL[1], 60], c.note, pType.caption),
    T('body', 'Body text (two columns)', 'body', [PF, 44, PFW, 130], c.body, { ...pType.body, cols: 2, gap: 6 }),
    ...pFoot(),
  ];
}

function pFullFrames(c: { photo: PremiumPhotoKey; fx: number; fy: number; alt: string }): BookElement[] {
  return [IMG('photo', 'Full-bleed photograph', [-3, -3, 286, 286], c.photo, { alt: c.alt, fx: c.fx, fy: c.fy })];
}

function buildArchitecture(): { pages: BookPage[]; masters: MasterPage[] } {
  const plateCaption = (title: string) =>
    `${title}\nWhere and when the photograph was taken, and by whom. Replace with the building's name, place and year.`;
  const masters = [
    makeMaster(AP_ID, 'm_plate', 'A — Plate with caption', 'image_led',
      'One photograph filling the image field, its plate number large and light in the left column above its caption.', P.paper,
      pPlateFrames({ photo: 'interior', fx: 50, fy: 55, alt: 'A plate photograph', no: '00', caption: plateCaption('Plate title') })),
    makeMaster(AP_ID, 'm_text', 'B — Text page', 'two_column',
      'A light heading, two columns of text in the image field and a note in the left column.', P.paper,
      pTextFrames({ heading: 'Heading', note: 'A note in the margin.', body: 'Two columns of text. Replace with your own words.' })),
    makeMaster(AP_ID, 'm_grid', 'C — Four-plate grid', 'image_gallery',
      'Four photographs on the module grid, two plate numbers and their captions in the left column.', P.paper,
      pGridFrames({
        photos: [
          { photo: 'courtyard', fx: 50, fy: 55, alt: 'Grid photograph 1' },
          { photo: 'doorway', fx: 50, fy: 55, alt: 'Grid photograph 2' },
          { photo: 'stair', fx: 55, fy: 40, alt: 'Grid photograph 3' },
          { photo: 'sanctuary', fx: 50, fy: 60, alt: 'Grid photograph 4' },
        ],
        no1: '00–00',
        cap1: 'Left: plate title.\nRight: plate title.',
        no2: '00–00',
        cap2: 'Left: plate title.\nRight: plate title.',
      })),
    makeMaster(AP_ID, 'm_full', 'D — Full-bleed plate', 'full_bleed_image',
      'One photograph to the edges of the page; its caption goes in the index of plates.', P.paper,
      pFullFrames({ photo: 'pavilion', fx: 45, fy: 50, alt: 'A full-bleed plate' })),
  ];
  const [mPlate, mText, mGrid, mFull] = masters;

  const thumbs: Array<[PremiumPhotoKey, string, number, number]> = [
    ['interior', '01', 50, 60],
    ['pavilion', '02', 45, 50],
    ['courtyard', '03', 50, 55],
    ['doorway', '04', 50, 55],
    ['stair', '05', 55, 40],
    ['sanctuary', '06', 50, 60],
    ['sculpture', '08', 60, 50],
    ['alpine', '14', 28, 50],
  ];
  const thumbW = 47;
  const thumbGap = (PFW - thumbW * 4) / 3;

  const pages = makePages(AP_ID, [
    {
      key: 'p01', label: 'Front cover', role: 'front_cover', bg: P.paper, chapterId: 'ch_front',
      els: [
        IMG('photo', 'Cover photograph', [14, 14, 252, 196], 'courtyard', { alt: 'A concrete courtyard around a still pool', fx: 50, fy: 55 }),
        T('title', 'Book title', 'display', [14, 220, 200, 26], 'Architecture & Place', { font: P.plex, size: 28, weight: 300, color: P.ink, lh: 1.15 }),
        T('sub', 'Subtitle', 'subheading', [14, 249, 200, 7], 'Buildings, landscapes and the light between them', { font: P.plex, size: 9, color: P.muted, lh: 1.3 }),
      ],
    },
    {
      key: 'p02', label: 'Frontispiece', role: 'full_bleed_image', bg: P.paper, chapterId: 'ch_front', master: mFull,
      els: pFullFrames({ photo: 'sanctuary', fx: 50, fy: 58, alt: 'A timber pavilion in a misty forest' }),
    },
    {
      key: 'p03', label: 'Title page', role: 'title_page', bg: P.paper, chapterId: 'ch_front',
      els: [
        T('title', 'Book title', 'display', [PF, 110, PFW, 16], 'Architecture & Place', { font: P.plex, size: 30, weight: 300, color: P.ink, lh: 1.1 }),
        T('sub', 'Subtitle', 'subheading', [PF, 130, PFW, 8], 'Buildings, landscapes and the light between them', { font: P.plex, size: 10, color: P.muted, lh: 1.3 }),
        T('publisher', 'Publisher', 'caption', [PF, 250, PFW, 6], 'Organisation name', { ...pType.caption, valign: 'bottom' }),
      ],
    },
    {
      key: 'p04', label: 'Copyright', role: 'copyright', bg: P.paper, chapterId: 'ch_front',
      els: [
        T('colophon', 'Copyright and colophon', 'caption', [PF, 190, 160, 66],
          'Architecture & Place\nPublished by Organisation name, City\n\nText © the authors. Photographs © the photographers. Drawings © the architects. All rights reserved.\n\nSet in IBM Plex Sans.\nISBN to be added',
          { font: P.plex, size: 7.5, color: P.muted, lh: 1.6, valign: 'bottom' }),
      ],
    },
    {
      key: 'p05', label: 'Contents', role: 'table_of_contents', bg: P.paper, chapterId: 'ch_front',
      els: [
        T('heading', 'Heading', 'heading', [PF, 14, PFW, 22], 'Contents', pType.heading),
        T('entries', 'Contents entries', 'body', [PF, 44, 150, 80], 'Introduction\nPlates\nDetails\nDrawings\nIndex of plates\nCredits', { font: P.plex, size: 17, weight: 300, color: P.ink, lh: 1.6 }),
        T('numbers', 'Contents page numbers', 'caption', [PF + 150, 44, PFW - 150, 80], '6\n7\n12\n13\n16\n17', { font: P.plex, size: 17, weight: 300, color: P.stone, lh: 1.6, align: 'right' }),
        ...pFoot(),
      ],
    },
    {
      key: 'p06', label: 'Introduction', role: 'introduction', bg: P.paper, chapterId: 'ch_plates', master: mText,
      els: [
        ...pTextFrames({
          heading: 'Introduction',
          note: 'Plate numbers in the margin refer to the index at the back.',
          body:
            'This book looks at buildings through the places they stand in and the light they let in. Replace this introduction with your own: which buildings, why these, and what the reader should look for in the photographs that follow. A sentence on each building is enough here; the captions say the rest.\n\n' +
            'Keep the text short and let the plates carry the book. A second paragraph can explain how the photographs were made: in what season, at what time of day and with what kind of camera, and why the photographer chose to leave people out of most of them.\n\n' +
            'A third can say how the book is arranged. The plates come first, then details and drawings, then an index that gives every plate its building, place and year.\n\n' +
            'A last paragraph can thank the owners who opened their doors.',
        }),
        IMG('strip', 'Photograph band', [PF, 182, PFW, 68], 'stair', { alt: 'A spiral stair under an oculus', fx: 50, fy: 42 }),
        T('strip_cap', 'Photograph band caption', 'caption', [PCOL[0], 182, PCOL[1], 30], 'The stair hall, from below.', pType.caption),
      ],
    },
    {
      key: 'p07', label: 'Plate 01', role: 'image_led', bg: P.paper, chapterId: 'ch_plates', master: mPlate,
      els: pPlateFrames({ photo: 'interior', fx: 50, fy: 60, alt: 'A salon with arched windows', no: '01', caption: plateCaption('Salon with arched windows') }),
    },
    {
      key: 'p08', label: 'Plate 02', role: 'full_bleed_image', bg: P.paper, chapterId: 'ch_plates', master: mFull,
      els: pFullFrames({ photo: 'pavilion', fx: 44, fy: 50, alt: 'A corridor of stone and timber' }),
    },
    {
      key: 'p09', label: 'Plates 03–06', role: 'image_gallery', bg: P.paper, chapterId: 'ch_plates', master: mGrid,
      els: pGridFrames({
        photos: [
          { photo: 'courtyard', fx: 50, fy: 55, alt: 'Courtyard and pool' },
          { photo: 'doorway', fx: 50, fy: 55, alt: 'Garden doorway' },
          { photo: 'stair', fx: 55, fy: 40, alt: 'Spiral stair' },
          { photo: 'sanctuary', fx: 50, fy: 60, alt: 'Forest pavilion' },
        ],
        no1: '03–04',
        cap1: 'Left: courtyard and pool, morning.\nRight: the garden door.',
        no2: '05–06',
        cap2: 'Left: the spiral stair.\nRight: the pavilion in mist.',
      }),
    },
    {
      key: 'p10', label: 'Thresholds', role: 'image_led', bg: P.paper, chapterId: 'ch_plates',
      els: [
        T('heading', 'Heading', 'heading', [PF, 14, PFW, 22], 'Thresholds', pType.heading),
        T('body', 'Body text', 'body', [PF, 44, 98, 200],
          'Every building in this book is entered through a threshold that slows the visitor down: a door, a step, a change of light. Replace this with an essay of your own.\n\n' +
          'One column of text beside a tall photograph lets the words and the picture be read together. Keep the essay to two or three paragraphs.',
          pType.body),
        IMG('photo', 'Tall photograph', [PF + 103, 44, 99, 216], 'doorway', { alt: 'A doorway onto a garden path', fx: 50, fy: 55 }),
        pPlateNo('no', 44, '07'),
        T('caption', 'Photograph caption', 'caption', [PCOL[0], 62, PCOL[1], 50], 'The garden door, looking out. Replace with your caption.', pType.caption),
        ...pFoot(),
      ],
    },
    {
      key: 'p11', label: 'Plate 08', role: 'image_led', bg: P.paper, chapterId: 'ch_plates', master: mPlate,
      els: pPlateFrames({ photo: 'sculpture', fx: 60, fy: 55, alt: 'A gallery with a sculpture on a plinth', no: '08', caption: plateCaption('Gallery with plinth') }),
    },
    {
      key: 'p12', label: 'Details', role: 'image_gallery', bg: P.paper, chapterId: 'ch_details',
      els: [
        IMG('d1', 'Detail photograph 1', [PF, 14, 64, 150], 'stair', { alt: 'The stair rail', fx: 62, fy: 50 }),
        IMG('d2', 'Detail photograph 2', [PF + 69, 14, 64, 150], 'courtyard', { alt: 'The olive tree in the courtyard', fx: 84, fy: 55 }),
        IMG('d3', 'Detail photograph 3', [PF + 138, 14, 64, 150], 'pavilion', { alt: 'Timber fins', fx: 82, fy: 50 }),
        pPlateNo('no', 14, '09–11'),
        T('caption', 'Detail captions', 'caption', [PCOL[0], 32, PCOL[1], 64], 'Left to right: the stair rail, the olive tree, the timber fins.', pType.caption),
        T('heading', 'Details heading', 'heading', [PF, 172, PFW, 9], 'Details', { font: P.plex, size: 11, weight: 500, color: P.ink, lh: 1.2 }),
        T('body', 'Details text (two columns)', 'body', [PF, 184, PFW, 62],
          'Close views of the materials and joints that make the buildings what they are. Replace this with a short note on each detail.\n\nSay what the material is, where it came from and how it has aged.',
          { ...pType.body, cols: 2, gap: 6 }),
        ...pFoot(),
      ],
    },
    {
      key: 'p13', label: 'Drawings', role: 'image_led', bg: P.paper, chapterId: 'ch_details',
      els: [
        ...EMPTY('drawing1', DRAWING_FRAME_NAME, [PF, 14, PFW, 118], P.surface, 'Ground floor plan'),
        ...EMPTY('drawing2', DRAWING_FRAME_NAME, [PF, 138, PFW, 122], P.surface, 'Long section'),
        pPlateNo('no1', 14, '12'),
        T('cap1', 'Drawing 1 caption', 'caption', [PCOL[0], 32, PCOL[1], 40], 'Ground floor plan.\nAdd the scale and the date of the drawing.', pType.caption),
        pPlateNo('no2', 138, '13'),
        T('cap2', 'Drawing 2 caption', 'caption', [PCOL[0], 156, PCOL[1], 40], 'Long section.\nAdd the scale and the date of the drawing.', pType.caption),
        ...pFoot(),
      ],
    },
    {
      key: 'p14', label: 'Plate 14', role: 'full_bleed_image', bg: P.paper, chapterId: 'ch_details', master: mFull,
      els: pFullFrames({ photo: 'alpine', fx: 28, fy: 50, alt: 'A stone hut above the clouds' }),
    },
    {
      key: 'p15', label: 'Quote', role: 'quote_page', bg: P.paper, chapterId: 'ch_details',
      els: [
        T('quote', 'Quote', 'quote', [PF, 80, 190, 74], '“A building is finished only when the light has somewhere to go.”', { font: P.plex, size: 30, weight: 300, color: P.ink, lh: 1.2, valign: 'bottom' }),
        T('attrib', 'Attribution', 'caption', [PF, 160, 190, 6], 'Architect name', { font: P.plex, size: 8.5, color: P.muted, lh: 1.3 }),
        ...pFoot(),
      ],
    },
    {
      key: 'p16', label: 'Index of plates', role: 'image_gallery', bg: P.paper, chapterId: 'ch_back',
      els: [
        T('heading', 'Heading', 'heading', [PF, 14, PFW, 22], 'Index of plates', pType.heading),
        ...thumbs.map(([photo, no, fx, fy], i) =>
          IMG(`t${i + 1}`, `Index photograph ${no}`, [PF + (i % 4) * (thumbW + thumbGap), 44 + Math.floor(i / 4) * 53, thumbW, thumbW], photo, { alt: `Plate ${no}`, fx, fy }),
        ),
        T('list', 'Index of plates (two columns)', 'caption', [PF, 152, PFW, 70],
          '01  Salon with arched windows\n02  Corridor of stone and timber\n03  Courtyard and pool\n04  The garden door\n05  The spiral stair\n06  The pavilion in mist\n07  The garden door, looking out\n' +
          '08  Gallery with plinth\n09  The stair rail\n10  The olive tree\n11  Timber fins\n12  Ground floor plan\n13  Long section\n14  Stone hut above the clouds',
          { font: P.plex, size: 8, color: P.ink, lh: 1.6, cols: 2, gap: 6 }),
        ...pFoot(),
      ],
    },
    {
      key: 'p17', label: 'Credits', role: 'closing_page', bg: P.paper, chapterId: 'ch_back', master: mText,
      els: pTextFrames({
        heading: 'Credits',
        note: 'Thanks to the owners who opened their doors.',
        body:
          'Photography\nPhotographer name\n\nText\nWriter name\n\nDrawings\nArchitect name\n\nDesign\nStudio name\n\nEditing\nEditor name\n\n' +
          'Thanks\nReplace these lines with the people who made the book, and thank the owners, the architects and everyone who helped with access.',
      }),
    },
    {
      key: 'p18', label: 'Back cover', role: 'back_cover', bg: P.paper, chapterId: 'ch_back',
      els: [
        IMG('photo', 'Back cover photograph', [PF, 14, PFW, 150], 'sculpture', { alt: 'A gallery with a sculpture on a plinth', fx: 60, fy: 60 }),
        T('blurb', 'Back cover text', 'body', [PF, 176, 150, 28], 'Fourteen plates, drawings and short essays on buildings and the places they stand in.', { font: P.plex, size: 9.5, color: P.ink, lh: 1.5 }),
        T('publisher', 'Publisher', 'caption', [PF, 250, 150, 6], 'Organisation name', { ...pType.caption, valign: 'bottom' }),
      ],
    },
  ]);
  return { pages, masters };
}

const ARCHITECTURE: PremiumSpec = {
  id: AP_ID,
  name: 'Architecture & Place',
  description:
    'An image-led square book on buildings and places: plates on a module grid with captions and plate numbers in the margin, full-bleed photographs, details, drawings and an index of plates.',
  tagline: 'Square, image-led plates on a module grid, captions and plate numbers in the margin.',
  signature: 'Each plate\'s number is set large and light in the margin column, level with the top of its photograph.',
  tags: ['architecture', 'photography', 'square', 'plates', 'premium'],
  documentKind: 'book',
  coverImage: PREMIUM_PHOTOS.courtyard.url,
  dimensions: dims(AP.W, AP.H, { top: 14, bottom: 20, inner: 14, outer: 14 }, 6, 6, 4, 'Architecture & Place 280 × 280 square'),
  designSystem: designSystem({
    name: 'Architecture & Place',
    paper: P.paper,
    surface: P.surface,
    ink: P.ink,
    mutedInk: P.muted,
    accent: P.stone,
    secondary: P.light,
    extra: [WHITE],
    display: P.plex,
    heading: P.plex,
    body: P.plex,
    caption: P.plex,
    quote: P.plex,
    numerical: P.plex,
    scale: { displayPt: 30, headingPt: 24, subheadingPt: 11, bodyPt: 9, captionPt: 8, quotePt: 24, folioPt: 8 },
    minBodyPt: 8.5,
    baselineMm: 4,
    margins: { top: 14, bottom: 20, inner: 14, outer: 14 },
    columns: 6,
    gutterMm: 6,
  }),
  chapters: [
    { id: 'ch_front', number: 1, title: 'Front matter', orderIndex: 0 },
    { id: 'ch_plates', number: 2, title: 'Plates', orderIndex: 1 },
    { id: 'ch_details', number: 3, title: 'Details and drawings', orderIndex: 2 },
    { id: 'ch_back', number: 4, title: 'Index and credits', orderIndex: 3 },
  ],
  print: { bindingType: 'smyth_hardcover', paperStockName: '170 gsm matt art', coverBoardCaliperMm: 2.5, exportSpreads: true },
  showcase: [[0], [5, 6], [7, 8]],
  build: buildArchitecture,
};

/* =====================================================================================================================
   5  IMPACT REPORT — 220 × 280 mm. Fraunces and Figtree on cool white. Each section owns a colour (overview ink,
      environment teal, people ochre, governance slate). The one move: that colour runs as a band across the head of
      every page in the section, and grows into the top half of the section's opener. Data pages use live charts.
   ===================================================================================================================== */

const IR_ID = 'tpl_premium_impact_report';
const IR = { W: 220, H: 280 };
const R = {
  paper: '#F7F8F6',
  surface: '#E5EDE9',
  ink: '#13292C',
  muted: '#5B6D6F',
  teal: '#0E6B63',
  ochre: '#D8A43A',
  slate: '#4D5A8E',
  paleTeal: '#CFE3DE',
  paleOchre: '#F4E6C4',
  paleSlate: '#DADFF0',
  fraunces: 'Fraunces',
  figtree: 'Figtree',
};

interface Section {
  name: string;
  color: string;
  /** text on the section colour */
  on: string;
  /** quieter text on the section colour */
  onMuted: string;
}
const SECTIONS: Record<'overview' | 'environment' | 'people' | 'governance', Section> = {
  overview: { name: 'Overview', color: R.ink, on: WHITE, onMuted: R.paleTeal },
  environment: { name: 'Environment', color: R.teal, on: WHITE, onMuted: R.paleTeal },
  people: { name: 'People', color: R.ochre, on: R.ink, onMuted: R.ink },
  governance: { name: 'Governance', color: R.slate, on: WHITE, onMuted: R.paleSlate },
};

const rType = {
  heading: { font: R.fraunces, size: 22, color: R.ink, lh: 1.15 } as TextOpts,
  body: { font: R.figtree, size: 9.5, color: R.ink, lh: 1.55 } as TextOpts,
  stand: { font: R.figtree, size: 10, color: R.muted, lh: 1.45 } as TextOpts,
  caption: { font: R.figtree, size: 7.5, color: R.muted, lh: 1.45 } as TextOpts,
  folio: { font: R.figtree, size: 8, color: R.muted, align: 'center', valign: 'middle', lh: 1.2 } as TextOpts,
};

const rBand = (s: Section): BookElement[] => [
  RECT('band', 'Section band', [-3, -3, 226, 15], s.color),
  RH('rh', [18, 3.5, 140, 6], s.name, { font: R.figtree, size: 8, weight: 600, color: s.on, ls: 0.04, lh: 1.2, valign: 'middle' }),
];
const rFolio = () => FOLIO([95, 264, 30, 5], rType.folio);

function rChart(s: Section, o: Omit<ChartOpts, 'font' | 'bg' | 'ink' | 'accent' | 'secondary' | 'category'> & { secondary?: string }): ChartOpts {
  return { ...o, category: s.name, font: R.figtree, bg: R.paper, ink: R.ink, accent: s.color, secondary: o.secondary ?? R.muted };
}

function rTextFrames(c: { section: Section; heading: string; note: string; body: string }): BookElement[] {
  return [
    ...rBand(c.section),
    T('heading', 'Heading', 'heading', [18, 24, 184, 14], c.heading, rType.heading),
    T('note', 'Margin note', 'caption', [18, 44, 56, 60], c.note, { font: R.figtree, size: 8.5, color: R.muted, lh: 1.5 }),
    T('body', 'Body text', 'body', [82, 44, 120, 160], c.body, { font: R.figtree, size: 10, color: R.ink, lh: 1.6 }),
    rFolio(),
  ];
}

function rOpenerFrames(c: { section: Section; number: string; intro: string; list: string }): BookElement[] {
  const s = c.section;
  return [
    RECT('field', 'Section colour field', [-3, -3, 226, 143], s.color),
    T('kicker', 'Section number', 'subheading', [18, 22, 184, 6], c.number, { font: R.figtree, size: 8.5, weight: 600, color: s.onMuted, lh: 1.3 }),
    T('name', 'Section name', 'display', [18, 76, 184, 52], s.name, { font: R.fraunces, size: 50, color: s.on, lh: 1.0, valign: 'bottom' }),
    T('intro', 'Section introduction', 'subheading', [18, 152, 124, 56], c.intro, { font: R.fraunces, size: 14, color: R.ink, lh: 1.35 }),
    T('list', 'In this section', 'caption', [150, 152, 52, 50], c.list, { font: R.figtree, size: 8.5, color: R.muted, lh: 1.65 }),
    rFolio(),
  ];
}

function rDataFrames(c: { section: Section; heading: string; stand: string; chart: ChartOpts; note: string }): BookElement[] {
  return [
    ...rBand(c.section),
    T('heading', 'Heading', 'heading', [18, 24, 184, 14], c.heading, rType.heading),
    T('stand', 'Standfirst', 'subheading', [18, 40, 150, 14], c.stand, rType.stand),
    CHART('chart', 'Chart', [18, 60, 184, 132], c.chart),
    T('note', 'What the figures show (two columns)', 'body', [18, 200, 184, 52], c.note, { ...rType.body, size: 9, cols: 2, gap: 6 }),
    rFolio(),
  ];
}

function rCaseFrames(c: { section: Section; title: string; photo: PremiumPhotoKey; fx: number; fy: number; alt: string; caption: string; body: string }): BookElement[] {
  const s = c.section;
  return [
    ...rBand(s),
    T('kicker', 'Case study label', 'subheading', [18, 24, 184, 6], 'Case study', { font: R.figtree, size: 8.5, weight: 600, color: s === SECTIONS.people ? R.ink : s.color, lh: 1.3 }),
    T('title', 'Case study title', 'heading', [18, 32, 184, 20], c.title, rType.heading),
    IMG('photo', 'Case study photograph', [18, 56, 184, 104], c.photo, { alt: c.alt, fx: c.fx, fy: c.fy }),
    T('caption', 'Photograph caption', 'caption', [18, 162, 184, 6], c.caption, rType.caption),
    T('body', 'Case study text (two columns)', 'body', [18, 174, 184, 76], c.body, { ...rType.body, cols: 2, gap: 6 }),
    rFolio(),
  ];
}

function buildImpact(): { pages: BookPage[]; masters: MasterPage[] } {
  const S = SECTIONS;
  const note =
    'Say what the figures show and why they moved. Name the period they cover and any change in how they were measured.\n\n' +
    'Every figure on this page is a sample. Replace each one with your own data before printing.';
  const caseBody =
    'Describe the project in two short paragraphs: the problem it set out to solve, where it took place, who took part and what was done. Name the partners and the people who led it, with their permission.\n\n' +
    'Then say what changed as a result and how you know: what was measured, before and after, and by whom. Say what you would do differently next time. Keep claims to what you can show, and point to the methodology at the back for how the figures were gathered.';
  const masters = [
    makeMaster(IR_ID, 'm_text', 'A — Report text page', 'editorial_text',
      'The section band, a heading, a note in the margin and one column of text.', R.paper,
      rTextFrames({ section: S.overview, heading: 'Heading', note: 'A note in the margin.', body: 'One column of text. Replace with your own words.' })),
    makeMaster(IR_ID, 'm_opener', 'B — Section opener', 'section_divider',
      'The section colour across the top half with the section\'s name, then an introduction and what the section holds.', R.paper,
      rOpenerFrames({ section: S.environment, number: 'Section', intro: 'Two sentences that introduce the section.', list: 'In this section\nTopic\nTopic\nTopic' })),
    makeMaster(IR_ID, 'm_data', 'C — Data page', 'infographic',
      'The section band, a heading and standfirst, a live chart and two columns on what the figures show.', R.paper,
      rDataFrames({
        section: S.environment,
        heading: 'Heading',
        stand: 'One sentence on what the chart shows.',
        chart: rChart(S.environment, {
          id: 'premium_impact_data', variant: 'vertical_bars', title: 'Chart title', subtitle: 'What is measured, and over what period',
          items: [
            { label: 'Item one', value: 40 },
            { label: 'Item two', value: 30 },
            { label: 'Item three', value: 20 },
            { label: 'Item four', value: 10 },
          ],
        }),
        note,
      })),
    makeMaster(IR_ID, 'm_case', 'D — Case study', 'case_study',
      'The section band, a case-study title, a wide photograph and two columns of text.', R.paper,
      rCaseFrames({ section: S.environment, title: 'Case study title', photo: 'courtyard', fx: 50, fy: 60, alt: 'A case study photograph', caption: 'Caption for the photograph.', body: caseBody })),
  ];
  const [mText, mOpener, mData, mCase] = masters;

  const contentsBlock = (i: number, y: number, s: Section, items: string, page: string): BookElement[] => [
    RECT(`sq${i}`, `${s.name} colour key`, [18, y + 1.2, 6, 6], s.color),
    T(`sec${i}`, `${s.name} entry`, 'heading', [30, y, 140, 9], s.name, { font: R.fraunces, size: 15, color: R.ink, lh: 1.1 }),
    T(`items${i}`, `${s.name} topics`, 'body', [30, y + 11, 140, 24], items, { font: R.figtree, size: 9, color: R.muted, lh: 1.55 }),
    T(`page${i}`, `${s.name} page number`, 'caption', [176, y, 26, 9], page, { font: R.fraunces, size: 15, color: R.ink, lh: 1.1, align: 'right' }),
  ];

  const pages = makePages(IR_ID, [
    {
      key: 'p01', label: 'Front cover', role: 'front_cover', bg: R.teal, chapterId: 'ch_overview',
      els: [
        IMG('photo', 'Cover photograph', [-3, -3, 226, 172], 'alpine', { alt: 'A stone hut on a ridge above the clouds', fx: 28, fy: 55 }),
        RECT('field', 'Cover colour field', [-3, 169, 226, 114], R.teal),
        T('title', 'Report title', 'display', [18, 182, 184, 20], 'Impact Report', { font: R.fraunces, size: 44, color: WHITE, lh: 1.0 }),
        T('org', 'Organisation and year', 'subheading', [18, 208, 184, 7], 'Organisation name, 2026', { font: R.figtree, size: 10, weight: 600, color: R.paleTeal, lh: 1.2 }),
        T('sub', 'Subtitle', 'body', [18, 222, 150, 22], 'How our work affected the environment, our people and the way we are governed, and what we will do next.', { font: R.figtree, size: 9.5, color: WHITE, lh: 1.45 }),
      ],
    },
    {
      key: 'p02', label: 'Contents', role: 'table_of_contents', bg: R.paper, chapterId: 'ch_overview',
      els: [
        ...rBand(S.overview),
        T('heading', 'Heading', 'heading', [18, 24, 184, 14], 'Contents', rType.heading),
        ...contentsBlock(1, 52, S.overview, 'A message from the chief executive\nThe year in numbers', '3'),
        ...contentsBlock(2, 96, S.environment, 'Energy, water and materials\nCase study', '5'),
        ...contentsBlock(3, 140, S.people, 'What our people told us\nCase study', '9'),
        ...contentsBlock(4, 184, S.governance, 'The board, targets and methodology', '12'),
        T('legend', 'Colour key note', 'caption', [18, 236, 150, 12], 'Each section keeps its colour in the band at the top of its pages.', rType.caption),
        rFolio(),
      ],
    },
    {
      key: 'p03', label: 'A message from the chief executive', role: 'foreword', bg: R.paper, chapterId: 'ch_overview',
      els: [
        ...rBand(S.overview),
        T('heading', 'Heading', 'heading', [18, 24, 184, 14], 'A message from the chief executive', rType.heading),
        ...PORTRAIT('portrait', [18, 44, 56, 72], R.surface, 'Portrait of the chief executive'),
        T('name', 'Signature name', 'heading', [18, 120, 56, 7], 'Name', { font: R.fraunces, size: 12, color: R.ink, lh: 1.15 }),
        T('role', 'Signature title', 'caption', [18, 128, 56, 12], 'Chief executive, Organisation name', rType.caption),
        T('body', 'Message', 'body', [82, 44, 120, 170],
          'Replace this with a message from the chief executive: what the year was like, what the organisation set out to change and where it fell short.\n\n' +
          'Be specific and plain. Name one result you are proud of and one you are not, and say what you will do about it. Readers trust a report that admits what did not work, and they notice when every number on every page has gone up.\n\n' +
          'Explain how this report is organised: the year in numbers first, then a section each on the environment, our people and the way we are governed, each with its own colour. The methodology at the back says where every figure came from.\n\n' +
          'Close with thanks to the people who did the work, and a sentence on what the next report should be able to show.',
          { font: R.figtree, size: 10, color: R.ink, lh: 1.6 }),
        rFolio(),
      ],
    },
    {
      key: 'p04', label: 'The year in numbers', role: 'infographic', bg: R.paper, chapterId: 'ch_overview', master: mData,
      els: rDataFrames({
        section: S.overview,
        heading: 'The year in numbers',
        stand: 'Six measures we report every year. Every figure on this page is a sample.',
        chart: rChart(S.overview, {
          id: 'premium_impact_kpis', variant: 'kpi_grid', title: 'Six measures, one year', subtitle: 'Every figure is a sample', secondary: R.teal,
          items: [
            { label: 'Renewable electricity', value: 60, unit: '%', category: 'Energy', description: 'Share of electricity used', color: R.teal },
            { label: 'Water reused', value: 40, unit: '%', category: 'Water', description: 'Share of water used again', color: R.teal },
            { label: 'Waste recovered', value: 75, unit: '%', category: 'Materials', description: 'Share kept from landfill', color: R.teal },
            { label: 'Training hours', value: 20, unit: 'k', category: 'People', description: 'Hours across all staff', color: R.ochre },
            { label: 'Staff survey', value: 80, unit: '%', category: 'People', description: 'Took part in the survey', color: R.ochre },
            { label: 'Independent board', value: 60, unit: '%', category: 'Governance', description: 'Independent directors', color: R.slate },
          ],
        }),
        note,
      }),
    },
    {
      key: 'p05', label: 'Environment', role: 'section_divider', bg: R.paper, chapterId: 'ch_env', master: mOpener,
      els: rOpenerFrames({
        section: S.environment,
        number: 'Section one',
        intro: 'How we used energy, water and materials this year, and where we fell short of what we set out to do.',
        list: 'In this section\nEnergy\nWater\nMaterials\nCase study',
      }),
    },
    {
      key: 'p06', label: 'Energy', role: 'infographic', bg: R.paper, chapterId: 'ch_env', master: mData,
      els: rDataFrames({
        section: S.environment,
        heading: 'Energy',
        stand: 'Where the electricity and fuel we used came from. Sample figures.',
        chart: rChart(S.environment, {
          id: 'premium_impact_energy', variant: 'donut_ring', title: 'Where our energy came from', subtitle: 'Share of all energy used, by source', secondary: R.ochre,
          items: [
            { label: 'Renewable electricity', value: 40, unit: '%' },
            { label: 'Grid electricity', value: 35, unit: '%' },
            { label: 'Natural gas', value: 15, unit: '%' },
            { label: 'Other fuels', value: 10, unit: '%' },
          ],
        }),
        note,
      }),
    },
    {
      key: 'p07', label: 'Water and materials', role: 'infographic', bg: R.paper, chapterId: 'ch_env',
      els: [
        ...rBand(S.environment),
        T('heading', 'Heading', 'heading', [18, 24, 184, 14], 'Water and materials', rType.heading),
        CHART('chart1', 'Chart: water', [18, 44, 184, 102], rChart(S.environment, {
          id: 'premium_impact_water', variant: 'horizontal_bars', title: 'Water used by site', subtitle: 'Million litres, sample figures',
          items: [
            { label: 'Site one', value: 120 },
            { label: 'Site two', value: 90 },
            { label: 'Site three', value: 70 },
            { label: 'Site four', value: 50 },
            { label: 'Site five', value: 30 },
          ],
        })),
        CHART('chart2', 'Chart: materials', [18, 152, 184, 100], rChart(S.environment, {
          id: 'premium_impact_materials', variant: 'radial_gauges', title: 'Materials recovered', subtitle: 'Share kept from landfill, sample figures', secondary: R.slate,
          items: [
            { label: 'Paper', value: 90, unit: '%', description: 'Recycled' },
            { label: 'Metals', value: 80, unit: '%', description: 'Recycled' },
            { label: 'Plastics', value: 50, unit: '%', description: 'Recycled' },
            { label: 'Food waste', value: 30, unit: '%', description: 'Composted' },
          ],
        })),
        rFolio(),
      ],
    },
    {
      key: 'p08', label: 'Case study', role: 'case_study', bg: R.paper, chapterId: 'ch_env', master: mCase,
      els: rCaseFrames({
        section: S.environment,
        title: 'Rebuilding with local stone and timber',
        photo: 'courtyard', fx: 50, fy: 60, alt: 'A courtyard built from local stone',
        caption: 'Replace with a photograph of the project and say where and when it was taken.',
        body: caseBody,
      }),
    },
    {
      key: 'p09', label: 'People', role: 'section_divider', bg: R.paper, chapterId: 'ch_people', master: mOpener,
      els: rOpenerFrames({
        section: S.people,
        number: 'Section two',
        intro: 'What it was like to work here this year, in our people\'s own words and in the measures we track.',
        list: 'In this section\nWhat people told us\nTraining\nCase study',
      }),
    },
    {
      key: 'p10', label: 'What our people told us', role: 'infographic', bg: R.paper, chapterId: 'ch_people', master: mData,
      els: rDataFrames({
        section: S.people,
        heading: 'What our people told us',
        stand: 'Share of staff who agreed with each statement in the yearly survey. Sample figures.',
        chart: rChart(S.people, {
          id: 'premium_impact_survey', variant: 'survey_bars', title: 'Share who agreed with each statement', subtitle: 'Yearly staff survey, sample figures', secondary: R.teal,
          items: [
            { label: 'I am proud to work here', value: 80, unit: '%' },
            { label: 'I can grow here', value: 70, unit: '%' },
            { label: 'My manager listens', value: 65, unit: '%' },
            { label: 'Workload is fair', value: 55, unit: '%' },
            { label: 'Decisions are explained', value: 45, unit: '%' },
          ],
        }),
        note,
      }),
    },
    {
      key: 'p11', label: 'Case study', role: 'case_study', bg: R.paper, chapterId: 'ch_people', master: mCase,
      els: rCaseFrames({
        section: S.people,
        title: 'A skills programme with local craftspeople',
        photo: 'craft', fx: 55, fy: 45, alt: 'A ceramics workshop',
        caption: 'Replace with a photograph of the programme and say where and when it was taken.',
        body: caseBody,
      }),
    },
    {
      key: 'p12', label: 'Governance', role: 'section_divider', bg: R.paper, chapterId: 'ch_gov', master: mOpener,
      els: rOpenerFrames({
        section: S.governance,
        number: 'Section three',
        intro: 'How the organisation is run and checked: the board, the targets we set and how we report against them.',
        list: 'In this section\nThe board\nTargets\nMethodology',
      }),
    },
    {
      key: 'p13', label: 'The board', role: 'infographic', bg: R.paper, chapterId: 'ch_gov', master: mData,
      els: rDataFrames({
        section: S.governance,
        heading: 'The board',
        stand: 'Who sits on the board and how often it met. Sample figures.',
        chart: rChart(S.governance, {
          id: 'premium_impact_board', variant: 'esg_pillars', title: 'Who sits on the board', subtitle: 'At the end of the year, sample figures', secondary: R.teal,
          items: [
            { label: 'Independent', value: 60, unit: '%', category: 'Independence', description: 'Of directors' },
            { label: 'Women', value: 40, unit: '%', category: 'Diversity', description: 'Of directors' },
            { label: 'Meetings', value: 10, category: 'Oversight', description: 'Held in the year' },
          ],
        }),
        note,
      }),
    },
    {
      key: 'p14', label: 'Targets', role: 'timeline', bg: R.paper, chapterId: 'ch_gov', master: mData,
      els: rDataFrames({
        section: S.governance,
        heading: 'Targets',
        stand: 'What we have committed to, and by when. Replace with your own targets.',
        chart: rChart(S.governance, {
          id: 'premium_impact_targets', variant: 'roadmap_tracks', title: 'Commitments and dates', subtitle: 'What we will do, and by when', secondary: R.teal,
          items: [
            { label: 'All electricity renewable', value: 100, yearOrStep: '2027', description: 'Every site, every month', color: R.teal },
            { label: 'Halve water per product', value: 50, yearOrStep: '2028', description: 'Against this year', color: R.teal },
            { label: 'Training for every role', value: 80, yearOrStep: '2028', description: 'Twenty hours a year each', color: R.ochre },
            { label: 'Independent audit of this report', value: 60, yearOrStep: '2030', description: 'Every figure checked', color: R.slate },
          ],
        }),
        note,
      }),
    },
    {
      key: 'p15', label: 'Methodology', role: 'editorial_text', bg: R.paper, chapterId: 'ch_gov', master: mText,
      els: [
        ...rTextFrames({
          section: S.governance,
          heading: 'Methodology',
          note: 'How the figures in this report were gathered, checked and compared with last year.',
          body:
            'This page explains how the figures in the report were gathered. Replace it with your own: the period the report covers, the sites and companies included and any left out, and why.\n\n' +
            'For each measure, say where the data came from, how it was calculated and who checked it. Note any change from last year\'s method, so readers can compare like with like, and restate last year\'s figure if the method changed.\n\n' +
            'Say which figures were checked by an independent body and which were not, and how estimates were made where data was missing.\n\n' +
            'Name the standards or frameworks you report against, and where readers can find the full data tables. Give a contact for questions about the report.',
        }),
        RECT('note_box', 'Sample note box', [18, 212, 184, 36], R.surface),
        T('sample_note', 'Sample note', 'body', [24, 217, 172, 26],
          'Every figure in this template is a sample. Replace each one with your own data, and say here where it came from, who checked it and for which period.',
          { font: R.figtree, size: 9, color: R.ink, lh: 1.5 }),
      ],
    },
    {
      key: 'p16', label: 'Back cover', role: 'back_cover', bg: R.teal, chapterId: 'ch_gov',
      els: [
        T('title', 'Report title', 'heading', [18, 24, 184, 10], 'Impact Report', { font: R.fraunces, size: 16, color: WHITE, lh: 1.1 }),
        T('address', 'Organisation address', 'body', [18, 200, 120, 30], 'Organisation name\nAddress line\nCity, postcode\nWebsite address', { font: R.figtree, size: 9, color: WHITE, lh: 1.5 }),
        T('print_note', 'Printing note', 'caption', [18, 240, 150, 10], 'Add your paper and printing details here.', { font: R.figtree, size: 7.5, color: R.paleTeal, lh: 1.4 }),
      ],
    },
  ]);
  return { pages, masters };
}

const IMPACT: PremiumSpec = {
  id: IR_ID,
  name: 'Impact Report',
  description:
    'An ESG or annual impact report: colour-coded sections, KPI and data pages built from live charts, case studies with photographs, targets and a methodology page.',
  tagline: 'Colour-coded sections, live charts, case studies and a methodology page.',
  signature: 'Each section\'s colour runs as a band across the head of its pages and grows into its opener.',
  tags: ['esg', 'impact', 'report', 'data', 'premium'],
  documentKind: 'report',
  coverImage: PREMIUM_PHOTOS.alpine.url,
  dimensions: dims(IR.W, IR.H, { top: 24, bottom: 22, inner: 18, outer: 18 }, 4, 6, 4.5, 'Impact Report 220 × 280'),
  designSystem: designSystem({
    name: 'Impact Report',
    paper: R.paper,
    surface: R.surface,
    ink: R.ink,
    mutedInk: R.muted,
    accent: R.teal,
    secondary: R.ochre,
    extra: [R.slate, R.paleTeal, R.paleOchre, R.paleSlate, WHITE],
    display: R.fraunces,
    heading: R.fraunces,
    body: R.figtree,
    caption: R.figtree,
    quote: R.fraunces,
    numerical: R.figtree,
    scale: { displayPt: 50, headingPt: 22, subheadingPt: 14, bodyPt: 9.5, captionPt: 7.5, quotePt: 14, folioPt: 8 },
    minBodyPt: 9,
    baselineMm: 4.5,
    margins: { top: 24, bottom: 22, inner: 18, outer: 18 },
    columns: 4,
    gutterMm: 6,
  }),
  chapters: [
    { id: 'ch_overview', number: 1, title: 'Overview', subtitle: 'Contents, message and the year in numbers', orderIndex: 0 },
    { id: 'ch_env', number: 2, title: 'Environment', orderIndex: 1 },
    { id: 'ch_people', number: 3, title: 'People', orderIndex: 2 },
    { id: 'ch_gov', number: 4, title: 'Governance', subtitle: 'The board, targets and methodology', orderIndex: 3 },
  ],
  print: { bindingType: 'perfect', paperStockName: '120 gsm recycled uncoated', coverBoardCaliperMm: 0, exportSpreads: false },
  showcase: [[0], [3, 4], [5, 6]],
  build: buildImpact,
};

/* ---------- the templates ---------- */

const SPECS: PremiumSpec[] = [AWARDS, LEADERSHIP, LEGACY, ARCHITECTURE, IMPACT];

export interface PremiumTemplateDetails {
  pageCount: number;
  masterCount: number;
  tagline: string;
  signature: string;
  /** page indexes the library previews: the cover, then spreads */
  showcase: number[][];
  fonts: string[];
}

export const PREMIUM_BOOK_TEMPLATES: BookTemplate[] = SPECS.map((s) => ({
  id: s.id,
  name: s.name,
  category: PREMIUM_CATEGORY,
  documentKind: s.documentKind,
  description: s.description,
  tags: s.tags,
  coverImage: s.coverImage,
  dimensions: s.dimensions,
  designSystem: s.designSystem,
  buildPages: () => s.build().pages,
}));

export const PREMIUM_TEMPLATE_DETAILS: Record<string, PremiumTemplateDetails> = Object.fromEntries(
  SPECS.map((s) => {
    const built = s.build();
    const t = s.designSystem.typography;
    return [
      s.id,
      {
        pageCount: built.pages.length,
        masterCount: built.masters.length,
        tagline: s.tagline,
        signature: s.signature,
        showcase: s.showcase,
        fonts: Array.from(new Set([t.displayFont, t.headingFont, t.bodyFont, t.captionFont, t.quoteFont, t.numericalFont])),
      },
    ];
  })
);

export function isPremiumTemplateId(id: string | undefined | null): boolean {
  return !!id && SPECS.some((s) => s.id === id);
}

/** a premium template's master pages (built fresh, the same ids every time) */
export function premiumMasterPages(templateId: string): MasterPage[] {
  const s = SPECS.find((x) => x.id === templateId);
  return s ? s.build().masters : [];
}

/** the photos a premium template's pages and master pages use, as photo-library entries */
export function premiumImageAssets(templateId: string): ImageAsset[] {
  const s = SPECS.find((x) => x.id === templateId);
  if (!s) return [];
  const built = s.build();
  const used = new Set<string>();
  [...built.pages, ...built.masters].forEach((p) =>
    p.elements.forEach((e) => {
      if (e.type === 'image' && e.image?.src) used.add(e.image.src);
    })
  );
  return Object.values(PREMIUM_PHOTOS)
    .filter((p) => used.has(p.url))
    .map(photoAsset);
}

/**
 * Finishes a book made from a premium template (sampleProject.createProjectFromBookTemplate and
 * unlimitedTemplateEngine.createProjectFromBookTemplateObject build the pages, the design system and the page size):
 * the template's own master pages (which its pages are linked to), chapters, the photos it uses in the photo library,
 * and print settings that suit it. Any other book is returned as it was.
 */
export function applyPremiumTemplate(project: BookProject, templateId: string): BookProject {
  const s = SPECS.find((x) => x.id === templateId);
  if (!s) return project;
  const have = new Set(project.imageAssets.map((a) => a.url));
  const extra = premiumImageAssets(templateId).filter((a) => !have.has(a.url));
  return {
    ...project,
    category: PREMIUM_CATEGORY,
    coverThumbnail: s.coverImage,
    masterPages: s.build().masters,
    chapters: s.chapters.map((c, i) => ({ ...c, orderIndex: i })),
    contentSections: [],
    imageAssets: [...project.imageAssets, ...extra],
    printSettings: { ...project.printSettings, ...s.print },
  };
}
