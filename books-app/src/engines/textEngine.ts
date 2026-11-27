import type { BookElement, BookPage, BookProject, ContentSection, TextRole, TextStyle } from '../types/bookstudio';
import { cssFont, getMeasure, measureGeneration, PT_TO_MM, type FontSpec } from './textMeasure';

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

/* =====================================================================================================================
   Laying text out the way it is drawn (BookCanvas on screen; exportEngine.ts in exports), with the real font's widths
   (textMeasure.ts):
   - the frame's inset is taken off every side; the rest is split into columns: (width − 2 × inset − gaps) ÷ columns,
     the gap being the frame's column gap, or 5 mm when it is 0, as both draw it;
   - words wrap where the canvas wraps them: at spaces, after a hyphen inside a word ("well-|known", not before a
     digit) and before or after an em dash; each piece measured in the frame's font, size, weight, italic and letter
     spacing, in capitals when the frame is set in capitals (lowercase and Capitalised the same way);
   - a line is the font size × the leading high; one return is a line break; an empty line between words is a new
     paragraph, and the paragraph gap counts from that empty line: paragraphs are never closer than one empty line,
     and further apart when the Paragraph Gap is larger than a line (BookCanvas draws exactly that);
   - columns fill one after another; a word wider than its column is cut off at the frame's edge, so it does not fit.
   Results are remembered per frame (its words, style and size) and per font load (measureGeneration), so a
   300-page book is laid out once and only an edited frame again.
   ===================================================================================================================== */

/** the frame's text box in millimetres, as drawn */
export interface TextBox {
  columns: number;
  columnWidthMm: number;
  columnGapMm: number;
  heightMm: number;
  fontSizeMm: number;
  lineHeightMm: number;
  /** what a paragraph gap adds beyond the empty line between paragraphs */
  extraParagraphGapMm: number;
}

export function textBoxOf(style: TextStyle, widthMm: number, heightMm: number): TextBox {
  const inset = Math.max(0, Number(style.insetMm) || 0);
  const columns = Math.max(1, Math.round(Number(style.columns) || 1));
  const gap = Number(style.columnGapMm) || 5;
  const fontSizeMm = Math.max(0, Number(style.fontSizePt) || 0) * PT_TO_MM;
  const lineHeightMm = fontSizeMm * (Number(style.lineHeight) || 1.4);
  return {
    columns,
    columnGapMm: gap,
    columnWidthMm: Math.max(0.5, (widthMm - inset * 2 - gap * (columns - 1)) / columns),
    heightMm: Math.max(0, heightMm - inset * 2),
    fontSizeMm,
    lineHeightMm,
    extraParagraphGapMm: paragraphExtraMm(style),
  };
}

/** how much further apart than one empty line two paragraphs are drawn (0 unless the Paragraph Gap is larger) */
export function paragraphExtraMm(style: TextStyle): number {
  const lineMm = Math.max(0, Number(style.fontSizePt) || 0) * PT_TO_MM * (Number(style.lineHeight) || 1.4);
  return Math.max(0, (Number(style.paragraphSpacingMm) || 0) - lineMm);
}

/**
 * The text cut into the paragraphs BookCanvas draws as separate blocks when the Paragraph Gap is wider than a line:
 * a paragraph break is a run of whitespace holding two returns or more; each later block starts with its empty lines
 * (one fewer than the returns), so the blocks draw the same lines the text does, and only the gap is added.
 * Whitespace after the last paragraph is left out (nothing visible is in it).
 */
export function paragraphsForDrawing(text: string): string[] {
  const blocks: string[] = [];
  const re = /[ \t\r\f]*\n(?:[ \t\r\f]*\n)+/g;
  let at = 0;
  let lead = '';
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    // empty lines before the first words are that paragraph's own (drawn as lines, never as a gap)
    if (!blocks.length && !text.slice(0, m.index).trim()) continue;
    blocks.push(lead + text.slice(at, m.index));
    lead = '\n'.repeat((m[0].match(/\n/g) || []).length - 1);
    at = m.index + m[0].length;
  }
  blocks.push(lead + text.slice(at));
  while (blocks.length > 1 && !blocks[blocks.length - 1].trim()) blocks.pop();
  return blocks;
}

function fontOf(style: TextStyle): FontSpec {
  return {
    family: style.fontFamily,
    sizePt: Number(style.fontSizePt) || 0,
    weight: Number(style.fontWeight) || 400,
    italic: style.fontStyle === 'italic',
    letterSpacingEm: Number(style.letterSpacingEm) || 0,
  };
}

function casing(style: TextStyle): (w: string) => string {
  switch (style.textTransform) {
    case 'uppercase':
      return (w) => w.toUpperCase();
    case 'lowercase':
      return (w) => w.toLowerCase();
    case 'capitalize':
      return (w) => w.charAt(0).toUpperCase() + w.slice(1);
    default:
      return (w) => w;
  }
}

/* ---------- words and what separates them ---------- */
interface Tok {
  s: number; // where the word starts in the text
  e: number; // where it ends
  brk: 0 | 1 | 2; // before it: 0 spaces on the same line, 1 a line break, 2 a new paragraph
  spaces: number; // brk 0: the spaces between it and the word before; else the spaces it is indented by
  blank: number; // empty lines before it (a new paragraph; or the text's own leading empty lines, for the first word)
}

/* the characters CSS breaks and collapses at (a no-break space joins words, as it does on the page) */
const WORD_RE = /[^ \t\n\r\f]+/g;

function tokenize(text: string): Tok[] {
  const out: Tok[] = [];
  WORD_RE.lastIndex = 0;
  let prevEnd = 0;
  let m: RegExpExecArray | null;
  while ((m = WORD_RE.exec(text))) {
    const s = m.index;
    let newlines = 0;
    let spaces = 0;
    for (let i = prevEnd; i < s; i++) {
      const ch = text.charCodeAt(i);
      if (ch === 10) {
        newlines += 1;
        spaces = 0;
      } else if (ch === 9) spaces += 8;
      else if (ch !== 13) spaces += 1;
    }
    if (!out.length) out.push({ s, e: s + m[0].length, brk: 0, spaces, blank: newlines });
    else if (newlines === 0) out.push({ s, e: s + m[0].length, brk: 0, spaces, blank: 0 });
    else if (newlines === 1) out.push({ s, e: s + m[0].length, brk: 1, spaces, blank: 0 });
    else out.push({ s, e: s + m[0].length, brk: 2, spaces, blank: newlines - 1 });
    prevEnd = s + m[0].length;
  }
  return out;
}

/* where the browser may also break a line inside a word (Unicode line breaking, as Chrome does it): after a hyphen,
   a true hyphen or an en dash between a letter or digit and a letter ("well-|known"; "2019-2020" and "-5" stay
   whole), and before and after an em dash ("proportion|—|leaving"; a run of dashes stays whole) */
const MAY_SPLIT = /[-\u2010\u2013\u2014]/;
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;
const DIGIT = /[0-9]/;
export function piecesOf(word: string): string[] {
  if (word.length < 2 || !MAY_SPLIT.test(word)) return [word];
  const out: string[] = [];
  let start = 0;
  for (let k = 0; k < word.length; k++) {
    const ch = word[k];
    if (ch === '\u2014') {
      let end = k;
      while (end + 1 < word.length && word[end + 1] === '\u2014') end += 1;
      if (k > start) out.push(word.slice(start, k));
      out.push(word.slice(k, end + 1));
      start = end + 1;
      k = end;
    } else if (
      (ch === '-' || ch === '\u2010' || ch === '\u2013') &&
      k > start &&
      k + 1 < word.length &&
      LETTER_OR_DIGIT.test(word[k - 1]) &&
      !DIGIT.test(word[k + 1]) &&
      word[k + 1] !== '-'
    ) {
      out.push(word.slice(start, k + 1));
      start = k + 1;
    }
  }
  if (start < word.length) out.push(word.slice(start));
  return out;
}

/* ---------- the layout ---------- */
interface Layout {
  /** words [0, fitted) are on lines inside the frame */
  fitted: number;
  total: number;
  /** words inside the frame that are wider than their column (cut off at the edge) */
  tooWide: number[];
  /** lines (and empty lines) the whole text needs; only counted fully when not stopped early */
  rows: number;
  /** the whole text's height stacked in one column, in mm */
  stackMm: number;
  /** lines that fit: per column × columns */
  capacityLines: number;
  box: TextBox;
}

const WRAP_EPS_MM = 0.01;

/* what layoutTextLines needs to know of a layout besides whether it fits: each row as it was placed (runLayout calls
   these only when it is given one; the fit check never is) */
interface LayoutRecorder {
  /** a line starts with the first piece of token `tok` (or a later piece, when a word broke at a hyphen) */
  start(tok: number, indentSpaces: number, piece: string, widthMm: number): void;
  /** a piece joins the line: after `spaces` spaces (0 inside a word broken at a hyphen or a dash) */
  append(tok: number, spaces: number, piece: string, widthMm: number): void;
  /** the line is complete: why it ended, and where it went (inside: col and its top) */
  finish(end: 'soft' | 'forced' | 'end', inside: boolean, col: number, topMm: number): void;
  /** an empty line (between paragraphs, or typed at the start) */
  empty(inside: boolean, col: number, topMm: number): void;
  /** the paragraph gap above a new paragraph (drawn only inside a column, never at its top) */
  gap(heightMm: number): void;
  /** a new paragraph starts with the next empty lines or line */
  paragraph(): void;
}

function runLayout(
  text: string,
  toks: Tok[],
  style: TextStyle,
  widthMm: number,
  heightMm: number,
  stopEarly: boolean,
  rec?: LayoutRecorder
): Layout {
  const box = textBoxOf(style, widthMm, heightMm);
  const font = fontOf(style);
  const measure = getMeasure();
  const cased = casing(style);
  const lineH = box.lineHeightMm;
  const tol = Math.max(0.05, lineH * 0.04);
  const limit = box.heightMm + tol;
  const colW = box.columnWidthMm;
  const capacityLines = lineH > 0 ? box.columns * Math.max(0, Math.floor(limit / lineH)) : 0;
  const result: Layout = { fitted: 0, total: toks.length, tooWide: [], rows: 0, stackMm: 0, capacityLines, box };
  if (!toks.length) return result;
  if (!(lineH > 0)) return result; // a frame with no type size holds nothing

  const spaceW = measure(' ', font);
  let col = 0;
  let y = 0;
  let out = false;

  /* one row down the frame: true while it is inside the frame */
  const place = (h: number, gapOnly: boolean): boolean => {
    result.stackMm += h;
    if (out) return false;
    if (y + h <= limit) {
      y += h;
      return true;
    }
    col += 1;
    y = 0;
    if (col >= box.columns) {
      out = true;
      return false;
    }
    if (gapOnly) return true; // a paragraph's gap is not drawn at the top of a column
    if (h <= limit) {
      y = h;
      return true;
    }
    out = true;
    return false;
  };

  let lineW = 0;
  let lineTooWide: number[] = [];
  /* words whose last piece is on a line already laid (a word broken at a hyphen fits only when all of it does) */
  let done = 0;
  const finishLine = (end: 'soft' | 'forced' | 'end' = 'soft') => {
    result.rows += 1;
    const inside = place(lineH, false);
    if (inside) {
      result.fitted = done;
      if (lineTooWide.length) result.tooWide.push(...lineTooWide);
    }
    lineTooWide = [];
    if (rec) rec.finish(end, inside, col, y - lineH);
  };
  const emptyLine = () => {
    result.rows += 1;
    const inside = place(lineH, false);
    if (rec) rec.empty(inside, col, y - lineH);
  };
  const startLine = (i: number, indentSpaces: number, w: number, piece: string) => {
    lineW = indentSpaces * spaceW + w;
    if (lineW > colW + WRAP_EPS_MM && lineTooWide[lineTooWide.length - 1] !== i) lineTooWide.push(i);
    if (rec) rec.start(i, indentSpaces, piece, w);
  };

  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    const pieces = piecesOf(cased(text.slice(t.s, t.e)));
    for (let p = 0; p < pieces.length; p++) {
      const w = measure(pieces[p], font);
      if (p > 0) {
        // inside a word, after a hyphen or at a dash: no space between the pieces
        if (lineW + w > colW - WRAP_EPS_MM) {
          finishLine();
          startLine(i, 0, w, pieces[p]);
        } else {
          lineW += w;
          if (rec) rec.append(i, 0, pieces[p], w);
        }
      } else if (i === 0) {
        for (let k = 0; k < t.blank; k++) emptyLine();
        startLine(0, t.spaces, w, pieces[p]);
      } else if (t.brk === 0) {
        const next = lineW + t.spaces * spaceW + w;
        if (next > colW - WRAP_EPS_MM) {
          finishLine();
          startLine(i, 0, w, pieces[p]);
        } else {
          lineW = next;
          if (rec) rec.append(i, t.spaces, pieces[p], w);
        }
      } else {
        finishLine('forced');
        if (t.brk === 2) {
          if (rec) rec.paragraph();
          if (box.extraParagraphGapMm > 0) {
            place(box.extraParagraphGapMm, true);
            if (rec) rec.gap(box.extraParagraphGapMm);
          }
          for (let k = 0; k < t.blank; k++) emptyLine();
        }
        startLine(i, t.spaces, w, pieces[p]);
      }
    }
    done = i + 1;
    if (stopEarly && out) return result;
  }
  finishLine('end');
  return result;
}

/* ---------- remembered layouts ---------- */
function styleKey(st: TextStyle): string {
  return [
    st.fontFamily,
    st.fontSizePt,
    st.fontWeight,
    st.fontStyle || '',
    st.lineHeight,
    st.letterSpacingEm,
    st.paragraphSpacingMm,
    st.columns,
    st.columnGapMm,
    st.insetMm,
    st.textTransform || '',
  ].join('|');
}

const LAYOUTS = new Map<string, Layout>();
const MAX_LAYOUTS = 600;
const TOKENS = new Map<string, Tok[]>();
const MAX_TOKENS = 300;

function tokensOf(text: string): Tok[] {
  let toks = TOKENS.get(text);
  if (!toks) {
    toks = tokenize(text);
    TOKENS.set(text, toks);
    if (TOKENS.size > MAX_TOKENS) TOKENS.delete(TOKENS.keys().next().value as string);
  }
  return toks;
}

function layoutOf(text: string, style: TextStyle, widthMm: number, heightMm: number, stopEarly = false): Layout {
  const key = `${measureGeneration()}|${styleKey(style)}|${widthMm}|${heightMm}|${stopEarly ? 1 : 0}|${text}`;
  const hit = LAYOUTS.get(key);
  if (hit) {
    LAYOUTS.delete(key);
    LAYOUTS.set(key, hit);
    return hit;
  }
  const lay = runLayout(text, tokensOf(text), style, widthMm, heightMm, stopEarly);
  LAYOUTS.set(key, lay);
  if (LAYOUTS.size > MAX_LAYOUTS) LAYOUTS.delete(LAYOUTS.keys().next().value as string);
  return lay;
}

/* each frame's last report, so an unchanged frame on any page is never laid out twice */
const REPORTS = new WeakMap<
  object,
  { gen: number; text: string; sig: string; w: number; h: number; report: TextOverflowReport }
>();

function isTextType(el: BookElement): boolean {
  return el.type === 'text' || el.type === 'header' || el.type === 'footer' || el.type === 'pageNumber';
}

/* the words as the canvas draws them (a page number frame shows its number, two digits) */
function drawnText(el: BookElement): string {
  const text = el.text || '';
  return el.type === 'pageNumber' ? (text || '{{page}}').replace('{{page}}', '00') : text;
}

const NO_OVERFLOW: TextOverflowReport = { isOverflowing: false, estimatedLines: 0, maxLines: 1, overflowWords: 0, fillRatio: 0 };

function reportOf(lay: Layout): TextOverflowReport {
  const notFitting = lay.total - lay.fitted + lay.tooWide.filter((i) => i < lay.fitted).length;
  const isOverflowing = notFitting > 0;
  const room = Math.max(0.01, lay.box.heightMm * lay.box.columns);
  return {
    isOverflowing,
    estimatedLines: lay.rows,
    maxLines: Math.max(1, lay.capacityLines),
    overflowWords: isOverflowing ? Math.max(1, notFitting) : 0,
    fillRatio: Number((lay.stackMm / room).toFixed(2)),
  };
}

/**
 * Does the frame's text fit? Measured with the real font, laid out as the canvas and exports draw it.
 * Never changes the frame.
 */
export function measureTextOverflow(el: BookElement): TextOverflowReport {
  if (!el.textStyle || !isTextType(el)) return { ...NO_OVERFLOW };
  const text = drawnText(el);
  if (!text.trim()) return { ...NO_OVERFLOW };
  const gen = measureGeneration();
  const sig = styleKey(el.textStyle);
  const seen = REPORTS.get(el);
  if (seen && seen.gen === gen && seen.text === text && seen.sig === sig && seen.w === el.widthMm && seen.h === el.heightMm) {
    return { ...seen.report };
  }
  const report = reportOf(layoutOf(text, el.textStyle, el.widthMm, el.heightMm));
  REPORTS.set(el, { gen, text, sig, w: el.widthMm, h: el.heightMm, report });
  return { ...report };
}

/* =====================================================================================================================
   The lines of a frame as the canvas draws them (Books Phase 4: the vector PDF draws them, and the PNG/JPG exports).
   The same layout as measureTextOverflow above (the same measure, breaks, columns and paragraph gaps), plus where each
   line sits, as BookCanvas's CSS puts it:
     - a line box is the leading high; the glyphs sit on a baseline half the leading's slack below the box's top
       (CSS half-leading: top + (leading − (ascent + descent)) ÷ 2 + ascent, the font's own ascent and descent);
     - left, centre and right inside the column; justified lines stretch every space to the column's width, except a
       paragraph's last line and a line before a typed return (CSS text-align-last); a line wider than its column is
       left at the start, as CSS does;
     - the text block sits at the top, middle or bottom of the frame inside its inset (BookCanvas's flex column); text
       that doesn't fit is laid from the top;
     - in two or more columns CSS balances the columns (column-fill: balance, the block's height is the text's): the
       columns are made as short as lets the text fit, keeping 2 lines of a paragraph at the foot of a column and 2 at
       the head of the next where Chrome keeps them (orphans and widows), and a paragraph gap is dropped at the top of
       a column. Text that doesn't fit fills the columns one after another, as the fit is measured.
   Checked against Chrome's own layout of BookCanvas's markup (2,000 random frames, real Google fonts): the same
   lines and columns, words within 0.25 mm. Where they differ it is the measure's own rounding at a line's very end
   (it wraps on the safe side), which the fit check shares.
   Only the lines that fit are returned; what doesn't fit (the "+N words don't fit") is not.
   ===================================================================================================================== */

/** one word (or the pieces of one word) on a line, where it is drawn: x from the frame's left, in mm */
export interface LaidWord {
  text: string;
  xMm: number;
  widthMm: number;
}

export interface LaidLine {
  /** the line as drawn (in capitals when the frame is set in capitals), indentation and spaces between words kept */
  text: string;
  /** where its first character starts, from the frame's left (inset, column, alignment and indentation included) */
  xMm: number;
  /** the line box's top, from the frame's top */
  yMm: number;
  /** its width as drawn: the column's width for a justified line, else the text's own */
  widthMm: number;
  /** the baseline the glyphs sit on, from the frame's top */
  baselineMm: number;
  /** stretched to the column's width (spaces widened) */
  justify: boolean;
  /** the last line of its paragraph, or before a typed return */
  lastInParagraph: boolean;
  /** 0 for the first column */
  column: number;
  /** each word where it is drawn (justification applied): draw these to place words exactly */
  words?: LaidWord[];
}

export interface LaidText {
  lines: LaidLine[];
  font: FontSpec;
  color: string;
  sizePt: number;
  lineHeightMm: number;
  overflow: boolean;
}

/** a font's ascent and descent, as fractions of its size (descent positive, below the baseline) */
export type FontMetricsFn = (font: FontSpec) => { ascent: number; descent: number };

let injectedMetrics: FontMetricsFn | null = null;
/** replaces how a font's ascent and descent are read (tests; the PDF passes its own per call); null: the browser's */
export function setFontMetrics(fn: FontMetricsFn | null): void {
  injectedMetrics = fn;
}

const METRICS = new Map<string, { ascent: number; descent: number }>();
const METRIC_PX = 1000;
let metricsCtx: CanvasRenderingContext2D | null | undefined;
/* the browser's own (the canvas's fontBoundingBox, the box CSS lines use), taken at 1000 px so its rounding to whole
   pixels is far below a hair; where there is no browser, the usual 0.8 and 0.2 */
const browserMetrics: FontMetricsFn = (font) => {
  const key = cssFont(font, METRIC_PX);
  const hit = METRICS.get(key);
  if (hit) return hit;
  if (metricsCtx === undefined) {
    try {
      metricsCtx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
    } catch {
      metricsCtx = null;
    }
  }
  let out = { ascent: 0.8, descent: 0.2 };
  if (metricsCtx) {
    metricsCtx.font = key;
    const m = metricsCtx.measureText('Hg');
    const a = Number(m.fontBoundingBoxAscent);
    const d = Number(m.fontBoundingBoxDescent);
    if (a > 0 && Number.isFinite(d)) out = { ascent: a / METRIC_PX, descent: d / METRIC_PX };
  }
  if (METRICS.size > 400) METRICS.clear();
  METRICS.set(key, out);
  return out;
};

/** the words a frame shows: a page number frame its page's number, two digits at least, as BookCanvas draws it */
export function drawnTextOf(el: BookElement, pageNumber?: number): string {
  const text = el.text || '';
  if (el.type !== 'pageNumber') return text;
  return (text || '{{page}}').replace('{{page}}', pageNumber === undefined ? '00' : String(pageNumber).padStart(2, '0'));
}

/* a row of the text block as CSS stacks it */
interface Row {
  kind: 'line' | 'empty' | 'gap';
  h: number;
  /** the CSS block it belongs to (one block, or one per paragraph when paragraph gaps are drawn) */
  block: number;
  /** index in `laid` for a line, -1 otherwise */
  line: number;
}

interface PendingLine {
  pieces: Array<{ tok: number; spaces: number; text: string; w: number }>;
  indent: number;
  end: 'soft' | 'forced' | 'end';
  col: number;
  top: number;
}

/* balanced columns, as Chrome fills a multi-column block whose height is its content's: the shortest column height that
   lets every row fit in `cols` columns (a paragraph gap is dropped at a column's top) -> each row's column and top,
   or null when even then it doesn't fit. A paragraph keeps 2 lines at the foot of a column (orphans) and 2 at the head
   of the next (widows), as Chrome keeps them: the part of a paragraph that would leave fewer than 2 lines behind moves
   on whole (unless it began the column); a break that would leave fewer than 2 lines to go moves up while 2 stay
   behind, else it stays; and no column is shorter than 2 lines of a paragraph (so one of 2 lines is never cut). */
function balanceColumns(rows: Row[], cols: number, maxMm: number): { at: Array<{ col: number; top: number }>; height: number } | null {
  const lineRows = rows.filter((r) => r.kind !== 'gap');
  if (!lineRows.length) return { at: [], height: 0 };
  const total = rows.reduce((s, r) => s + r.h, 0);
  /* the tallest piece no break may cut: a paragraph's first 2 lines (orphans) */
  let tallest = Math.max(...lineRows.map((r) => r.h));
  for (let i = 0; i < rows.length; ) {
    if (rows[i].kind === 'gap') {
      i += 1;
      continue;
    }
    let j = i;
    let h = 0;
    while (j < rows.length && rows[j].kind !== 'gap' && rows[j].block === rows[i].block) {
      if (j - i < 2) h += rows[j].h;
      j += 1;
    }
    tallest = Math.max(tallest, h);
    i = j;
  }
  let H = Math.max(tallest, total / cols);
  const EPS = 1e-6;
  for (let attempt = 0; attempt < 400 && H <= maxMm + EPS; attempt++) {
    const at: Array<{ col: number; top: number }> = rows.map(() => ({ col: 0, top: 0 }));
    let col = 0;
    let y = 0;
    let shortage = Infinity;
    let ok = true;
    let i = 0;
    let colStart = 0; // the first row of this column
    while (i < rows.length) {
      const r = rows[i];
      if (r.kind === 'gap') {
        at[i] = { col, top: y };
        if (y > 0 && y + r.h <= H + EPS) y += r.h;
        else if (y > 0) {
          // a gap at a break is dropped; the next paragraph starts the next column
          shortage = Math.min(shortage, y + r.h - H);
          col += 1;
          y = 0;
          colStart = i + 1;
          if (col >= cols) {
            ok = false;
            break;
          }
        }
        i += 1;
        continue;
      }
      if (y + r.h <= H + EPS) {
        at[i] = { col, top: y };
        y += r.h;
        i += 1;
        continue;
      }
      shortage = Math.min(shortage, y + r.h - H);
      let k = i;
      const sameBlock = (j: number) => rows[j].kind !== 'gap' && rows[j].block === r.block;
      let after = 0;
      for (let j = i; j < rows.length && sameBlock(j); j++) after += 1;
      let before = 0;
      for (let j = i - 1; j >= colStart && sameBlock(j); j--) before += 1;
      if (before > 0 && before < 2) {
        // orphans: the paragraph's part moves on whole, unless it began the column
        const first = i - before;
        if (first > colStart) k = first;
      } else if (before >= 2 && after < 2) {
        // widows: lines move on with the last, while 2 stay behind
        const move = 2 - after;
        if (before - move >= 2) k = i - move;
      }
      col += 1;
      y = 0;
      colStart = k;
      if (col >= cols) {
        ok = false;
        break;
      }
      i = k;
    }
    if (ok) return { at, height: H };
    if (!(shortage > EPS) || !Number.isFinite(shortage)) shortage = Math.max(0.01, tallest * 0.01);
    H += shortage;
  }
  return null;
}

/**
 * The lines of a text frame as the canvas draws them, for the PDF and the PNG/JPG exports. Positions are in mm from
 * the frame's top-left (before its rotation). `pageNumber` resolves a page number frame's {{page}} as the canvas does;
 * `metrics` gives the font's ascent and descent (default: the browser's, as CSS uses them).
 */
export function layoutTextLines(
  el: BookElement,
  opts: { pageNumber?: number; metrics?: FontMetricsFn } = {}
): LaidText {
  const style = el.textStyle;
  const font: FontSpec = style
    ? fontOf(style)
    : { family: '', sizePt: 0, weight: 400, italic: false, letterSpacingEm: 0 };
  const out: LaidText = {
    lines: [],
    font,
    color: style?.color || '#1C1917',
    sizePt: font.sizePt,
    lineHeightMm: 0,
    overflow: false,
  };
  if (!style) return out;
  const text = drawnTextOf(el, opts.pageNumber);
  const box = textBoxOf(style, el.widthMm, el.heightMm);
  out.lineHeightMm = box.lineHeightMm;
  if (!text.trim() || !(box.lineHeightMm > 0)) return out;

  const toks = tokensOf(text);
  const pending: PendingLine[] = [];
  const rows: Row[] = [];
  let cur: PendingLine | null = null;
  let block = 0;
  const lineH = box.lineHeightMm;
  const blocksArePara = box.extraParagraphGapMm > 0;
  const rec: LayoutRecorder = {
    start(tok, indent, piece, w) {
      cur = { pieces: [{ tok, spaces: 0, text: piece, w }], indent, end: 'soft', col: 0, top: 0 };
    },
    append(tok, spaces, piece, w) {
      if (cur) cur.pieces.push({ tok, spaces, text: piece, w });
    },
    finish(end, inside, col, top) {
      if (!cur) return;
      cur.end = end;
      rows.push({ kind: 'line', h: lineH, block, line: inside ? pending.length : -1 });
      if (inside) {
        cur.col = col;
        cur.top = top;
        pending.push(cur);
      }
      cur = null;
    },
    empty() {
      rows.push({ kind: 'empty', h: lineH, block, line: -1 });
    },
    gap(h) {
      rows.push({ kind: 'gap', h, block: block + 1, line: -1 });
    },
    paragraph() {
      if (blocksArePara) block += 1;
    },
  };
  const lay = runLayout(text, toks, style, el.widthMm, el.heightMm, false, rec);
  out.overflow = reportOf(lay).isOverflowing;

  /* where each laid line goes: as laid (one column, or text that doesn't fit), or the columns balanced */
  let place: Array<{ col: number; top: number }> = pending.map((p) => ({ col: p.col, top: p.top }));
  let blockH = 0;
  if (box.columns > 1 && !out.overflow) {
    const tol = Math.max(0.05, lineH * 0.04);
    const balanced = balanceColumns(rows, box.columns, box.heightMm + tol);
    if (balanced) {
      /* the block is as tall as its balanced columns (CSS), which may be taller than what is in them */
      place = [];
      rows.forEach((r, ri) => {
        if (r.kind === 'line' && r.line >= 0) place[r.line] = balanced.at[ri];
      });
      blockH = balanced.height;
    } else {
      blockH = box.heightMm;
    }
  } else if (out.overflow) {
    blockH = box.heightMm;
  } else {
    blockH = rows.reduce((s, r) => s + r.h, 0);
  }
  const inset = Math.max(0, Number(style.insetMm) || 0);
  const slack = Math.max(0, box.heightMm - blockH);
  const shift = style.verticalAlign === 'middle' ? slack / 2 : style.verticalAlign === 'bottom' ? slack : 0;

  const measure = getMeasure();
  const spaceW = measure(' ', font);
  const m = (opts.metrics || injectedMetrics || browserMetrics)(font);
  const sizeMm = box.fontSizeMm;
  const baselineInLine = (lineH - (m.ascent + m.descent) * sizeMm) / 2 + m.ascent * sizeMm;
  const colW = box.columnWidthMm;

  pending.forEach((p, li) => {
    const at = place[li] || { col: p.col, top: p.top };
    const x0 = inset + at.col * (colW + box.columnGapMm);
    const top = inset + shift + at.top;
    /* words: pieces of one token on this line join into one word */
    const words: Array<{ text: string; spacesBefore: number; w: number }> = [];
    let lastTok = -1;
    for (const pc of p.pieces) {
      if (pc.tok === lastTok && pc.spaces === 0 && words.length) {
        words[words.length - 1].text += pc.text;
        words[words.length - 1].w += pc.w;
      } else words.push({ text: pc.text, spacesBefore: pc.spaces, w: pc.w });
      lastTok = pc.tok;
    }
    const indentW = p.indent * spaceW;
    let natural = indentW;
    words.forEach((w, wi) => {
      natural += (wi ? w.spacesBefore * spaceW : 0) + w.w;
    });
    const gaps = words.reduce((s, w, wi) => s + (wi ? w.spacesBefore : 0), 0);
    const fitsColumn = natural <= colW + WRAP_EPS_MM;
    const justify = style.textAlign === 'justify' && p.end === 'soft' && gaps > 0 && fitsColumn;
    const lastInParagraph = p.end !== 'soft';
    let startX = x0;
    if (fitsColumn && style.textAlign === 'center') startX = x0 + (colW - natural) / 2;
    else if (fitsColumn && style.textAlign === 'right') startX = x0 + colW - natural;
    const perSpace = justify ? (colW - natural) / gaps : 0;
    const laidWords: LaidWord[] = [];
    let x = startX + indentW;
    let lineText = ' '.repeat(p.indent);
    words.forEach((w, wi) => {
      if (wi) {
        x += w.spacesBefore * (spaceW + perSpace);
        lineText += ' '.repeat(w.spacesBefore);
      }
      laidWords.push({ text: w.text, xMm: x, widthMm: w.w });
      lineText += w.text;
      x += w.w;
    });
    out.lines.push({
      text: lineText,
      xMm: startX,
      yMm: top,
      widthMm: justify ? colW : natural,
      baselineMm: top + baselineInLine,
      justify,
      lastInParagraph,
      column: at.col,
      words: laidWords,
    });
  });
  return out;
}

/* ---------- splitting text at what fits ---------- */
const ABBREVIATION = /^(?:[A-Z]\.|(?:[A-Z]\.){2,}|Mr\.|Mrs\.|Ms\.|Dr\.|St\.|Sr\.|Jr\.|Prof\.|vs\.|e\.g\.|i\.e\.|No\.|Rs\.|Fig\.)$/i;
function endsSentence(word: string): boolean {
  return /[.!?…]["'”’»)\]]*$/.test(word) && !ABBREVIATION.test(word);
}

/* how many words to keep when `fitted` fit: the closest paragraph end within the last few words, else the closest
   sentence end (or line break), else every word that fits */
function cutPoint(text: string, toks: Tok[], fitted: number): number {
  if (fitted <= 0) return 0;
  const lookBack = Math.min(12, Math.floor(fitted / 3));
  const lowest = Math.max(1, fitted - lookBack);
  for (let k = fitted; k >= lowest; k--) if (toks[k] && toks[k].brk === 2) return k;
  for (let k = fitted; k >= lowest; k--) {
    if (toks[k] && toks[k].brk === 1) return k;
    if (endsSentence(text.slice(toks[k - 1].s, toks[k - 1].e))) return k;
  }
  return fitted;
}

export interface FrameFit {
  fits: boolean;
  fittingText: string;
  rest: string;
  overflowWords: number;
}

/**
 * Splits `text` into what fits `el` (its size and type) and the rest, at a word boundary, preferring the end of a
 * paragraph or a sentence within the last few words. Nothing is lost: fittingText + the whitespace between them +
 * rest is `text`. `fits` is false also when a single word is wider than the frame (it would be cut off at the edge);
 * overflowWords counts those words too.
 */
export function fitTextToFrame(el: BookElement, text: string): FrameFit {
  const source = String(text ?? '');
  if (!el.textStyle) return { fits: true, fittingText: source, rest: '', overflowWords: 0 };
  const toks = tokensOf(source);
  if (!toks.length) return { fits: true, fittingText: source, rest: '', overflowWords: 0 };
  const lay = layoutOf(source, el.textStyle, el.widthMm, el.heightMm, true);
  if (lay.fitted >= toks.length) {
    return { fits: lay.tooWide.length === 0, fittingText: source, rest: '', overflowWords: lay.tooWide.length };
  }
  /* the cut is always at a space (a word broken at a hyphen moves on whole) */
  const keep = cutPoint(source, toks, lay.fitted);
  const cutOff = lay.tooWide.filter((i) => i < keep).length;
  return {
    fits: false,
    fittingText: keep === 0 ? '' : source.slice(0, toks[keep - 1].e),
    rest: source.slice(toks[keep].s),
    overflowWords: toks.length - keep + cutOff,
  };
}

/* ---------- how much a frame holds ---------- */
/* plain editorial copy of everyday word lengths (about 4.8 letters a word), in paragraphs of about 70 words */
const TYPICAL_COPY = (
  'The book opens with a short account of how the project began and who took part in it. Each chapter then ' +
  'follows one place, one idea or one group of people, with photographs chosen to show the work as it was done. ' +
  'Where figures are given they come from the teams themselves, and the dates are those of the events described. ' +
  'The aim throughout has been to keep the words close to the pictures, so that a reader can turn to any page and ' +
  'find a complete story told in a few paragraphs, with room for the images to speak for themselves.'
).split(' ');
const PARAGRAPH_WORDS = 70;

function typicalCopy(words: number): string {
  let out = '';
  for (let i = 0; i < words; i++) {
    const w = TYPICAL_COPY[i % TYPICAL_COPY.length];
    out += i === 0 ? w : i % PARAGRAPH_WORDS === 0 ? `\n\n${w}` : ` ${w}`;
  }
  return out;
}

const CAPACITY = new Map<string, number>();

/** About how many words of typical copy fit the frame as it is set (its size, columns, type and spacing). */
export function frameCapacityWords(el: BookElement): number {
  if (!el.textStyle) return 0;
  const key = `${measureGeneration()}|${styleKey(el.textStyle)}|${el.widthMm}|${el.heightMm}`;
  const known = CAPACITY.get(key);
  if (known !== undefined) return known;
  const box = textBoxOf(el.textStyle, el.widthMm, el.heightMm);
  let words = 0;
  if (box.lineHeightMm > 0) {
    const lines = box.columns * Math.floor((box.heightMm + Math.max(0.05, box.lineHeightMm * 0.04)) / box.lineHeightMm);
    const perLine = Math.max(1, Math.ceil(box.columnWidthMm / Math.max(0.2, box.fontSizeMm * 2.4)));
    // a first guess from the frame's lines, doubled until some of the sample is left over
    let guess = Math.max(16, Math.ceil(lines * perLine * 1.25));
    for (let tries = 0; tries < 8; tries++) {
      const sample = typicalCopy(guess);
      const lay = runLayout(sample, tokenize(sample), el.textStyle, el.widthMm, el.heightMm, true);
      words = lay.fitted;
      if (lay.fitted < guess || guess >= 40000) break;
      guess = Math.min(40000, guess * 2);
    }
  }
  CAPACITY.set(key, words);
  if (CAPACITY.size > 2000) CAPACITY.delete(CAPACITY.keys().next().value as string);
  return words;
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

/* =====================================================================================================================
   Fixing text that does not fit (a Designer's: each changes the design). None moves anything else on the page or
   silently cuts words; each says whether the words now fit.
   ===================================================================================================================== */
export interface FitFix {
  element: BookElement;
  /** the words fit after the change */
  fits: boolean;
  /** words that still do not fit after it (0 when they fit) */
  overflowWords: number;
  /** anything was changed */
  changed: boolean;
  /** the fix went as far as it sensibly goes */
  atLimit: boolean;
}

function withStyle(el: BookElement, patch: Partial<TextStyle>): BookElement {
  return { ...el, textStyle: { ...(el.textStyle as TextStyle), ...patch } };
}

function fitState(el: BookElement): { fits: boolean; overflowWords: number } {
  const r = measureTextOverflow(el);
  return { fits: !r.isOverflowing, overflowWords: r.overflowWords };
}

function unchanged(el: BookElement, atLimit: boolean): FitFix {
  return { element: el, ...fitState(el), changed: false, atLimit };
}

/* the largest value in `grid` (ascending) for which make(value) fits, or null (fit grows with the value's index) */
function largestFitting<T>(grid: T[], make: (v: T) => BookElement): T | null {
  let lo = 0;
  let hi = grid.length - 1;
  let best: T | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (fitState(make(grid[mid])).fits) {
      best = grid[mid];
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return best;
}

function smallestFitting<T>(grid: T[], make: (v: T) => BookElement): T | null {
  let lo = 0;
  let hi = grid.length - 1;
  let best: T | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (fitState(make(grid[mid])).fits) {
      best = grid[mid];
      hi = mid - 1;
    } else lo = mid + 1;
  }
  return best;
}

const BODY_ROLES: Array<TextRole | undefined> = ['body', 'quote', undefined];
const SMALL_ROLES: TextRole[] = ['caption', 'folio', 'running_head'];

/** The smallest type size Shrink to fit may use: body text never below the design system's approved minimum. */
export function minimumSizePt(el: BookElement, minApprovedBodyPt: number): number {
  const current = Number(el.textStyle?.fontSizePt) || 0;
  const approved = Number(minApprovedBodyPt) || 8;
  let floor: number;
  if (BODY_ROLES.includes(el.textRole)) floor = approved;
  else if (SMALL_ROLES.includes(el.textRole as TextRole)) floor = 6;
  else floor = Math.max(approved, current * 0.6);
  return Math.min(current, Math.ceil(floor * 2) / 2);
}

/** Shrink to fit: the largest size (in half points) at which the words fit, never below minimumSizePt. When even the
    minimum does not fit, nothing changes (fits: false, atLimit: true). */
export function shrinkTextToFit(el: BookElement, minApprovedBodyPt: number): FitFix & { minimumPt: number } {
  const minimumPt = minimumSizePt(el, minApprovedBodyPt);
  if (!el.textStyle) return { ...unchanged(el, true), minimumPt };
  if (fitState(el).fits) return { ...unchanged(el, false), minimumPt };
  const current = Number(el.textStyle.fontSizePt) || 0;
  const grid: number[] = [];
  for (let s = Math.ceil(minimumPt * 2) / 2; s < current - 0.001; s += 0.5) grid.push(Number(s.toFixed(1)));
  const best = largestFitting(grid, (s) => withStyle(el, { fontSizePt: s }));
  if (best === null) {
    const atMin = withStyle(el, { fontSizePt: minimumPt });
    return { element: el, fits: false, overflowWords: fitState(atMin).overflowWords, changed: false, atLimit: true, minimumPt };
  }
  return { element: withStyle(el, { fontSizePt: best }), fits: true, overflowWords: 0, changed: true, atLimit: false, minimumPt };
}

function leadingFloor(el: BookElement): number {
  if (el.textRole === 'display' || el.textRole === 'heading') return 0.95;
  if (el.textRole === 'subheading') return 1.05;
  return 1.15;
}

/** Tighten spacing: first the paragraph gap where it is larger than a line, then the leading (in steps of 0.05, not
    below 1.15 for body text, 1.05 for subheadings, 0.95 for headings). As much as needed; when even the tightest
    sensible spacing does not fit, that is applied and fits is false. */
export function tightenSpacingToFit(el: BookElement): FitFix {
  if (!el.textStyle) return unchanged(el, true);
  if (fitState(el).fits) return unchanged(el, false);
  const st = el.textStyle;
  const fontMm = (Number(st.fontSizePt) || 0) * PT_TO_MM;
  const lh0 = Number(st.lineHeight) || 1.4;
  const sp0 = Number(st.paragraphSpacingMm) || 0;
  const floor10 = (v: number) => Math.floor(v * 10 + 1e-9) / 10;

  // 1. the paragraph gap, where it is drawn wider than an empty line
  let sp1 = sp0;
  const line0 = fontMm * lh0;
  if (sp0 > line0 + 0.05) {
    const grid: number[] = [];
    for (let v = Math.ceil(line0 * 2) / 2; v < sp0 - 0.001; v += 0.5) grid.push(Number(v.toFixed(1)));
    const best = largestFitting(grid, (v) => withStyle(el, { paragraphSpacingMm: v }));
    if (best !== null) return { element: withStyle(el, { paragraphSpacingMm: best }), fits: true, overflowWords: 0, changed: true, atLimit: false };
    sp1 = floor10(line0);
  }

  // 2. the leading; the paragraph gap is kept from growing past the empty line as lines get closer
  const at = (lh: number) => withStyle(el, { lineHeight: lh, paragraphSpacingMm: Math.min(sp1, floor10(fontMm * lh)) });
  const lowest = Math.min(lh0, leadingFloor(el));
  const grid: number[] = [];
  for (let k = Math.ceil((lowest - 1e-9) * 20); k / 20 < lh0 - 0.001; k++) grid.push(Number((k / 20).toFixed(2)));
  const best = largestFitting(grid, at);
  if (best !== null) return { element: at(best), fits: true, overflowWords: 0, changed: true, atLimit: false };
  const tightest = at(grid.length ? grid[0] : lh0);
  const ts = tightest.textStyle as TextStyle;
  const changed = ts.lineHeight !== st.lineHeight || ts.paragraphSpacingMm !== st.paragraphSpacingMm;
  return { element: changed ? tightest : el, ...fitState(changed ? tightest : el), changed, atLimit: true };
}

/** Make the frame taller: the smallest height (in half millimetres) at which the words fit, its bottom never past
    `maxBottomMm` (the page's bottom margin). When even that does not fit, the frame reaches it and fits is false. */
export function growFrameToFit(el: BookElement, maxBottomMm: number): FitFix {
  if (!el.textStyle) return unchanged(el, true);
  if (fitState(el).fits) return unchanged(el, false);
  const maxH = Number((maxBottomMm - el.yMm).toFixed(2));
  if (!(maxH > el.heightMm + 0.05)) return unchanged(el, true);
  const grid: number[] = [];
  for (let h = el.heightMm + 0.5; h < maxH - 0.001; h += 0.5) grid.push(Number(h.toFixed(2)));
  grid.push(maxH);
  const best = smallestFitting(grid, (h) => ({ ...el, heightMm: h }));
  if (best !== null) return { element: { ...el, heightMm: best }, fits: true, overflowWords: 0, changed: true, atLimit: best >= maxH };
  const tallest = { ...el, heightMm: maxH };
  return { element: tallest, ...fitState(tallest), changed: true, atLimit: true };
}

/* Phase 1's names, kept for whoever still calls them; each is now the measured fix above. */
export function fitTextWithinApprovedLimits(el: BookElement, minApprovedPt: number): BookElement {
  return shrinkTextToFit(el, minApprovedPt).element;
}

export function tightenParagraphSpacing(el: BookElement): BookElement {
  return tightenSpacingToFit(el).element;
}

export function expandFrameHeightForText(el: BookElement, maxPageHeightMm: number): BookElement {
  return growFrameToFit(el, maxPageHeightMm - 8).element;
}

/**
 * Splits a frame's text for "Continue on the next page": what fits stays, the rest continues. Measured with
 * fitTextToFrame; at least one word stays, and two words or fewer are never split.
 */
export function splitOverflowTextForContinuation(el: BookElement): {
  fittingText: string;
  continuationText: string;
} {
  const full = (el.text || '').trim();
  const words = full ? full.split(/\s+/) : [];
  if (!el.textStyle || words.length <= 2) return { fittingText: full, continuationText: '' };
  const fit = fitTextToFrame(el, full);
  if (!fit.rest) return { fittingText: full, continuationText: '' };
  if (!fit.fittingText) {
    // nothing fits at all: the first word stays, so the frame is not left empty
    const m = /^\S+/.exec(full);
    const first = m ? m[0] : '';
    return { fittingText: first, continuationText: full.slice(first.length).trimStart() };
  }
  return { fittingText: fit.fittingText, continuationText: fit.rest };
}

export function findTextElementsOnPage(page: BookPage): BookElement[] {
  return page.elements.filter((e) => e.type === 'text');
}
