import React, { useMemo, useRef, useState } from 'react';
import {
  AlignLeft,
  BarChart3,
  BookMarked,
  Bookmark,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Copy,
  Eye,
  EyeOff,
  FolderPlus,
  Group,
  Hash,
  Heading1,
  Heading2,
  Image as ImageIcon,
  Layers,
  LayoutTemplate,
  Link2Off,
  Lock,
  Minus,
  PanelBottom,
  PanelTop,
  Plus,
  Quote,
  Search,
  Shapes,
  Sparkles,
  Square,
  Trash2,
  Type,
  Ungroup,
  Unlock,
  Upload,
} from 'lucide-react';
import type {
  BookElement,
  BookPage,
  BookProject,
  CustomSavedTemplate,
  ImageAsset,
  MasterPage,
  PageRole,
} from '../types/bookstudio';
import {
  PhotoResolutionBadge,
  photoPrintResolution,
  printQuality,
  sharpPrintSizeCm,
} from './PhotoResolutionBadge';

export type ComponentDragKind =
  | 'heading'
  | 'subheading'
  | 'paragraph'
  | 'caption'
  | 'pull_quote'
  | 'text_box'
  | 'image'
  | 'shape_rect'
  | 'shape_ellipse'
  | 'line'
  | 'background_panel'
  | 'decorative_frame'
  | 'page_number'
  | 'header'
  | 'footer'
  | 'logo'
  | 'infographic';

interface LeftSidebarProps {
  project: BookProject;
  activePage: BookPage;
  selectedElementIds: string[];
  customComponents: CustomSavedTemplate[];
  /** false for a Content editor: no Elements (adding frames) or Masters tab, Layers read-only, page type fixed */
  canDesign: boolean;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onAddComponent: (kind: ComponentDragKind, customPayload?: BookElement) => void;
  onSelectElements: (ids: string[]) => void;
  onUpdateElement: (pageId: string, elementId: string, patch: Partial<BookElement>) => void;
  onDeleteElements: (pageId: string, ids: string[]) => void;
  onDuplicateElements: (pageId: string, ids: string[]) => void;
  onReorderLayer: (pageId: string, elementId: string, direction: 'up' | 'down') => void;
  onGroupSelected: () => void;
  onUngroupSelected: () => void;
  onSaveSelectedAsComponent: () => void;
  onUploadImages: (files: FileList) => Promise<void>;
  onPlaceOrReplaceImage: (asset: ImageAsset) => void;
  onUpdateAssetMeta: (assetId: string, patch: Partial<ImageAsset>) => void;
  onApplyMaster: (pageId: string, masterId: string) => void;
  onCreateMasterFromPage: (name: string, description: string) => void;
  onEditMasterBackground: (masterId: string, bg: string) => void;
  onDetachMaster: (pageId: string) => void;
  onSelectPage: (pageId: string) => void;
  onAddChapter: (title: string) => void;
  onUpdatePageMeta: (pageId: string, patch: Partial<BookPage>) => void;
  onOpenInfographicsModal: () => void;
}

const COMPONENT_GROUPS: Array<{
  title: string;
  items: Array<{ kind: ComponentDragKind; label: string; icon: React.ReactNode }>;
}> = [
  {
    title: 'Content',
    items: [
      { kind: 'heading', label: 'Heading', icon: <Heading1 className="w-3.5 h-3.5" /> },
      { kind: 'subheading', label: 'Subheading', icon: <Heading2 className="w-3.5 h-3.5" /> },
      { kind: 'paragraph', label: 'Paragraph', icon: <AlignLeft className="w-3.5 h-3.5" /> },
      { kind: 'text_box', label: 'Text Frame', icon: <Type className="w-3.5 h-3.5" /> },
      { kind: 'caption', label: 'Caption', icon: <Minus className="w-3.5 h-3.5" /> },
      { kind: 'pull_quote', label: 'Pull Quote', icon: <Quote className="w-3.5 h-3.5" /> },
    ],
  },
  {
    title: 'Visual & Graphic',
    items: [
      { kind: 'image', label: 'Image Frame', icon: <ImageIcon className="w-3.5 h-3.5" /> },
      { kind: 'shape_rect', label: 'Rectangle', icon: <Square className="w-3.5 h-3.5" /> },
      { kind: 'shape_ellipse', label: 'Circle / Oval', icon: <Shapes className="w-3.5 h-3.5" /> },
      { kind: 'line', label: 'Hairline Rule', icon: <Minus className="w-3.5 h-3.5" /> },
      { kind: 'background_panel', label: 'Tinted Panel', icon: <LayoutTemplate className="w-3.5 h-3.5" /> },
      { kind: 'decorative_frame', label: 'Border Frame', icon: <Sparkles className="w-3.5 h-3.5" /> },
    ],
  },
  {
    title: 'Publishing',
    items: [
      { kind: 'page_number', label: 'Page Number', icon: <Hash className="w-3.5 h-3.5" /> },
      { kind: 'header', label: 'Running Header', icon: <PanelTop className="w-3.5 h-3.5" /> },
      { kind: 'footer', label: 'Running Footer', icon: <PanelBottom className="w-3.5 h-3.5" /> },
      { kind: 'logo', label: 'Publisher Logo', icon: <Bookmark className="w-3.5 h-3.5" /> },
      { kind: 'infographic', label: 'Infographic', icon: <BarChart3 className="w-3.5 h-3.5" /> },
    ],
  },
];

const PAGE_ROLES: Array<{ value: PageRole; label: string }> = [
  { value: 'front_cover', label: 'Front Cover' },
  { value: 'inside_front_cover', label: 'Inside Front Cover' },
  { value: 'title_page', label: 'Title Page' },
  { value: 'copyright', label: 'Copyright Page' },
  { value: 'foreword', label: 'Foreword' },
  { value: 'introduction', label: 'Introduction' },
  { value: 'table_of_contents', label: 'Table of Contents' },
  { value: 'chapter_opener', label: 'Chapter Opener' },
  { value: 'editorial_text', label: 'Editorial Text' },
  { value: 'two_column', label: 'Two-Column Editorial' },
  { value: 'three_column', label: 'Three-Column Editorial' },
  { value: 'image_led', label: 'Image-Led Page' },
  { value: 'full_bleed_image', label: 'Full-Bleed Image' },
  { value: 'image_gallery', label: 'Image Gallery' },
  { value: 'quote_page', label: 'Quote Page' },
  { value: 'interview', label: 'Interview Layout' },
  { value: 'case_study', label: 'Case Study' },
  { value: 'timeline', label: 'Timeline Page' },
  { value: 'infographic', label: 'Infographic Page' },
  { value: 'section_divider', label: 'Section Divider' },
  { value: 'acknowledgements', label: 'Acknowledgements' },
  { value: 'closing_page', label: 'Closing Page' },
  { value: 'back_cover', label: 'Back Cover' },
  { value: 'blank', label: 'Blank Page' },
];

/** under a library photo: how sharp it prints where it is placed (the softest place first), or where it would be sharp */
const AssetPrintLine: React.FC<{ asset: ImageAsset; use: Array<{ pageNumber: number; ppi: number | null }> }> = ({ asset, use }) => {
  if (!use.length) {
    const cm = sharpPrintSizeCm(asset.widthPx || 0, asset.heightPx || 0);
    return (
      <div className="text-[11px] text-[#8F8C84] leading-snug" title="300 pixels per inch is sharp in print">
        Not placed{asset.widthPx && asset.heightPx ? ` · sharp up to ${cm.widthCm}×${cm.heightCm} cm` : ''}
      </div>
    );
  }
  const measured = use.filter((u) => u.ppi !== null) as Array<{ pageNumber: number; ppi: number }>;
  const pages = [...new Set(use.map((u) => u.pageNumber))].sort((a, b) => a - b);
  const where = `${pages.length === 1 ? 'page' : 'pages'} ${pages.slice(0, 4).join(', ')}${pages.length > 4 ? '…' : ''}`;
  if (!measured.length) return <div className="text-[11px] text-[#8F8C84]">On {where}</div>;
  const worst = measured.reduce((a, u) => (u.ppi < a.ppi ? u : a), measured[0]);
  const q = printQuality(worst.ppi);
  const tone =
    q.level === 'too_low'
      ? 'bg-[#3A1F1A] border-[#E07A5F]/60 text-[#F7D6CB]'
      : q.level === 'low'
        ? 'bg-[#33281A] border-[#D4A657]/60 text-[#F2DDB3]'
        : '';
  const detail = `${Math.round(worst.ppi)} ppi${measured.length > 1 ? ' at the least' : ''} · ${where}`;
  return (
    <div className="space-y-0.5" title={`${Math.round(worst.ppi)} pixels per inch where it prints${measured.length > 1 ? ' (its softest place)' : ''}. 300 ppi is sharp.`}>
      {tone ? (
        <span className={`inline-block px-1.5 py-px rounded border text-[11px] font-medium leading-tight ${tone}`}>{q.label}</span>
      ) : (
        <span className={`text-[11px] ${q.level === 'good' ? 'text-[#A9C79A]' : 'text-[#C8C5BC]'}`}>{q.label}</span>
      )}
      <div className="font-mono-tabular text-[11px] text-[#8F8C84] leading-snug">{detail}</div>
    </div>
  );
};

export const LeftSidebar: React.FC<LeftSidebarProps> = ({
  project,
  activePage,
  selectedElementIds,
  customComponents,
  canDesign,
  collapsed,
  onToggleCollapse,
  onAddComponent,
  onSelectElements,
  onUpdateElement,
  onDeleteElements,
  onDuplicateElements,
  onReorderLayer,
  onGroupSelected,
  onUngroupSelected,
  onSaveSelectedAsComponent,
  onUploadImages,
  onPlaceOrReplaceImage,
  onUpdateAssetMeta,
  onApplyMaster,
  onCreateMasterFromPage,
  onEditMasterBackground,
  onDetachMaster,
  onSelectPage,
  onAddChapter,
  onUpdatePageMeta,
  onOpenInfographicsModal,
}) => {
  const [chosenTab, setTab] = useState<'components' | 'layers' | 'assets' | 'masters' | 'structure'>(
    canDesign ? 'components' : 'assets'
  );
  // adding frames (Elements) and master pages (Masters) are the design's: a Content editor has neither tab
  const tab = !canDesign && (chosenTab === 'components' || chosenTab === 'masters') ? 'assets' : chosenTab;
  const designTab = (id: string) => id === 'components' || id === 'masters';
  const [assetSearch, setAssetSearch] = useState('');
  const [assetCategory, setAssetCategory] = useState('All');
  const [uploading, setUploading] = useState(false);
  const [newMasterName, setNewMasterName] = useState('');
  const [newChapterTitle, setNewChapterTitle] = useState('');
  const [editingLayerId, setEditingLayerId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const assetCategories = useMemo(() => {
    const cats = new Set<string>(['All']);
    project.imageAssets.forEach((a) => cats.add(a.category || 'Uploads'));
    return Array.from(cats);
  }, [project.imageAssets]);

  const filteredAssets = useMemo(() => {
    const q = assetSearch.trim().toLowerCase();
    return project.imageAssets.filter((a) => {
      const catOk = assetCategory === 'All' || a.category === assetCategory;
      const qOk =
        !q ||
        a.name.toLowerCase().includes(q) ||
        a.tags.some((t) => t.toLowerCase().includes(q));
      return catOk && qOk;
    });
  }, [project.imageAssets, assetSearch, assetCategory]);

  const sortedLayers = useMemo(
    () => [...activePage.elements].sort((a, b) => b.zIndex - a.zIndex),
    [activePage.elements]
  );

  /* where each library photo is placed, and how sharp it prints there (pixels over the frame's print size) */
  const assetOfImage = useMemo(() => {
    const byId = new Map<string, ImageAsset>();
    const byUrl = new Map<string, ImageAsset>();
    project.imageAssets.forEach((a) => {
      byId.set(a.id, a);
      byUrl.set(a.url, a);
      if (a.printUrl) byUrl.set(a.printUrl, a);
    });
    return (el: BookElement): ImageAsset | undefined =>
      (el.image?.assetId && byId.get(el.image.assetId)) || (el.image?.src ? byUrl.get(el.image.src) : undefined);
  }, [project.imageAssets]);
  const photoUse = useMemo(() => {
    const use = new Map<string, Array<{ pageNumber: number; ppi: number | null }>>();
    project.pages.forEach((page, i) =>
      page.elements.forEach((el) => {
        if (el.type !== 'image' || !el.image?.src) return;
        const asset = assetOfImage(el);
        if (!asset) return;
        const r = photoPrintResolution(el, asset);
        const list = use.get(asset.id) || [];
        list.push({ pageNumber: i + 1, ppi: r ? r.ppi : null });
        use.set(asset.id, list);
      })
    );
    return use;
  }, [project.pages, assetOfImage]);
  const selectedPhoto =
    selectedElementIds.length === 1
      ? activePage.elements.find((e) => e.id === selectedElementIds[0] && e.type === 'image') || null
      : null;
  const selectedPhotoRes = selectedPhoto ? photoPrintResolution(selectedPhoto, assetOfImage(selectedPhoto)) : null;
  const selectedPhotoLow = !!selectedPhotoRes && ['too_low', 'low'].includes(printQuality(selectedPhotoRes.ppi).level);

  if (collapsed) {
    return (
      <aside className="w-11 shrink-0 bg-[#18181B] border-r border-white/[0.08] flex flex-col items-center py-2 gap-2">
        <button
          onClick={onToggleCollapse}
          title="Expand Studio Panel"
          className="h-7 w-7 flex items-center justify-center text-[#98958D] hover:text-[#ECEAE4] hover:bg-white/[0.05] rounded cursor-pointer"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
        {(
          [
            ['components', Plus, 'Components'],
            ['layers', Layers, 'Layers'],
            ['assets', ImageIcon, 'Image Library'],
            ['masters', LayoutTemplate, 'Master Pages'],
            ['structure', BookMarked, 'Book Structure'],
          ] as const
        ).filter(([id]) => canDesign || !designTab(id)).map(([id, Icon, label]) => (
          <button
            key={id}
            onClick={() => {
              setTab(id);
              onToggleCollapse();
            }}
            title={label}
            className={`h-8 w-8 flex items-center justify-center rounded transition-colors cursor-pointer ${
              tab === id ? 'bg-[#26262B] text-[#C6A26B]' : 'text-[#98958D] hover:text-[#ECEAE4]'
            }`}
          >
            <Icon className="w-4 h-4" />
          </button>
        ))}
      </aside>
    );
  }

  const handleUploadChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    setUploading(true);
    try {
      await onUploadImages(e.target.files);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  return (
    <aside className="w-[268px] shrink-0 bg-[#18181B] border-r border-white/[0.08] flex flex-col min-h-0 select-none">
      {/* Rail Header Tabs */}
      <div className="flex items-center justify-between border-b border-white/[0.08] px-1.5 pt-1.5">
        <div className="flex items-center gap-0.5">
          {(
            [
              ['components', Plus, 'Elements'],
              ['layers', Layers, 'Layers'],
              ['assets', ImageIcon, 'Images'],
              ['masters', LayoutTemplate, 'Masters'],
              ['structure', BookMarked, 'Book'],
            ] as const
          ).filter(([id]) => canDesign || !designTab(id)).map(([id, Icon, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              title={label}
              className={`px-2 py-2 flex items-center gap-1 text-[11px] border-b-2 transition-colors cursor-pointer ${
                tab === id
                  ? 'border-[#C6A26B] text-[#ECEAE4] font-medium'
                  : 'border-transparent text-[#8F8C84] hover:text-[#D7D4CC]'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {tab === id && <span>{label}</span>}
            </button>
          ))}
        </div>
        <button
          onClick={onToggleCollapse}
          title="Collapse Panel"
          className="h-6 w-6 flex items-center justify-center text-[#8F8C84] hover:text-[#ECEAE4] rounded cursor-pointer mb-1"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {/* a selected photo that would print soft is said on every tab (the Images tab says more) */}
        {tab !== 'assets' && selectedPhoto && selectedPhotoLow && (
          <div className="p-2 bg-[#2A1E1A] border border-[#E07A5F]/40 rounded space-y-1">
            <div className="text-[11px] font-medium text-[#F7D6CB] truncate">Selected photo: {selectedPhoto.name}</div>
            <PhotoResolutionBadge element={selectedPhoto} pixels={assetOfImage(selectedPhoto)} />
          </div>
        )}
        {/* 1. COMPONENTS LIBRARY (Designers) */}
        {tab === 'components' && canDesign && (
          <>
            <p className="text-[11px] text-[#8F8C84] leading-relaxed">
              Drag any component onto a page spread, or click to place it aligned to the active grid.
            </p>
            {COMPONENT_GROUPS.map((group) => (
              <div key={group.title} className="space-y-1.5">
                <div className="text-[11px] font-medium text-[#98958D] tracking-wide">
                  {group.title}
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {group.items.map((item) => (
                    <button
                      key={item.kind}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData('application/x-bookstudio-component', item.kind);
                        e.dataTransfer.effectAllowed = 'copy';
                      }}
                      onClick={() => {
                        if (item.kind === 'infographic') {
                          onOpenInfographicsModal();
                        } else {
                          onAddComponent(item.kind);
                        }
                      }}
                      className="flex items-center gap-2 px-2.5 py-2 bg-[#1F1F24] hover:bg-[#28282E] border border-white/[0.06] hover:border-[#C6A26B]/40 rounded text-left text-[11px] text-[#E2DFD7] transition-colors cursor-grab active:cursor-grabbing"
                    >
                      <span className="text-[#C6A26B] shrink-0">{item.icon}</span>
                      <span className="truncate">{item.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}

            {/* Custom Reusable Components */}
            <div className="pt-2 border-t border-white/[0.08] space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-[#98958D]">Custom Components</span>
                <button
                  onClick={onSaveSelectedAsComponent}
                  disabled={selectedElementIds.length === 0}
                  title="Save currently selected canvas element as reusable component"
                  className="text-[11px] text-[#C6A26B] hover:text-[#DFC08E] disabled:opacity-35 cursor-pointer"
                >
                  + Save Selected
                </button>
              </div>
              {customComponents.length === 0 ? (
                <p className="text-[11px] text-[#73706A]">
                  Select any element on the canvas and click Save Selected to reuse across projects.
                </p>
              ) : (
                <div className="space-y-1">
                  {customComponents.map((comp) => (
                    <button
                      key={comp.id}
                      onClick={() =>
                        onAddComponent('text_box', comp.payload.element as BookElement)
                      }
                      className="w-full px-2.5 py-1.5 text-left text-[11px] bg-[#1F1F24] hover:bg-[#28282E] border border-white/[0.06] rounded text-[#E2DFD7] flex items-center justify-between cursor-pointer"
                    >
                      <span className="truncate">{comp.title}</span>
                      <Plus className="w-3 h-3 text-[#C6A26B] shrink-0" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {/* 2. LAYERS PANEL */}
        {tab === 'layers' && (
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-[#98958D]">
                {activePage.label} · {sortedLayers.length} layers
              </span>
              {!canDesign && (
                <span
                  title="The layers are the design: a Designer changes them. Click a layer to select its frame."
                  className="flex items-center gap-1 text-[11px] text-[#7F7C75]"
                >
                  <Lock className="w-3 h-3" />
                  <span>Read-only</span>
                </span>
              )}
              {canDesign && (
              <div className="flex items-center gap-1">
                <button
                  onClick={onGroupSelected}
                  disabled={selectedElementIds.length < 2}
                  title="Group selected layers"
                  className="p-1 text-[#98958D] hover:text-[#ECEAE4] disabled:opacity-30 rounded cursor-pointer"
                >
                  <Group className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={onUngroupSelected}
                  disabled={selectedElementIds.length === 0}
                  title="Ungroup selected"
                  className="p-1 text-[#98958D] hover:text-[#ECEAE4] disabled:opacity-30 rounded cursor-pointer"
                >
                  <Ungroup className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => onDuplicateElements(activePage.id, selectedElementIds)}
                  disabled={selectedElementIds.length === 0}
                  title="Duplicate selected"
                  className="p-1 text-[#98958D] hover:text-[#ECEAE4] disabled:opacity-30 rounded cursor-pointer"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => onDeleteElements(activePage.id, selectedElementIds)}
                  disabled={selectedElementIds.length === 0}
                  title="Delete selected"
                  className="p-1 text-[#98958D] hover:text-[#E07A5F] disabled:opacity-30 rounded cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              )}
            </div>

            <div className="space-y-1">
              {sortedLayers.map((el) => {
                const isSelected = selectedElementIds.includes(el.id);
                return (
                  <div
                    key={el.id}
                    onClick={(e) => {
                      if (e.shiftKey) {
                        onSelectElements(
                          isSelected
                            ? selectedElementIds.filter((i) => i !== el.id)
                            : [...selectedElementIds, el.id]
                        );
                      } else {
                        onSelectElements([el.id]);
                      }
                    }}
                    className={`group px-2 py-1.5 rounded border flex items-center gap-1.5 text-[11px] cursor-pointer transition-colors ${
                      isSelected
                        ? 'bg-[#2A2824] border-[#C6A26B]/60 text-[#F4F1EA]'
                        : 'bg-[#1D1D21] border-transparent hover:border-white/[0.08] text-[#C8C5BC]'
                    }`}
                  >
                    <span className="text-[11px] font-mono-tabular text-[#8F8C84] w-4 shrink-0 uppercase">
                      {el.type.slice(0, 2)}
                    </span>

                    {editingLayerId === el.id && canDesign ? (
                      <input
                        autoFocus
                        value={el.name}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) =>
                          onUpdateElement(activePage.id, el.id, { name: e.target.value })
                        }
                        onBlur={() => setEditingLayerId(null)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') setEditingLayerId(null);
                        }}
                        className="flex-1 bg-[#121214] px-1 py-0.5 text-[11px] text-white rounded focus:outline-none"
                      />
                    ) : (
                      <span
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          if (canDesign) setEditingLayerId(el.id);
                        }}
                        title={canDesign ? 'Double-click to rename layer' : el.name}
                        className="flex-1 truncate"
                      >
                        {el.name}
                        {el.groupId && (
                          <span className="text-[11px] text-[#C6A26B] ml-1">· grp</span>
                        )}
                      </span>
                    )}

                    {!canDesign ? (
                      <div className="flex items-center gap-1 shrink-0 text-[#6F6C65]">
                        {el.locked && <Lock className="w-3 h-3" aria-label="Locked" />}
                        {el.hidden && <EyeOff className="w-3 h-3" aria-label="Hidden" />}
                      </div>
                    ) : (
                    <div className="flex items-center gap-0.5 shrink-0">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onReorderLayer(activePage.id, el.id, 'up');
                        }}
                        title="Bring forward"
                        className="p-0.5 text-[#7F7C75] hover:text-white cursor-pointer"
                      >
                        <ChevronUp className="w-3 h-3" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onReorderLayer(activePage.id, el.id, 'down');
                        }}
                        title="Send backward"
                        className="p-0.5 text-[#7F7C75] hover:text-white cursor-pointer"
                      >
                        <ChevronDown className="w-3 h-3" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onUpdateElement(activePage.id, el.id, { locked: !el.locked });
                        }}
                        title={el.locked ? 'Unlock layer' : 'Lock layer'}
                        className={`p-0.5 cursor-pointer ${
                          el.locked ? 'text-[#C6A26B]' : 'text-[#7F7C75] hover:text-white'
                        }`}
                      >
                        {el.locked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onUpdateElement(activePage.id, el.id, { hidden: !el.hidden });
                        }}
                        title={el.hidden ? 'Show layer' : 'Hide layer'}
                        className={`p-0.5 cursor-pointer ${
                          el.hidden ? 'text-[#E07A5F]' : 'text-[#7F7C75] hover:text-white'
                        }`}
                      >
                        {el.hidden ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                      </button>
                    </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 3. IMAGE ASSET LIBRARY */}
        {tab === 'assets' && (
          <div className="space-y-3">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp,image/tiff,.jpg,.jpeg,.png,.tif,.tiff,.webp"
              onChange={handleUploadChange}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="w-full py-2 px-3 bg-[#C6A26B] hover:bg-[#D5B47F] text-[#121214] text-xs font-medium rounded flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>{uploading ? 'Uploading Images...' : 'Bulk Upload Photographs'}</span>
            </button>

            <div className="relative">
              <Search className="w-3.5 h-3.5 text-[#7F7C75] absolute left-2.5 top-2" />
              <input
                type="text"
                value={assetSearch}
                onChange={(e) => setAssetSearch(e.target.value)}
                placeholder="Search images or tags..."
                className="w-full bg-[#121214] border border-white/[0.08] rounded pl-8 pr-2.5 py-1.5 text-[11px] text-[#ECEAE4] placeholder-[#73706A] focus:outline-none focus:border-[#C6A26B]/60"
              />
            </div>

            <div className="flex flex-wrap gap-1">
              {assetCategories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setAssetCategory(cat)}
                  className={`px-2 py-0.5 text-[11px] rounded transition-colors cursor-pointer ${
                    assetCategory === cat
                      ? 'bg-[#2B2B31] text-[#ECEAE4]'
                      : 'text-[#8F8C84] hover:text-[#D7D4CC]'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>

            {selectedPhoto && (
              <div className="p-2.5 bg-[#1F1F24] border border-white/[0.08] rounded space-y-1.5" aria-label="Selected photo frame">
                <div className="text-[11px] font-medium text-[#ECEAE4] truncate" title={selectedPhoto.name}>
                  Selected photo frame: {selectedPhoto.name}
                </div>
                {!selectedPhoto.image?.src ? (
                  <p className="text-[11px] text-[#A19E95]">This frame has no photo yet: click a photo below to put it in.</p>
                ) : selectedPhotoRes ? (
                  <PhotoResolutionBadge element={selectedPhoto} pixels={assetOfImage(selectedPhoto)} />
                ) : (
                  <p className="text-[11px] text-[#A19E95]">This photo's pixel size is not known, so how sharp it prints cannot be worked out.</p>
                )}
              </div>
            )}

            <p className="text-[11px] text-[#8F8C84]">
              {canDesign
                ? 'Drag a photograph onto any existing image frame to replace it non-destructively, or click to insert/replace.'
                : 'Drag a photo onto a photo frame, or select a photo frame on the page and click a photo here, to put it in the frame.'}
            </p>
            <p className="text-[11px] text-[#8F8C84]">
              Under each photo: its pixels, and where it is placed, how sharp it prints there. 300 ppi is sharp; under 150 looks soft in print.
            </p>

            <div className="grid grid-cols-2 gap-2">
              {filteredAssets.map((asset) => (
                <div
                  key={asset.id}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('application/x-bookstudio-image', JSON.stringify(asset));
                    e.dataTransfer.effectAllowed = 'copy';
                  }}
                  onClick={() => onPlaceOrReplaceImage(asset)}
                  className="group bg-[#1F1F24] border border-white/[0.07] hover:border-[#C6A26B]/60 rounded overflow-hidden cursor-grab active:cursor-grabbing"
                >
                  <div className="aspect-[4/3] bg-[#121214] overflow-hidden relative">
                    <img
                      src={asset.url}
                      alt={asset.name}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                    />
                  </div>
                  <div className="p-1.5 space-y-0.5">
                    <div className="text-[11px] text-[#E2DFD7] truncate" title={asset.name}>
                      {asset.name}
                    </div>
                    <div className="font-mono-tabular text-[11px] text-[#8F8C84]">
                      {asset.widthPx}×{asset.heightPx} px · {asset.category}
                    </div>
                    <AssetPrintLine asset={asset} use={photoUse.get(asset.id) || []} />
                    <input
                      type="text"
                      value={asset.tags.join(', ')}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) =>
                        onUpdateAssetMeta(asset.id, {
                          tags: e.target.value
                            .split(',')
                            .map((t) => t.trim())
                            .filter(Boolean),
                        })
                      }
                      placeholder="Add tags..."
                      className="w-full bg-transparent text-[11px] text-[#98958D] focus:bg-[#121214] focus:text-white px-1 py-0.5 rounded focus:outline-none"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 4. MASTER PAGES (Designers) */}
        {tab === 'masters' && canDesign && (
          <div className="space-y-3">
            <div className="p-2.5 bg-[#1F1F24] border border-white/[0.07] rounded space-y-2">
              <div className="text-[11px] font-medium text-[#ECEAE4]">Active Page Master</div>
              <div className="text-[11px] text-[#98958D]">
                {activePage.detachedFromMaster
                  ? 'Detached (independent overrides)'
                  : project.masterPages.find((m) => m.id === activePage.masterPageId)?.name ||
                    'No Master Assigned'}
              </div>
              {activePage.masterPageId && !activePage.detachedFromMaster && (
                <button
                  onClick={() => onDetachMaster(activePage.id)}
                  className="w-full py-1.5 px-2 text-[11px] bg-[#26262C] hover:bg-[#313139] text-[#D7D4CC] rounded flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Link2Off className="w-3 h-3" />
                  <span>Detach Page From Master</span>
                </button>
              )}
            </div>

            <div className="space-y-1.5">
              <div className="text-[11px] font-medium text-[#98958D]">Create Custom Master</div>
              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={newMasterName}
                  onChange={(e) => setNewMasterName(e.target.value)}
                  placeholder="e.g. F — Interview Spread"
                  className="flex-1 bg-[#121214] border border-white/[0.08] rounded px-2 py-1 text-[11px] text-[#ECEAE4] focus:outline-none focus:border-[#C6A26B]/60"
                />
                <button
                  onClick={() => {
                    if (!newMasterName.trim()) return;
                    onCreateMasterFromPage(
                      newMasterName.trim(),
                      `Custom master captured from ${activePage.label}`
                    );
                    setNewMasterName('');
                  }}
                  className="px-2.5 py-1 bg-[#C6A26B] text-[#121214] text-[11px] font-medium rounded cursor-pointer"
                >
                  Save
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-[11px] font-medium text-[#98958D]">
                Reusable Master Layouts ({project.masterPages.length})
              </div>
              {project.masterPages.map((master: MasterPage) => {
                const linkedCount = project.pages.filter(
                  (p) => p.masterPageId === master.id && !p.detachedFromMaster
                ).length;
                return (
                  <div
                    key={master.id}
                    className="p-2.5 bg-[#1F1F24] border border-white/[0.07] rounded space-y-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-xs font-medium text-[#ECEAE4]">{master.name}</div>
                        <div className="text-[11px] text-[#8F8C84] mt-0.5">
                          {linkedCount} linked page{linkedCount === 1 ? '' : 's'} ·{' '}
                          {master.elements.length} master elements
                        </div>
                      </div>
                      <input
                        type="color"
                        value={master.backgroundColor}
                        onChange={(e) => onEditMasterBackground(master.id, e.target.value)}
                        title="Update master background (propagates to linked pages)"
                        className="w-5 h-5 rounded border border-white/15 bg-transparent cursor-pointer shrink-0"
                      />
                    </div>
                    <p className="text-[11px] text-[#98958D] leading-relaxed">
                      {master.description}
                    </p>
                    <button
                      onClick={() => onApplyMaster(activePage.id, master.id)}
                      className="w-full py-1 text-[11px] bg-[#28282F] hover:bg-[#32323B] text-[#E2DFD7] rounded transition-colors cursor-pointer"
                    >
                      Apply to Current Page
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 5. BOOK STRUCTURE & CHAPTERS */}
        {tab === 'structure' && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <div className="text-[11px] font-medium text-[#98958D]">Chapters & Sections</div>
              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={newChapterTitle}
                  onChange={(e) => setNewChapterTitle(e.target.value)}
                  placeholder="New chapter title..."
                  className="flex-1 bg-[#121214] border border-white/[0.08] rounded px-2 py-1 text-[11px] text-[#ECEAE4] focus:outline-none"
                />
                <button
                  onClick={() => {
                    if (!newChapterTitle.trim()) return;
                    onAddChapter(newChapterTitle.trim());
                    setNewChapterTitle('');
                  }}
                  title="Add Chapter"
                  className="px-2 py-1 bg-[#C6A26B] text-[#121214] rounded cursor-pointer"
                >
                  <FolderPlus className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="space-y-1">
                {project.chapters.map((ch) => (
                  <div
                    key={ch.id}
                    className="px-2 py-1.5 bg-[#1F1F24] border border-white/[0.06] rounded text-[11px] text-[#E2DFD7] flex items-center justify-between"
                  >
                    <span className="truncate">{ch.title}</span>
                    <span className="font-mono-tabular text-[11px] text-[#8F8C84]">
                      {project.pages.filter((p) => p.chapterId === ch.id).length}p
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-1.5 pt-2 border-t border-white/[0.08]">
              <div className="text-[11px] font-medium text-[#98958D]">
                Page Sequence ({project.pages.length} pages)
              </div>
              <div className="space-y-1.5">
                {project.pages.map((p, idx) => (
                  <div
                    key={p.id}
                    onClick={() => onSelectPage(p.id)}
                    className={`p-2 rounded border text-[11px] space-y-1.5 cursor-pointer ${
                      p.id === activePage.id
                        ? 'bg-[#2A2824] border-[#C6A26B]/60'
                        : 'bg-[#1D1D21] border-white/[0.05] hover:border-white/[0.12]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono-tabular text-[11px] text-[#C6A26B]">
                        P.{String(idx + 1).padStart(2, '0')} · {idx === 0 ? 'Cover' : idx % 2 === 1 ? 'Verso (L)' : 'Recto (R)'}
                      </span>
                      {p.dimensionsOverride && (
                        <span className="text-[11px] text-[#C6A26B]">Custom Size</span>
                      )}
                    </div>
                    <select
                      value={p.role}
                      disabled={!canDesign}
                      title={canDesign ? 'Page type' : 'The page type is part of the design: a Designer changes it'}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) =>
                        onUpdatePageMeta(p.id, { role: e.target.value as PageRole })
                      }
                      className="w-full bg-[#121214] border border-white/[0.08] rounded px-1.5 py-1 text-[11px] text-[#D7D4CC] disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {PAGE_ROLES.map((r) => (
                        <option key={r.value} value={r.value}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                    <select
                      value={p.chapterId || ''}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) =>
                        onUpdatePageMeta(p.id, { chapterId: e.target.value || undefined })
                      }
                      className="w-full bg-[#121214] border border-white/[0.08] rounded px-1.5 py-1 text-[11px] text-[#98958D]"
                    >
                      <option value="">Front / Back Matter (Unassigned)</option>
                      {project.chapters.map((ch) => (
                        <option key={ch.id} value={ch.id}>
                          {ch.title}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
};
