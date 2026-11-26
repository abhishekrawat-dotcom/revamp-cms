import type { BookElement, BookPage, BookProject, ContentSection } from '../types/bookstudio';

export interface TextOverflowReport {
  isOverflowing: boolean;
  estimatedLines: number;
  maxLines: number;
  overflowWords: number;
  fillRatio: number; // > 1 means overflow
}

export function countWords(text?: string): number {
  if (!text || !text.trim()) return 0;
  return text.trim().split(/\s+/).length;
}

export function countCharacters(text?: string): number {
  if (!text) return 0;
  return text.length;
}

const PT_TO_MM = 25.4 / 72;

/**
 * Deterministic typography layout estimator in physical millimetres.
 * Checks if text overflows its assigned frame without ever altering frame geometry.
 */
export function measureTextOverflow(el: BookElement): TextOverflowReport {
  if (
    !el.textStyle ||
    (el.type !== 'text' && el.type !== 'header' && el.type !== 'footer' && el.type !== 'pageNumber')
  ) {
    return { isOverflowing: false, estimatedLines: 0, maxLines: 1, overflowWords: 0, fillRatio: 0 };
  }
  const text = (el.text || '').trim();
  if (!text) {
    return { isOverflowing: false, estimatedLines: 0, maxLines: 1, overflowWords: 0, fillRatio: 0 };
  }

  const style = el.textStyle;
  const inset = style.insetMm || 0;
  const cols = Math.max(1, style.columns || 1);
  const colGap = style.columnGapMm || 5;
  const usableW = Math.max(8, el.widthMm - inset * 2 - colGap * (cols - 1));
  const colWidthMm = usableW / cols;
  const usableH = Math.max(4, el.heightMm - inset * 2);

  const fontSizeMm = style.fontSizePt * PT_TO_MM;
  const lineHeightMm = Math.max(fontSizeMm * (style.lineHeight || 1.4), 1.5);
  const avgCharWidthMm = fontSizeMm * (0.52 + Math.max(0, style.letterSpacingEm || 0) * 0.85);
  const charsPerLine = Math.max(4, Math.floor(colWidthMm / Math.max(0.5, avgCharWidthMm)));

  const paragraphs = text.split(/\n+/);
  let totalLines = 0;
  const paraGapLines = (style.paragraphSpacingMm || 0) / lineHeightMm;

  paragraphs.forEach((p, idx) => {
    const words = p.trim().split(/\s+/);
    let lineLen = 0;
    let linesInPara = 1;
    for (const w of words) {
      const add = lineLen === 0 ? w.length : w.length + 1;
      if (lineLen + add > charsPerLine && lineLen > 0) {
        linesInPara += 1;
        lineLen = w.length;
      } else {
        lineLen += add;
      }
    }
    totalLines += linesInPara;
    if (idx < paragraphs.length - 1) {
      totalLines += paraGapLines;
    }
  });

  const maxLinesPerCol = Math.max(1, Math.floor(usableH / lineHeightMm));
  const totalCapacityLines = maxLinesPerCol * cols;
  const fillRatio = totalLines / Math.max(1, totalCapacityLines);
  const isOverflowing = totalLines > totalCapacityLines + 0.15;

  const totalWords = countWords(text);
  const overflowRatio = Math.max(0, (totalLines - totalCapacityLines) / Math.max(1, totalLines));
  const overflowWords = isOverflowing ? Math.max(1, Math.ceil(totalWords * overflowRatio)) : 0;

  return {
    isOverflowing,
    estimatedLines: Math.ceil(totalLines),
    maxLines: totalCapacityLines,
    overflowWords,
    fillRatio: Number(fillRatio.toFixed(2)),
  };
}

export interface PageWordStats {
  pageId: string;
  pageNumber: number;
  label: string;
  chapterId?: string;
  words: number;
  characters: number;
  overflowCount: number;
  emptyTextFrames: number;
}

export interface EditorialAnalytics {
  totalWords: number;
  totalCharacters: number;
  pageStats: PageWordStats[];
  spreadStats: Array<{ spreadLabel: string; pageIds: string[]; words: number }>;
  chapterStats: Array<{ chapterId: string; title: string; words: number; pageCount: number }>;
  overflowFrames: Array<{ pageId: string; pageNumber: number; elementId: string; elementName: string; overflowWords: number }>;
  emptyTextFrames: Array<{ pageId: string; pageNumber: number; elementId: string; elementName: string }>;
  unassignedSections: ContentSection[];
}

/**
 * Computes live backend editorial word & character counts.
 * IMPORTANT: Strictly backend editorial data — never rendered onto pages or exported PDFs.
 */
export function computeEditorialAnalytics(project: BookProject): EditorialAnalytics {
  let totalWords = 0;
  let totalCharacters = 0;
  const pageStats: PageWordStats[] = [];
  const overflowFrames: EditorialAnalytics['overflowFrames'] = [];
  const emptyTextFrames: EditorialAnalytics['emptyTextFrames'] = [];

  project.pages.forEach((page, idx) => {
    let pageWords = 0;
    let pageChars = 0;
    let pageOverflows = 0;
    let pageEmptyFrames = 0;

    for (const el of page.elements) {
      if (el.type === 'text') {
        const w = countWords(el.text);
        const c = countCharacters(el.text);
        pageWords += w;
        pageChars += c;
        if (w === 0) {
          pageEmptyFrames += 1;
          emptyTextFrames.push({
            pageId: page.id,
            pageNumber: idx + 1,
            elementId: el.id,
            elementName: el.name,
          });
        } else {
          const ov = measureTextOverflow(el);
          if (ov.isOverflowing) {
            pageOverflows += 1;
            overflowFrames.push({
              pageId: page.id,
              pageNumber: idx + 1,
              elementId: el.id,
              elementName: el.name,
              overflowWords: ov.overflowWords,
            });
          }
        }
      }
    }

    totalWords += pageWords;
    totalCharacters += pageChars;
    pageStats.push({
      pageId: page.id,
      pageNumber: idx + 1,
      label: page.label,
      chapterId: page.chapterId,
      words: pageWords,
      characters: pageChars,
      overflowCount: pageOverflows,
      emptyTextFrames: pageEmptyFrames,
    });
  });

  // Spread grouping: page 1 (cover) single, then facing pairs (2-3, 4-5, ...)
  const spreadStats: EditorialAnalytics['spreadStats'] = [];
  if (pageStats.length > 0) {
    spreadStats.push({
      spreadLabel: 'Page 1 (Cover)',
      pageIds: [pageStats[0].pageId],
      words: pageStats[0].words,
    });
    for (let i = 1; i < pageStats.length; i += 2) {
      const left = pageStats[i];
      const right = pageStats[i + 1];
      if (right) {
        spreadStats.push({
          spreadLabel: `Spread ${left.pageNumber}–${right.pageNumber}`,
          pageIds: [left.pageId, right.pageId],
          words: left.words + right.words,
        });
      } else {
        spreadStats.push({
          spreadLabel: `Page ${left.pageNumber}`,
          pageIds: [left.pageId],
          words: left.words,
        });
      }
    }
  }

  const chapterStats = project.chapters.map((ch) => {
    const matching = pageStats.filter((p) => p.chapterId === ch.id);
    return {
      chapterId: ch.id,
      title: ch.title,
      words: matching.reduce((acc, p) => acc + p.words, 0),
      pageCount: matching.length,
    };
  });

  const unassignedSections = project.contentSections.filter((s) => !s.assignedPageId);

  return {
    totalWords,
    totalCharacters,
    pageStats,
    spreadStats,
    chapterStats,
    overflowFrames,
    emptyTextFrames,
    unassignedSections,
  };
}

/**
 * Controlled non-destructive overflow remedies:
 * Never silently truncates or randomly rearranges surrounding elements.
 */
export function fitTextWithinApprovedLimits(
  el: BookElement,
  minApprovedPt: number
): BookElement {
  if (!el.textStyle) return el;
  let candidate = { ...el, textStyle: { ...el.textStyle } };
  while (
    measureTextOverflow(candidate).isOverflowing &&
    candidate.textStyle.fontSizePt > minApprovedPt
  ) {
    candidate = {
      ...candidate,
      textStyle: {
        ...candidate.textStyle,
        fontSizePt: Number(Math.max(minApprovedPt, candidate.textStyle.fontSizePt - 0.5).toFixed(1)),
      },
    };
  }
  return candidate;
}

export function tightenParagraphSpacing(el: BookElement): BookElement {
  if (!el.textStyle) return el;
  return {
    ...el,
    textStyle: {
      ...el.textStyle,
      lineHeight: Number(Math.max(1.15, el.textStyle.lineHeight - 0.1).toFixed(2)),
      paragraphSpacingMm: Number(Math.max(1, el.textStyle.paragraphSpacingMm - 1.5).toFixed(1)),
    },
  };
}

export function expandFrameHeightForText(el: BookElement, maxPageHeightMm: number): BookElement {
  const ov = measureTextOverflow(el);
  if (!ov.isOverflowing) return el;
  const neededH = Math.ceil(el.heightMm * Math.min(2.2, ov.fillRatio + 0.08));
  const clampedH = Math.min(maxPageHeightMm - el.yMm - 8, neededH);
  return {
    ...el,
    heightMm: Math.max(el.heightMm, clampedH),
  };
}

export function splitOverflowTextForContinuation(el: BookElement): {
  fittingText: string;
  continuationText: string;
} {
  const full = (el.text || '').trim();
  const words = full.split(/\s+/);
  const ov = measureTextOverflow(el);
  if (!ov.isOverflowing || words.length <= 2) {
    return { fittingText: full, continuationText: '' };
  }
  const keepCount = Math.max(1, words.length - ov.overflowWords);
  return {
    fittingText: words.slice(0, keepCount).join(' '),
    continuationText: words.slice(keepCount).join(' '),
  };
}

export function findTextElementsOnPage(page: BookPage): BookElement[] {
  return page.elements.filter((e) => e.type === 'text');
}
