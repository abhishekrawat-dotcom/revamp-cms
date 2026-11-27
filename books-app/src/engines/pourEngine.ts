/* The content workflow (Books Phase 3, 27 Nov 2026): pouring the manuscript into the book's own text frames (no AI),
   choosing the layout a new page is made from, and the editorial word counts. Pure functions only: nothing here
   measures text itself (the caller passes the real-font fit and overflow measures from textEngine) and nothing here
   imports at run time, so a test can bundle this file alone.

   What the pour never does (lib/book-rules.js decides what is design): move, resize or restyle a frame, add or remove
   a frame on an existing page, or change a page's settings. It writes a frame's words and its contentSectionId, marks
   each placed manuscript section with where it starts, and (when the person chose it) adds pages made from one of the
   book's own layouts, which a Content editor may do too. */
import type { BookElement, BookPage, BookProject, ContentSection, PageRole } from '../types/bookstudio';

/* ---------- words ---------- */

/** the number of words in a text (as textEngine.countWords counts them) */
export function wordsIn(text?: string | null): number {
  if (!text || !text.trim()) return 0;
  return text.trim().split(/\s+/).length;
}

/** what goes between two manuscript sections poured into one frame: a paragraph break */
export const SECTION_BREAK = '\n\n';

/* ---------- placeholder words ---------- */

/** the words the editor itself puts in a new frame (App.tsx createElementFromKind): a frame still holding them is empty */
export const NEW_FRAME_TEXTS = [
  'Section Heading',
  'ARCHITECTURAL SUBHEADING',
  'Double-click to edit editorial copy inside this locked frame. Surrounding photography and grids remain undisturbed.',
  'Plate 04 — Hand-finished travertine colonnade at late afternoon.',
  '“True luxury in print lies in measured silence, generous margins, and the weight of honest paper.”',
];

/** "Lorem ipsum" and the like: sample words, never anyone's text */
const SAMPLE_WORDS = /\blorem\s+ipsum\b|\bdolor\s+sit\s+amet\b|\bconsectetur\s+adipiscing\b|^(click|double-click|tap) (here )?to (edit|add|type)\b|^(your|add your|type your|enter your) (text|copy|heading|title|caption|quote)\b/i;

export function normText(t?: string | null): string {
  return String(t || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * The words a template put in the book's frames, which count as empty: the master pages' frames, the pages of the
 * built-in template the book was made from (matched by its design system's sourceTemplateName), and the editor's own
 * new-frame words. A template's one-word labels ("Contents", "Index") are left out: they are the book's structure,
 * not sample copy.
 */
export function collectPlaceholderTexts(
  project: BookProject,
  templates?: Array<{ name: string; buildPages: () => BookPage[] }>
): Set<string> {
  const out = new Set<string>();
  const add = (t?: string) => {
    const n = normText(t);
    if (n && n.split(' ').length > 1) out.add(n);
  };
  NEW_FRAME_TEXTS.forEach((t) => out.add(normText(t)));
  (project.masterPages || []).forEach((m) => (m.elements || []).forEach((el) => add(el.text)));
  const source = project.designSystem?.sourceTemplateName;
  const tpl = source && templates ? templates.find((t) => t.name === source) : undefined;
  if (tpl) {
    try {
      tpl.buildPages().forEach((p) => p.elements.forEach((el) => add(el.text)));
    } catch {
      /* a template that cannot be built adds nothing */
    }
  }
  return out;
}

/** true when a frame's words are empty or are a template's sample words (placeholders) */
export function isPlaceholderText(text: string | undefined | null, placeholders?: Set<string>): boolean {
  const n = normText(text);
  if (!n) return true;
  if (SAMPLE_WORDS.test(n)) return true;
  return !!placeholders && placeholders.has(n);
}

/* ---------- frames and their kinds ---------- */

/** the kinds the pour matches: a manuscript section goes only into a frame of its kind */
export type FrameGroup = 'heading' | 'body' | 'quote' | 'caption';

export const GROUP_LABEL: Record<FrameGroup, string> = {
  heading: 'heading',
  body: 'body text',
  quote: 'quote',
  caption: 'caption',
};

/** a text frame's kind, or null for a frame the pour never fills (running heads, page numbers, hidden frames) */
export function groupOfFrame(el: BookElement): FrameGroup | null {
  if (el.type !== 'text' || el.hidden) return null;
  switch (el.textRole) {
    case 'display':
    case 'heading':
    case 'subheading':
      return 'heading';
    case 'quote':
      return 'quote';
    case 'caption':
      return 'caption';
    case 'folio':
    case 'running_head':
      return null;
    default:
      return 'body';
  }
}

export function groupOfSection(kind: ContentSection['kind']): FrameGroup {
  if (kind === 'heading' || kind === 'subheading') return 'heading';
  if (kind === 'quote') return 'quote';
  if (kind === 'caption') return 'caption';
  return 'body'; // body, interview
}

/** frames within this many millimetres of each other's top edge are read as one row, left to right */
const ROW_MM = 3;

/** a page's frames in reading order: top to bottom, and left to right within a row */
export function readingOrder<T extends { xMm: number; yMm: number }>(elements: T[]): T[] {
  const byTop = [...elements].sort((a, b) => a.yMm - b.yMm || a.xMm - b.xMm);
  const rows: T[][] = [];
  for (const el of byTop) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(el.yMm - row[0].yMm) <= ROW_MM) row.push(el);
    else rows.push([el]);
  }
  return rows.flatMap((r) => r.sort((a, b) => a.xMm - b.xMm));
}

/* ---------- where each manuscript section is ---------- */

export interface SectionPlace {
  placed: boolean;
  pageIds: string[];
  pageNumbers: number[];
  /** the frame the section starts in, when it is on a page */
  firstElementId?: string;
}

/** each section's place in the book: the frames that carry it (contentSectionId), or the frame it was assigned to */
export function sectionPlacement(project: BookProject): Record<string, SectionPlace> {
  const out: Record<string, SectionPlace> = {};
  const pageIndex = new Map<string, number>();
  const elementPage = new Map<string, number>();
  project.pages.forEach((p, i) => {
    pageIndex.set(p.id, i);
    p.elements.forEach((el) => elementPage.set(el.id, i));
  });
  for (const s of project.contentSections) {
    const pages = new Set<number>();
    let first: string | undefined;
    project.pages.forEach((p, i) => {
      for (const el of p.elements) {
        if (el.contentSectionId === s.id && wordsIn(el.text) > 0) {
          pages.add(i);
          if (!first) first = el.id;
        }
      }
    });
    if (s.assignedElementId && elementPage.has(s.assignedElementId)) {
      pages.add(elementPage.get(s.assignedElementId)!);
      first = s.assignedElementId;
    }
    const idx = [...pages].sort((a, b) => a - b);
    out[s.id] = {
      placed: idx.length > 0,
      pageIds: idx.map((i) => project.pages[i].id),
      pageNumbers: idx.map((i) => i + 1),
      firstElementId: first,
    };
  }
  return out;
}

/** the manuscript sections on no page, in manuscript order */
export function sectionsNotPlaced(project: BookProject): ContentSection[] {
  const where = sectionPlacement(project);
  return manuscriptOrder(project.contentSections).filter((s) => !where[s.id]?.placed);
}

export function manuscriptOrder(sections: ContentSection[]): ContentSection[] {
  return sections
    .map((s, i) => ({ s, i }))
    .sort((a, b) => (a.s.orderIndex ?? a.i) - (b.s.orderIndex ?? b.i) || a.i - b.i)
    .map((x) => x.s);
}

/* ---------- a new page's layout ---------- */

export interface PageLayoutChoice {
  /** 'master:<id>' | 'page:<id>' | 'blank:<id>' */
  id: string;
  kind: 'master' | 'page' | 'blank';
  sourceId: string;
  label: string;
  /** what the new page gets, in plain words */
  detail: string;
}

let idSeq = 0;
function defaultId(prefix: string): string {
  idSeq = (idSeq + 1) % 1e6;
  return `${prefix}_${Date.now().toString(36)}_${idSeq.toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

function textFrameCount(elements: BookElement[]): number {
  return elements.filter((e) => groupOfFrame(e) !== null).length;
}

/**
 * The layouts a new page can be made from (book-rules accepts each from a Content editor): every master page, by name;
 * a copy of the given page; and, for Designers, an empty page with that page's background.
 */
export function pageLayoutChoices(
  project: BookProject,
  currentPage: BookPage | null | undefined,
  opts: { includeBlank?: boolean } = {}
): PageLayoutChoice[] {
  const out: PageLayoutChoice[] = [];
  for (const m of project.masterPages || []) {
    const n = m.elements.length;
    const t = textFrameCount(m.elements);
    out.push({
      id: `master:${m.id}`,
      kind: 'master',
      sourceId: m.id,
      label: m.name || 'Master page',
      detail: t
        ? `${n} frame${n === 1 ? '' : 's'}, ${t} for text, with the master page's sample words`
        : `${n} frame${n === 1 ? '' : 's'}, none for text`,
    });
  }
  if (currentPage) {
    const idx = project.pages.findIndex((p) => p.id === currentPage.id);
    const n = currentPage.elements.length;
    out.push({
      id: `page:${currentPage.id}`,
      kind: 'page',
      sourceId: currentPage.id,
      label: `A copy of page ${idx + 1}${currentPage.label ? ` (${currentPage.label})` : ''}`,
      detail: `the same ${n} frame${n === 1 ? '' : 's'}, with its words and photos left out (running heads, page numbers and charts stay)`,
    });
    if (opts.includeBlank) {
      out.push({
        id: `blank:${currentPage.id}`,
        kind: 'blank',
        sourceId: currentPage.id,
        label: `An empty page like page ${idx + 1}`,
        detail: 'its background and page settings, with no frames',
      });
    }
  }
  return out;
}

/** the kinds of text frame a layout's page has (what a pour can put on it) */
export function layoutKinds(project: BookProject, choiceId: string): Set<FrameGroup> {
  const page = pageFromLayout(project, choiceId, { newId: () => 'probe' });
  return new Set((page ? page.elements.map(groupOfFrame) : []).filter(Boolean) as FrameGroup[]);
}

/** the layout to offer first for the pages a pour adds: one with every kind of frame still needed, else one with body
    frames, else one with any text frame, else the first */
export function suggestedLayout(project: BookProject, choices: PageLayoutChoice[], needed: FrameGroup[]): string {
  const kinds = choices.map((c) => ({ id: c.id, k: layoutKinds(project, c.id) }));
  const all = kinds.find((x) => needed.length > 0 && needed.every((g) => x.k.has(g)));
  const body = kinds.find((x) => x.k.has('body'));
  const any = kinds.find((x) => x.k.size > 0);
  return (all || body || any || kinds[0] || { id: '' }).id;
}

/** the page settings a copy of a page keeps: everything but its id, place, label, chapter, type and frames */
function pageSettingsOf(page: BookPage): Partial<BookPage> {
  const { id, orderIndex, label, chapterId, role, elements, ...look } = page;
  void id; void orderIndex; void label; void chapterId; void role; void elements;
  return JSON.parse(JSON.stringify(look));
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

/**
 * A new page made from a layout of the book (see pageLayoutChoices): its frames are copies with new ids, and its
 * settings (background, master link, size) are the layout's.
 *   - from a master page: linked to it, its frames with the words the master has (the template's own words);
 *   - a copy of a page: its frames, with the words of its text frames and its photos left out; running heads, page
 *     numbers and infographics (charts) stay as they are;
 *   - an empty page: the page's settings and no frames.
 */
export function pageFromLayout(
  project: BookProject,
  choiceId: string,
  opts: { label?: string; chapterId?: string; newId?: (prefix: string) => string } = {}
): BookPage | null {
  const newId = opts.newId || defaultId;
  const [kind, ...rest] = String(choiceId || '').split(':');
  const sourceId = rest.join(':');
  const base = { id: newId('pg'), orderIndex: 0, label: opts.label || 'New page', ...(opts.chapterId ? { chapterId: opts.chapterId } : {}) };
  if (kind === 'master') {
    const m = (project.masterPages || []).find((x) => x.id === sourceId);
    if (!m) return null;
    return {
      ...base,
      role: m.role as PageRole,
      masterPageId: m.id,
      backgroundColor: m.backgroundColor,
      elements: m.elements.map((el) => {
        const copy = clone(el);
        delete copy.contentSectionId;
        return { ...copy, id: newId('el'), masterElementId: el.id, overriddenFromMaster: false };
      }),
    };
  }
  const src = project.pages.find((p) => p.id === sourceId);
  if (!src) return null;
  const settings = pageSettingsOf(src);
  if (kind === 'blank') {
    return { ...settings, ...base, role: src.role, elements: [] } as BookPage;
  }
  if (kind !== 'page') return null;
  const groups = new Map<string, string>();
  return {
    ...settings,
    ...base,
    role: src.role,
    elements: src.elements.map((el) => {
      const copy = clone(el);
      copy.id = newId('el');
      if (copy.groupId) {
        if (!groups.has(copy.groupId)) groups.set(copy.groupId, newId('grp'));
        copy.groupId = groups.get(copy.groupId);
      }
      delete copy.contentSectionId;
      if (copy.type === 'text' && copy.textRole !== 'folio' && copy.textRole !== 'running_head') copy.text = '';
      if (copy.type === 'image' && copy.image) {
        copy.image = {
          ...copy.image,
          src: '',
          assetId: undefined,
          alt: 'Empty image frame',
          naturalWidth: undefined,
          naturalHeight: undefined,
          captionText: undefined,
          zoom: 1,
          focalX: 50,
          focalY: 50,
          originalCrop: { zoom: 1, focalX: 50, focalY: 50, fit: copy.image.fit || 'cover' },
        };
      }
      return copy;
    }),
  } as BookPage;
}

/** the book with `pages` put in after the page `afterPageId` (at the end when it is not found), page order renumbered */
export function insertPagesAfter(project: BookProject, afterPageId: string | null, pages: BookPage[]): BookProject {
  const list = [...project.pages];
  const at = afterPageId ? list.findIndex((p) => p.id === afterPageId) : -1;
  list.splice(at >= 0 ? at + 1 : list.length, 0, ...pages);
  return { ...project, pages: list.map((p, i) => ({ ...p, orderIndex: i })) };
}

/* ---------- the pour ---------- */

export interface FitResult {
  fits: boolean;
  fittingText: string;
  rest: string;
  overflowWords: number;
}
/** textEngine.fitTextToFrame: how much of `text` fits `el`, measured with the real font */
export type FitFn = (el: BookElement, text: string) => FitResult;

export interface PourOptions {
  /** the sections to place; they go in manuscript order whatever order this lists them in */
  sectionIds: string[];
  /** the page the pour starts on */
  startPageId?: string;
  /** "Replace text in frames that already have words": off, only empty frames and placeholders are filled */
  replaceExisting?: boolean;
  /** the template's own words (collectPlaceholderTexts): a frame holding them counts as empty */
  placeholders?: Set<string>;
  fit: FitFn;
  /** when the book's frames run out: add pages made from this layout (a PageLayoutChoice id); none = stop */
  addPagesFrom?: string | null;
  /** a Designer's pour marks a master page's frame as changed on this page, as typing in it does (Content editors: no) */
  markOverridden?: boolean;
  /** the most pages one pour may add */
  maxAddedPages?: number;
  newId?: (prefix: string) => string;
}

export interface PourPiece {
  pageId: string;
  pageNumber: number;
  elementId: string;
  elementName: string;
  words: number;
  isNewPage: boolean;
}

export interface PourPlacement {
  sectionId: string;
  title: string;
  kind: ContentSection['kind'];
  words: number;
  pieces: PourPiece[];
}

export interface PourLeftover {
  sectionId: string;
  title: string;
  kind: ContentSection['kind'];
  words: number;
  /** why it was not placed, in plain words */
  why: string;
}

export interface PourPlan {
  /** the book after the pour (apply it as one change) */
  project: BookProject;
  placements: PourPlacement[];
  leftovers: PourLeftover[];
  sectionsPlaced: number;
  framesUsed: number;
  /** the page numbers (in the poured book) that receive words */
  pageNumbers: number[];
  pagesAdded: number;
  /** where the added pages go: after this page number (0 = none added) */
  addedAfterPageNumber: number;
  wordsPlaced: number;
  wordsLeftOver: number;
  /** frames of a matching kind left alone because they already have words (the replace box was not ticked) */
  framesKeptWithWords: number;
  /** selected sections that were already on a page: they will be on the pages twice */
  alreadyPlaced: string[];
  /** the last of the book's own pages that gets words; '' when none */
  lastExistingPageId: string;
  summary: string;
}

interface Slot {
  /** the page's index in the book; an added page counts on from the book's last page */
  pageIdx: number;
  isNew: boolean;
  el: BookElement;
  group: FrameGroup;
  /** reading position across the whole sequence */
  pos: number;
  /** may the pour write here */
  usable: boolean;
  /** the words the pour puts here (null: untouched) */
  text: string | null;
  sectionId?: string;
  /** too small for one word: passed over */
  skipped?: boolean;
}

interface Item {
  section: ContentSection;
  group: FrameGroup;
  text: string;
  words: number;
}

interface FlowState {
  /** the reading position of the last heading or body frame used */
  flowPos: number;
  /** the body frame the last body section ended in, still open for the next body section */
  openBody: Slot | null;
  /** the page the flow is on (quotes and captions go here or later) */
  curPage: number;
}

const FLOW: Record<FrameGroup, boolean> = { heading: true, body: true, quote: false, caption: false };

/**
 * Plans pouring manuscript sections into the book's text frames, without changing any frame's place, size or style.
 *
 * Order: frames are read in page order from the start page, and on a page top to bottom, then left to right.
 * Kinds: a heading goes to a heading, title or subheading frame; body text and interviews to body frames; a quote to a
 * quote frame; a caption to a caption frame.
 * Headings and body text keep strict reading order (a section never goes into a frame read before the previous one);
 * consecutive body sections share a frame, a paragraph break between them, as far as it fits. Quotes and captions go
 * into the first free frame of their kind on the page the text has reached, or the next page that has one.
 * Each frame is filled only as far as `fit` says fits; the rest goes on into the next frame of its kind.
 * Frames that already have words are left alone unless `replaceExisting`; empty frames and template words count as free.
 * When the frames run out, either pages from the chosen layout are added after the last page that has received words
 * and the text reads on there, or the pour stops. A section is placed whole or not at all; when heading or body text
 * cannot be placed, everything after it is kept back too, so nothing is placed out of order; what was not placed is
 * listed with its words and why. A manuscript section's own text is never changed.
 */
export function planPour(project: BookProject, options: PourOptions): PourPlan {
  const fit = options.fit;
  const newId = options.newId || defaultId;
  const maxAdded = Math.max(0, options.maxAddedPages ?? 200);
  const replace = !!options.replaceExisting;
  const pages = project.pages;
  const startIdx = Math.max(0, pages.findIndex((p) => p.id === options.startPageId));

  const wanted = new Set(options.sectionIds);
  const where = sectionPlacement(project);
  const items: Item[] = manuscriptOrder(project.contentSections)
    .filter((s) => wanted.has(s.id))
    .map((s) => {
      const text = String(s.body || '').trim();
      return { section: s, group: groupOfSection(s.kind), text, words: wordsIn(text) };
    })
    .filter((it) => it.words > 0);
  const alreadyPlaced = items.filter((it) => where[it.section.id]?.placed).map((it) => it.section.id);
  const groupsWanted = new Set(items.map((it) => it.group));

  /* the existing frames, in reading order from the start page */
  let framesKeptWithWords = 0;
  const seq: Slot[] = [];
  for (let i = startIdx; i < pages.length; i++) {
    for (const el of readingOrder(pages[i].elements.filter((e) => groupOfFrame(e) !== null))) {
      const group = groupOfFrame(el)!;
      const usable = replace || isPlaceholderText(el.text, options.placeholders);
      if (!usable && groupsWanted.has(group)) framesKeptWithWords += 1;
      seq.push({ pageIdx: i, isNew: false, el, group, pos: seq.length, usable, text: null });
    }
  }
  const existingCount = seq.length;
  const kindsInBook = new Set(seq.map((s) => s.group));

  /* pages from the chosen layout, made one at a time as the words need them. They go in after the last page that has
     received words when the first one is made; from then on, the book's pages after that one are not used, so the
     text reads on into the new pages without a jump */
  const layoutId = options.addPagesFrom || null;
  const probe = layoutId ? pageFromLayout(project, layoutId, { newId: () => 'probe' }) : null;
  const layoutKinds = new Set((probe ? probe.elements.map(groupOfFrame) : []).filter(Boolean) as FrameGroup[]);
  const newPages: BookPage[] = [];
  let insertAfterIdx: number | null = null;
  let limitHit = false;
  const lastUsedIdx = () => {
    let m = -1;
    for (let k = 0; k < existingCount; k++) if (seq[k].text !== null && seq[k].pageIdx > m) m = seq[k].pageIdx;
    return m;
  };
  const grow = (): Slot[] | null => {
    if (!probe) return null;
    if (newPages.length >= maxAdded) {
      limitHit = true;
      return null;
    }
    if (insertAfterIdx === null) {
      const m = lastUsedIdx();
      insertAfterIdx = m >= 0 ? m : startIdx;
    }
    const page = pageFromLayout(project, layoutId!, { chapterId: pages[insertAfterIdx]?.chapterId, newId });
    if (!page) return null;
    newPages.push(page);
    const pageIdx = pages.length + newPages.length - 1;
    const added: Slot[] = readingOrder(page.elements.filter((e) => groupOfFrame(e) !== null)).map((el) => ({
      pageIdx,
      isNew: true,
      el,
      group: groupOfFrame(el)!,
      pos: seq.length,
      usable: true,
      text: null,
    }));
    added.forEach((s, k) => (s.pos = seq.length + k));
    seq.push(...added);
    return added;
  };
  const ungrow = (added: Slot[]) => {
    seq.splice(seq.length - added.length, added.length);
    newPages.pop();
    if (!newPages.length) insertAfterIdx = null;
  };
  /* may the pour write in this frame now */
  const open = (x: Slot) => x.usable && x.text === null && !x.skipped && (x.isNew || insertAfterIdx === null || x.pageIdx <= insertAfterIdx);

  /* one section into the frames, whole or not at all */
  const placeItem = (item: Item, st: FlowState): { used: Slot[] } | { fail: 'none' | 'limit' | 'small' } => {
    const undo: Array<() => void> = [];
    const used: Slot[] = [];
    const flow = FLOW[item.group];
    const minPage = st.curPage;
    const canGrow = !!probe && layoutKinds.has(item.group);
    let cursor = flow ? st.flowPos : -1;
    let rest = item.text;
    let grewWithoutProgress = 0;
    let failure: 'none' | 'limit' | 'small' = 'none';

    const write = (s: Slot, text: string) => {
      const prevText = s.text;
      const prevSec = s.sectionId;
      undo.push(() => {
        s.text = prevText;
        s.sectionId = prevSec;
      });
      s.text = text;
      if (!s.sectionId) s.sectionId = item.section.id;
      used.push(s);
    };

    /* a body section goes on in the body frame the previous one ended in, as far as it fits */
    const ob = st.openBody;
    if (item.group === 'body' && ob && ob.pos === st.flowPos && ob.text) {
      const existing = ob.text;
      const combined = existing + SECTION_BREAK + rest;
      const r = fit(ob.el, combined);
      if (r.fits) {
        write(ob, combined);
        rest = '';
      } else if (wordsIn(r.fittingText) > wordsIn(existing) && startsWithWords(r.fittingText, existing)) {
        write(ob, r.fittingText.trim());
        rest = String(r.rest || '').trim();
      }
    }

    while (rest) {
      const s = seq.find((x) => x.group === item.group && open(x) && x.pos > cursor && (flow || x.pageIdx >= minPage));
      if (!s) {
        if (!canGrow) break;
        if (grewWithoutProgress >= 2) {
          failure = 'small';
          break;
        }
        const added = grow();
        if (!added) {
          failure = limitHit ? 'limit' : 'none';
          break;
        }
        undo.push(() => ungrow(added));
        grewWithoutProgress += 1;
        continue;
      }
      const r = fit(s.el, rest);
      /* a heading goes whole into one frame, never split across small ones: a frame it doesn't fit is passed over */
      const piece = r.fits ? rest : item.group === 'heading' ? '' : String(r.fittingText || '').trim();
      if (!wordsIn(piece)) {
        /* too small for one word: passed over, in reading order */
        undo.push(() => {
          s.skipped = false;
        });
        s.skipped = true;
        cursor = s.pos;
        continue;
      }
      write(s, piece);
      grewWithoutProgress = 0;
      cursor = s.pos;
      rest = r.fits ? '' : String(r.rest || '').trim();
    }

    if (rest) {
      for (let k = undo.length - 1; k >= 0; k--) undo[k]();
      return { fail: failure };
    }
    const last = used[used.length - 1];
    if (flow && last) {
      st.flowPos = last.pos;
      st.openBody = item.group === 'body' ? last : null;
      st.curPage = last.pageIdx;
    }
    return { used };
  };

  /* the pour, in manuscript order. When heading or body text cannot be placed, it stops there: what follows is kept
     back, so nothing is placed out of order */
  const framesOf = new Map<string, Slot[]>();
  const leftovers: PourLeftover[] = [];
  const st: FlowState = { flowPos: -1, openBody: null, curPage: startIdx };
  let flowStopped = false;
  for (const item of items) {
    if (flowStopped) {
      leftovers.push(leftoverOf(item, 'it comes after text that did not fit, so it was kept back to keep the order'));
      continue;
    }
    const r = placeItem(item, st);
    if ('used' in r) {
      framesOf.set(item.section.id, r.used);
      continue;
    }
    const kind = GROUP_LABEL[item.group];
    let why: string;
    if (r.fail === 'limit') why = `the pour stops at ${plural(maxAdded, 'added page')}`;
    else if (r.fail === 'small') why = `the ${kind} frames of the layout you chose are too small for it`;
    else if (probe && !layoutKinds.has(item.group)) why = `the free ${kind} frames ran out, and the layout you chose has no ${kind} frame`;
    else if (!kindsInBook.has(item.group)) why = `there is no ${kind} frame from the start page on`;
    else why = `the free ${kind} frames ran out`;
    leftovers.push(leftoverOf(item, why));
    if (FLOW[item.group]) flowStopped = true;
  }

  /* the poured book: only words and the section each frame carries change. A page the pour added keeps every frame of
     its layout; the text frames it did not fill are left empty, so no sample words print */
  const textFor = new Map<string, Slot>();
  seq.forEach((s) => {
    if (s.text !== null) textFor.set(s.el.id, s);
  });
  const markOverridden = !!options.markOverridden;
  const applyTo = (el: BookElement): BookElement => {
    const s = textFor.get(el.id);
    if (!s) return el;
    const next: BookElement = { ...el, text: s.text!, contentSectionId: s.sectionId };
    if (markOverridden && el.masterElementId) next.overriddenFromMaster = true;
    return next;
  };
  const keptNew = newPages
    .filter((p) => p.elements.some((el) => textFor.has(el.id)))
    .map((p) => ({
      ...p,
      elements: p.elements.map((el) => (textFor.has(el.id) ? applyTo(el) : groupOfFrame(el) ? { ...el, text: '' } : el)),
    }));
  const afterIdx = insertAfterIdx ?? startIdx;
  const afterPage = pages[afterIdx];
  let poured: BookProject = { ...project, pages: pages.map((p) => ({ ...p, elements: p.elements.map(applyTo) })) };
  if (keptNew.length) poured = insertPagesAfter(poured, afterPage ? afterPage.id : null, keptNew);
  const newIds = new Set(keptNew.map((p) => p.id));
  const numberOf = new Map<string, number>();
  poured.pages.forEach((p, i) => {
    numberOf.set(p.id, i + 1);
    if (newIds.has(p.id)) p.label = `Page ${i + 1}`;
  });
  const pageOfEl = new Map<string, BookPage>();
  poured.pages.forEach((p) => p.elements.forEach((el) => pageOfEl.set(el.id, p)));

  /* placements, in manuscript order, each with the frames it went into */
  const placements: PourPlacement[] = [];
  for (const item of items) {
    const used = framesOf.get(item.section.id);
    if (!used || !used.length) continue;
    placements.push({
      sectionId: item.section.id,
      title: item.section.title,
      kind: item.section.kind,
      words: item.words,
      pieces: used.map((s) => {
        const pg = pageOfEl.get(s.el.id)!;
        return {
          pageId: pg.id,
          pageNumber: numberOf.get(pg.id) || 0,
          elementId: s.el.id,
          elementName: s.el.name,
          words: wordsIn(s.text),
          isNewPage: s.isNew,
        };
      }),
    });
  }

  /* each placed section marked with where it starts; a section whose frame was written over loses that mark (or takes
     another frame that still carries it) */
  const startOf = new Map(placements.map((p) => [p.sectionId, p.pieces[0]]));
  const carried = new Map<string, { pageId: string; elementId: string }>();
  poured.pages.forEach((p) =>
    p.elements.forEach((el) => {
      if (el.contentSectionId && wordsIn(el.text) > 0 && !carried.has(el.contentSectionId)) carried.set(el.contentSectionId, { pageId: p.id, elementId: el.id });
    })
  );
  poured.contentSections = project.contentSections.map((s) => {
    const start = startOf.get(s.id);
    if (start) return { ...s, assignedPageId: start.pageId, assignedElementId: start.elementId };
    if (s.assignedElementId && textFor.has(s.assignedElementId)) {
      const still = carried.get(s.id);
      return still
        ? { ...s, assignedPageId: still.pageId, assignedElementId: still.elementId }
        : { ...s, assignedPageId: undefined, assignedElementId: undefined };
    }
    return s;
  });

  const plan: PourPlan = {
    project: poured,
    placements,
    leftovers,
    sectionsPlaced: placements.length,
    framesUsed: textFor.size,
    pageNumbers: [...new Set(placements.flatMap((p) => p.pieces.map((x) => x.pageNumber)))].sort((a, b) => a - b),
    pagesAdded: keptNew.length,
    addedAfterPageNumber: keptNew.length ? afterIdx + 1 : 0,
    wordsPlaced: placements.reduce((a, p) => a + p.words, 0),
    wordsLeftOver: leftovers.reduce((a, l) => a + l.words, 0),
    framesKeptWithWords,
    alreadyPlaced,
    lastExistingPageId: (() => {
      const m = lastUsedIdx();
      return m >= 0 ? pages[m].id : '';
    })(),
    summary: '',
  };
  plan.summary = pourSummary(plan);
  return plan;
}

/** do `text`'s first words read as `prefix`'s words (whitespace aside) */
function startsWithWords(text: string, prefix: string): boolean {
  const a = String(text || '').trim().split(/\s+/);
  const b = String(prefix || '').trim().split(/\s+/);
  if (b.length > a.length) return false;
  for (let i = 0; i < b.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function leftoverOf(item: Item, why: string): PourLeftover {
  return { sectionId: item.section.id, title: item.section.title, kind: item.section.kind, words: item.words, why };
}

function plural(n: number, one: string, many?: string): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many || one + 's'}`;
}

/** "12 sections into 9 frames on pages 3–8; 2 pages will be added; 0 words left over" */
export function pourSummary(plan: Pick<PourPlan, 'sectionsPlaced' | 'framesUsed' | 'pageNumbers' | 'pagesAdded' | 'wordsLeftOver'>): string {
  const nums = plan.pageNumbers;
  const where = !nums.length ? '' : nums.length === 1 ? ` on page ${nums[0]}` : ` on pages ${nums[0]}–${nums[nums.length - 1]}`;
  const parts = [
    `${plural(plan.sectionsPlaced, 'section')} into ${plural(plan.framesUsed, 'frame')}${where}`,
    plan.pagesAdded ? `${plural(plan.pagesAdded, 'page')} will be added` : 'no pages added',
    `${plural(plan.wordsLeftOver, 'word')} left over`,
  ];
  return parts.join('; ');
}

/* ---------- the editorial word counts ---------- */

export type OverflowMeasure = (el: BookElement) => { isOverflowing: boolean; overflowWords: number };

export interface FrameRef {
  pageId: string;
  pageNumber: number;
  elementId: string;
  elementName: string;
  words: number;
  overflowWords?: number;
}

export interface CountRow {
  key: string;
  label: string;
  words: number;
  characters: number;
  pageIds: string[];
  pageCount: number;
}

export interface PageCountRow extends CountRow {
  pageNumber: number;
  chapterTitle: string;
  textFrames: number;
  overflowing: number;
  empty: number;
  sample: number;
}

export interface EditorialCounts {
  totalWords: number;
  totalCharacters: number;
  pages: PageCountRow[];
  spreads: CountRow[];
  chapters: CountRow[];
  overflowing: FrameRef[];
  empty: FrameRef[];
  /** frames still holding a template's sample words: they print as they are */
  sample: FrameRef[];
  /** manuscript sections on no page */
  notPlaced: Array<{ id: string; title: string; kind: ContentSection['kind']; words: number }>;
  sectionsPlaced: number;
}

function charsIn(text?: string): number {
  return text ? text.length : 0;
}

/**
 * The book's words and characters per page, per spread (the cover alone, then facing pairs) and per chapter; the text
 * frames whose words don't fit, the empty ones and those still holding sample words; and the manuscript sections on
 * no page. Hidden frames are left out (they do not print). Editorial data only: never drawn on a page or exported.
 */
export function editorialCounts(project: BookProject, measure: OverflowMeasure, placeholders?: Set<string>): EditorialCounts {
  const chapterTitle = new Map(project.chapters.map((c) => [c.id, c.title]));
  const pages: PageCountRow[] = [];
  const overflowing: FrameRef[] = [];
  const empty: FrameRef[] = [];
  const sample: FrameRef[] = [];
  let totalWords = 0;
  let totalCharacters = 0;

  project.pages.forEach((page, i) => {
    let words = 0;
    let characters = 0;
    let textFrames = 0;
    let ov = 0;
    let em = 0;
    let sa = 0;
    for (const el of readingOrder(page.elements)) {
      if (el.type !== 'text' || el.hidden) continue;
      textFrames += 1;
      const w = wordsIn(el.text);
      words += w;
      characters += charsIn(el.text);
      const ref = { pageId: page.id, pageNumber: i + 1, elementId: el.id, elementName: el.name || 'Text frame', words: w };
      if (w === 0) {
        em += 1;
        empty.push(ref);
        continue;
      }
      if (groupOfFrame(el) && isPlaceholderText(el.text, placeholders)) {
        sa += 1;
        sample.push(ref);
      }
      const m = measure(el);
      if (m.isOverflowing) {
        ov += 1;
        overflowing.push({ ...ref, overflowWords: m.overflowWords });
      }
    }
    totalWords += words;
    totalCharacters += characters;
    pages.push({
      key: page.id,
      label: page.label || `Page ${i + 1}`,
      pageNumber: i + 1,
      chapterTitle: page.chapterId ? chapterTitle.get(page.chapterId) || '' : '',
      words,
      characters,
      pageIds: [page.id],
      pageCount: 1,
      textFrames,
      overflowing: ov,
      empty: em,
      sample: sa,
    });
  });

  const spreads: CountRow[] = [];
  if (pages.length) {
    spreads.push({ key: 'cover', label: 'Page 1 (cover)', words: pages[0].words, characters: pages[0].characters, pageIds: [pages[0].key], pageCount: 1 });
    for (let i = 1; i < pages.length; i += 2) {
      const a = pages[i];
      const b = pages[i + 1];
      spreads.push({
        key: a.key,
        label: b ? `Pages ${a.pageNumber}–${b.pageNumber}` : `Page ${a.pageNumber}`,
        words: a.words + (b ? b.words : 0),
        characters: a.characters + (b ? b.characters : 0),
        pageIds: b ? [a.key, b.key] : [a.key],
        pageCount: b ? 2 : 1,
      });
    }
  }

  const chapters: CountRow[] = project.chapters.map((ch) => {
    const rows = pages.filter((p) => project.pages[p.pageNumber - 1].chapterId === ch.id);
    return {
      key: ch.id,
      label: ch.title,
      words: rows.reduce((a, r) => a + r.words, 0),
      characters: rows.reduce((a, r) => a + r.characters, 0),
      pageIds: rows.map((r) => r.key),
      pageCount: rows.length,
    };
  });
  const known = new Set(project.chapters.map((c) => c.id));
  const loose = pages.filter((p) => {
    const c = project.pages[p.pageNumber - 1].chapterId;
    return !c || !known.has(c);
  });
  if (loose.length) {
    chapters.push({
      key: '__none',
      label: 'Not in a chapter',
      words: loose.reduce((a, r) => a + r.words, 0),
      characters: loose.reduce((a, r) => a + r.characters, 0),
      pageIds: loose.map((r) => r.key),
      pageCount: loose.length,
    });
  }

  const where = sectionPlacement(project);
  const ordered = manuscriptOrder(project.contentSections);
  const notPlaced = ordered
    .filter((s) => !where[s.id]?.placed)
    .map((s) => ({ id: s.id, title: s.title, kind: s.kind, words: wordsIn(s.body) }));

  return {
    totalWords,
    totalCharacters,
    pages,
    spreads,
    chapters,
    overflowing,
    empty,
    sample,
    notPlaced,
    sectionsPlaced: ordered.length - notPlaced.length,
  };
}
