import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AiEditorialSuggestion,
  AlignAction,
  BookElement,
  BookPage,
  BookProject,
  BookSummary,
  BookTemplate,
  CustomSavedTemplate,
  ImageAsset,
  InDesignTool,
  InfographicData,
  InfographicTemplate,
  PageRotation,
  ProjectVersion,
  UserFontCollection,
} from './types/bookstudio';
import {
  deleteProjectById,
  knownBase,
  loadBook,
  loadBookList,
  loadCustomTemplates,
  loadFontCollections,
  loadLatest,
  loadMe,
  restoreDeletedPage,
  saveCustomTemplate,
  saveFontCollection,
  saveProject,
  sendPresence,
  setBookStatus,
  uploadImageAssets,
  type BooksMe,
  type DeletedPage,
  type PresenceEntry,
} from './services/storageService';
import { ApiError, currentUser, errorText, setActiveBookId, type SignedInUser } from './services/api';
import {
  designChanges,
  mergeBooks,
  rebaseOnto,
  resolveConflicts,
  sameBook,
  type ConflictChoice,
  type MergeConflict,
} from './services/bookRules';
import { personName } from './services/people';
import { exportProjectBackupPackage } from './engines/exportEngine';
import {
  createInitialSampleProject,
  createProjectFromBookTemplate,
} from './data/sampleProject';
import { EDITORIAL_PHOTOS } from './data/curatedAssets';
import { BUILTIN_INFOGRAPHIC_TEMPLATES } from './data/infographicTemplates';
import { ensureProjectFontsLoaded } from './engines/fontEngine';
import { getEffectivePageDimensions } from './engines/dimensionEngine';
import {
  applyMasterToPage,
  createMasterFromPage,
  detachPageFromMaster,
  newPageLook,
  syncMasterChangesAcrossBook,
} from './engines/masterPageEngine';
import {
  computeEditorialAnalytics,
  splitOverflowTextForContinuation,
} from './engines/textEngine';
import {
  alignAndDistributeElements,
  createProjectFromBookTemplateObject,
} from './engines/unlimitedTemplateEngine';
import { InDesignControlBar } from './components/InDesignControlBar';
import { InDesignToolPalette } from './components/InDesignToolPalette';
import { LeftSidebar, type ComponentDragKind } from './components/LeftSidebar';
import { BookCanvas } from './components/BookCanvas';
import { RightPropertiesPanel } from './components/RightPropertiesPanel';
import { BottomPageNavigator } from './components/BottomPageNavigator';
import { DashboardView } from './components/DashboardView';
import { TemplateUploadModal } from './components/TemplateUploadModal';
import { TemplateLibraryModal } from './components/TemplateLibraryModal';
import { TypographyStudioModal } from './components/TypographyStudioModal';
import { PageDimensionsModal } from './components/PageDimensionsModal';
import { ContentManagerModal } from './components/ContentManagerModal';
import { GlobalDesignSystemModal } from './components/GlobalDesignSystemModal';
import { AiAssistantDrawer } from './components/AiAssistantDrawer';
import { ExportPreflightModal } from './components/ExportPreflightModal';
import { VersionHistoryModal } from './components/VersionHistoryModal';
import { AiAutoFlowModal } from './components/AiAutoFlowModal';
import { MergeConflictsModal, type MergeDialogState } from './components/MergeConflictsModal';

type ActiveModal =
  | null
  | 'upload_template'
  | 'dimensions'
  | 'design_system'
  | 'typography'
  | 'content'
  | 'templates'
  | 'infographics'
  | 'auto_flow'
  | 'export'
  | 'versions'
  | 'ai_assistant';

/* The studio always holds one book in memory so its panels have something to draw; until a real book is opened that
   is this sample, which is never listed, never saved and never edited (requireBook). */
const PLACEHOLDER_ID = 'proj_forms_of_silence_sample';

/* what the dashboard lists for a book this tab holds in full */
function summaryOf(p: BookProject, extra?: Partial<BookSummary>): BookSummary {
  let words = 0;
  for (const page of p.pages)
    for (const el of page.elements) if (el.text && el.text.trim()) words += el.text.trim().split(/\s+/).length;
  return {
    id: p.id,
    name: p.name,
    status: p.status,
    subtitle: p.subtitle || '',
    category: p.category || '',
    unit: p.unit,
    coverThumbnail: p.coverThumbnail || '',
    dimensions: { widthMm: p.dimensions.widthMm, heightMm: p.dimensions.heightMm },
    pageCount: p.pages.length,
    wordCount: words,
    createdAt: p.createdAt,
    createdBy: '',
    updatedAt: p.updatedAt,
    updatedBy: '',
    ...(extra || {}),
  };
}

interface Notice {
  kind: 'error' | 'info';
  text: string;
  bookId?: string;
}

/* The parts of the studio that change the design: a Content editor is not offered them (the owner, 26 Nov 2026:
   "Content editor = everything except the design"), and the guard in commitProjectUpdate refuses whatever is left. */
const DESIGN_MODALS: Partial<Record<NonNullable<ActiveModal>, string>> = {
  upload_template: 'Only a Designer can import a design template.',
  dimensions: 'Only a Designer can change the page size, margins and bleed.',
  design_system: 'Only a Designer can change the design system.',
  typography: 'Only a Designer can change fonts and text styles.',
  templates: 'Only a Designer can start a book or add layouts from the template library.',
  infographics: 'Only a Designer can add a new infographic. You can change the data, labels and chart type of the ones on the page.',
};

/** what a Content editor sees on a refused change: the rules' own first reason */
function designRefusal(why: string[]): string {
  const first = String(why[0] || 'the design would change').replace(/[.\s]+$/, '');
  return `Only a Designer can change the design: ${first}.`;
}

/* a merge in progress: what it was put together from, kept while the person chooses */
interface PendingMerge {
  bookId: string;
  base: BookProject;
  latest: BookProject;
  mine: BookProject;
  merged: BookProject;
  conflicts: MergeConflict[];
  updatedBy: string;
}

const DEFAULT_FONT_COLLECTION: UserFontCollection = {
  id: 'default_editorial_fonts',
  name: 'My Editorial Fonts',
  fonts: ['Playfair Display', 'Cormorant Garamond', 'Lora', 'Plus Jakarta Sans', 'JetBrains Mono'],
  presets: [],
  updatedAt: new Date().toISOString(),
};

function createElementFromKind(
  kind: ComponentDragKind,
  project: BookProject,
  xMm: number,
  yMm: number,
  zIndex: number,
  customElement?: BookElement
): BookElement {
  if (customElement) {
    return {
      ...structuredClone(customElement),
      id: `el_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      xMm,
      yMm,
      zIndex,
    };
  }

  const ds = project.designSystem;
  const id = `el_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const base = {
    id,
    xMm: Number(xMm.toFixed(1)),
    yMm: Number(yMm.toFixed(1)),
    rotation: 0,
    opacity: 1,
    locked: false,
    hidden: false,
    zIndex,
  };

  switch (kind) {
    case 'heading':
      return {
        ...base,
        name: 'Editorial Heading',
        type: 'text',
        widthMm: 140,
        heightMm: 22,
        textRole: 'heading',
        text: 'Section Heading',
        textStyle: {
          fontFamily: ds.typography.headingFont,
          fontSizePt: ds.typography.scale.headingPt,
          fontWeight: 500,
          color: ds.colors.ink,
          lineHeight: 1.15,
          letterSpacingEm: -0.01,
          textAlign: 'left',
          verticalAlign: 'top',
          paragraphSpacingMm: 3,
          columns: 1,
          columnGapMm: 5,
          insetMm: 0,
        },
      };
    case 'subheading':
      return {
        ...base,
        name: 'Subheading',
        type: 'text',
        widthMm: 120,
        heightMm: 12,
        textRole: 'subheading',
        text: 'ARCHITECTURAL SUBHEADING',
        textStyle: {
          fontFamily: ds.typography.captionFont,
          fontSizePt: 10.5,
          fontWeight: 600,
          color: ds.colors.primaryAccent,
          lineHeight: 1.3,
          letterSpacingEm: 0.14,
          textAlign: 'left',
          verticalAlign: 'top',
          paragraphSpacingMm: 2,
          columns: 1,
          columnGapMm: 5,
          insetMm: 0,
          textTransform: 'uppercase',
        },
      };
    case 'paragraph':
    case 'text_box':
      return {
        ...base,
        name: kind === 'text_box' ? 'Text Frame' : 'Editorial Paragraph',
        type: 'text',
        widthMm: 140,
        heightMm: 62,
        textRole: 'body',
        text: 'Double-click to edit editorial copy inside this locked frame. Surrounding photography and grids remain undisturbed.',
        textStyle: {
          fontFamily: ds.typography.bodyFont,
          fontSizePt: ds.typography.scale.bodyPt,
          fontWeight: 400,
          color: ds.colors.ink,
          lineHeight: 1.55,
          letterSpacingEm: 0,
          textAlign: 'left',
          verticalAlign: 'top',
          paragraphSpacingMm: ds.spacing.paragraphGapMm,
          columns: 1,
          columnGapMm: ds.grid.gutterMm,
          insetMm: 0,
        },
      };
    case 'caption':
      return {
        ...base,
        name: 'Image Caption',
        type: 'text',
        widthMm: 110,
        heightMm: 12,
        textRole: 'caption',
        text: 'Plate 04 — Hand-finished travertine colonnade at late afternoon.',
        textStyle: {
          fontFamily: ds.typography.captionFont,
          fontSizePt: ds.typography.scale.captionPt,
          fontWeight: 400,
          color: ds.colors.mutedInk,
          lineHeight: 1.4,
          letterSpacingEm: 0.02,
          textAlign: 'left',
          verticalAlign: 'top',
          paragraphSpacingMm: 1,
          columns: 1,
          columnGapMm: 4,
          insetMm: 0,
        },
      };
    case 'pull_quote':
      return {
        ...base,
        name: 'Pull Quote',
        type: 'text',
        widthMm: 130,
        heightMm: 42,
        textRole: 'quote',
        text: '“True luxury in print lies in measured silence, generous margins, and the weight of honest paper.”',
        textStyle: {
          fontFamily: ds.typography.quoteFont,
          fontSizePt: ds.typography.scale.quotePt,
          fontWeight: 400,
          fontStyle: 'italic',
          color: ds.colors.ink,
          lineHeight: 1.35,
          letterSpacingEm: 0,
          textAlign: 'left',
          verticalAlign: 'middle',
          paragraphSpacingMm: 2,
          columns: 1,
          columnGapMm: 4,
          insetMm: 2,
        },
      };
    case 'image':
      return {
        ...base,
        name: 'Photograph Frame',
        type: 'image',
        widthMm: 110,
        heightMm: 82,
        image: {
          src: project.imageAssets[0]?.url || EDITORIAL_PHOTOS.courtyard,
          alt: 'Editorial photograph',
          fit: 'cover',
          zoom: 1,
          focalX: 50,
          focalY: 50,
          naturalWidth: project.imageAssets[0]?.widthPx || 1408,
          naturalHeight: project.imageAssets[0]?.heightPx || 1056,
          originalCrop: { zoom: 1, focalX: 50, focalY: 50, fit: 'cover' },
        },
      };
    case 'shape_rect':
      return {
        ...base,
        name: 'Rectangle Block',
        type: 'shape',
        widthMm: 70,
        heightMm: 45,
        shape: {
          shapeKind: 'rectangle',
          fill: ds.colors.surface,
          stroke: ds.colors.primaryAccent,
          strokeWidthMm: 0.3,
          cornerRadiusMm: 0,
        },
      };
    case 'shape_ellipse':
      return {
        ...base,
        name: 'Circle / Oval',
        type: 'shape',
        widthMm: 50,
        heightMm: 50,
        shape: {
          shapeKind: 'ellipse',
          fill: ds.colors.surface,
          stroke: ds.colors.primaryAccent,
          strokeWidthMm: 0.4,
          cornerRadiusMm: 0,
        },
      };
    case 'line':
      return {
        ...base,
        name: 'Hairline Rule',
        type: 'line',
        widthMm: 120,
        heightMm: 2,
        shape: {
          shapeKind: 'rule',
          fill: 'transparent',
          stroke: ds.colors.primaryAccent,
          strokeWidthMm: 0.35,
          cornerRadiusMm: 0,
        },
      };
    case 'background_panel':
      return {
        ...base,
        name: 'Tinted Editorial Panel',
        type: 'shape',
        widthMm: 150,
        heightMm: 90,
        zIndex: 1,
        shape: {
          shapeKind: 'rectangle',
          fill: ds.colors.surface,
          stroke: 'transparent',
          strokeWidthMm: 0,
          cornerRadiusMm: 0,
        },
      };
    case 'decorative_frame':
      return {
        ...base,
        name: 'Architectural Border Frame',
        type: 'decorative',
        widthMm: 140,
        heightMm: 180,
        shape: {
          shapeKind: 'frame',
          fill: 'transparent',
          stroke: ds.colors.primaryAccent,
          strokeWidthMm: 0.5,
          cornerRadiusMm: 0,
        },
      };
    case 'page_number':
      return {
        ...base,
        name: 'Page Number',
        type: 'pageNumber',
        widthMm: 20,
        heightMm: 8,
        textRole: 'folio',
        text: '{{page}}',
        textStyle: {
          fontFamily: ds.typography.numericalFont,
          fontSizePt: ds.typography.scale.folioPt,
          fontWeight: 500,
          color: ds.colors.mutedInk,
          lineHeight: 1.2,
          letterSpacingEm: 0.08,
          textAlign: 'right',
          verticalAlign: 'middle',
          paragraphSpacingMm: 0,
          columns: 1,
          columnGapMm: 0,
          insetMm: 0,
        },
      };
    case 'header':
      return {
        ...base,
        name: 'Running Header',
        type: 'header',
        widthMm: 140,
        heightMm: 7,
        textRole: 'running_head',
        text: project.name.toUpperCase(),
        textStyle: {
          fontFamily: ds.typography.captionFont,
          fontSizePt: 7.5,
          fontWeight: 500,
          color: ds.colors.mutedInk,
          lineHeight: 1.2,
          letterSpacingEm: 0.14,
          textAlign: 'left',
          verticalAlign: 'middle',
          paragraphSpacingMm: 0,
          columns: 1,
          columnGapMm: 0,
          insetMm: 0,
          textTransform: 'uppercase',
        },
      };
    case 'footer':
      return {
        ...base,
        name: 'Running Footer',
        type: 'footer',
        widthMm: 140,
        heightMm: 7,
        textRole: 'running_head',
        text: 'COLLECTOR EDITION · ARCHIVAL PRINT',
        textStyle: {
          fontFamily: ds.typography.captionFont,
          fontSizePt: 7.5,
          fontWeight: 400,
          color: ds.colors.mutedInk,
          lineHeight: 1.2,
          letterSpacingEm: 0.12,
          textAlign: 'left',
          verticalAlign: 'middle',
          paragraphSpacingMm: 0,
          columns: 1,
          columnGapMm: 0,
          insetMm: 0,
          textTransform: 'uppercase',
        },
      };
    case 'logo':
      return {
        ...base,
        name: 'Publisher Imprint',
        type: 'logo',
        widthMm: 55,
        heightMm: 10,
        textRole: 'caption',
        text: 'ATELIER PRESS',
        textStyle: {
          fontFamily: ds.typography.displayFont,
          fontSizePt: 10,
          fontWeight: 600,
          color: ds.colors.ink,
          lineHeight: 1.2,
          letterSpacingEm: 0.22,
          textAlign: 'center',
          verticalAlign: 'middle',
          paragraphSpacingMm: 0,
          columns: 1,
          columnGapMm: 0,
          insetMm: 0,
          textTransform: 'uppercase',
        },
      };
    case 'infographic': {
      const tpl = BUILTIN_INFOGRAPHIC_TEMPLATES[0];
      return {
        ...base,
        name: tpl.name,
        type: 'infographic',
        widthMm: Math.min(170, project.dimensions.widthMm - 36),
        heightMm: 112,
        infographic: {
          ...structuredClone(tpl.defaultData),
          fontFamily: ds.typography.captionFont,
          backgroundColor: ds.colors.surface,
          textColor: ds.colors.ink,
          accentColor: ds.colors.primaryAccent,
          secondaryColor: ds.colors.secondaryAccent,
        },
      };
    }
  }
}

export default function App() {
  const [user, setUser] = useState<SignedInUser | null>(null);
  /* this person's Books role (GET /api/books/me); until it is known, and if it cannot be read, nothing of the design
     is offered (fails closed) */
  const [me, setMe] = useState<BooksMe | null>(null);
  const [accessError, setAccessError] = useState('');
  const canDesign = me?.canDesign === true;
  const [view, setView] = useState<'studio' | 'dashboard'>('dashboard');
  const [projects, setProjects] = useState<BookProject[]>(() => [createInitialSampleProject()]);
  const [activeProjectId, setActiveProjectId] = useState<string>(PLACEHOLDER_ID);
  const [bookList, setBookList] = useState<BookSummary[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [activePageId, setActivePageId] = useState<string>('');
  const [selectedElementIds, setSelectedElementIds] = useState<string[]>([]);
  const [clipboardElements, setClipboardElements] = useState<BookElement[]>([]);

  const [customTemplates, setCustomTemplates] = useState<CustomSavedTemplate[]>([]);
  const [fontCollection, setFontCollection] = useState<UserFontCollection>(DEFAULT_FONT_COLLECTION);

  // Workspace view states
  const [zoom, setZoom] = useState(0.76);
  const [viewMode, setViewMode] = useState<'spread' | 'single'>('spread');
  const [previewMode, setPreviewMode] = useState(false);
  const [showGuides, setShowGuides] = useState(true);
  const [showRulers, setShowRulers] = useState(true);
  const [snapToGrid, setSnapToGrid] = useState(false);
  const [snapToObjects, setSnapToObjects] = useState(true);
  const [canvasViewRotation, setCanvasViewRotation] = useState<PageRotation>(0);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [activeTool, setActiveTool] = useState<InDesignTool>('select');

  // Modals & AI prompt
  const [activeModal, setActiveModal] = useState<ActiveModal>(null);
  const [historyTab, setHistoryTab] = useState<'versions' | 'deleted' | 'activity'>('versions');
  const [aiInitialPrompt, setAiInitialPrompt] = useState('');

  // Save & History stacks
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'unsaved'>('saved');
  const [undoStack, setUndoStack] = useState<BookProject[]>([]);
  const [redoStack, setRedoStack] = useState<BookProject[]>([]);
  const autosaveTimerRef = useRef<number | null>(null);
  const hydratedRef = useRef(false);

  // Who else has the open book (POST /api/books/presence every 30 s and on page change)
  const [presence, setPresence] = useState<PresenceEntry[]>([]);

  /* Putting two people's saves together (a save refused as stale): while the newest copy is read, autosave waits
     (mergingRef); while the person chooses between conflicting changes, edits wait too (editsBlockedRef), so what
     is saved is exactly what was put together. */
  const [mergeDialog, setMergeDialog] = useState<MergeDialogState | null>(null);
  const [mergeBusy, setMergeBusy] = useState(false);
  const mergingRef = useRef<string | null>(null);
  const editsBlockedRef = useRef(false);
  const pendingMergeRef = useRef<PendingMerge | null>(null);
  const mergeRunsRef = useRef(0);
  /** the save (and any merge it led to) still running, so a page restore can wait for it */
  const saveChainRef = useRef<Promise<boolean> | null>(null);

  // the newest values, for callbacks that run after an await
  const projectsRef = useRef(projects);
  projectsRef.current = projects;
  const activeProjectIdRef = useRef(activeProjectId);
  activeProjectIdRef.current = activeProjectId;
  const canDesignRef = useRef(canDesign);
  canDesignRef.current = canDesign;

  const activeProject = useMemo(
    () =>
      projects.find((p) => p.id === activeProjectId) ||
      projects.find((p) => p.id === PLACEHOLDER_ID) ||
      projects[0],
    [projects, activeProjectId]
  );
  const realBookOpen = activeProject.id !== PLACEHOLDER_ID;

  // the open book's id goes with its AI calls, so its AI use is counted against it
  useEffect(() => {
    setActiveBookId(realBookOpen ? activeProject.id : '');
  }, [activeProject.id, realBookOpen]);

  const upsertSummary = useCallback((p: BookProject, extra?: Partial<BookSummary>) => {
    if (p.id === PLACEHOLDER_ID) return;
    setBookList((list) => {
      const prev = list.find((b) => b.id === p.id);
      const next = summaryOf(p, { createdBy: prev?.createdBy || '', updatedBy: prev?.updatedBy || '', ...(extra || {}) });
      return [next, ...list.filter((b) => b.id !== p.id)];
    });
  }, []);

  /* something that changes a book needs a book open: from the dashboard with none open, it says so instead of
     changing the hidden sample */
  const requireBook = (what: string): boolean => {
    if (activeProject.id !== PLACEHOLDER_ID) return true;
    setNotice({ kind: 'info', text: `Open a book, or start a new one, to ${what}.` });
    return false;
  };

  /* what only a Designer may do (the server refuses it too, 403 'designer-only'): said plainly instead of tried */
  const requireDesigner = (sentence: string): boolean => {
    if (canDesignRef.current) return true;
    setNotice({ kind: 'info', text: sentence });
    return false;
  };

  const openModal = (m: NonNullable<ActiveModal>) => {
    const locked = DESIGN_MODALS[m];
    if (locked && !canDesignRef.current) {
      setNotice({ kind: 'info', text: locked });
      return;
    }
    if (m === 'versions') setHistoryTab('versions');
    setActiveModal(m);
  };

  const activePageIndex = useMemo(() => {
    const idx = activeProject.pages.findIndex((p) => p.id === activePageId);
    return idx >= 0 ? idx : 0;
  }, [activeProject.pages, activePageId]);

  const activePage = activeProject.pages[activePageIndex] || activeProject.pages[0];

  const selectedElement = useMemo(() => {
    if (selectedElementIds.length !== 1) return null;
    return activePage.elements.find((e) => e.id === selectedElementIds[0]) || null;
  }, [activePage.elements, selectedElementIds]);

  const analytics = useMemo(() => computeEditorialAnalytics(activeProject), [activeProject]);

  // Ensure activePageId is always valid
  useEffect(() => {
    if (activeProject && (!activePageId || !activeProject.pages.some((p) => p.id === activePageId))) {
      setActivePageId(activeProject.pages[0]?.id || '');
    }
  }, [activeProject, activePageId]);

  // Load Google Fonts used in active project
  useEffect(() => {
    if (activeProject) {
      ensureProjectFontsLoaded(activeProject);
    }
  }, [activeProject]);

  // The team's books (summaries: a book is read whole when it is opened), saved templates and this person's fonts
  const hydrateFromStorage = useCallback(async () => {
    setListLoading(true);
    setListError('');
    try {
      setBookList(await loadBookList());
    } catch (err) {
      setListError(errorText(err, 'The books could not be loaded.'));
    } finally {
      setListLoading(false);
      hydratedRef.current = true;
    }
    try {
      const [loadedTemplates, loadedFonts] = await Promise.all([loadCustomTemplates(), loadFontCollections()]);
      setCustomTemplates(loadedTemplates);
      if (loadedFonts.length > 0) setFontCollection(loadedFonts[0]);
    } catch (err) {
      setNotice({ kind: 'error', text: errorText(err, 'Your saved templates and fonts could not be loaded.') });
    }
  }, []);

  // signed in (auth.js) -> this person's Books role -> the books; a person without Books sees why, and nothing else
  useEffect(() => {
    let active = true;
    const ready = window.RevampAuth ? window.RevampAuth.whenResolved() : Promise.resolve();
    ready.then(async () => {
      if (!active) return;
      setUser(currentUser());
      try {
        const who = await loadMe();
        if (!active) return;
        setMe(who);
      } catch (err) {
        if (!active) return;
        if (err instanceof ApiError && err.code === 'no-books') {
          setAccessError(err.message);
          setListLoading(false);
          return;
        }
        setMe({ role: 'content', email: currentUser()?.email || '', canDesign: false });
        setNotice({
          kind: 'error',
          text: errorText(err, 'Your Books role could not be read.') + ' Until you reload the page, only content can be changed.',
        });
      }
      void hydrateFromStorage();
    });
    return () => {
      active = false;
    };
  }, [hydrateFromStorage]);

  /* the person's role can be shown before any book is open, and a Content editor never sees a design tool selected */
  useEffect(() => {
    if (!canDesign && !['select', 'direct_select', 'hand', 'zoom'].includes(activeTool)) setActiveTool('select');
  }, [canDesign, activeTool]);

  const applyBookFromServer = useCallback(
    (prevBase: BookProject | null, book: BookProject) => {
      setProjects((list) => list.map((p) => (p.id === book.id ? book : p)));
      if (activeProjectIdRef.current === book.id) {
        if (prevBase) {
          setUndoStack((st) => st.map((s) => rebaseOnto(prevBase, s, book)));
          setRedoStack((st) => st.map((s) => rebaseOnto(prevBase, s, book)));
        } else {
          setUndoStack([]);
          setRedoStack([]);
        }
      }
      setSaveState('saved');
      upsertSummary(book);
    },
    [upsertSummary]
  );

  /* A save refused because someone else saved first: their newest copy is read and put together with this tab's
     book from the copy both started at. Nothing in conflict -> saved at once; otherwise the person chooses. */
  const mergeWithLatestRef = useRef<(bookId: string, updatedBy: string) => Promise<boolean>>(async () => false);

  // Schedule debounced autosave whenever active project mutates
  const persistProjectNow = useCallback(
    (proj: BookProject): Promise<boolean> => {
      const run = (async (): Promise<boolean> => {
        if (proj.id === PLACEHOLDER_ID) return true;
        if (mergingRef.current === proj.id) return false; // the merge under way saves when it is done
        setSaveState('saving');
        try {
          await saveProject(proj);
          mergeRunsRef.current = 0;
          // saved, unless something newer is already in the editor (its own autosave follows)
          const held = projectsRef.current.find((p) => p.id === proj.id);
          setSaveState(!held || held === proj || sameBook(held, proj) ? 'saved' : 'unsaved');
          upsertSummary(proj, { updatedBy: user?.email || me?.email || '' });
          setNotice((n) => (n && n.bookId === proj.id ? null : n));
          return true;
        } catch (err) {
          if (err instanceof ApiError && err.code === 'stale') {
            return mergeWithLatestRef.current(proj.id, String((err.data && err.data.updatedBy) || ''));
          }
          setSaveState('unsaved');
          if (err instanceof ApiError && err.code === 'design-only') {
            const changes = Array.isArray(err.data.changes) ? (err.data.changes as string[]) : [];
            pendingMergeRef.current = null;
            setMergeDialog({
              mode: 'cannot',
              bookId: proj.id,
              bookName: proj.name,
              updatedBy: '',
              conflicts: [],
              title: 'This change cannot be saved',
              reason: designRefusal(changes.length ? changes : [err.message]),
            });
            editsBlockedRef.current = true;
            return false;
          }
          setNotice({
            kind: 'error',
            bookId: proj.id,
            text: errorText(err, 'The book could not be saved.') + ' Your changes are still here; they will be saved with your next change.',
          });
          return false;
        }
      })();
      saveChainRef.current = run;
      const settle = () => {
        if (saveChainRef.current === run) saveChainRef.current = null;
      };
      run.then(settle, settle);
      return run;
    },
    [upsertSummary, user, me]
  );

  /** One autosave, 1.6 s after the newest change (each change moves it on); none while a merge is being made. */
  const scheduleAutosave = useCallback(
    (proj: BookProject) => {
      if (autosaveTimerRef.current) window.clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
      if (mergingRef.current === proj.id) return; // the merge saves the book when it is done
      autosaveTimerRef.current = window.setTimeout(() => void persistProjectNow(proj), 1600);
    },
    [persistProjectNow]
  );

  /* the merged book becomes this tab's book and its new base, history moves onto it, and it is saved */
  const finishMerge = useCallback(
    async (pm: PendingMerge, finalBook: BookProject): Promise<boolean> => {
      if (!canDesignRef.current) {
        const why = designChanges(pm.latest, finalBook);
        if (why.length) {
          pendingMergeRef.current = pm;
          editsBlockedRef.current = true;
          setMergeDialog({
            mode: 'cannot',
            bookId: pm.bookId,
            bookName: pm.mine.name,
            updatedBy: pm.updatedBy,
            conflicts: [],
            reason: `${personName(pm.updatedBy)} changed the design, and your changes still use the old one (${why[0].replace(/[.\s]+$/, '')}). Only a Designer can put those together.`,
          });
          setSaveState('unsaved');
          return false;
        }
      }
      setProjects((list) => list.map((p) => (p.id === pm.bookId ? finalBook : p)));
      if (activeProjectIdRef.current === pm.bookId) {
        setUndoStack((st) => st.map((s) => rebaseOnto(pm.base, s, pm.latest)));
        setRedoStack((st) => st.map((s) => rebaseOnto(pm.base, s, pm.latest)));
      }
      upsertSummary(finalBook);
      pendingMergeRef.current = null;
      editsBlockedRef.current = false;
      mergingRef.current = null;
      setMergeDialog(null);
      projectsRef.current = projectsRef.current.map((p) => (p.id === pm.bookId ? finalBook : p));
      const ok = await persistProjectNow(finalBook);
      if (ok) setNotice({ kind: 'info', text: `Merged with ${personName(pm.updatedBy)}'s changes.` });
      return ok;
    },
    [persistProjectNow, upsertSummary]
  );

  mergeWithLatestRef.current = async (bookId: string, updatedByHint: string): Promise<boolean> => {
    if (mergingRef.current || editsBlockedRef.current) return false;
    mergingRef.current = bookId;
    if (autosaveTimerRef.current) window.clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = null;
    mergeRunsRef.current += 1;
    setSaveState('saving');
    const base = knownBase(bookId);
    let latest: BookProject;
    let updatedBy = updatedByHint;
    try {
      const r = await loadLatest(bookId);
      latest = r.book;
      updatedBy = r.updatedBy || updatedByHint;
    } catch (err) {
      mergingRef.current = null;
      setSaveState('unsaved');
      setNotice({
        kind: 'error',
        bookId,
        text: 'Someone else saved this book, and their copy could not be read: ' + errorText(err, 'please try again.') + ' Your changes are still here.',
      });
      return false;
    }
    const mine = projectsRef.current.find((p) => p.id === bookId);
    if (!mine) {
      mergingRef.current = null;
      return false;
    }
    const cannot = (reason: string) => {
      pendingMergeRef.current = { bookId, base: base || latest, latest, mine, merged: latest, conflicts: [], updatedBy };
      editsBlockedRef.current = true;
      setMergeDialog({ mode: 'cannot', bookId, bookName: mine.name, updatedBy, conflicts: [], reason });
      setSaveState('unsaved');
      return false;
    };
    if (!base) return cannot('This tab has no record of the copy you started from, so your changes cannot be put together with the newer one automatically.');
    if (mergeRunsRef.current > 4) return cannot('The book keeps changing while your changes are saved, so they could not be put together.');
    let pm: PendingMerge;
    try {
      const { merged, conflicts } = mergeBooks(base, mine, latest);
      pm = { bookId, base, latest, mine, merged, conflicts, updatedBy };
    } catch (err) {
      return cannot('Your changes and the newer saved copy could not be compared (' + errorText(err, 'unexpected content') + ').');
    }
    const { merged, conflicts } = pm;
    if (conflicts.length) {
      pendingMergeRef.current = pm;
      editsBlockedRef.current = true;
      setMergeDialog({ mode: 'conflicts', bookId, bookName: mine.name, updatedBy, conflicts });
      setSaveState('unsaved');
      return false;
    }
    return finishMerge(pm, merged);
  };

  /* the person's choice for each conflict -> the book that is saved */
  const handleResolveMerge = async (choices: Record<string, ConflictChoice>) => {
    const pm = pendingMergeRef.current;
    if (!pm) return;
    setMergeBusy(true);
    try {
      await finishMerge(pm, resolveConflicts(pm.merged, pm.conflicts, choices));
    } finally {
      setMergeBusy(false);
    }
  };

  /* the way out that loses nothing saved: the newest copy is opened (this tab's unsaved changes are let go) */
  const handleUseLatest = async () => {
    const pm = pendingMergeRef.current;
    const bookId = mergeDialog?.bookId || pm?.bookId;
    if (!bookId) return;
    setMergeBusy(true);
    try {
      const latest = pm ? pm.latest : (await loadLatest(bookId)).book;
      setProjects((list) => list.map((p) => (p.id === bookId ? latest : p)));
      if (activeProjectIdRef.current === bookId) {
        setUndoStack([]);
        setRedoStack([]);
      }
      setSaveState('saved');
      upsertSummary(latest);
      pendingMergeRef.current = null;
      editsBlockedRef.current = false;
      mergingRef.current = null;
      mergeRunsRef.current = 0;
      setMergeDialog(null);
      setNotice({ kind: 'info', text: 'The newest saved copy of the book is open.' });
    } catch (err) {
      setNotice({ kind: 'error', text: errorText(err, 'The newer copy could not be opened. Please try again.') });
    } finally {
      setMergeBusy(false);
    }
  };

  /* Designers only: this tab's version kept as a new book, and the shared book read again, so neither is lost */
  const handleKeepMineAsCopy = async () => {
    const pm = pendingMergeRef.current;
    const bookId = mergeDialog?.bookId || pm?.bookId;
    if (!bookId || !requireDesigner('Only Designers can start a new book.')) return;
    const mine = projectsRef.current.find((p) => p.id === bookId) || pm?.mine;
    if (!mine) return;
    setMergeBusy(true);
    const now = new Date().toISOString();
    const copy: BookProject = {
      ...structuredClone(mine),
      id: `proj_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name: `${mine.name} (my version)`,
      createdAt: now,
      updatedAt: now,
    };
    pendingMergeRef.current = null;
    editsBlockedRef.current = false;
    mergingRef.current = null;
    mergeRunsRef.current = 0;
    setMergeDialog(null);
    setProjects((prev) => [copy, ...prev]);
    setActiveProjectId(copy.id);
    setUndoStack([]);
    setRedoStack([]);
    try {
      await persistProjectNow(copy);
      // the book that was saved elsewhere is read again, so this tab does not keep the refused version
      const latest = pm && pm.latest ? pm.latest : (await loadLatest(bookId)).book;
      setProjects((prev) => prev.map((p) => (p.id === bookId ? latest : p)));
    } catch {
      setProjects((prev) => prev.filter((p) => p.id !== bookId));
    } finally {
      setMergeBusy(false);
    }
  };

  // leaving with changes that have not reached the server asks first
  useEffect(() => {
    if (saveState === 'saved') return;
    const onLeave = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onLeave);
    return () => window.removeEventListener('beforeunload', onLeave);
  }, [saveState]);

  /* Every change to the open book comes here. A Content editor's change that would alter the design (the shared
     rules' designChanges) is not applied, so the editor never sends a save the server refuses. */
  const commitProjectUpdate = useCallback(
    (updater: (prev: BookProject) => BookProject, recordHistory = true) => {
      setProjects((prevList) => {
        const current = prevList.find((p) => p.id === activeProjectId);
        if (!current || current.id === PLACEHOLDER_ID) return prevList;
        if (editsBlockedRef.current) return prevList;
        const next = {
          ...updater(current),
          updatedAt: new Date().toISOString(),
        };
        if (!canDesignRef.current) {
          const why = designChanges(current, next);
          if (why.length) {
            setNotice({ kind: 'info', text: designRefusal(why) });
            return prevList;
          }
        }

        if (recordHistory) {
          setUndoStack((stack) => [...stack.slice(-39), structuredClone(current)]);
          setRedoStack([]);
        }

        setSaveState('unsaved');
        scheduleAutosave(next);

        return prevList.map((p) => (p.id === current.id ? next : p));
      });
    },
    [activeProjectId, scheduleAutosave]
  );

  /* undo and redo put back a whole earlier state; for a Content editor only one that keeps the design as it is now */
  const applyHistoryState = useCallback(
    (state: BookProject) => {
      setProjects((list) => list.map((p) => (p.id === state.id ? state : p)));
      setSaveState('unsaved');
      // an undone change is saved like any other
      scheduleAutosave(state);
    },
    [scheduleAutosave]
  );

  const handleUndo = useCallback(() => {
    if (editsBlockedRef.current || undoStack.length === 0) return;
    const previous = undoStack[undoStack.length - 1];
    if (previous.id !== activeProject.id) return;
    if (!canDesignRef.current) {
      const why = designChanges(activeProject, previous);
      if (why.length) {
        setNotice({ kind: 'info', text: designRefusal(why) });
        return;
      }
    }
    setUndoStack(undoStack.slice(0, -1));
    setRedoStack((r) => [...r.slice(-39), structuredClone(activeProject)]);
    applyHistoryState(previous);
  }, [undoStack, activeProject, applyHistoryState]);

  const handleRedo = useCallback(() => {
    if (editsBlockedRef.current || redoStack.length === 0) return;
    const restored = redoStack[redoStack.length - 1];
    if (restored.id !== activeProject.id) return;
    if (!canDesignRef.current) {
      const why = designChanges(activeProject, restored);
      if (why.length) {
        setNotice({ kind: 'info', text: designRefusal(why) });
        return;
      }
    }
    setRedoStack(redoStack.slice(0, -1));
    setUndoStack((u) => [...u.slice(-39), structuredClone(activeProject)]);
    applyHistoryState(restored);
  }, [redoStack, activeProject, applyHistoryState]);

  /* Who else is here: this tab says where it is every 30 s and when the page changes, and hears who else has the
     book open (seen in the last 70 s). Stops when the book is closed. */
  const presencePageRef = useRef('');
  presencePageRef.current = activePage?.id || '';
  const myEmail = (me?.email || user?.email || '').toLowerCase();
  const presenceBookId = view === 'studio' && realBookOpen && !accessError ? activeProject.id : '';
  useEffect(() => {
    if (!presenceBookId) {
      setPresence([]);
      return;
    }
    let stopped = false;
    const beat = () => {
      if (!presencePageRef.current) return;
      sendPresence(presenceBookId, presencePageRef.current).then(
        (here) => {
          if (!stopped) setPresence(here.filter((h) => h.email.toLowerCase() !== myEmail));
        },
        () => {
          /* the list keeps what it had; the server forgets people after 70 s anyway */
        }
      );
    };
    // the first beat is the page effect's below (it runs whenever the book or the page changes)
    const every = window.setInterval(beat, 30000);
    return () => {
      stopped = true;
      window.clearInterval(every);
    };
  }, [presenceBookId, myEmail]);
  useEffect(() => {
    if (!presenceBookId || !activePage?.id) return;
    const pageId = activePage.id;
    let stopped = false;
    const t = window.setTimeout(() => {
      sendPresence(presenceBookId, pageId).then(
        (here) => {
          if (!stopped) setPresence(here.filter((h) => h.email.toLowerCase() !== myEmail));
        },
        () => {}
      );
    }, 700);
    return () => {
      stopped = true;
      window.clearTimeout(t);
    };
  }, [presenceBookId, activePage?.id, myEmail]);

  const othersHere = useMemo(
    () =>
      presence.map((h) => {
        const idx = activeProject.pages.findIndex((p) => p.id === h.pageId);
        return { email: h.email, pageId: h.pageId, name: personName(h.email), pageNumber: idx >= 0 ? idx + 1 : 0 };
      }),
    [presence, activeProject.pages]
  );

  /* Before a deleted page is put back, everything this tab has is saved (and merged, if it crossed someone's save):
     the server restores on the revision this tab knows. */
  const flushSaves = async (bookId: string): Promise<'ok' | 'merging' | 'failed'> => {
    if (autosaveTimerRef.current) window.clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = null;
    for (let i = 0; i < 4 && saveChainRef.current; i++) await saveChainRef.current.catch(() => false);
    if (editsBlockedRef.current || mergingRef.current) return 'merging';
    const held = projectsRef.current.find((p) => p.id === bookId);
    const base = knownBase(bookId);
    if (held && (!base || !sameBook(held, base))) {
      const ok = await persistProjectNow(held);
      if (editsBlockedRef.current || mergingRef.current) return 'merging';
      return ok ? 'ok' : 'failed';
    }
    return 'ok';
  };

  const handleRestoreDeletedPage = async (p: DeletedPage): Promise<{ ok: boolean; text: string }> => {
    const bookId = activeProject.id;
    if (!realBookOpen) return { ok: false, text: 'Open the book first.' };
    const label = p.label ? `"${p.label}"` : 'The page';
    const flushed = await flushSaves(bookId);
    if (flushed === 'merging') return { ok: false, text: 'First choose between your changes and the other person\'s, then restore the page.' };
    if (flushed === 'failed') return { ok: false, text: 'Your latest changes could not be saved, so the page was not restored. Check the message at the top and try again.' };
    const place = (book: BookProject) => {
      const idx = book.pages.findIndex((x) => x.id === p.pageId);
      if (idx >= 0) {
        setActivePageId(p.pageId);
        setSelectedElementIds([]);
      }
      return idx;
    };
    let prevBase = knownBase(bookId);
    try {
      const book = await restoreDeletedPage(bookId, p.pageId);
      applyBookFromServer(prevBase, book);
      const idx = place(book);
      return { ok: true, text: `${label} is back${idx >= 0 ? ` as page ${idx + 1}` : ''}.` };
    } catch (err) {
      if (!(err instanceof ApiError && (err.code === 'stale' || err.code === 'exists'))) {
        return { ok: false, text: errorText(err, 'The page could not be restored. Please try again.') };
      }
      // someone saved in between (or put the page back already): read the newest copy, then try once more
      try {
        const latest = (await loadLatest(bookId)).book;
        applyBookFromServer(prevBase, latest);
        if (latest.pages.some((x) => x.id === p.pageId)) {
          const idx = place(latest);
          return { ok: true, text: `${label} is already back in the book${idx >= 0 ? `, as page ${idx + 1}` : ''}.` };
        }
        prevBase = knownBase(bookId);
        const book = await restoreDeletedPage(bookId, p.pageId);
        applyBookFromServer(prevBase, book);
        const idx = place(book);
        return { ok: true, text: `${label} is back${idx >= 0 ? ` as page ${idx + 1}` : ''}.` };
      } catch (err2) {
        return { ok: false, text: errorText(err2, 'The page could not be restored. Please try again.') };
      }
    }
  };

  // Compute visible pages for Facing-Page Spread vs Single-Page View
  const visiblePages = useMemo(() => {
    if (viewMode === 'single' || activePageIndex === 0) {
      return [{ page: activePage, pageNumber: activePageIndex + 1, side: 'single' as const }];
    }
    const leftIdx = activePageIndex % 2 === 1 ? activePageIndex : activePageIndex - 1;
    const left = activeProject.pages[leftIdx];
    const right = activeProject.pages[leftIdx + 1];
    const list: Array<{ page: BookPage; pageNumber: number; side: 'single' | 'left' | 'right' }> = [];
    if (left) list.push({ page: left, pageNumber: leftIdx + 1, side: right ? 'left' : 'single' });
    if (right) list.push({ page: right, pageNumber: leftIdx + 2, side: 'right' });
    return list;
  }, [viewMode, activePage, activePageIndex, activeProject.pages]);

  // Element CRUD Handlers
  const handleUpdateElement = useCallback(
    (pageId: string, elementId: string, patch: Partial<BookElement>, recordHistory = true) => {
      commitProjectUpdate(
        (proj) => ({
          ...proj,
          pages: proj.pages.map((p) =>
            p.id !== pageId
              ? p
              : {
                  ...p,
                  elements: p.elements.map((el) =>
                    el.id === elementId ? { ...el, ...patch } : el
                  ),
                }
          ),
        }),
        recordHistory
      );
    },
    [commitProjectUpdate]
  );

  const handleDeleteElements = useCallback(
    (pageId: string, ids: string[]) => {
      if (ids.length === 0) return;
      const idSet = new Set(ids);
      commitProjectUpdate((proj) => ({
        ...proj,
        pages: proj.pages.map((p) =>
          p.id !== pageId
            ? p
            : { ...p, elements: p.elements.filter((el) => !idSet.has(el.id)) }
        ),
      }));
      setSelectedElementIds([]);
    },
    [commitProjectUpdate]
  );

  const handleDuplicateElements = useCallback(
    (pageId: string, ids: string[]) => {
      if (ids.length === 0) return;
      const newIds: string[] = [];
      commitProjectUpdate((proj) => ({
        ...proj,
        pages: proj.pages.map((p) => {
          if (p.id !== pageId) return p;
          const clones = p.elements
            .filter((el) => ids.includes(el.id))
            .map((el, i) => {
              const nid = `el_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 5)}`;
              newIds.push(nid);
              return {
                ...structuredClone(el),
                id: nid,
                name: `${el.name} Copy`,
                xMm: Number((el.xMm + 6).toFixed(1)),
                yMm: Number((el.yMm + 6).toFixed(1)),
                zIndex: p.elements.length + i + 2,
                masterElementId: undefined,
              };
            });
          return { ...p, elements: [...p.elements, ...clones] };
        }),
      }));
      setSelectedElementIds(newIds);
    },
    [commitProjectUpdate]
  );

  const handleReorderLayer = (pageId: string, elementId: string, direction: 'up' | 'down') => {
    commitProjectUpdate((proj) => ({
      ...proj,
      pages: proj.pages.map((p) => {
        if (p.id !== pageId) return p;
        const sorted = [...p.elements].sort((a, b) => a.zIndex - b.zIndex);
        const idx = sorted.findIndex((e) => e.id === elementId);
        if (idx < 0) return p;
        const targetIdx = direction === 'up' ? Math.min(sorted.length - 1, idx + 1) : Math.max(0, idx - 1);
        if (targetIdx === idx) return p;
        const [moved] = sorted.splice(idx, 1);
        sorted.splice(targetIdx, 0, moved);
        return {
          ...p,
          elements: sorted.map((el, i) => ({ ...el, zIndex: i + 1 })),
        };
      }),
    }));
  };

  const handleGroupSelected = () => {
    if (selectedElementIds.length < 2) return;
    const gid = `grp_${Date.now()}`;
    commitProjectUpdate((proj) => ({
      ...proj,
      pages: proj.pages.map((p) =>
        p.id !== activePage.id
          ? p
          : {
              ...p,
              elements: p.elements.map((el) =>
                selectedElementIds.includes(el.id) ? { ...el, groupId: gid } : el
              ),
            }
      ),
    }));
  };

  const handleUngroupSelected = () => {
    if (selectedElementIds.length === 0) return;
    commitProjectUpdate((proj) => ({
      ...proj,
      pages: proj.pages.map((p) =>
        p.id !== activePage.id
          ? p
          : {
              ...p,
              elements: p.elements.map((el) =>
                selectedElementIds.includes(el.id) ? { ...el, groupId: undefined } : el
              ),
            }
      ),
    }));
  };

  const handleAddComponent = (
    kind: ComponentDragKind,
    customPayload?: BookElement,
    dropPos?: { pageId: string; xMm: number; yMm: number }
  ) => {
    const targetPageId = dropPos?.pageId || activePage.id;
    const targetPage = activeProject.pages.find((p) => p.id === targetPageId) || activePage;
    const dim = getEffectivePageDimensions(targetPage, activeProject.dimensions);
    const xMm = dropPos ? dropPos.xMm : dim.margins.outer;
    const yMm = dropPos ? dropPos.yMm : dim.margins.top + 12;
    const newEl = createElementFromKind(
      kind,
      activeProject,
      xMm,
      yMm,
      targetPage.elements.length + 2,
      customPayload
    );

    commitProjectUpdate((proj) => ({
      ...proj,
      pages: proj.pages.map((p) =>
        p.id === targetPageId ? { ...p, elements: [...p.elements, newEl] } : p
      ),
    }));
    setActivePageId(targetPageId);
    setSelectedElementIds([newEl.id]);
  };

  // Non-destructive frame-preserving image replacement or insertion
  const handleDropImageOnPage = (
    pageId: string,
    asset: ImageAsset,
    xMm: number,
    yMm: number,
    targetElementId?: string
  ) => {
    // a Content editor puts photos into the frames the design has; a new frame is the design's
    if (!targetElementId && !canDesignRef.current) {
      setNotice({ kind: 'info', text: 'Drop the photo on a photo frame to put it in. Only a Designer can add new frames.' });
      return;
    }
    commitProjectUpdate((proj) => ({
      ...proj,
      pages: proj.pages.map((p) => {
        if (p.id !== pageId) return p;
        const target = targetElementId
          ? p.elements.find((e) => e.id === targetElementId && e.type === 'image')
          : null;
        if (target && target.image) {
          // Strictly preserve frame coordinates, width, height, rotation, fit, focal point & crop
          return {
            ...p,
            elements: p.elements.map((el) =>
              el.id === target.id
                ? {
                    ...el,
                    image: {
                      ...el.image!,
                      src: asset.url,
                      assetId: asset.id,
                      alt: asset.name,
                      naturalWidth: asset.widthPx,
                      naturalHeight: asset.heightPx,
                    },
                  }
                : el
            ),
          };
        }
        const newImgEl: BookElement = {
          id: `el_img_${Date.now()}`,
          name: asset.name,
          type: 'image',
          xMm: Number(xMm.toFixed(1)),
          yMm: Number(yMm.toFixed(1)),
          widthMm: 110,
          heightMm: 82,
          rotation: 0,
          opacity: 1,
          locked: false,
          hidden: false,
          zIndex: p.elements.length + 2,
          image: {
            src: asset.url,
            assetId: asset.id,
            alt: asset.name,
            fit: 'cover',
            zoom: 1,
            focalX: 50,
            focalY: 50,
            naturalWidth: asset.widthPx,
            naturalHeight: asset.heightPx,
            originalCrop: { zoom: 1, focalX: 50, focalY: 50, fit: 'cover' },
          },
        };
        return { ...p, elements: [...p.elements, newImgEl] };
      }),
    }));
  };

  const handlePlaceOrReplaceImage = (asset: ImageAsset) => {
    if (selectedElement && selectedElement.type === 'image') {
      handleDropImageOnPage(activePage.id, asset, selectedElement.xMm, selectedElement.yMm, selectedElement.id);
    } else if (!canDesignRef.current) {
      setNotice({ kind: 'info', text: 'Select a photo frame on the page first, then pick the photo to put in it.' });
    } else {
      const dim = getEffectivePageDimensions(activePage, activeProject.dimensions);
      handleDropImageOnPage(activePage.id, asset, dim.margins.outer, dim.margins.top + 14);
    }
  };

  const handleBulkUploadImages = async (files: FileList) => {
    if (!requireBook('upload photos')) return;
    const { assets, failed } = await uploadImageAssets(files, (done, total) =>
      setNotice(done < total ? { kind: 'info', text: `Uploading photo ${done + 1} of ${total}…` } : null)
    );
    if (assets.length) {
      commitProjectUpdate((proj) => ({
        ...proj,
        imageAssets: [...assets, ...proj.imageAssets],
      }));
    }
    if (failed.length) {
      setNotice({
        kind: 'error',
        text:
          failed.length === 1
            ? `${failed[0].name} was not added: ${failed[0].error}`
            : `${failed.length} photos were not added: ` + failed.map((f) => `${f.name} (${f.error})`).join('; '),
      });
    }
  };

  // Controlled Overflow Continuation onto Next Page
  const handleContinueOverflowToNextPage = (pageId: string, elementId: string) => {
    const pIdx = activeProject.pages.findIndex((p) => p.id === pageId);
    if (pIdx < 0) return;
    const sourcePage = activeProject.pages[pIdx];
    const sourceEl = sourcePage.elements.find((e) => e.id === elementId);
    if (!sourceEl || !sourceEl.textStyle) return;

    const { fittingText, continuationText } = splitOverflowTextForContinuation(sourceEl);
    if (!continuationText) return;

    commitProjectUpdate((proj) => {
      const pagesCopy = structuredClone(proj.pages);
      const src = pagesCopy[pIdx];
      src.elements = src.elements.map((e) =>
        e.id === elementId ? { ...e, text: fittingText } : e
      );

      let nextPage = pagesCopy[pIdx + 1];
      if (!nextPage) {
        nextPage = {
          ...newPageLook(proj, src),
          id: `pg_cont_${Date.now()}`,
          orderIndex: pagesCopy.length,
          label: `Continued Spread`,
          role: 'editorial_text',
          elements: [],
        };
        pagesCopy.push(nextPage);
      }

      const dim = getEffectivePageDimensions(nextPage, proj.dimensions);
      nextPage.elements.push({
        ...structuredClone(sourceEl),
        id: `el_cont_${Date.now()}`,
        name: `${sourceEl.name} (Continued)`,
        xMm: dim.margins.inner,
        yMm: dim.margins.top + 8,
        widthMm: Math.min(sourceEl.widthMm, dim.widthMm - dim.margins.inner - dim.margins.outer),
        heightMm: Math.max(60, dim.heightMm - dim.margins.top - dim.margins.bottom - 20),
        text: continuationText,
        zIndex: nextPage.elements.length + 2,
      });

      return { ...proj, pages: pagesCopy };
    });
  };

  // Insert Infographic from 52-Template Library
  const handleInsertInfographic = (tpl: InfographicTemplate) => {
    if (!requireBook('add an infographic to it')) return;
    const dim = getEffectivePageDimensions(activePage, activeProject.dimensions);
    const ds = activeProject.designSystem;
    const maxW = Math.max(80, dim.widthMm - dim.margins.inner - dim.margins.outer);
    const el: BookElement = {
      id: `el_inf_${Date.now()}`,
      name: tpl.name,
      type: 'infographic',
      xMm: dim.margins.outer,
      yMm: dim.margins.top + 16,
      widthMm: Math.min(tpl.defaultWidthMm, maxW),
      heightMm: Math.min(tpl.defaultHeightMm, dim.heightMm - dim.margins.top - dim.margins.bottom - 24),
      rotation: 0,
      opacity: 1,
      locked: false,
      hidden: false,
      zIndex: activePage.elements.length + 3,
      infographic: {
        ...structuredClone(tpl.defaultData),
        fontFamily: ds.typography.captionFont,
        backgroundColor: ds.colors.surface,
        textColor: ds.colors.ink,
        accentColor: ds.colors.primaryAccent,
        secondaryColor: ds.colors.secondaryAccent,
      },
    };
    commitProjectUpdate((proj) => ({
      ...proj,
      pages: proj.pages.map((p) =>
        p.id === activePage.id ? { ...p, elements: [...p.elements, el] } : p
      ),
    }));
    setSelectedElementIds([el.id]);
    setView('studio');
  };

  // Save Selected Element or Infographic to Custom Reusable Templates
  const handleSaveCustomComponent = async (el?: BookElement) => {
    const target = el || selectedElement;
    if (!target || !requireDesigner('Only Designers can save templates.')) return;
    const tpl: CustomSavedTemplate = {
      id: `ctpl_${Date.now()}`,
      templateKind: target.type === 'infographic' ? 'infographic' : 'component',
      collectionName: 'My Studio Library',
      category: target.type === 'infographic' ? 'Saved Infographics' : 'Custom Components',
      title: target.name,
      description: `Saved from ${activeProject.name} (${activePage.label})`,
      tags: [target.type, activeProject.category],
      payload: { element: structuredClone(target) },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    try {
      await saveCustomTemplate(tpl);
      setCustomTemplates((prev) => [tpl, ...prev]);
    } catch (err) {
      setNotice({ kind: 'error', text: errorText(err, 'The template could not be saved.') });
    }
  };

  // InDesign Precision Align & Distribute
  const handleAlignElements = useCallback(
    (action: AlignAction) => {
      if (selectedElementIds.length === 0) return;
      const dim = getEffectivePageDimensions(activePage, activeProject.dimensions);
      commitProjectUpdate((proj) => ({
        ...proj,
        pages: proj.pages.map((p) =>
          p.id !== activePage.id
            ? p
            : {
                ...p,
                elements: alignAndDistributeElements(p.elements, selectedElementIds, action, dim),
              }
        ),
      }));
    },
    [activePage, activeProject.dimensions, selectedElementIds, commitProjectUpdate]
  );

  // InDesign Rubber-Band Draw-to-Create Frame on Page
  const handleCreateDrawnElement = useCallback(
    (
      pageId: string,
      tool: InDesignTool,
      rectMm: { xMm: number; yMm: number; widthMm: number; heightMm: number }
    ) => {
      const targetPage = activeProject.pages.find((p) => p.id === pageId) || activePage;
      const ds = activeProject.designSystem;
      const zIndex = targetPage.elements.length + 2;
      let newEl: BookElement;

      if (tool === 'frame_image') {
        // Authentic InDesign empty X-crossed image frame ready for drag-drop or link replacement
        newEl = {
          id: `el_imgf_${Date.now()}`,
          name: 'Image Frame',
          type: 'image',
          xMm: rectMm.xMm,
          yMm: rectMm.yMm,
          widthMm: rectMm.widthMm,
          heightMm: rectMm.heightMm,
          rotation: 0,
          opacity: 1,
          locked: false,
          hidden: false,
          zIndex,
          image: {
            src: '',
            alt: 'Empty image frame',
            fit: 'cover',
            zoom: 1,
            focalX: 50,
            focalY: 50,
            originalCrop: { zoom: 1, focalX: 50, focalY: 50, fit: 'cover' },
          },
        };
      } else {
        const kindMap: Partial<Record<InDesignTool, ComponentDragKind>> = {
          type: 'text_box',
          rect: 'shape_rect',
          ellipse: 'shape_ellipse',
          line: 'line',
          infographic: 'infographic',
        };
        const kind = kindMap[tool] || 'text_box';
        const base = createElementFromKind(kind, activeProject, rectMm.xMm, rectMm.yMm, zIndex);
        newEl = {
          ...base,
          xMm: rectMm.xMm,
          yMm: rectMm.yMm,
          widthMm: rectMm.widthMm,
          heightMm: tool === 'line' ? 2 : rectMm.heightMm,
        };
        if (tool === 'type' && newEl.textStyle) {
          newEl.textStyle = { ...newEl.textStyle, color: ds.colors.ink };
        }
      }

      commitProjectUpdate((proj) => ({
        ...proj,
        pages: proj.pages.map((p) =>
          p.id === pageId ? { ...p, elements: [...p.elements, newEl] } : p
        ),
      }));
      setActivePageId(pageId);
      setSelectedElementIds([newEl.id]);
    },
    [activeProject, activePage, commitProjectUpdate]
  );

  // Swap Fill & Stroke on Selected Shape Frame
  const handleSwapFillStroke = useCallback(() => {
    if (!selectedElement?.shape) return;
    handleUpdateElement(activePage.id, selectedElement.id, {
      shape: {
        ...selectedElement.shape,
        fill: selectedElement.shape.stroke || 'transparent',
        stroke: selectedElement.shape.fill || 'transparent',
        strokeWidthMm: Math.max(0.35, selectedElement.shape.strokeWidthMm),
      },
    });
  }, [selectedElement, activePage.id, handleUpdateElement]);

  // Open Any Procedural or AI-Generated Book/Report Template Directly
  const handleCreateBookFromTemplateObject = async (tpl: BookTemplate) => {
    if (!requireDesigner('Only Designers can start a new book.')) return;
    const newProj = createProjectFromBookTemplateObject(tpl);
    setProjects((prev) => [newProj, ...prev]);
    setActiveProjectId(newProj.id);
    setActivePageId(newProj.pages[0]?.id || '');
    setSelectedElementIds([]);
    setActiveModal(null);
    setView('studio');
    await persistProjectNow(newProj);
  };

  // Save Generated Book/Report Template to My Templates
  const handleSaveCustomBookTemplate = async (tpl: BookTemplate) => {
    if (!requireDesigner('Only Designers can save templates.')) return;
    const pages = tpl.buildPages();
    const saved: CustomSavedTemplate = {
      id: `ctpl_book_${Date.now()}`,
      templateKind: 'book',
      collectionName: tpl.documentKind === 'report' ? 'Saved Reports' : 'Saved Books',
      category: tpl.category,
      title: tpl.name,
      description: tpl.description,
      tags: tpl.tags,
      payload: {
        bookTemplate: {
          id: tpl.id,
          name: tpl.name,
          category: tpl.category,
          documentKind: tpl.documentKind || 'book',
          description: tpl.description,
          tags: tpl.tags,
          coverImage: tpl.coverImage,
          dimensions: tpl.dimensions,
          designSystem: tpl.designSystem,
          pages,
        },
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    try {
      await saveCustomTemplate(saved);
      setCustomTemplates((prev) => [saved, ...prev]);
    } catch (err) {
      setNotice({ kind: 'error', text: errorText(err, 'The template could not be saved.') });
    }
  };

  // Save AI-Generated Infographic to My Templates
  const handleSaveCustomInfographicData = async (data: InfographicData) => {
    const el: BookElement = {
      id: `el_inf_saved_${Date.now()}`,
      name: data.title,
      type: 'infographic',
      xMm: 18,
      yMm: 28,
      widthMm: 176,
      heightMm: 112,
      rotation: 0,
      opacity: 1,
      locked: false,
      hidden: false,
      zIndex: 5,
      infographic: structuredClone(data),
    };
    await handleSaveCustomComponent(el);
  };

  // Apply User-Approved AI Editorial Assistant Suggestions
  const handleApplyAiSuggestion = (sug: AiEditorialSuggestion) => {
    const targetPageId = sug.targetPageId || activePage.id;
    const payload = sug.actionPayload || {};

    if (sug.actionType === 'adjust_typography' && sug.targetElementId) {
      const el = activePage.elements.find((e) => e.id === sug.targetElementId);
      if (!el?.textStyle) return;
      handleUpdateElement(targetPageId, el.id, {
        textStyle: {
          ...el.textStyle,
          fontSizePt:
            typeof payload.recommendedFontSizePt === 'number' && payload.recommendedFontSizePt >= 6
              ? payload.recommendedFontSizePt
              : el.textStyle.fontSizePt,
          lineHeight:
            typeof payload.recommendedLineHeight === 'number' && payload.recommendedLineHeight >= 1
              ? payload.recommendedLineHeight
              : el.textStyle.lineHeight,
        },
      });
    } else if (sug.actionType === 'update_text' && sug.targetElementId && typeof payload.rewrittenText === 'string') {
      handleUpdateElement(targetPageId, sug.targetElementId, { text: payload.rewrittenText });
    } else if (sug.actionType === 'resolve_overflow' && sug.targetElementId) {
      handleContinueOverflowToNextPage(targetPageId, sug.targetElementId);
    } else if (sug.actionType === 'insert_infographic') {
      const variant = String(payload.recommendedInfographicVariant || '');
      const match =
        BUILTIN_INFOGRAPHIC_TEMPLATES.find((t) => t.variant === variant) ||
        BUILTIN_INFOGRAPHIC_TEMPLATES[0];
      handleInsertInfographic(match);
    }
  };

  // Keyboard shortcuts (Undo, Redo, Save, Copy, Paste, Delete, Nudge)
  useEffect(() => {
    if (view !== 'studio' || activeModal !== null || mergeDialog !== null) return;

    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void persistProjectNow(activeProject);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !isInput) {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
        return;
      }
      if (isInput) return;

      // pasting, deleting and nudging frames, and the frame-drawing tools, are the design's: not a Content editor's
      if (!canDesign) {
        if (!e.ctrlKey && !e.metaKey && !e.altKey) {
          const k = e.key.toLowerCase();
          if (k === 'v') setActiveTool('select');
          else if (k === 'a') setActiveTool('direct_select');
          else if (k === 'h') setActiveTool('hand');
          else if (k === 'z') setActiveTool('zoom');
          else if (k === 'w') setPreviewMode((p) => !p);
        }
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c' && selectedElementIds.length > 0) {
        const els = activePage.elements.filter((el) => selectedElementIds.includes(el.id));
        setClipboardElements(structuredClone(els));
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v' && clipboardElements.length > 0) {
        e.preventDefault();
        const pastedIds: string[] = [];
        commitProjectUpdate((proj) => ({
          ...proj,
          pages: proj.pages.map((p) => {
            if (p.id !== activePage.id) return p;
            const clones = clipboardElements.map((el, i) => {
              const nid = `el_paste_${Date.now()}_${i}`;
              pastedIds.push(nid);
              return {
                ...structuredClone(el),
                id: nid,
                xMm: Number((el.xMm + 6).toFixed(1)),
                yMm: Number((el.yMm + 6).toFixed(1)),
                zIndex: p.elements.length + i + 2,
              };
            });
            return { ...p, elements: [...p.elements, ...clones] };
          }),
        }));
        setSelectedElementIds(pastedIds);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedElementIds.length > 0) {
        e.preventDefault();
        handleDeleteElements(activePage.id, selectedElementIds);
      } else if (
        ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) &&
        selectedElementIds.length > 0
      ) {
        e.preventDefault();
        const step = e.shiftKey ? 5 : 1;
        const dx = e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0;
        const dy = e.key === 'ArrowDown' ? step : e.key === 'ArrowUp' ? -step : 0;
        commitProjectUpdate((proj) => ({
          ...proj,
          pages: proj.pages.map((p) =>
            p.id !== activePage.id
              ? p
              : {
                  ...p,
                  elements: p.elements.map((el) =>
                    selectedElementIds.includes(el.id) && !el.locked
                      ? {
                          ...el,
                          xMm: Number((el.xMm + dx).toFixed(1)),
                          yMm: Number((el.yMm + dy).toFixed(1)),
                        }
                      : el
                  ),
                }
          ),
        }));
      } else if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        // Adobe InDesign Single-Key Tool & Screen Mode Shortcuts
        const k = e.key.toLowerCase();
        if (k === 'v') setActiveTool('select');
        else if (k === 'a') setActiveTool('direct_select');
        else if (k === 't') setActiveTool('type');
        else if (k === 'f') setActiveTool('frame_image');
        else if (k === 'm') setActiveTool('rect');
        else if (k === 'o') setActiveTool('ellipse');
        else if (e.key === '\\') setActiveTool('line');
        else if (k === 'g') setActiveTool('infographic');
        else if (k === 'h') setActiveTool('hand');
        else if (k === 'z') setActiveTool('zoom');
        else if (k === 'w') setPreviewMode((p) => !p);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    view,
    activeModal,
    mergeDialog,
    canDesign,
    activeProject,
    activePage,
    selectedElementIds,
    clipboardElements,
    persistProjectNow,
    handleUndo,
    handleRedo,
    handleDeleteElements,
    commitProjectUpdate,
  ]);

  // Dashboard Actions
  const handleCreateBookFromTemplate = async (templateId: string) => {
    if (!requireDesigner('Only Designers can start a new book.')) return;
    const newProj = createProjectFromBookTemplate(templateId);
    setProjects((prev) => [newProj, ...prev]);
    setActiveProjectId(newProj.id);
    setActivePageId(newProj.pages[0]?.id || '');
    setSelectedElementIds([]);
    setActiveModal(null);
    setView('studio');
    await persistProjectNow(newProj);
  };

  const handleCreateBlankBook = async () => {
    if (!requireDesigner('Only Designers can start a new book.')) return;
    const base = createProjectFromBookTemplate('tpl_01_luxury_monograph', 'New Custom Coffee Table Book');
    base.pages = [
      {
        id: `pg_blank_1_${Date.now()}`,
        orderIndex: 0,
        label: 'Front Cover',
        role: 'front_cover',
        backgroundColor: base.designSystem.colors.paper,
        elements: [],
      },
      {
        id: `pg_blank_2_${Date.now()}`,
        orderIndex: 1,
        label: 'Page 2 (Verso)',
        role: 'editorial_text',
        masterPageId: base.masterPages[0]?.id,
        backgroundColor: base.designSystem.colors.paper,
        elements: structuredClone(base.masterPages[0]?.elements || []),
      },
      {
        id: `pg_blank_3_${Date.now()}`,
        orderIndex: 2,
        label: 'Page 3 (Recto)',
        role: 'editorial_text',
        masterPageId: base.masterPages[0]?.id,
        backgroundColor: base.designSystem.colors.paper,
        elements: structuredClone(base.masterPages[0]?.elements || []),
      },
    ];
    setProjects((prev) => [base, ...prev]);
    setActiveProjectId(base.id);
    setActivePageId(base.pages[0].id);
    setView('studio');
    setActiveModal('dimensions');
    await persistProjectNow(base);
  };

  /* a book this tab holds whole, else read from the server */
  const fullBook = async (projectId: string): Promise<BookProject> => {
    const held = projects.find((p) => p.id === projectId);
    if (held) return held;
    const book = await loadBook(projectId);
    setProjects((prev) => [book, ...prev.filter((p) => p.id !== book.id)]);
    return book;
  };

  const handleOpenProject = async (projectId: string) => {
    // back to the book already open: as it was left (its undo history and any save still on its way)
    if (projectId === activeProjectId && projects.some((p) => p.id === projectId)) {
      setView('studio');
      return;
    }
    setBusyId(projectId);
    try {
      const book = await fullBook(projectId);
      setActiveProjectId(book.id);
      setActivePageId(book.pages[0]?.id || '');
      setSelectedElementIds([]);
      setUndoStack([]);
      setRedoStack([]);
      setSaveState('saved');
      setView('studio');
    } catch (err) {
      setNotice({ kind: 'error', text: errorText(err, 'This book could not be opened.') });
    } finally {
      setBusyId(null);
    }
  };

  const handleDuplicateProject = async (projectId: string) => {
    if (!requireDesigner('Only Designers can start a new book, so only a Designer can copy one.')) return;
    setBusyId(projectId);
    try {
      const source = await fullBook(projectId);
      const now = new Date().toISOString();
      const copy: BookProject = {
        ...structuredClone(source),
        id: `proj_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        name: `${source.name} (Copy)`,
        status: 'draft',
        createdAt: now,
        updatedAt: now,
      };
      setProjects((prev) => [copy, ...prev]);
      await persistProjectNow(copy);
    } catch (err) {
      setNotice({ kind: 'error', text: errorText(err, 'The book could not be copied.') });
    } finally {
      setBusyId(null);
    }
  };

  const handleDownloadBackup = async (projectId: string) => {
    setBusyId(projectId);
    try {
      await exportProjectBackupPackage(await fullBook(projectId));
    } catch (err) {
      setNotice({ kind: 'error', text: errorText(err, 'The backup could not be made.') });
    } finally {
      setBusyId(null);
    }
  };

  const handleToggleArchiveProject = async (projectId: string) => {
    if (!requireDesigner('Only Designers can archive a book.')) return;
    const target = bookList.find((b) => b.id === projectId);
    if (!target) return;
    const status: BookProject['status'] = target.status === 'archived' ? 'draft' : 'archived';
    try {
      await setBookStatus(projectId, status);
      const now = new Date().toISOString();
      setBookList((list) => list.map((b) => (b.id === projectId ? { ...b, status, updatedAt: now, updatedBy: user?.email || '' } : b)));
      setProjects((prev) => prev.map((p) => (p.id === projectId ? { ...p, status, updatedAt: now } : p)));
    } catch (err) {
      setNotice({ kind: 'error', text: errorText(err, 'The book could not be changed.') });
    }
  };

  const handleDeleteProject = async (projectId: string) => {
    if (!requireDesigner('Only Designers can delete a book.')) return;
    try {
      await deleteProjectById(projectId);
      setBookList((list) => list.filter((b) => b.id !== projectId));
      setProjects((prev) => prev.filter((p) => p.id !== projectId));
      if (activeProjectId === projectId) {
        setActiveProjectId(PLACEHOLDER_ID);
        setView('dashboard');
      }
    } catch (err) {
      setNotice({ kind: 'error', text: errorText(err, 'The book could not be deleted.') });
    }
  };

  // Page Navigator Operations
  /* A new page is made from the book's own layouts (the owner, 26 Nov 2026), so a Content editor may add one too: the
     first master page with its frames and its settings, else an empty page with the current page's settings. */
  const handleAddPage = () => {
    const master = activeProject.masterPages[0];
    const newPage: BookPage = {
      ...newPageLook(activeProject, activePage),
      id: `pg_${Date.now()}`,
      orderIndex: activeProject.pages.length,
      label: `Page ${activeProject.pages.length + 1}`,
      role: 'editorial_text',
      elements: master
        ? master.elements.map((m, i) => ({
            ...structuredClone(m),
            id: `el_m_${Date.now()}_${i}`,
            masterElementId: m.id,
          }))
        : [],
    };
    commitProjectUpdate((proj) => ({ ...proj, pages: [...proj.pages, newPage] }));
    setActivePageId(newPage.id);
  };

  const handleInsertSpread = () => {
    const master = activeProject.masterPages[0];
    const baseNum = activeProject.pages.length + 1;
    const mkPage = (offset: number, sideLabel: string): BookPage => ({
      id: `pg_${Date.now()}_${offset}`,
      orderIndex: activeProject.pages.length + offset,
      ...newPageLook(activeProject, activePage),
      label: `Editorial ${sideLabel} ${baseNum + offset}`,
      role: 'editorial_text',
      elements: master
        ? master.elements.map((m, i) => ({
            ...structuredClone(m),
            id: `el_m_${Date.now()}_${offset}_${i}`,
            masterElementId: m.id,
          }))
        : [],
    });
    const left = mkPage(0, 'Verso');
    const right = mkPage(1, 'Recto');
    commitProjectUpdate((proj) => ({ ...proj, pages: [...proj.pages, left, right] }));
    setActivePageId(left.id);
  };

  const handleDuplicatePage = (pageId: string) => {
    const idx = activeProject.pages.findIndex((p) => p.id === pageId);
    if (idx < 0) return;
    const copy: BookPage = {
      ...structuredClone(activeProject.pages[idx]),
      id: `pg_copy_${Date.now()}`,
      label: `${activeProject.pages[idx].label} Copy`,
      elements: activeProject.pages[idx].elements.map((e, i) => ({
        ...structuredClone(e),
        id: `el_cp_${Date.now()}_${i}`,
      })),
    };
    commitProjectUpdate((proj) => {
      const next = [...proj.pages];
      next.splice(idx + 1, 0, copy);
      return {
        ...proj,
        pages: next.map((p, i) => ({ ...p, orderIndex: i })),
      };
    });
    setActivePageId(copy.id);
  };

  const handleDeletePage = (pageId: string) => {
    if (activeProject.pages.length <= 1) return;
    const idx = activeProject.pages.findIndex((p) => p.id === pageId);
    commitProjectUpdate((proj) => {
      const next = proj.pages
        .filter((p) => p.id !== pageId)
        .map((p, i) => ({ ...p, orderIndex: i }));
      return { ...proj, pages: next };
    });
    const fallback = activeProject.pages[Math.max(0, idx - 1)];
    if (fallback && fallback.id !== pageId) setActivePageId(fallback.id);
  };

  const handleReorderPages = (fromIdx: number, toIdx: number) => {
    commitProjectUpdate((proj) => {
      const list = [...proj.pages];
      const [moved] = list.splice(fromIdx, 1);
      list.splice(toIdx, 0, moved);
      return {
        ...proj,
        pages: list.map((p, i) => ({ ...p, orderIndex: i })),
      };
    });
  };

  const handleRotateCanvasView = (dir: 'cw' | 'ccw') => {
    setCanvasViewRotation((prev) => {
      const next = (prev + (dir === 'cw' ? 90 : 270)) % 360;
      return next as PageRotation;
    });
  };

  const customComponents = useMemo(
    () => customTemplates.filter((t) => t.templateKind === 'component' || t.templateKind === 'infographic'),
    [customTemplates]
  );

  return (
    <>
      {notice && (
        <div
          role={notice.kind === 'info' ? 'status' : 'alert'}
          className={`fixed top-20 left-1/2 -translate-x-1/2 z-[60] max-w-[min(720px,calc(100vw-32px))] px-4 py-2.5 rounded-md shadow-2xl border text-xs flex items-center gap-3 ${
            notice.kind === 'info'
              ? 'bg-[#1F1F24] border-white/[0.14] text-[#ECEAE4]'
              : 'bg-[#3A1F1A] border-[#E07A5F]/50 text-[#F7D6CB]'
          }`}
        >
          <span className="flex-1">{notice.text}</span>
          <button onClick={() => setNotice(null)} aria-label="Dismiss" className="px-1.5 text-[#A19E95] hover:text-white cursor-pointer shrink-0">
            ✕
          </button>
        </div>
      )}
      {mergeDialog && (
        <MergeConflictsModal
          state={mergeDialog}
          canKeepCopy={canDesign}
          busy={mergeBusy}
          onResolve={(choices) => void handleResolveMerge(choices)}
          onUseLatest={() => void handleUseLatest()}
          onKeepCopy={() => void handleKeepMineAsCopy()}
        />
      )}
      {view === 'dashboard' ? (
        <DashboardView
          projects={bookList}
          activeProjectId={realBookOpen ? activeProject.id : null}
          user={user}
          role={me ? me.role : null}
          canDesign={canDesign}
          accessError={accessError}
          loading={listLoading || (!me && !accessError)}
          loadError={listError}
          onRetryLoad={() => void hydrateFromStorage()}
          busyId={busyId}
          onDownloadBackup={(id) => void handleDownloadBackup(id)}
          onOpenProject={(id) => void handleOpenProject(id)}
          onCreateBlankBook={() => void handleCreateBlankBook()}
          onOpenTemplateUpload={() => openModal('upload_template')}
          onOpenBookTemplates={() => openModal('templates')}
          onOpenInfographicsLibrary={() => openModal('infographics')}
          onDuplicateProject={(id) => void handleDuplicateProject(id)}
          onToggleArchiveProject={(id) => void handleToggleArchiveProject(id)}
          onDeleteProject={(id) => void handleDeleteProject(id)}
        />
      ) : (
        <div className="h-screen w-screen overflow-hidden bg-[#121214] text-[#ECEAE4] flex flex-col">
          {/* ZONE 1: Adobe InDesign Menu Bar + Contextual Control Strip */}
          {!previewMode && (
            <InDesignControlBar
              project={activeProject}
              activePageId={activePage.id}
              activeTool={activeTool}
              selectedElement={selectedElement}
              selectedCount={selectedElementIds.length}
              saveState={saveState}
              canUndo={undoStack.length > 0}
              canRedo={redoStack.length > 0}
              zoom={zoom}
              viewMode={viewMode}
              previewMode={previewMode}
              showGuides={showGuides}
              showRulers={showRulers}
              totalWords={analytics.totalWords}
              overflowCount={analytics.overflowFrames.length}
              user={user}
              canDesign={canDesign}
              othersHere={othersHere}
              onBackToDashboard={() => setView('dashboard')}
              onRenameProject={(name) =>
                commitProjectUpdate((proj) => ({ ...proj, name }), false)
              }
              onManualSave={() => void persistProjectNow(activeProject)}
              onUndo={handleUndo}
              onRedo={handleRedo}
              onZoomChange={setZoom}
              onFitToScreen={() => setZoom(viewMode === 'spread' ? 0.72 : 0.92)}
              onViewModeChange={setViewMode}
              onTogglePreview={() => setPreviewMode((p) => !p)}
              onToggleGuides={() => setShowGuides((g) => !g)}
              onToggleRulers={() => setShowRulers((r) => !r)}
              onToggleLeftSidebar={() => setLeftCollapsed((c) => !c)}
              onAddPage={handleAddPage}
              onInsertSpread={handleInsertSpread}
              onDuplicateSelected={() => handleDuplicateElements(activePage.id, selectedElementIds)}
              onDeleteSelected={() => handleDeleteElements(activePage.id, selectedElementIds)}
              onGroupSelected={handleGroupSelected}
              onUngroupSelected={handleUngroupSelected}
              onAlignElements={handleAlignElements}
              onUpdateElement={(pageId, elId, patch) => handleUpdateElement(pageId, elId, patch)}
              onOpenModal={openModal}
            />
          )}

          {/* MIDDLE ROW: InDesign Tool Palette + Left Studio Rail + Central Spread Canvas + Right Docked Inspector */}
          <div className="flex-1 flex min-h-0 overflow-hidden">
            {!previewMode && (
              <InDesignToolPalette
                activeTool={activeTool}
                previewMode={previewMode}
                selectedElement={selectedElement}
                primaryAccent={activeProject.designSystem.colors.primaryAccent}
                inkColor={activeProject.designSystem.colors.ink}
                canDesign={canDesign}
                onSelectTool={setActiveTool}
                onTogglePreview={() => setPreviewMode((p) => !p)}
                onSwapFillStroke={handleSwapFillStroke}
              />
            )}

            {!previewMode && (
              <LeftSidebar
                project={activeProject}
                activePage={activePage}
                selectedElementIds={selectedElementIds}
                customComponents={customComponents}
                canDesign={canDesign}
                collapsed={leftCollapsed}
                onToggleCollapse={() => setLeftCollapsed((c) => !c)}
                onAddComponent={(kind, customPayload) => handleAddComponent(kind, customPayload)}
                onSelectElements={setSelectedElementIds}
                onUpdateElement={(pageId, elId, patch) => handleUpdateElement(pageId, elId, patch)}
                onDeleteElements={handleDeleteElements}
                onDuplicateElements={handleDuplicateElements}
                onReorderLayer={handleReorderLayer}
                onGroupSelected={handleGroupSelected}
                onUngroupSelected={handleUngroupSelected}
                onSaveSelectedAsComponent={() => void handleSaveCustomComponent()}
                onUploadImages={handleBulkUploadImages}
                onPlaceOrReplaceImage={handlePlaceOrReplaceImage}
                onUpdateAssetMeta={(assetId, patch) =>
                  commitProjectUpdate((proj) => ({
                    ...proj,
                    imageAssets: proj.imageAssets.map((a) =>
                      a.id === assetId ? { ...a, ...patch } : a
                    ),
                  }))
                }
                onApplyMaster={(pageId, masterId) => {
                  const master = activeProject.masterPages.find((m) => m.id === masterId);
                  if (!master) return;
                  commitProjectUpdate((proj) => ({
                    ...proj,
                    pages: proj.pages.map((p) =>
                      p.id === pageId ? applyMasterToPage(p, master, false) : p
                    ),
                  }));
                }}
                onCreateMasterFromPage={(name, desc) => {
                  const master = createMasterFromPage(activePage, name, desc);
                  commitProjectUpdate((proj) => ({
                    ...proj,
                    masterPages: [...proj.masterPages, master],
                  }));
                }}
                onEditMasterBackground={(masterId, bg) => {
                  const existing = activeProject.masterPages.find((m) => m.id === masterId);
                  if (!existing) return;
                  commitProjectUpdate((proj) =>
                    syncMasterChangesAcrossBook(proj, { ...existing, backgroundColor: bg })
                  );
                }}
                onDetachMaster={(pageId) =>
                  commitProjectUpdate((proj) => ({
                    ...proj,
                    pages: proj.pages.map((p) =>
                      p.id === pageId ? detachPageFromMaster(p) : p
                    ),
                  }))
                }
                onSelectPage={(pageId) => {
                  setActivePageId(pageId);
                  setSelectedElementIds([]);
                }}
                onAddChapter={(title) =>
                  commitProjectUpdate((proj) => ({
                    ...proj,
                    chapters: [
                      ...proj.chapters,
                      {
                        id: `ch_${Date.now()}`,
                        number: proj.chapters.length + 1,
                        title,
                        orderIndex: proj.chapters.length,
                      },
                    ],
                  }))
                }
                onUpdatePageMeta={(pageId, patch) =>
                  commitProjectUpdate((proj) => ({
                    ...proj,
                    pages: proj.pages.map((p) => (p.id === pageId ? { ...p, ...patch } : p)),
                  }))
                }
                onOpenInfographicsModal={() => openModal('infographics')}
              />
            )}

            {/* ZONE 3: Central Book Spread Canvas */}
            <BookCanvas
              project={activeProject}
              visiblePages={visiblePages}
              activePageId={activePage.id}
              selectedElementIds={selectedElementIds}
              zoom={zoom}
              canvasViewRotation={canvasViewRotation}
              showGuides={showGuides}
              showRulers={showRulers}
              snapToGrid={snapToGrid}
              snapToObjects={snapToObjects}
              previewMode={previewMode}
              activeTool={activeTool}
              canDesign={canDesign}
              onSelectPage={(pageId) => setActivePageId(pageId)}
              onSelectElements={(pageId, ids) => {
                setActivePageId(pageId);
                setSelectedElementIds(ids);
              }}
              onUpdateElement={handleUpdateElement}
              onDropComponent={(pageId, kind, xMm, yMm) =>
                handleAddComponent(kind, undefined, { pageId, xMm, yMm })
              }
              onDropImageOnPage={handleDropImageOnPage}
              onCreateDrawnElement={handleCreateDrawnElement}
              onZoomStep={(delta) =>
                setZoom((z) => Math.max(0.3, Math.min(2.2, Number((z + delta).toFixed(2)))))
              }
              onSelectTool={setActiveTool}
              onRotateCanvasView={handleRotateCanvasView}
              onToggleSnapGrid={() => setSnapToGrid((s) => !s)}
              onToggleSnapObjects={() => setSnapToObjects((s) => !s)}
              onExitPreview={() => setPreviewMode(false)}
            />

            {/* ZONE 4: Right Docked InDesign Inspector (Properties · Styles · Swatches · Align · Links) */}
            {!previewMode && (
              <RightPropertiesPanel
                project={activeProject}
                activePage={activePage}
                selectedElement={selectedElement}
                selectedCount={selectedElementIds.length}
                canDesign={canDesign}
                onUpdateElement={(pageId, elId, patch) => handleUpdateElement(pageId, elId, patch)}
                onUpdatePage={(pageId, patch) =>
                  commitProjectUpdate((proj) => ({
                    ...proj,
                    pages: proj.pages.map((p) => (p.id === pageId ? { ...p, ...patch } : p)),
                  }))
                }
                onAlignElements={handleAlignElements}
                onJumpToElement={(pageId, elId) => {
                  setActivePageId(pageId);
                  setSelectedElementIds([elId]);
                }}
                onContinueOverflowToNextPage={handleContinueOverflowToNextPage}
                onOpenTypographyModal={() => openModal('typography')}
                onOpenDimensionsModal={() => openModal('dimensions')}
                onOpenInfographicsModal={() => openModal('infographics')}
                onSaveInfographicAsTemplate={(el) => void handleSaveCustomComponent(el)}
                onRequestAiTextFit={(el) => {
                  setAiInitialPrompt(
                    `The text frame "${el.name}" is overflowing its frame. Suggest a concise editorial rewrite that fits without altering our approved typography or layout.`
                  );
                  setActiveModal('ai_assistant');
                }}
              />
            )}
          </div>

          {/* ZONE 5: Bottom Spread & Page Navigator */}
          {!previewMode && (
            <BottomPageNavigator
              project={activeProject}
              activePageId={activePage.id}
              onSelectPage={(pageId) => {
                setActivePageId(pageId);
                setSelectedElementIds([]);
              }}
              onAddPage={handleAddPage}
              onInsertSpread={handleInsertSpread}
              onDuplicatePage={handleDuplicatePage}
              onDeletePage={handleDeletePage}
              onReorderPages={handleReorderPages}
              othersHere={othersHere}
              onOpenDeletedPages={() => {
                setHistoryTab('deleted');
                setActiveModal('versions');
              }}
            />
          )}
        </div>
      )}

      {/* MODALS & DRAWERS */}
      {activeModal === 'upload_template' && canDesign && (
        <TemplateUploadModal
          onClose={() => setActiveModal(null)}
          onCreateProjectFromApprovedReport={async (newProj) => {
            if (!requireDesigner('Only Designers can start a new book.')) return;
            setProjects((prev) => [newProj, ...prev]);
            setActiveProjectId(newProj.id);
            setActivePageId(newProj.pages[0]?.id || '');
            setSelectedElementIds([]);
            setActiveModal(null);
            setView('studio');
            await persistProjectNow(newProj);
          }}
        />
      )}

      {(activeModal === 'templates' || activeModal === 'infographics') && canDesign && (
        <TemplateLibraryModal
          initialTab={activeModal === 'infographics' ? 'infographics' : 'books'}
          currentProject={activeProject}
          customTemplates={customTemplates}
          onClose={() => setActiveModal(null)}
          onCreateBookFromTemplate={(tplId) => void handleCreateBookFromTemplate(tplId)}
          onCreateBookFromTemplateObject={(tpl) => void handleCreateBookFromTemplateObject(tpl)}
          onInsertBookPageLayout={(page) => {
            if (!requireBook('add this page to it')) return;
            const newPage: BookPage = {
              ...page,
              id: `pg_ins_${Date.now()}`,
              orderIndex: activeProject.pages.length,
              elements: page.elements.map((e, i) => ({
                ...e,
                id: `el_ins_${Date.now()}_${i}`,
              })),
            };
            commitProjectUpdate((proj) => ({ ...proj, pages: [...proj.pages, newPage] }));
            setActivePageId(newPage.id);
            setView('studio');
          }}
          onInsertInfographic={handleInsertInfographic}
          onSaveCustomBookTemplate={(tpl) => void handleSaveCustomBookTemplate(tpl)}
          onSaveCustomInfographicData={(data) => void handleSaveCustomInfographicData(data)}
          onInsertCustomTemplate={(ct) => {
            if (ct.templateKind === 'book' && ct.payload?.bookTemplate) {
              const savedBook = ct.payload.bookTemplate as Omit<BookTemplate, 'buildPages'> & {
                pages: BookPage[];
              };
              void handleCreateBookFromTemplateObject({
                ...savedBook,
                buildPages: () => structuredClone(savedBook.pages || []),
              });
              return;
            }
            if (ct.payload?.element) {
              if (!requireBook('add this component to it')) return;
              handleAddComponent('text_box', ct.payload.element as BookElement);
              setView('studio');
            }
          }}
        />
      )}

      {activeModal === 'typography' && canDesign && (
        <TypographyStudioModal
          project={activeProject}
          fontCollection={fontCollection}
          onUpdateProject={(updated) => commitProjectUpdate(() => updated)}
          onSaveFontCollection={(col) => {
            setFontCollection(col);
            void saveFontCollection(col);
          }}
          onClose={() => setActiveModal(null)}
        />
      )}

      {activeModal === 'dimensions' && canDesign && (
        <PageDimensionsModal
          project={activeProject}
          activePage={activePage}
          canvasViewRotation={canvasViewRotation}
          onRotateCanvasView={handleRotateCanvasView}
          onUpdateProject={(updated) => commitProjectUpdate(() => updated)}
          onClose={() => setActiveModal(null)}
        />
      )}

      {activeModal === 'content' && (
        <ContentManagerModal
          project={activeProject}
          onUpdateProject={(updated) => commitProjectUpdate(() => updated)}
          onJumpToPage={(pageId, elId) => {
            setActivePageId(pageId);
            setSelectedElementIds(elId ? [elId] : []);
          }}
          onClose={() => setActiveModal(null)}
        />
      )}

      {activeModal === 'design_system' && canDesign && (
        <GlobalDesignSystemModal
          project={activeProject}
          onUpdateProject={(updated) => commitProjectUpdate(() => updated)}
          onJumpToPage={(pageId, elId) => {
            setActivePageId(pageId);
            setSelectedElementIds(elId ? [elId] : []);
          }}
          onClose={() => setActiveModal(null)}
        />
      )}

      {activeModal === 'export' && (
        <ExportPreflightModal
          project={activeProject}
          canDesign={canDesign}
          activePage={activePage}
          activePageIndex={activePageIndex}
          onUpdateProject={(updated) => commitProjectUpdate(() => updated)}
          onJumpToPage={(pageId, elId) => {
            setActivePageId(pageId);
            setSelectedElementIds(elId ? [elId] : []);
          }}
          onClose={() => setActiveModal(null)}
        />
      )}

      {activeModal === 'versions' && (
        <VersionHistoryModal
          project={activeProject}
          canRestoreVersion={canDesign}
          initialTab={historyTab}
          onRestorePage={handleRestoreDeletedPage}
          onRestoreVersion={(ver: ProjectVersion) => {
            if (!requireDesigner('Only a Designer can restore a whole version, because it brings back its design too.')) return;
            commitProjectUpdate((proj) => ({
              ...proj,
              dimensions: structuredClone(ver.snapshot.dimensions),
              designSystem: structuredClone(ver.snapshot.designSystem),
              pages: structuredClone(ver.snapshot.pages),
              masterPages: structuredClone(ver.snapshot.masterPages),
              chapters: structuredClone(ver.snapshot.chapters),
              contentSections: structuredClone(ver.snapshot.contentSections),
            }));
          }}
          onClose={() => setActiveModal(null)}
        />
      )}

      {activeModal === 'auto_flow' && (
        <AiAutoFlowModal
          project={activeProject}
          canDesign={canDesign}
          onApplyFlowedProject={(updated) => {
            commitProjectUpdate(() => updated, true);
            setActivePageId(updated.pages[0]?.id || activePage.id);
            setSelectedElementIds([]);
          }}
          onClose={() => setActiveModal(null)}
        />
      )}

      {activeModal === 'ai_assistant' && (
        <AiAssistantDrawer
          project={activeProject}
          activePage={activePage}
          selectedElement={selectedElement}
          initialPrompt={aiInitialPrompt}
          canDesign={canDesign}
          onApplySuggestion={handleApplyAiSuggestion}
          onClose={() => {
            setAiInitialPrompt('');
            setActiveModal(null);
          }}
        />
      )}
    </>
  );
}
