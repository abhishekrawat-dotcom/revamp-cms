import type { BookElement, BookPage, BookProject, MasterPage } from '../types/bookstudio';

/**
 * Applies a Master Page to a target page while preserving any user-added or overridden content elements.
 */
export function applyMasterToPage(page: BookPage, master: MasterPage, replaceAll = false): BookPage {
  const clonedMasterElements: BookElement[] = master.elements.map((mel, idx) => ({
    ...structuredClone(mel),
    id: `el_${page.id}_m_${mel.id}_${idx}`,
    masterElementId: mel.id,
    overriddenFromMaster: false,
  }));

  if (replaceAll) {
    return {
      ...page,
      masterPageId: master.id,
      detachedFromMaster: false,
      backgroundColor: master.backgroundColor,
      elements: clonedMasterElements,
    };
  }

  // Keep user-created and overridden elements, replace non-overridden master-linked items
  const keptLocalElements = page.elements.filter(
    (el) => !el.masterElementId || el.overriddenFromMaster
  );

  // Avoid duplicating master elements that were overridden
  const overriddenMasterIds = new Set(
    keptLocalElements.map((e) => e.masterElementId).filter(Boolean)
  );
  const activeMasterItems = clonedMasterElements.filter(
    (mel) => !overriddenMasterIds.has(mel.masterElementId)
  );

  return {
    ...page,
    masterPageId: master.id,
    detachedFromMaster: false,
    backgroundColor: master.backgroundColor,
    elements: [...activeMasterItems, ...keptLocalElements],
  };
}

/**
 * Propagates edits made on a Master Page to every linked, non-detached page in the book,
 * while strictly preserving individual page overrides.
 */
export function syncMasterChangesAcrossBook(
  project: BookProject,
  updatedMaster: MasterPage
): BookProject {
  const nextMasters = project.masterPages.map((m) =>
    m.id === updatedMaster.id ? updatedMaster : m
  );

  const nextPages = project.pages.map((page) => {
    if (page.masterPageId !== updatedMaster.id || page.detachedFromMaster) {
      return page;
    }
    return applyMasterToPage(page, updatedMaster, false);
  });

  return {
    ...project,
    masterPages: nextMasters,
    pages: nextPages,
  };
}

/**
 * Detaches a page from its Master Page so all elements become independent local objects.
 */
export function detachPageFromMaster(page: BookPage): BookPage {
  return {
    ...page,
    detachedFromMaster: true,
    elements: page.elements.map((el) => ({
      ...el,
      masterElementId: undefined,
      overriddenFromMaster: false,
    })),
  };
}

/**
 * Captures an existing page as a reusable Master Page.
 */
export function createMasterFromPage(page: BookPage, name: string, description: string): MasterPage {
  return {
    id: `master_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name,
    role: page.role,
    description,
    backgroundColor: page.backgroundColor,
    elements: page.elements.map((el) => ({
      ...structuredClone(el),
      masterElementId: undefined,
      overriddenFromMaster: false,
    })),
    isBuiltIn: false,
  };
}

/* What a new page shares with one of the book's own layouts (the owner, 26 Nov 2026: a new page is made from the book's
   layouts, so a Content editor may add one too; lib/book-rules.js checks a new page's settings whole): */

/** the page settings of a page made from a master page: linked to it, with its background */
export function pageLookFromMaster(master: MasterPage): Pick<BookPage, 'masterPageId' | 'backgroundColor'> {
  return { masterPageId: master.id, backgroundColor: master.backgroundColor };
}

/** the page settings of a copy of an existing page: everything but its id, place, label, chapter, type and frames */
export function pageLookFromPage(page: BookPage): Omit<BookPage, 'id' | 'orderIndex' | 'label' | 'chapterId' | 'role' | 'elements'> {
  const { id, orderIndex, label, chapterId, role, elements, ...look } = page;
  void id; void orderIndex; void label; void chapterId; void role; void elements;
  return structuredClone(look);
}

/** a new page's settings when nothing says which layout: the first master page's, else the current page's (or, in a
    book with neither, the first page's, else a plain paper page) */
export function newPageLook(
  project: BookProject,
  current?: BookPage | null
): Pick<BookPage, 'backgroundColor'> & Partial<Pick<BookPage, 'masterPageId' | 'detachedFromMaster' | 'dimensionsOverride'>> {
  const master = project.masterPages[0];
  if (master) return pageLookFromMaster(master);
  const src = current || project.pages[0];
  if (src) return pageLookFromPage(src);
  return { backgroundColor: project.designSystem.colors.paper };
}
