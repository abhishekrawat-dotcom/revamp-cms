// How wide a run of text is in a frame's real font: the one measure every fit check in the editor uses
// (textEngine.ts: the canvas's red outline, the Properties panel's overflow box, the pre-export check, Auto-Flow's
// frame capacities). Phase 1's estimate took 0.52 × the font size for every letter; this asks the browser itself.
//
//   canvasMeasure()  the browser's: a canvas that is never put on the page, drawing with the same CSS font the canvas
//                    shows the frame in (`<weight> <size>px "<family>", serif`, italic when set), so a Google font is
//                    measured as it is drawn. Widths are kept per font and word at one reference size and scaled
//                    (text widths grow in proportion to the size), so a 300-page book measures each word once.
//   setMeasure(fn)   replaces it (tests inject a fake); setMeasure(null) goes back to the browser's.
//   getMeasure()     the measure in use; where there is no browser (Node), a plain estimate.
//   useFontsVersion() a React hook whose value changes whenever fonts finish loading (document.fonts 'loadingdone',
//                    and once at document.fonts.ready): a component that calls it draws again, and textEngine's
//                    memory of earlier layouts is keyed by measureGeneration(), so nothing measured before a font
//                    arrived sticks. Widths taken while a font is still loading are dropped when it has loaded.
import { useSyncExternalStore } from 'react';

export type FontSpec = { family: string; sizePt: number; weight: number; italic: boolean; letterSpacingEm: number };
/** the width of `text` in `font`, in millimetres (letter spacing included, after every character, as CSS draws it) */
export type MeasureFn = (text: string, font: FontSpec) => number;

export const PT_TO_MM = 25.4 / 72;
/* the size widths are taken at: large enough that the browser's rounding is far below a hair's width */
const REF_PX = 64;
/* per font, at most this many words remembered (a whole book's vocabulary is far less) */
const MAX_WORDS_PER_FONT = 60000;

let injected: MeasureFn | null = null;
let browser: MeasureFn | null = null;
let generation = 1;
const listeners = new Set<() => void>();

function notify(): void {
  generation += 1;
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {
      /* a listener's own trouble is not the measure's */
    }
  });
}

/** changes whenever a measurement could have changed: a font finished loading, or the measure was replaced */
export function measureGeneration(): number {
  return generation;
}

export function subscribeMeasure(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function setMeasure(fn: MeasureFn | null): void {
  injected = fn;
  notify();
}

export function getMeasure(): MeasureFn {
  if (injected) return injected;
  if (!browser) browser = hasCanvas() ? canvasMeasure() : estimateMeasure;
  return browser;
}

/** the CSS font the canvas draws a frame's text in (BookCanvas: fontFamily `"<family>", serif`) */
export function cssFont(font: Pick<FontSpec, 'family' | 'weight' | 'italic'>, px: number): string {
  const family = String(font.family || '').replace(/["\\]/g, '').trim();
  const weight = Math.round(Number(font.weight) || 400);
  return `${font.italic ? 'italic ' : ''}${weight} ${px}px ${family ? `"${family}", ` : ''}serif`;
}

function charCount(text: string): number {
  let n = 0;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  for (const _ of text) n += 1;
  return n;
}

function toMm(em: number, text: string, font: FontSpec): number {
  const sizeMm = (Number(font.sizePt) || 0) * PT_TO_MM;
  return em * sizeMm + (Number(font.letterSpacingEm) || 0) * sizeMm * charCount(text);
}

/* ---------- where there is no browser: a plain estimate (never used in the editor itself) ---------- */
const NARROW = new Set(Array.from(`il.,;:'!|ftrjI()[]"`));
const WIDE = new Set(Array.from('mwMW@%'));
export const estimateMeasure: MeasureFn = (text, font) => {
  let em = 0;
  for (const ch of text) {
    if (ch === ' ') em += 0.26;
    else if (NARROW.has(ch)) em += 0.3;
    else if (WIDE.has(ch)) em += 0.85;
    else if (ch >= 'A' && ch <= 'Z') em += 0.66;
    else em += 0.52;
  }
  return toMm(em, text, font);
};

/* ---------- the browser's ---------- */
let ctx: CanvasRenderingContext2D | null | undefined;
let ctxFont = '';
const EM_WIDTHS = new Map<string, Map<string, number>>();
let watching = false;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

function hasCanvas(): boolean {
  return context() !== null;
}

function context(): CanvasRenderingContext2D | null {
  if (ctx !== undefined) return ctx;
  try {
    ctx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
  } catch {
    ctx = null;
  }
  return ctx;
}

function fontSet(): FontFaceSet | null {
  return typeof document !== 'undefined' && document.fonts ? document.fonts : null;
}

/* a font finished loading (or failed): every width is taken again, and whoever draws is told */
function refreshSoon(): void {
  if (refreshTimer !== null) return;
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    EM_WIDTHS.clear();
    ctxFont = '';
    notify();
  }, 30);
}

function watchFonts(): void {
  if (watching) return;
  const fonts = fontSet();
  if (!fonts) return;
  watching = true;
  try {
    fonts.addEventListener('loadingdone', refreshSoon);
    fonts.addEventListener('loadingerror', refreshSoon);
    void fonts.ready.then(refreshSoon, refreshSoon);
  } catch {
    /* an old browser without font events: the widths stay as first taken */
  }
}

/* a font the page knows but has not loaded yet (a Google font whose stylesheet arrived): ask for it, and take every
   width again once it is in. Until then the browser draws, and so measures, its fallback. Each font is asked for
   once: one that failed to download stays "not loaded", and asking again would measure the book again forever. */
const ASKED = new Set<string>();
function askForFont(font: string): void {
  const fonts = fontSet();
  if (!fonts || ASKED.has(font)) return;
  ASKED.add(font);
  try {
    if (!fonts.check(font)) void fonts.load(font).then(refreshSoon, refreshSoon);
  } catch {
    /* a family name the browser cannot read: measured with the fallback, as it is drawn */
  }
}

export function canvasMeasure(): MeasureFn {
  watchFonts();
  return (text, font) => {
    const c = context();
    if (!c) return estimateMeasure(text, font);
    const key = cssFont(font, REF_PX);
    let widths = EM_WIDTHS.get(key);
    if (!widths) {
      widths = new Map();
      EM_WIDTHS.set(key, widths);
      askForFont(key);
    }
    let em = widths.get(text);
    if (em === undefined) {
      if (ctxFont !== key) {
        c.font = key;
        ctxFont = key;
      }
      em = c.measureText(text).width / REF_PX;
      if (widths.size < MAX_WORDS_PER_FONT) widths.set(text, em);
    }
    return toMm(em, text, font);
  };
}

/** a value that changes when fonts finish loading, so whoever calls it measures again with the real font */
export function useFontsVersion(): number {
  getMeasure();
  return useSyncExternalStore(subscribeMeasure, measureGeneration, measureGeneration);
}
