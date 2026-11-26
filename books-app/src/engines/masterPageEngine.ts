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
