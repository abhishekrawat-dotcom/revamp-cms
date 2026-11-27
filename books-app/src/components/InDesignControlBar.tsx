import React, { useEffect, useRef, useState } from 'react';
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalSpaceAround,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalSpaceAround,
  ArrowLeft,
  BarChart3,
  BookOpen,
  Check,
  Cloud,
  Download,
  Eye,
  Grid,
  LayoutGrid,
  Lock,
  Maximize2,
  Redo2,
  Ruler,
  Save,
  Sparkles,
  Undo2,
  Wand2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { SignedInUser } from '../services/api';
import type { AlignAction, BookElement, BookProject, InDesignTool } from '../types/bookstudio';
import { formatNumericValue, unitToMm } from '../engines/dimensionEngine';
import { GOOGLE_FONTS_CATALOG, loadGoogleFont } from '../engines/fontEngine';

export interface InDesignControlBarProps {
  project: BookProject;
  activePageId: string;
  activeTool: InDesignTool;
  selectedElement: BookElement | null;
  selectedCount: number;
  saveState: 'saved' | 'saving' | 'unsaved';
  canUndo: boolean;
  canRedo: boolean;
  zoom: number;
  viewMode: 'spread' | 'single';
  previewMode: boolean;
  showGuides: boolean;
  showRulers: boolean;
  totalWords: number;
  overflowCount: number;
  user: SignedInUser | null;
  /** false for a Content editor: the design's menus and controls are not offered */
  canDesign: boolean;
  /** others with this book open (POST /api/books/presence), with the page each is on (0 = not known) */
  othersHere: Array<{ email: string; name: string; pageNumber: number }>;
  onBackToDashboard: () => void;
  onRenameProject: (name: string) => void;
  onManualSave: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onZoomChange: (zoom: number) => void;
  onFitToScreen: () => void;
  onViewModeChange: (mode: 'spread' | 'single') => void;
  onTogglePreview: () => void;
  onToggleGuides: () => void;
  onToggleRulers: () => void;
  onToggleLeftSidebar: () => void;
  onAddPage: () => void;
  onInsertSpread: () => void;
  onDuplicateSelected: () => void;
  onDeleteSelected: () => void;
  onGroupSelected: () => void;
  onUngroupSelected: () => void;
  onAlignElements: (action: AlignAction) => void;
  onUpdateElement: (pageId: string, elementId: string, patch: Partial<BookElement>) => void;
  onOpenModal: (
    modal:
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
      | 'ai_assistant'
      /** the word counts beside the canvas (not a modal) */
      | 'editorial'
  ) => void;
}

type MenuKey = 'file' | 'edit' | 'layout' | 'type' | 'object' | 'view' | 'window';

/** what the "Content editor" tag says is locked */
export const CONTENT_EDITOR_TIP =
  'Content editor: you can change words, photos in their frames (choose, move, zoom), infographic data, labels and chart type, captions, the manuscript and pages, and export. Locked for you: the page size, master pages, colours, fonts and text styles, and where frames sit and how they look. A Designer changes those.';

const TOOL_LABELS: Record<InDesignTool, string> = {
  select: 'Selection (V)',
  direct_select: 'Direct Select (A)',
  type: 'Type Frame (T)',
  frame_image: 'Image Frame (F)',
  rect: 'Rectangle (M)',
  ellipse: 'Ellipse (O)',
  line: 'Hairline Rule (\\)',
  infographic: 'Infographic (G)',
  hand: 'Hand Pan (H)',
  zoom: 'Zoom (Z)',
};

export const InDesignControlBar: React.FC<InDesignControlBarProps> = ({
  project,
  activePageId,
  activeTool,
  selectedElement,
  selectedCount,
  saveState,
  canUndo,
  canRedo,
  zoom,
  viewMode,
  previewMode,
  showGuides,
  showRulers,
  totalWords,
  overflowCount,
  user,
  canDesign,
  othersHere,
  onBackToDashboard,
  onRenameProject,
  onManualSave,
  onUndo,
  onRedo,
  onZoomChange,
  onFitToScreen,
  onViewModeChange,
  onTogglePreview,
  onToggleGuides,
  onToggleRulers,
  onToggleLeftSidebar,
  onAddPage,
  onInsertSpread,
  onDuplicateSelected,
  onDeleteSelected,
  onGroupSelected,
  onUngroupSelected,
  onAlignElements,
  onUpdateElement,
  onOpenModal,
}) => {
  const [openMenu, setOpenMenu] = useState<MenuKey | null>(null);
  const menuBarRef = useRef<HTMLDivElement>(null);
  const unit = project.unit;

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (menuBarRef.current && !menuBarRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, []);

  const runAndClose = (fn: () => void) => {
    fn();
    setOpenMenu(null);
  };

  /* items marked design: true change the book's design: a Content editor is not offered them */
  const allMenus: Record<
    MenuKey,
    { label: string; items: Array<{ label: string; shortcut?: string; divider?: boolean; disabled?: boolean; design?: boolean; action?: () => void }> }
  > = {
    file: {
      label: 'File',
      items: [
        { label: 'Projects Dashboard', action: onBackToDashboard },
        { label: 'New from Unlimited Books & Reports...', shortcut: 'Ctrl+N', design: true, action: () => onOpenModal('templates') },
        { label: 'Insert Unlimited Vector Infographic...', design: true, action: () => onOpenModal('infographics') },
        { label: 'AI Auto-Flow My Data Into Layout...', action: () => onOpenModal('auto_flow') },
        { label: 'Import Reference Design (PDF / IDML / Image)...', design: true, action: () => onOpenModal('upload_template') },
        { label: '', divider: true },
        { label: 'Document Setup & Trim Size...', design: true, action: () => onOpenModal('dimensions') },
        { label: 'Save Publication', shortcut: 'Ctrl+S', action: onManualSave },
        { label: 'Version History & Snapshots...', action: () => onOpenModal('versions') },
        { label: '', divider: true },
        { label: 'Export PDF, Images or Backup...', shortcut: 'Ctrl+E', action: () => onOpenModal('export') },
      ],
    },
    edit: {
      label: 'Edit',
      items: [
        { label: 'Undo', shortcut: 'Ctrl+Z', disabled: !canUndo, action: onUndo },
        { label: 'Redo', shortcut: 'Ctrl+Shift+Z', disabled: !canRedo, action: onRedo },
        { label: '', divider: true },
        { label: 'Duplicate Selected Frame', disabled: selectedCount === 0, design: true, action: onDuplicateSelected },
        { label: 'Delete Selected Frame', shortcut: 'Del', disabled: selectedCount === 0, design: true, action: onDeleteSelected },
        { label: '', divider: true, design: true },
        { label: 'Editorial Content & Word Count Manager...', action: () => onOpenModal('content') },
        { label: "Word Counts & Text That Doesn't Fit", action: () => onOpenModal('editorial') },
      ],
    },
    layout: {
      label: 'Layout',
      items: [
        { label: 'Add Single Page', action: onAddPage },
        { label: 'Insert Facing Spread (2 Pages)', action: onInsertSpread },
        { label: '', divider: true, design: true },
        { label: 'Margins, Columns & Bleed Setup...', design: true, action: () => onOpenModal('dimensions') },
        { label: 'Global Design System & Brand Styles...', design: true, action: () => onOpenModal('design_system') },
      ],
    },
    type: {
      label: 'Type',
      items: [
        { label: 'Google Fonts & Typography Studio...', design: true, action: () => onOpenModal('typography') },
        { label: 'Editorial Copy & Overflow Manager...', action: () => onOpenModal('content') },
        { label: "Word Counts & Text That Doesn't Fit", action: () => onOpenModal('editorial') },
        { label: 'AI Editorial Copy & Layout Assistant...', action: () => onOpenModal('ai_assistant') },
      ],
    },
    object: {
      label: 'Object',
      items: [
        { label: 'Group Selected Frames', disabled: selectedCount < 2, design: true, action: onGroupSelected },
        { label: 'Ungroup Selected', disabled: selectedCount === 0, design: true, action: onUngroupSelected },
        { label: '', divider: true, design: true },
        { label: 'Align Left Edges', disabled: selectedCount === 0, design: true, action: () => onAlignElements('left') },
        { label: 'Align Horizontal Centers', disabled: selectedCount === 0, design: true, action: () => onAlignElements('center_h') },
        { label: 'Align Right Edges', disabled: selectedCount === 0, design: true, action: () => onAlignElements('right') },
        { label: 'Align Top Edges', disabled: selectedCount === 0, design: true, action: () => onAlignElements('top') },
        { label: 'Align Vertical Centers', disabled: selectedCount === 0, design: true, action: () => onAlignElements('center_v') },
        { label: 'Distribute Horizontal Spacing', disabled: selectedCount < 3, design: true, action: () => onAlignElements('distribute_h') },
        { label: 'Distribute Vertical Spacing', disabled: selectedCount < 3, design: true, action: () => onAlignElements('distribute_v') },
      ],
    },
    view: {
      label: 'View',
      items: [
        { label: 'Facing Pages Spread View', action: () => onViewModeChange('spread') },
        { label: 'Single Page View', action: () => onViewModeChange('single') },
        { label: '', divider: true },
        { label: 'Zoom In', shortcut: '+', action: () => onZoomChange(Math.min(2.2, Number((zoom + 0.15).toFixed(2)))) },
        { label: 'Zoom Out', shortcut: '-', action: () => onZoomChange(Math.max(0.3, Number((zoom - 0.15).toFixed(2)))) },
        { label: 'Fit Spread in Window', action: onFitToScreen },
        { label: '', divider: true },
        { label: showGuides ? 'Hide Margins & Grid Guides' : 'Show Margins & Grid Guides', action: onToggleGuides },
        { label: showRulers ? 'Hide Physical Rulers' : 'Show Physical Rulers', action: onToggleRulers },
        { label: previewMode ? 'Screen Mode: Normal (W)' : 'Screen Mode: Preview (W)', shortcut: 'W', action: onTogglePreview },
      ],
    },
    window: {
      label: 'Window',
      items: [
        { label: 'Toggle Left Studio Rail (Pages / Layers / Assets)', action: onToggleLeftSidebar },
        { label: 'Unlimited Books & Reports Library...', design: true, action: () => onOpenModal('templates') },
        { label: 'Unlimited Infographics Studio...', design: true, action: () => onOpenModal('infographics') },
        { label: 'AI Editorial Assistant Drawer...', action: () => onOpenModal('ai_assistant') },
      ],
    },
  };

  // a Content editor's menus: without the design's items (a menu left with none is not shown)
  const menus = {} as typeof allMenus;
  (Object.keys(allMenus) as MenuKey[]).forEach((key) => {
    const items = allMenus[key].items.filter((it) => canDesign || !it.design);
    if (items.some((it) => !it.divider)) menus[key] = { ...allMenus[key], items };
  });

  return (
    <header className="shrink-0 bg-[#18181B] border-b border-white/[0.08] select-none z-30">
      {/* TIER 1: Classic Adobe InDesign Application Menu Bar */}
      <div
        ref={menuBarRef}
        className="h-8 px-2.5 flex items-center justify-between gap-2 border-b border-white/[0.06] bg-[#141417]"
      >
        <div className="flex items-center gap-1 min-w-0">
          <button
            onClick={onBackToDashboard}
            title="Return to Publications Dashboard"
            className="h-6 px-1.5 flex items-center gap-1.5 rounded hover:bg-white/[0.06] cursor-pointer shrink-0"
          >
            <span className="w-5 h-5 rounded-[3px] bg-[#2D1C24] border border-[#C6A26B]/60 text-[#E8CFA1] font-mono-tabular text-[11px] font-bold flex items-center justify-center">
              Bs
            </span>
            <ArrowLeft className="w-3 h-3 text-[#8F8C84]" />
          </button>

          {/* Menu Triggers */}
          <nav className="hidden md:flex items-center gap-0.5 ml-1">
            {(Object.keys(menus) as MenuKey[]).map((key) => {
              const m = menus[key];
              const isOpen = openMenu === key;
              return (
                <div key={key} className="relative">
                  <button
                    onClick={() => setOpenMenu(isOpen ? null : key)}
                    onMouseEnter={() => {
                      if (openMenu && openMenu !== key) setOpenMenu(key);
                    }}
                    className={`px-2 py-0.5 text-[11px] rounded transition-colors cursor-pointer whitespace-nowrap ${
                      isOpen
                        ? 'bg-[#2C2C34] text-white'
                        : 'text-[#C8C5BC] hover:text-white hover:bg-white/[0.06]'
                    }`}
                  >
                    {m.label}
                  </button>
                  {isOpen && (
                    <div className="absolute left-0 top-full mt-1 w-64 bg-[#1D1D22] border border-white/[0.12] rounded shadow-2xl py-1 z-50">
                      {m.items.map((item, idx) =>
                        item.divider ? (
                          <div key={idx} className="my-1 border-t border-white/[0.08]" />
                        ) : (
                          <button
                            key={idx}
                            disabled={item.disabled}
                            onClick={() => item.action && runAndClose(item.action)}
                            className="w-full px-3 py-1.5 text-left text-[11px] text-[#ECEAE4] hover:bg-[#C6A26B] hover:text-[#121214] disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-[#ECEAE4] flex items-center justify-between gap-2 cursor-pointer"
                          >
                            <span className="truncate">{item.label}</span>
                            {item.shortcut && (
                              <span className="font-mono-tabular text-[11px] opacity-65 shrink-0">
                                {item.shortcut}
                              </span>
                            )}
                          </button>
                        )
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </nav>

          <span className="hidden min-[1200px]:inline text-white/15 mx-1 shrink-0">|</span>

          <input
            type="text"
            value={project.name}
            onChange={(e) => onRenameProject(e.target.value)}
            aria-label="Document title"
            title={project.name}
            className="bg-transparent text-[11px] font-medium text-[#ECEAE4] hover:bg-white/[0.04] focus:bg-[#232328] focus:outline-none focus:ring-1 focus:ring-[#C6A26B]/60 rounded px-1.5 py-0.5 w-20 min-[1200px]:w-28 min-[1400px]:w-40 min-[1600px]:w-52 min-w-0 truncate"
          />

          <button
            onClick={onManualSave}
            title={`${saveState === 'saving' ? 'Saving' : saveState === 'saved' ? 'Saved' : 'Unsaved'} — save the book (Ctrl+S)`}
            aria-label={`${saveState === 'saving' ? 'Saving' : saveState === 'saved' ? 'Saved' : 'Unsaved'}: save the book`}
            className="h-6 px-1.5 flex items-center gap-1 text-[11px] text-[#98958D] hover:text-[#ECEAE4] hover:bg-white/[0.05] rounded whitespace-nowrap shrink-0 cursor-pointer"
          >
            {saveState === 'saved' ? (
              <Check className="w-3 h-3 text-[#8AA678]" />
            ) : (
              <Save className="w-3 h-3 text-[#C6A26B]" />
            )}
            <span className="hidden min-[1400px]:inline">{saveState === 'saving' ? 'Saving' : saveState === 'saved' ? 'Saved' : 'Unsaved'}</span>
          </button>

          {!canDesign && (
            <span
              title={CONTENT_EDITOR_TIP}
              tabIndex={0}
              aria-label={CONTENT_EDITOR_TIP}
              className="h-5 px-1.5 flex items-center gap-1 text-[11px] font-medium text-[#E6CFA5] bg-[#26231D] border border-[#C6A26B]/40 rounded whitespace-nowrap shrink-0 cursor-help"
            >
              <Lock className="w-2.5 h-2.5" />
              <span className="hidden min-[1400px]:inline">Content editor</span>
            </span>
          )}

          {/* "Also here": a small circle with each person's initials (their name and page in its tooltip), the words "Also
              here" only where there is room. Fixed-size and never shrunk, so it can't be squeezed out of sight or run under
              the buttons on the right at any window width (names cut to "qa" at 1366 px and gone at 1280 px before) */}
          {othersHere.length > 0 && (
            <div
              role="group"
              tabIndex={0}
              title={`Also here: ${othersHere.map((o) => `${o.name}${o.pageNumber ? ` (page ${o.pageNumber})` : ''}`).join(', ')}`}
              aria-label={`Also here: ${othersHere.map((o) => `${o.name}${o.pageNumber ? ` on page ${o.pageNumber}` : ''}`).join(', ')}`}
              className="flex shrink-0 items-center gap-1 ml-1 rounded focus:outline-none focus-visible:ring-1 focus-visible:ring-[#C6A26B]/60"
            >
              <span className="hidden 2xl:inline text-[11px] text-[#8F8C84] whitespace-nowrap">Also here:</span>
              {othersHere.slice(0, 3).map((o) => (
                <span
                  key={o.email}
                  title={`${o.name} (${o.email})${o.pageNumber ? ` is on page ${o.pageNumber}` : ' has this book open'}`}
                  className="flex items-center justify-center w-6 h-6 rounded-full text-[11px] font-semibold text-[#CFE3C2] bg-[#1F2A1C] border border-[#8AA678]/60 uppercase"
                >
                  {String(o.name || o.email || '?')
                    .split(/[\s._-]+/)
                    .filter(Boolean)
                    .slice(0, 2)
                    .map((w) => w.charAt(0))
                    .join('') || '?'}
                </span>
              ))}
              {othersHere.length > 3 && (
                <span
                  title={othersHere.slice(3).map((o) => o.email).join(', ')}
                  className="flex items-center justify-center w-6 h-6 rounded-full text-[11px] text-[#8F8C84] bg-white/[0.04] border border-white/[0.1]"
                >
                  +{othersHere.length - 3}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Right Utility Actions */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => onOpenModal('auto_flow')}
            title="Put your data once — AI flows everything as-is into this exact layout, image placeholders & live infographics"
            className="h-6 px-2.5 flex items-center gap-1 text-[11px] font-medium text-[#121214] bg-[#DFC08E] hover:bg-[#EBD2A8] rounded transition-colors whitespace-nowrap cursor-pointer"
          >
            <Wand2 className="w-3 h-3" />
            <span>Auto-Flow Data</span>
          </button>

          {canDesign && (
            <>
              <button
                onClick={() => onOpenModal('templates')}
                className="h-6 px-2 flex items-center gap-1 text-[11px] text-[#E6CFA5] bg-[#26231D] hover:bg-[#322D24] border border-[#C6A26B]/30 rounded transition-colors whitespace-nowrap cursor-pointer"
              >
                <LayoutGrid className="w-3 h-3 text-[#C6A26B]" />
                <span>Books & Reports</span>
              </button>

              <button
                onClick={() => onOpenModal('infographics')}
                className="h-6 px-2 flex items-center gap-1 text-[11px] text-[#D7D4CC] hover:text-white hover:bg-white/[0.06] rounded transition-colors whitespace-nowrap cursor-pointer"
              >
                <BarChart3 className="w-3 h-3 text-[#C6A26B]" />
                <span className="hidden sm:inline">Infographics</span>
              </button>
            </>
          )}

          <button
            onClick={() => onOpenModal('editorial')}
            title="Word counts per page, spread and chapter, and the text that doesn't fit"
            aria-label={`Word counts: ${totalWords.toLocaleString()} words${overflowCount ? `, ${overflowCount} frames with text that doesn't fit` : ''}`}
            className="hidden xl:flex h-6 px-2 items-center gap-1 text-[11px] font-mono-tabular text-[#98958D] hover:text-white hover:bg-white/[0.06] rounded whitespace-nowrap cursor-pointer"
          >
            <span>{totalWords.toLocaleString()} words</span>
            {overflowCount > 0 && <span className="text-[#E07A5F] font-bold">· {overflowCount} don't fit</span>}
          </button>

          <button
            onClick={() => onOpenModal('ai_assistant')}
            title="AI Editorial Assistant"
            className="h-6 px-2 flex items-center gap-1 text-[11px] text-[#D7D4CC] hover:text-white hover:bg-white/[0.06] rounded transition-colors whitespace-nowrap cursor-pointer"
          >
            <Sparkles className="w-3 h-3 text-[#C6A26B]" />
            <span className="hidden lg:inline">Assistant</span>
          </button>

          <span
            title={user ? `Saved in EventSphere · ${user.email}` : 'Saved in EventSphere'}
            className="h-6 px-1.5 flex items-center text-[11px] text-[#A19E95]"
          >
            <Cloud className="w-3 h-3 text-[#8AA678]" />
          </span>

          <button
            onClick={() => onOpenModal('export')}
            className="h-6 px-2.5 flex items-center gap-1 text-[11px] font-medium bg-[#C6A26B] hover:bg-[#D5B47F] text-[#121214] rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Download className="w-3 h-3" />
            <span>Export PDF</span>
          </button>
        </div>
      </div>

      {/* TIER 2: InDesign Contextual Control Bar */}
      <div className="h-9 px-2.5 flex items-center justify-between gap-2 bg-[#1D1D21] overflow-x-auto">
        {/* Left: Undo/Redo + Active Tool + Live Coordinates / Contextual Typography */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center gap-0.5">
            <button
              onClick={onUndo}
              disabled={!canUndo}
              title="Undo (Ctrl+Z)"
              className="h-6 w-6 flex items-center justify-center text-[#A19E95] hover:text-white hover:bg-white/[0.06] disabled:opacity-25 rounded cursor-pointer"
            >
              <Undo2 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={onRedo}
              disabled={!canRedo}
              title="Redo (Ctrl+Shift+Z)"
              className="h-6 w-6 flex items-center justify-center text-[#A19E95] hover:text-white hover:bg-white/[0.06] disabled:opacity-25 rounded cursor-pointer"
            >
              <Redo2 className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="h-4 w-px bg-white/[0.08]" />

          <span className="text-[11px] font-mono-tabular text-[#C6A26B] whitespace-nowrap">
            {TOOL_LABELS[activeTool]}
          </span>

          <div className="h-4 w-px bg-white/[0.08]" />

          {selectedElement && !canDesign ? (
            <div
              className="flex items-center gap-2 text-[11px] font-mono-tabular text-[#8F8C84] whitespace-nowrap"
              title="Where a frame sits and how it looks is the design: a Designer changes it"
            >
              <Lock className="w-3 h-3 text-[#7F7C75]" />
              <span>
                X {formatNumericValue(selectedElement.xMm, unit)} · Y {formatNumericValue(selectedElement.yMm, unit)} · W{' '}
                {formatNumericValue(selectedElement.widthMm, unit)} · H {formatNumericValue(selectedElement.heightMm, unit)} {unit}
              </span>
              {selectedElement.textStyle && (
                <span>
                  · {selectedElement.textStyle.fontFamily} {selectedElement.textStyle.fontSizePt}pt
                </span>
              )}
            </div>
          ) : selectedElement ? (
            <div className="flex items-center gap-1.5">
              {(
                [
                  ['X', selectedElement.xMm, (v: number) => onUpdateElement(activePageId, selectedElement.id, { xMm: v })],
                  ['Y', selectedElement.yMm, (v: number) => onUpdateElement(activePageId, selectedElement.id, { yMm: v })],
                  ['W', selectedElement.widthMm, (v: number) => onUpdateElement(activePageId, selectedElement.id, { widthMm: Math.max(4, v) })],
                  ['H', selectedElement.heightMm, (v: number) => onUpdateElement(activePageId, selectedElement.id, { heightMm: Math.max(2, v) })],
                ] as const
              ).map(([lbl, mmVal, onSet]) => (
                <label key={lbl} className="flex items-center gap-1">
                  <span className="text-[11px] text-[#8F8C84] font-mono-tabular">{lbl}</span>
                  <input
                    type="number"
                    step={0.5}
                    value={formatNumericValue(mmVal, unit)}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      if (!Number.isNaN(v)) onSet(Number(unitToMm(v, unit).toFixed(1)));
                    }}
                    className="w-13 bg-[#121214] border border-white/[0.08] rounded px-1.5 py-0.5 font-mono-tabular text-[11px] text-[#ECEAE4] focus:outline-none focus:border-[#C6A26B]/60"
                  />
                </label>
              ))}

              {/* Contextual Typography Quick Strip */}
              {selectedElement.textStyle && (
                <>
                  <div className="h-4 w-px bg-white/[0.08] mx-0.5" />
                  <select
                    value={selectedElement.textStyle.fontFamily}
                    onChange={(e) => {
                      const fam = e.target.value;
                      void loadGoogleFont(fam);
                      onUpdateElement(activePageId, selectedElement.id, {
                        textStyle: { ...selectedElement.textStyle!, fontFamily: fam },
                      });
                    }}
                    className="h-6 max-w-32 bg-[#121214] border border-white/[0.08] rounded px-1.5 text-[11px] text-[#ECEAE4]"
                  >
                    {Array.from(
                      new Set([
                        selectedElement.textStyle.fontFamily,
                        project.designSystem.typography.displayFont,
                        project.designSystem.typography.headingFont,
                        project.designSystem.typography.bodyFont,
                        project.designSystem.typography.captionFont,
                        ...GOOGLE_FONTS_CATALOG.slice(0, 20).map((f) => f.family),
                      ])
                    ).map((fam) => (
                      <option key={fam} value={fam}>
                        {fam}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    step={0.5}
                    min={5}
                    max={140}
                    title="Font Size (pt)"
                    value={selectedElement.textStyle.fontSizePt}
                    onChange={(e) =>
                      onUpdateElement(activePageId, selectedElement.id, {
                        textStyle: {
                          ...selectedElement.textStyle!,
                          fontSizePt: Math.max(5, parseFloat(e.target.value) || 10),
                        },
                      })
                    }
                    className="w-12 h-6 bg-[#121214] border border-white/[0.08] rounded px-1.5 font-mono-tabular text-[11px] text-[#ECEAE4]"
                  />
                  <span className="text-[11px] text-[#8F8C84]">pt</span>
                </>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2 text-[11px] text-[#98958D]">
              {canDesign ? (
                <button
                  onClick={() => onOpenModal('dimensions')}
                  className="flex items-center gap-1 hover:text-white cursor-pointer whitespace-nowrap"
                >
                  <BookOpen className="w-3 h-3 text-[#C6A26B]" />
                  <span className="font-mono-tabular">
                    {project.dimensions.widthMm}×{project.dimensions.heightMm}mm · {project.dimensions.columns} cols
                  </span>
                </button>
              ) : (
                <span className="flex items-center gap-1 whitespace-nowrap">
                  <BookOpen className="w-3 h-3 text-[#C6A26B]" />
                  <span className="font-mono-tabular">
                    {project.dimensions.widthMm}×{project.dimensions.heightMm}mm · {project.dimensions.columns} cols
                  </span>
                </span>
              )}
              <span className="text-white/20">·</span>
              <span className="hidden lg:inline text-[11px] text-[#8F8C84]">
                {canDesign
                  ? 'Drag on page with T, F, M, O, \\ or G tool to draw frames directly'
                  : 'Double-click a frame to change its words, or to move the photo inside it'}
              </span>
            </div>
          )}
        </div>

        {/* Right: Quick Align Bar + View / Zoom / Guides / Preview [W] */}
        <div className="flex items-center gap-1.5 shrink-0">
          {selectedCount > 0 && canDesign && (
            <div className="hidden xl:flex items-center bg-[#121214] border border-white/[0.08] rounded p-0.5 gap-0.5">
              {(
                [
                  ['left', AlignStartHorizontal, 'Align Left'],
                  ['center_h', AlignCenterHorizontal, 'Align Horizontal Center'],
                  ['right', AlignEndHorizontal, 'Align Right'],
                  ['top', AlignStartVertical, 'Align Top'],
                  ['center_v', AlignCenterVertical, 'Align Vertical Center'],
                  ['bottom', AlignEndVertical, 'Align Bottom'],
                  ['distribute_h', AlignHorizontalSpaceAround, 'Distribute Horizontal (3+ frames)'],
                  ['distribute_v', AlignVerticalSpaceAround, 'Distribute Vertical (3+ frames)'],
                ] as const
              ).map(([action, Icon, tip]) => (
                <button
                  key={action}
                  onClick={() => onAlignElements(action)}
                  disabled={(action === 'distribute_h' || action === 'distribute_v') && selectedCount < 3}
                  title={tip}
                  className="h-5 w-5 flex items-center justify-center text-[#A19E95] hover:text-[#C6A26B] hover:bg-white/[0.06] disabled:opacity-25 rounded cursor-pointer"
                >
                  <Icon className="w-3 h-3" />
                </button>
              ))}
            </div>
          )}

          <div className="flex items-center bg-[#121214] border border-white/[0.08] rounded p-0.5">
            <button
              onClick={() => onViewModeChange('spread')}
              className={`px-1.5 py-0.5 text-[11px] rounded cursor-pointer ${
                viewMode === 'spread' ? 'bg-[#282830] text-[#ECEAE4]' : 'text-[#8F8C84] hover:text-white'
              }`}
            >
              Spread
            </button>
            <button
              onClick={() => onViewModeChange('single')}
              className={`px-1.5 py-0.5 text-[11px] rounded cursor-pointer ${
                viewMode === 'single' ? 'bg-[#282830] text-[#ECEAE4]' : 'text-[#8F8C84] hover:text-white'
              }`}
            >
              Single
            </button>
          </div>

          <div className="flex items-center bg-[#121214] border border-white/[0.08] rounded px-1 py-0.5 gap-0.5">
            <button
              onClick={() => onZoomChange(Math.max(0.3, Number((zoom - 0.1).toFixed(2))))}
              title="Zoom Out"
              className="h-5 w-5 flex items-center justify-center text-[#98958D] hover:text-white cursor-pointer"
            >
              <ZoomOut className="w-3 h-3" />
            </button>
            <span className="font-mono-tabular text-[11px] text-[#D7D4CC] w-9 text-center">
              {Math.round(zoom * 100)}%
            </span>
            <button
              onClick={() => onZoomChange(Math.min(2.2, Number((zoom + 0.1).toFixed(2))))}
              title="Zoom In"
              className="h-5 w-5 flex items-center justify-center text-[#98958D] hover:text-white cursor-pointer"
            >
              <ZoomIn className="w-3 h-3" />
            </button>
            <button
              onClick={onFitToScreen}
              title="Fit Spread to Window"
              className="h-5 w-5 flex items-center justify-center text-[#98958D] hover:text-white cursor-pointer"
            >
              <Maximize2 className="w-2.5 h-2.5" />
            </button>
          </div>

          <button
            onClick={onToggleGuides}
            title="Toggle Margin, Column & Bleed Guides"
            className={`h-6 px-1.5 flex items-center gap-1 text-[11px] rounded border cursor-pointer ${
              showGuides
                ? 'bg-[#282830] border-white/[0.14] text-[#ECEAE4]'
                : 'border-transparent text-[#8F8C84] hover:text-white'
            }`}
          >
            <Grid className="w-3 h-3" />
            <span className="hidden lg:inline">Guides</span>
          </button>

          <button
            onClick={onToggleRulers}
            title="Toggle Rulers"
            className={`h-6 w-6 flex items-center justify-center rounded border cursor-pointer ${
              showRulers
                ? 'bg-[#282830] border-white/[0.14] text-[#ECEAE4]'
                : 'border-transparent text-[#8F8C84] hover:text-white'
            }`}
          >
            <Ruler className="w-3 h-3" />
          </button>

          <button
            onClick={onTogglePreview}
            title="Presentation Preview Mode (W)"
            className={`h-6 px-2 flex items-center gap-1 text-[11px] rounded border cursor-pointer whitespace-nowrap ${
              previewMode
                ? 'bg-[#C6A26B] text-[#121214] border-[#C6A26B] font-semibold'
                : 'border-white/[0.1] text-[#D7D4CC] hover:bg-white/[0.06]'
            }`}
          >
            <Eye className="w-3 h-3" />
            <span>Preview (W)</span>
          </button>
        </div>
      </div>
    </header>
  );
};
