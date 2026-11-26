import type { BookProject, GoogleFontItem, TextRole } from '../types/bookstudio';

/**
 * Curated official Google Fonts catalog with authentic categories, weights, variable flags, and scripts.
 * Supplemented by the whole Google Fonts library from EventSphere (GET /api/books/fonts, TypographyStudioModal),
 * and ANY searched Google Font family can be dynamically loaded live via the official CSS2 API.
 */
export const GOOGLE_FONTS_CATALOG: GoogleFontItem[] = [
  // Editorial & Luxury Serifs
  { family: 'Playfair Display', category: 'serif', weights: [400, 500, 600, 700, 800], hasItalic: true, isVariable: true, scripts: ['latin', 'latin-ext', 'cyrillic'], styleTag: 'luxury', license: 'SIL OFL 1.1 (Embeddable)' },
  { family: 'Cormorant Garamond', category: 'serif', weights: [300, 400, 500, 600, 700], hasItalic: true, isVariable: false, scripts: ['latin', 'latin-ext', 'cyrillic'], styleTag: 'luxury', license: 'SIL OFL 1.1 (Embeddable)' },
  { family: 'Bodoni Moda', category: 'serif', weights: [400, 500, 600, 700, 800], hasItalic: true, isVariable: true, scripts: ['latin', 'latin-ext'], styleTag: 'luxury', license: 'SIL OFL 1.1 (Embeddable)' },
  { family: 'Fraunces', category: 'serif', weights: [300, 400, 500, 600, 700, 800], hasItalic: true, isVariable: true, scripts: ['latin', 'latin-ext'], styleTag: 'editorial', license: 'SIL OFL 1.1 (Embeddable)' },
  { family: 'Cinzel', category: 'serif', weights: [400, 500, 600, 700, 800], hasItalic: false, isVariable: true, scripts: ['latin', 'latin-ext'], styleTag: 'heritage', license: 'SIL OFL 1.1 (Embeddable)' },
  { family: 'EB Garamond', category: 'serif', weights: [400, 500, 600, 700, 800], hasItalic: true, isVariable: true, scripts: ['latin', 'latin-ext', 'greek', 'cyrillic'], styleTag: 'heritage', license: 'SIL OFL 1.1 (Embeddable)' },
  { family: 'Source Serif 4', category: 'serif', weights: [300, 400, 500, 600, 700], hasItalic: true, isVariable: true, scripts: ['latin', 'latin-ext', 'greek', 'cyrillic'], styleTag: 'editorial', license: 'SIL OFL 1.1 (Embeddable)' },
  { family: 'Lora', category: 'serif', weights: [400, 500, 600, 700], hasItalic: true, isVariable: true, scripts: ['latin', 'latin-ext', 'cyrillic', 'vietnamese'], styleTag: 'editorial', license: 'SIL OFL 1.1 (Embeddable)' },
  { family: 'Libre Baskerville', category: 'serif', weights: [400, 700], hasItalic: true, isVariable: false, scripts: ['latin', 'latin-ext'], styleTag: 'heritage', license: 'SIL OFL 1.1 (Embeddable)' },
  { family: 'Crimson Pro', category: 'serif', weights: [300, 400, 500, 600, 700], hasItalic: true, isVariable: true, scripts: ['latin', 'latin-ext', 'vietnamese'], styleTag: 'editorial', license: 'SIL OFL 1.1 (Embeddable)' },
  { family: 'Spectral', category: 'serif', weights: [300, 400, 500, 600, 700], hasItalic: true, isVariable: false, scripts: ['latin', 'latin-ext', 'cyrillic'], styleTag: 'editorial', license: 'SIL OFL 1.1 (Embeddable)' },
  { family: 'Merriweather', category: 'serif', weights: [300, 400, 700, 900], hasItalic: true, isVariable: false, scripts: ['latin', 'latin-ext', 'cyrillic'], styleTag: 'editorial', license: 'SIL OFL 1.1 (Embeddable)' },
  { family: 'Prata', category: 'serif', weights: [400], hasItalic: false, isVariable: false, scripts: ['latin', 'cyrillic'], styleTag: 'luxury', license: 'SIL OFL 1.1 (Embeddable)' },
  { family: 'Marcellus', category: 'serif', weights: [400], hasItalic: false, isVariable: false, scripts: ['latin', 'latin-ext'], styleTag: 'heritage', license: 'SIL OFL 1.1 (Embeddable)' },
  { family: 'Cardo', category: 'serif', weights: [400, 700], hasItalic: true, isVariable: false, scripts: ['latin', 'greek', 'hebrew'], styleTag: 'heritage', license: 'SIL OFL 1.1 (Embeddable)' },
  { family: 'DM Serif Display', category: 'serif', weights: [400], hasItalic: true, isVariable: false, scripts: ['latin', 'latin-ext'], styleTag: 'luxury', license: 'SIL OFL 1.1 (Embeddable)' },
  { family: 'DM Serif Text', category: 'serif', weights: [400], hasItalic: true, isVariable: false, scripts: ['latin', 'latin-ext'], styleTag: 'editorial', license: 'SIL OFL 1.1 (Embeddable)' },
  { family: 'Gelasio', category: 'serif', weights: [400, 500, 600, 700], hasItalic: true, isVariable: true, scripts: ['latin', 'latin-ext'], styleTag: 'editorial', license: 'SIL OFL 1.1 (Embeddable)' },
  { family: 'Old Standard TT', category: 'serif', weights: [400, 700], hasItalic: true, isVariable: false, scripts: ['latin', 'cyrillic'], styleTag: 'heritage', license: 'SIL OFL 1.1 (Embeddable)' },
  { family: 'Noto Serif', category: 'serif', weights: [300, 400, 500, 600, 700], hasItalic: true, isVariable: true, scripts: ['latin', 'greek', 'cyrillic', 'vietnamese'], styleTag: 'editorial', license: 'SIL OFL 1.1 (Embeddable)' },
  { family: 'Noto Serif Devanagari', category: 'serif', weights: [400, 500, 600, 700], hasItalic: false, isVariable: true, scripts: ['devanagari', 'latin'], styleTag: 'heritage', license: 'SIL OFL 1.1 (Embeddable)' },
  { family: 'Amiri', category: 'serif', weights: [400, 700], hasItalic: true, isVariable: false, scripts: ['arabic', 'latin'], styleTag: 'heritage', license: 'SIL OFL 1.1 (Embeddable)' },
  { family: 'Baskervville', category: 'serif', weights: [400], hasItalic: true, isVariable: false, scripts: ['latin', 'latin-ext'], styleTag: 'heritage', license: 'SIL OFL 1.1 (Embeddable)' },
  { family: 'Abhaya Libre', category: 'serif', weights: [400, 500, 600, 700, 800], hasItalic: false, isVariable: false, scripts: ['latin', 'sinhala'], styleTag: 'editorial', license: 'SIL OFL 1.1 (Embeddable)' },
  { family: 'Vollkorn', category: 'serif', weights: [400, 500, 600, 700], hasItalic: true, isVariable: true, scripts: ['latin', 'cyrillic', 'greek'], styleTag: 'editorial', license: 'SIL OFL 1.1 (Embeddable)' },

  // Sans-Serif (Architectural, Modern, Editorial)
  { family: 'Plus Jakarta Sans', category: 'sans-serif', weights: [300, 400, 500, 600, 700, 800], hasItalic: true, isVariable: true, scripts: ['latin', 'latin-ext', 'vietnamese'], styleTag: 'modern', license: 'SIL OFL 1.1 (Embeddable)' },
  { family: 'DM Sans', category: 'sans-serif', weights: [300, 400, 500, 600, 700], hasItalic: true, isVariable: true, scripts: ['latin', 'latin-ext'], styleTag: 'modern', license: 'SIL OFL 1.1 (Embeddable)' },
  { family: 'Manrope', category: 'sans-serif', weights: [300, 400, 500, 600, 700, 800], hasItalic: false, isVariable: true, scripts: ['latin', 'latin-ext', 'cyrillic', 'greek'], styleTag: 'architectural', license: 'SIL OFL 1.1 (Embeddable)' },
  { family: 'Outfit', category: 'sans-serif', weights: [300, 400, 500, 600, 700, 800], hasItalic: false, isVariable: true, scripts: ['latin', 'latin-ext'], styleTag: 'architectural', license: 'SIL OFL 1.1 (Embeddable)' },
  { family: 'Bricolage Grotesque', category: 'sans-serif', weights: [300, 400, 500, 600, 700, 800], hasItalic: false, isVariable: true, scripts: ['latin', 'latin-ext'], styleTag: 'modern', license: 'SIL OFL 1.1 (Embeddable)' },
  { family: 'Public Sans', category: 'sans-serif', weights: [300, 400, 500, 600, 700], hasItalic: true, isVariable: true, scripts: ['latin', 'latin-ext'], styleTag: 'architectural', license: 'SIL OFL 1.1 (Embeddable)' },
  { family: 'Archivo', category: 'sans-serif', weights: [300, 400, 500, 600, 700], hasItalic: true, isVariable: true, scripts: ['latin', 'latin-ext'], styleTag: 'architectural', license: 'SIL OFL 1.1 (Embeddable)' },
  { family: 'Work Sans', category: 'sans-serif', weights: [300, 400, 500, 600, 700], hasItalic: true, isVariable: true, scripts: ['latin', 'latin-ext'], styleTag: 'modern', license: 'SIL OFL 1.1 (Embeddable)' },
  { family: 'IBM Plex Sans', category: 'sans-serif', weights: [300, 400, 500, 600, 700], hasItalic: true, isVariable: false, scripts: ['latin', 'latin-ext', 'cyrillic', 'greek'], styleTag: 'architectural', license: 'SIL OFL 1.1 (Embeddable)' },
  { family: 'Tenor Sans', category: 'sans-serif', weights: [400], hasItalic: false, isVariable: false, scripts: ['latin', 'cyrillic'], styleTag: 'luxury', license: 'SIL OFL 1.1 (Embeddable)' },
  { family: 'Josefin Sans', category: 'sans-serif', weights: [300, 400, 500, 600, 700], hasItalic: true, isVariable: true, scripts: ['latin', 'latin-ext'], styleTag: 'luxury', license: 'SIL OFL 1.1 (Embeddable)' },
  { family: 'Montserrat', category: 'sans-serif', weights: [300, 400, 500, 600, 700, 800], hasItalic: true, isVariable: true, scripts: ['latin', 'latin-ext', 'cyrillic'], styleTag: 'modern', license: 'SIL OFL 1.1 (Embeddable)' },
  { family: 'Raleway', category: 'sans-serif', weights: [300, 400, 500, 600, 700], hasItalic: true, isVariable: true, scripts: ['latin', 'latin-ext', 'cyrillic'], styleTag: 'luxury', license: 'SIL OFL 1.1 (Embeddable)' },
  { family: 'Urbanist', category: 'sans-serif', weights: [300, 400, 500, 600, 700], hasItalic: true, isVariable: true, scripts: ['latin', 'latin-ext'], styleTag: 'architectural', license: 'SIL OFL 1.1 (Embeddable)' },
  { family: 'Jost', category: 'sans-serif', weights: [300, 400, 500, 600, 700], hasItalic: true, isVariable: true, scripts: ['latin', 'latin-ext', 'cyrillic'], styleTag: 'architectural', license: 'SIL OFL 1.1 (Embeddable)' },
  { family: 'Karla', category: 'sans-serif', weights: [300, 400, 500, 600, 700], hasItalic: true, isVariable: true, scripts: ['latin', 'latin-ext'], styleTag: 'modern', license: 'SIL OFL 1.1 (Embeddable)' },
  { family: 'Lato', category: 'sans-serif', weights: [300, 400, 700, 900], hasItalic: true, isVariable: false, scripts: ['latin', 'latin-ext'], styleTag: 'modern', license: 'SIL OFL 1.1 (Embeddable)' },
  { family: 'Source Sans 3', category: 'sans-serif', weights: [300, 400, 500, 600, 700], hasItalic: true, isVariable: true, scripts: ['latin', 'cyrillic', 'greek'], styleTag: 'modern', license: 'SIL OFL 1.1 (Embeddable)' },
  { family: 'Noto Sans', category: 'sans-serif', weights: [300, 400, 500, 600, 700], hasItalic: true, isVariable: true, scripts: ['latin', 'cyrillic', 'greek', 'devanagari'], styleTag: 'modern', license: 'SIL OFL 1.1 (Embeddable)' },
  { family: 'Noto Sans Devanagari', category: 'sans-serif', weights: [400, 500, 600, 700], hasItalic: false, isVariable: true, scripts: ['devanagari', 'latin'], styleTag: 'modern', license: 'SIL OFL 1.1 (Embeddable)' },
  { family: 'Barlow Condensed', category: 'sans-serif', weights: [400, 500, 600, 700], hasItalic: true, isVariable: false, scripts: ['latin', 'latin-ext'], styleTag: 'architectural', license: 'SIL OFL 1.1 (Embeddable)' },
  { family: 'Oswald', category: 'sans-serif', weights: [300, 400, 500, 600, 700], hasItalic: false, isVariable: true, scripts: ['latin', 'latin-ext', 'cyrillic'], styleTag: 'architectural', license: 'SIL OFL 1.1 (Embeddable)' },
  { family: 'Antonio', category: 'sans-serif', weights: [300, 400, 500, 600, 700], hasItalic: false, isVariable: true, scripts: ['latin', 'latin-ext'], styleTag: 'architectural', license: 'SIL OFL 1.1 (Embeddable)' },
  { family: 'Sora', category: 'sans-serif', weights: [300, 400, 500, 600, 700], hasItalic: false, isVariable: true, scripts: ['latin', 'latin-ext'], styleTag: 'modern', license: 'SIL OFL 1.1 (Embeddable)' },
  { family: 'Figtree', category: 'sans-serif', weights: [300, 400, 500, 600, 700], hasItalic: true, isVariable: true, scripts: ['latin', 'latin-ext'], styleTag: 'modern', license: 'SIL OFL 1.1 (Embeddable)' },

  // Display
  { family: 'Syne', category: 'display', weights: [400, 500, 600, 700, 800], hasItalic: false, isVariable: true, scripts: ['latin', 'latin-ext', 'greek'], styleTag: 'architectural', license: 'SIL OFL 1.1 (Embeddable)' },
  { family: 'Italiana', category: 'display', weights: [400], hasItalic: false, isVariable: false, scripts: ['latin'], styleTag: 'luxury', license: 'SIL OFL 1.1 (Embeddable)' },
  { family: 'Poiret One', category: 'display', weights: [400], hasItalic: false, isVariable: false, scripts: ['latin', 'cyrillic'], styleTag: 'luxury', license: 'SIL OFL 1.1 (Embeddable)' },
  { family: 'Abril Fatface', category: 'display', weights: [400], hasItalic: false, isVariable: false, scripts: ['latin', 'latin-ext'], styleTag: 'editorial', license: 'SIL OFL 1.1 (Embeddable)' },
  { family: 'Unbounded', category: 'display', weights: [300, 400, 500, 600, 700], hasItalic: false, isVariable: true, scripts: ['latin', 'cyrillic'], styleTag: 'architectural', license: 'SIL OFL 1.1 (Embeddable)' },
  { family: 'Forum', category: 'display', weights: [400], hasItalic: false, isVariable: false, scripts: ['latin', 'cyrillic'], styleTag: 'heritage', license: 'SIL OFL 1.1 (Embeddable)' },
  { family: 'Yeseva One', category: 'display', weights: [400], hasItalic: false, isVariable: false, scripts: ['latin', 'cyrillic'], styleTag: 'editorial', license: 'SIL OFL 1.1 (Embeddable)' },
  { family: 'Big Shoulders Display', category: 'display', weights: [400, 500, 600, 700, 800], hasItalic: false, isVariable: true, scripts: ['latin', 'latin-ext'], styleTag: 'architectural', license: 'SIL OFL 1.1 (Embeddable)' },
  { family: 'Cinzel Decorative', category: 'display', weights: [400, 700, 900], hasItalic: false, isVariable: false, scripts: ['latin'], styleTag: 'heritage', license: 'SIL OFL 1.1 (Embeddable)' },

  // Monospace (Numerals, Folios, Technical Captions)
  { family: 'JetBrains Mono', category: 'monospace', weights: [300, 400, 500, 600, 700], hasItalic: true, isVariable: true, scripts: ['latin', 'latin-ext', 'cyrillic', 'greek'], styleTag: 'technical', license: 'SIL OFL 1.1 (Embeddable)' },
  { family: 'IBM Plex Mono', category: 'monospace', weights: [300, 400, 500, 600, 700], hasItalic: true, isVariable: false, scripts: ['latin', 'latin-ext', 'cyrillic'], styleTag: 'technical', license: 'SIL OFL 1.1 (Embeddable)' },
  { family: 'Space Mono', category: 'monospace', weights: [400, 700], hasItalic: true, isVariable: false, scripts: ['latin', 'latin-ext'], styleTag: 'technical', license: 'SIL OFL 1.1 (Embeddable)' },
  { family: 'DM Mono', category: 'monospace', weights: [300, 400, 500], hasItalic: true, isVariable: false, scripts: ['latin', 'latin-ext'], styleTag: 'technical', license: 'SIL OFL 1.1 (Embeddable)' },
  { family: 'Fira Code', category: 'monospace', weights: [300, 400, 500, 600, 700], hasItalic: false, isVariable: true, scripts: ['latin', 'cyrillic', 'greek'], styleTag: 'technical', license: 'SIL OFL 1.1 (Embeddable)' },
  { family: 'Inconsolata', category: 'monospace', weights: [300, 400, 500, 600, 700], hasItalic: false, isVariable: true, scripts: ['latin', 'latin-ext'], styleTag: 'technical', license: 'SIL OFL 1.1 (Embeddable)' },

  // Handwriting & Calligraphic Accents
  { family: 'Pinyon Script', category: 'handwriting', weights: [400], hasItalic: false, isVariable: false, scripts: ['latin'], styleTag: 'calligraphic', license: 'SIL OFL 1.1 (Embeddable)' },
  { family: 'Great Vibes', category: 'handwriting', weights: [400], hasItalic: false, isVariable: false, scripts: ['latin', 'latin-ext'], styleTag: 'calligraphic', license: 'SIL OFL 1.1 (Embeddable)' },
  { family: 'Allura', category: 'handwriting', weights: [400], hasItalic: false, isVariable: false, scripts: ['latin', 'latin-ext'], styleTag: 'calligraphic', license: 'SIL OFL 1.1 (Embeddable)' },
  { family: 'Caveat', category: 'handwriting', weights: [400, 500, 600, 700], hasItalic: false, isVariable: true, scripts: ['latin', 'cyrillic'], styleTag: 'calligraphic', license: 'SIL OFL 1.1 (Embeddable)' },
  { family: 'Alex Brush', category: 'handwriting', weights: [400], hasItalic: false, isVariable: false, scripts: ['latin', 'latin-ext'], styleTag: 'calligraphic', license: 'SIL OFL 1.1 (Embeddable)' },
];

const loadedFamilies = new Set<string>([
  'Playfair Display',
  'Cormorant Garamond',
  'Plus Jakarta Sans',
  'DM Sans',
  'Lora',
  'JetBrains Mono',
]);

const loadingStatus = new Map<string, 'loaded' | 'loading' | 'error'>();
for (const fam of loadedFamilies) {
  loadingStatus.set(fam, 'loaded');
}

/**
 * Dynamically loads any Google Font family via the official Google Fonts CSS2 API
 * and confirms availability through document.fonts.
 */
export async function loadGoogleFont(
  family: string,
  weights: number[] = [300, 400, 500, 600, 700]
): Promise<'loaded' | 'error'> {
  const clean = family.trim();
  if (!clean) return 'error';
  if (loadedFamilies.has(clean) && loadingStatus.get(clean) === 'loaded') {
    return 'loaded';
  }
  if (typeof document === 'undefined') return 'loaded';

  loadingStatus.set(clean, 'loading');
  const encodedFamily = encodeURIComponent(clean).replace(/%20/g, '+');
  const id = `bs-gfont-${clean.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;

  if (!document.getElementById(id)) {
    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    const uniqueWeights = Array.from(new Set(weights.length ? weights : [400, 600, 700])).sort(
      (a, b) => a - b
    );
    const italTuples = [
      ...uniqueWeights.map((w) => `0,${w}`),
      ...uniqueWeights.filter((w) => w === 400 || w === 600).map((w) => `1,${w}`),
    ];
    // Try italic+weights first, fallback gracefully to simple family query
    link.href = `https://fonts.googleapis.com/css2?family=${encodedFamily}:ital,wght@${italTuples.join(';')}&display=swap`;
    link.onerror = () => {
      // Fallback for single-weight or non-italic fonts
      const fallback = document.createElement('link');
      fallback.rel = 'stylesheet';
      fallback.href = `https://fonts.googleapis.com/css2?family=${encodedFamily}&display=swap`;
      document.head.appendChild(fallback);
    };
    document.head.appendChild(link);
  }

  try {
    await document.fonts.load(`400 16px "${clean}"`);
    loadedFamilies.add(clean);
    loadingStatus.set(clean, 'loaded');
    return 'loaded';
  } catch {
    loadingStatus.set(clean, 'error');
    return 'error';
  }
}

export function getFontLoadStatus(family: string): 'loaded' | 'loading' | 'unloaded' | 'error' {
  return loadingStatus.get(family) || 'unloaded';
}

export function ensureProjectFontsLoaded(project: BookProject): void {
  const families = new Set<string>([
    project.designSystem.typography.primaryFont,
    project.designSystem.typography.secondaryFont,
    project.designSystem.typography.displayFont,
    project.designSystem.typography.headingFont,
    project.designSystem.typography.bodyFont,
    project.designSystem.typography.captionFont,
    project.designSystem.typography.quoteFont,
    project.designSystem.typography.numericalFont,
  ]);

  for (const page of project.pages) {
    for (const el of page.elements) {
      if (el.textStyle?.fontFamily) families.add(el.textStyle.fontFamily);
      if (el.infographic?.fontFamily) families.add(el.infographic.fontFamily);
    }
  }

  families.forEach((fam) => {
    void loadGoogleFont(fam);
  });
}

export interface FontProductionEntry {
  family: string;
  weightsUsed: number[];
  pageCount: number;
  elementCount: number;
  status: 'loaded' | 'loading' | 'unloaded' | 'error';
  license: string;
  isSystemApproved: boolean;
}

export function auditProjectFonts(project: BookProject): FontProductionEntry[] {
  const approvedSet = new Set<string>([
    project.designSystem.typography.primaryFont,
    project.designSystem.typography.secondaryFont,
    project.designSystem.typography.displayFont,
    project.designSystem.typography.headingFont,
    project.designSystem.typography.bodyFont,
    project.designSystem.typography.captionFont,
    project.designSystem.typography.quoteFont,
    project.designSystem.typography.numericalFont,
  ]);

  const map = new Map<
    string,
    { weights: Set<number>; pages: Set<string>; elements: number }
  >();

  for (const page of project.pages) {
    for (const el of page.elements) {
      const fam = el.textStyle?.fontFamily || el.infographic?.fontFamily;
      if (!fam) continue;
      const entry = map.get(fam) || { weights: new Set<number>(), pages: new Set<string>(), elements: 0 };
      entry.weights.add(el.textStyle?.fontWeight || 400);
      entry.pages.add(page.id);
      entry.elements += 1;
      map.set(fam, entry);
    }
  }

  return Array.from(map.entries()).map(([family, stats]) => {
    const meta = GOOGLE_FONTS_CATALOG.find((f) => f.family.toLowerCase() === family.toLowerCase());
    return {
      family,
      weightsUsed: Array.from(stats.weights).sort((a, b) => a - b),
      pageCount: stats.pages.size,
      elementCount: stats.elements,
      status: getFontLoadStatus(family),
      license: meta?.license || 'Google Fonts OFL / Embeddable',
      isSystemApproved: approvedSet.has(family),
    };
  });
}

/**
 * Replaces a font globally or on selected pages while strictly preserving
 * existing fontSize, weight, color, lineHeight, letterSpacing, paragraphSpacing, and frame dimensions.
 */
export function replaceFontNonDestructively(
  project: BookProject,
  options: {
    targetRole?: TextRole | 'all';
    fromFamily?: string;
    toFamily: string;
    scope: 'book' | 'selected_pages';
    selectedPageIds?: string[];
  }
): BookProject {
  const pageIdSet = new Set(options.selectedPageIds || []);

  const updatedPages = project.pages.map((page) => {
    if (options.scope === 'selected_pages' && !pageIdSet.has(page.id)) {
      return page;
    }
    return {
      ...page,
      elements: page.elements.map((el) => {
        if (!el.textStyle) return el;
        const matchesFamily = !options.fromFamily || el.textStyle.fontFamily === options.fromFamily;
        const matchesRole =
          !options.targetRole || options.targetRole === 'all' || el.textRole === options.targetRole;
        if (!matchesFamily || !matchesRole) return el;
        return {
          ...el,
          textStyle: {
            ...el.textStyle,
            fontFamily: options.toFamily,
          },
        };
      }),
    };
  });

  const nextTypo = { ...project.designSystem.typography };
  if (options.scope === 'book') {
    if (options.targetRole === 'display') nextTypo.displayFont = options.toFamily;
    if (options.targetRole === 'heading') nextTypo.headingFont = options.toFamily;
    if (options.targetRole === 'body') nextTypo.bodyFont = options.toFamily;
    if (options.targetRole === 'caption') nextTypo.captionFont = options.toFamily;
    if (options.targetRole === 'quote') nextTypo.quoteFont = options.toFamily;
    if (options.targetRole === 'folio') nextTypo.numericalFont = options.toFamily;
    if (options.fromFamily) {
      if (nextTypo.primaryFont === options.fromFamily) nextTypo.primaryFont = options.toFamily;
      if (nextTypo.secondaryFont === options.fromFamily) nextTypo.secondaryFont = options.toFamily;
      if (nextTypo.displayFont === options.fromFamily) nextTypo.displayFont = options.toFamily;
      if (nextTypo.headingFont === options.fromFamily) nextTypo.headingFont = options.toFamily;
      if (nextTypo.bodyFont === options.fromFamily) nextTypo.bodyFont = options.toFamily;
      if (nextTypo.captionFont === options.fromFamily) nextTypo.captionFont = options.toFamily;
      if (nextTypo.quoteFont === options.fromFamily) nextTypo.quoteFont = options.toFamily;
      if (nextTypo.numericalFont === options.fromFamily) nextTypo.numericalFont = options.toFamily;
    }
  }

  void loadGoogleFont(options.toFamily);

  return {
    ...project,
    designSystem: {
      ...project.designSystem,
      typography: nextTypo,
    },
    pages: updatedPages,
  };
}
