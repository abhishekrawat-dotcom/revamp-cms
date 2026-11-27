// The shared Books rules (functions/lib/book-rules.js): what is design and what is content, and how two people's saves
// of one book are put together. The server refuses a Content editor's design change with the same file, so the editor
// takes it in whole (esbuild bundles the CommonJS file) instead of keeping a second copy that could drift.
import rules from '../../../functions/lib/book-rules.js';
import type { BookProject } from '../types/bookstudio';

export interface MergeConflict {
  id: string;
  kind: 'book' | 'page' | 'frame' | 'contentSections' | 'imageAssets' | 'masterPages';
  pageId?: string;
  elementId?: string;
  itemId?: string;
  field: string;
  label: string;
  mine: unknown;
  theirs: unknown;
}

export type ConflictChoice = 'mine' | 'theirs';

interface Rules {
  designChanges(before: unknown, after: unknown): string[];
  mergeBooks(base: unknown, mine: unknown, theirs: unknown): { merged: unknown; conflicts: MergeConflict[] };
  resolveConflicts(merged: unknown, conflicts: MergeConflict[], choices: Record<string, ConflictChoice>): unknown;
  same(a: unknown, b: unknown): boolean;
}
const R = rules as unknown as Rules;

/** The design changes `after` makes to `before`, as sentences ([] = content only). */
export function designChanges(before: BookProject, after: BookProject): string[] {
  return R.designChanges(before, after);
}

/** The same book, field for field (key order and undefined fields aside). */
export function sameBook(a: BookProject, b: BookProject): boolean {
  return R.same(a, b);
}

/* The time of the last change is not something two people disagree about: each side's is set aside before the merge
   (it would otherwise be a conflict on every save), and the merged book gets the time it was put together. */
function withoutTime(b: BookProject, at: string): BookProject {
  return { ...b, updatedAt: at };
}

/** A three-way merge of this tab's book (mine) and the newest saved one (theirs), from the copy both started at. */
export function mergeBooks(base: BookProject, mine: BookProject, theirs: BookProject): { merged: BookProject; conflicts: MergeConflict[] } {
  const at = theirs.updatedAt;
  const r = R.mergeBooks(withoutTime(base, at), withoutTime(mine, at), withoutTime(theirs, at));
  return { merged: { ...(r.merged as BookProject), updatedAt: new Date().toISOString() }, conflicts: r.conflicts };
}

/** The merged book with each conflict settled the way the person chose (theirs is already in `merged`). */
export function resolveConflicts(merged: BookProject, conflicts: MergeConflict[], choices: Record<string, ConflictChoice>): BookProject {
  return R.resolveConflicts(merged, conflicts, choices) as BookProject;
}

/* An earlier or later state of this tab's history, moved onto the newest saved book: what the history step changed
   from the copy both started at is kept, and everything the other person changed is taken (where both changed the
   same thing, theirs). Undo and redo then never take back the other person's work. */
export function rebaseOnto(base: BookProject, state: BookProject, latest: BookProject): BookProject {
  if (state.id !== latest.id) return state;
  return mergeBooks(base, state, latest).merged;
}
