import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  AlignCenter,
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalSpaceAround,
  AlignJustify,
  AlignLeft,
  AlignRight,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalSpaceAround,
  ArrowDownToLine,
  ArrowUpToLine,
  BookmarkPlus,
  Check,
  Crop,
  Image as ImageIcon,
  Link2,
  Loader2,
  Lock,
  Maximize,
  Minimize2,
  Palette,
  PenLine,
  Plus,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Type as TypeIcon,
  X,
} from 'lucide-react';
import type {
  AlignAction,
  BookElement,
  BookPage,
  BookProject,
  InfographicItem,
  InfographicVisualVariant,
} from '../types/bookstudio';
import { BUILTIN_INFOGRAPHIC_TEMPLATES } from '../data/infographicTemplates';
import {
  formatNumericValue,
  getEffectivePageDimensions,
  MM_PER_INCH,
  unitToMm,
} from '../engines/dimensionEngine';
import { GOOGLE_FONTS_CATALOG, loadGoogleFont } from '../engines/fontEngine';
import {
  countWords,
  fitTextToFrame,
  frameCapacityWords,
  growFrameToFit,
  measureTextOverflow,
  minimumSizePt,
  shrinkTextToFit,
  splitOverflowTextForContinuation,
  tightenSpacingToFit,
} from '../engines/textEngine';
import { useFontsVersion } from '../engines/textMeasure';
import { editTextWithAi, type EditTextInstruction } from '../services/aiService';
import { PhotoResolutionBadge } from './PhotoResolutionBadge';
import { errorText } from '../services/api';

interface RightPropertiesPanelProps {
  project: BookProject;
  activePage: BookPage;
  selectedElement: BookElement | null;
  selectedCount: number;
  /** false for a Content editor: geometry, typography, styles, swatches, align, shapes, photo effects and infographic
      colours are shown read-only or not at all; words, the photo in a frame and its crop, and infographic data stay */
  canDesign: boolean;
  onUpdateElement: (pageId: string, elementId: string, patch: Partial<BookElement>) => void;
  onUpdatePage: (pageId: string, patch: Partial<BookPage>) => void;
  onAlignElements: (action: AlignAction) => void;
  onJumpToElement: (pageId: string, elementId: string) => void;
  onContinueOverflowToNextPage: (pageId: string, elementId: string) => void;
  onOpenTypographyModal: () => void;
  onOpenDimensionsModal: () => void;
  onOpenInfographicsModal: () => void;
  onSaveInfographicAsTemplate: (el: BookElement) => void;
  /** no longer used: the overflow box's "Shorten with ETB2B AI" is the panel's own "Edit with AI" (Phase 3) */
  onRequestAiTextFit?: (el: BookElement) => void;
}

type InspectorTab = 'properties' | 'styles' | 'swatches' | 'align' | 'links';

/* the chart types an infographic frame can be shown as (content: the data stays, only how it is drawn changes) */
const CHART_TYPES: Array<{ variant: InfographicVisualVariant; templateId: string; name: string }> = (() => {
  const seen = new Set<string>();
  const out: Array<{ variant: InfographicVisualVariant; templateId: string; name: string }> = [];
  for (const t of BUILTIN_INFOGRAPHIC_TEMPLATES) {
    if (seen.has(t.variant)) continue;
    seen.add(t.variant);
    out.push({ variant: t.variant, templateId: t.id, name: String(t.variant).replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) });
  }
  return out;
})();

const LOCKED_TIP = 'This is part of the design: a Designer changes it';

/* "Edit with AI" on a text frame: ETB2B AI's version of the words, shown as a suggestion until Apply or Discard */
interface AiEditState {
  status: 'idle' | 'working' | 'ready' | 'error';
  elementId: string;
  task: EditTextInstruction | null;
  /** the frame's words when ETB2B AI was asked */
  baseText: string;
  suggestion: string;
  error: string;
}
const IDLE_AI: AiEditState = { status: 'idle', elementId: '', task: null, baseText: '', suggestion: '', error: '' };
const AI_TASK_NAMES: Record<EditTextInstruction, string> = {
  shorten: 'Shorten to fit',
  grammar: 'Fix grammar and spelling',
  clarify: 'Make it clearer',
  custom: 'Your change',
};
function wordsLabel(n: number): string {
  return `${n} ${n === 1 ? 'word' : 'words'}`;
}
function dontFit(n: number): string {
  return `${wordsLabel(n)} ${n === 1 ? "doesn't" : "don't"} fit`;
}

/* where "Continue on the next page" pours the rest: an empty text frame of the same kind on the next page (its words
   are content, so both roles can fill it) */
function continuationFrame(next: BookPage, source: BookElement): BookElement | null {
  const role = source.textRole || 'body';
  const empty = next.elements.filter(
    (e) => e.type === 'text' && !e.hidden && !e.locked && !!e.textStyle && countWords(e.text) === 0 && (e.textRole || 'body') === role
  );
  if (!empty.length) return null;
  return empty.reduce((a, b) => (b.widthMm * b.heightMm > a.widthMm * a.heightMm ? b : a));
}

const EDITORIAL_SWATCH_LIBRARY = [
  { name: 'Museum Paper', hex: '#F7F4EE' },
  { name: 'Warm Alabaster', hex: '#FAF8F5' },
  { name: 'Archival Cream', hex: '#EDE7DB' },
  { name: 'Cool Slate Paper', hex: '#F1F3F5' },
  { name: 'Obsidian Ink', hex: '#141416' },
  { name: 'Charcoal Ink', hex: '#26262A' },
  { name: 'Warm Bronze', hex: '#B58952' },
  { name: 'Deep Terracotta', hex: '#A24B38' },
  { name: 'Oxford Navy', hex: '#1D334A' },
  { name: 'Botanical Forest', hex: '#2A4A3E' },
  { name: 'Imperial Burgundy', hex: '#632632' },
  { name: 'Muted Stone', hex: '#767168' },
];

export const RightPropertiesPanel: React.FC<RightPropertiesPanelProps> = ({
  project,
  activePage,
  selectedElement,
  selectedCount,
  canDesign,
  onUpdateElement,
  onUpdatePage,
  onAlignElements,
  onJumpToElement,
  onContinueOverflowToNextPage,
  onOpenTypographyModal,
  onOpenDimensionsModal,
  onOpenInfographicsModal,
  onSaveInfographicAsTemplate,
}) => {
  const [chosenPanelTab, setPanelTab] = useState<InspectorTab>('properties');
  // styles, swatches and align only change the design: a Content editor has Properties and Links
  const panelTab: InspectorTab = !canDesign && chosenPanelTab !== 'links' ? 'properties' : chosenPanelTab;
  const [swatchTarget, setSwatchTarget] = useState<'auto' | 'text' | 'fill' | 'stroke' | 'paper'>('auto');
  const unit = project.unit;
  const pageDim = getEffectivePageDimensions(activePage, project.dimensions);
  // fit is measured with the frame's real font: once a font has loaded, the overflow box is measured again
  useFontsVersion();
  const copyRef = useRef<HTMLTextAreaElement | null>(null);
  // manual editing is the default; ETB2B AI sits beside it
  const [editMode, setEditMode] = useState<'manual' | 'ai'>('manual');
  const [ai, setAi] = useState<AiEditState>(IDLE_AI);
  const [aiRequest, setAiRequest] = useState('');
  const aiSeq = useRef(0);
  /* what the last fix did, said in a sentence under the overflow box */
  const [fixNote, setFixNote] = useState<{ elementId: string; kind: 'ok' | 'warn'; text: string } | null>(null);
  const selectedId = selectedElement?.id || '';
  useEffect(() => {
    // another frame: an answer still on its way is for the old one
    aiSeq.current += 1;
    setAi(IDLE_AI);
    setFixNote(null);
  }, [selectedId]);

  const placedImageLinks = useMemo(() => {
    const links: Array<{
      pageId: string;
      pageNumber: number;
      pageLabel: string;
      element: BookElement;
      effectiveDpi: number | null;
    }> = [];
    project.pages.forEach((pg, idx) => {
      pg.elements.forEach((el) => {
        if (el.type === 'image') {
          let dpi: number | null = null;
          if (el.image?.naturalWidth && el.image?.naturalHeight) {
            const wIn = Math.max(0.1, el.widthMm / MM_PER_INCH);
            const hIn = Math.max(0.1, el.heightMm / MM_PER_INCH);
            dpi = Math.round(
              Math.min(el.image.naturalWidth / wIn, el.image.naturalHeight / hIn) /
                (el.image.zoom || 1)
            );
          }
          links.push({
            pageId: pg.id,
            pageNumber: idx + 1,
            pageLabel: pg.label,
            element: el,
            effectiveDpi: dpi,
          });
        }
      });
    });
    return links;
  }, [project.pages]);

  const paragraphStylePresets = useMemo(() => {
    const t = project.designSystem.typography;
    const c = project.designSystem.colors;
    return [
      {
        id: 'display',
        name: 'Display Cover Title',
        meta: `${t.displayFont} · ${t.scale.displayPt}pt`,
        patch: {
          fontFamily: t.displayFont,
          fontSizePt: t.scale.displayPt,
          fontWeight: 500,
          fontStyle: 'normal' as const,
          lineHeight: 1.08,
          letterSpacingEm: -0.01,
          color: c.ink,
          columns: 1,
          textTransform: 'none' as const,
        },
      },
      {
        id: 'heading',
        name: 'Chapter / Section Heading',
        meta: `${t.headingFont} · ${t.scale.headingPt}pt`,
        patch: {
          fontFamily: t.headingFont,
          fontSizePt: t.scale.headingPt,
          fontWeight: 500,
          fontStyle: 'normal' as const,
          lineHeight: 1.15,
          letterSpacingEm: -0.01,
          color: c.ink,
          columns: 1,
          textTransform: 'none' as const,
        },
      },
      {
        id: 'kicker',
        name: 'Uppercase Kicker / Eyebrow',
        meta: `${t.captionFont} · 8.5pt · +0.14em`,
        patch: {
          fontFamily: t.captionFont,
          fontSizePt: 8.5,
          fontWeight: 600,
          fontStyle: 'normal' as const,
          lineHeight: 1.25,
          letterSpacingEm: 0.14,
          color: c.primaryAccent,
          columns: 1,
          textTransform: 'uppercase' as const,
        },
      },
      {
        id: 'body',
        name: 'Editorial Body Copy',
        meta: `${t.bodyFont} · ${t.scale.bodyPt}pt · 1.55`,
        patch: {
          fontFamily: t.bodyFont,
          fontSizePt: t.scale.bodyPt,
          fontWeight: 400,
          fontStyle: 'normal' as const,
          lineHeight: 1.55,
          letterSpacingEm: 0,
          color: c.ink,
          columns: 1,
          textTransform: 'none' as const,
        },
      },
      {
        id: 'body_2col',
        name: '2-Column Magazine / Report Body',
        meta: `${t.bodyFont} · ${t.scale.bodyPt}pt · 2 cols`,
        patch: {
          fontFamily: t.bodyFont,
          fontSizePt: t.scale.bodyPt,
          fontWeight: 400,
          fontStyle: 'normal' as const,
          lineHeight: 1.5,
          letterSpacingEm: 0,
          color: c.ink,
          columns: 2,
          textTransform: 'none' as const,
        },
      },
      {
        id: 'quote',
        name: 'Italic Pull Quote',
        meta: `${t.quoteFont} · ${t.scale.quotePt}pt Italic`,
        patch: {
          fontFamily: t.quoteFont,
          fontSizePt: t.scale.quotePt,
          fontWeight: 400,
          fontStyle: 'italic' as const,
          lineHeight: 1.35,
          letterSpacingEm: 0,
          color: c.ink,
          columns: 1,
          textTransform: 'none' as const,
        },
      },
      {
        id: 'caption',
        name: 'Plate Caption / Footnote',
        meta: `${t.captionFont} · ${t.scale.captionPt}pt`,
        patch: {
          fontFamily: t.captionFont,
          fontSizePt: t.scale.captionPt,
          fontWeight: 400,
          fontStyle: 'normal' as const,
          lineHeight: 1.4,
          letterSpacingEm: 0.02,
          color: c.mutedInk,
          columns: 1,
          textTransform: 'none' as const,
        },
      },
    ];
  }, [project.designSystem]);

  const applySwatchColor = (hex: string) => {
    if (swatchTarget === 'paper' || !selectedElement) {
      onUpdatePage(activePage.id, { backgroundColor: hex });
      return;
    }
    if (
      (swatchTarget === 'text' || swatchTarget === 'auto') &&
      selectedElement.textStyle
    ) {
      onUpdateElement(activePage.id, selectedElement.id, {
        textStyle: { ...selectedElement.textStyle, color: hex },
      });
      return;
    }
    if (selectedElement.shape) {
      if (swatchTarget === 'stroke' || selectedElement.type === 'line') {
        onUpdateElement(activePage.id, selectedElement.id, {
          shape: { ...selectedElement.shape, stroke: hex },
        });
      } else {
        onUpdateElement(activePage.id, selectedElement.id, {
          shape: { ...selectedElement.shape, fill: hex },
        });
      }
      return;
    }
    if (selectedElement.infographic) {
      onUpdateElement(activePage.id, selectedElement.id, {
        infographic: {
          ...selectedElement.infographic,
          accentColor: swatchTarget === 'stroke' ? selectedElement.infographic.accentColor : hex,
          secondaryColor: swatchTarget === 'stroke' ? hex : selectedElement.infographic.secondaryColor,
        },
      });
    }
  };

  const renderTabBar = () => (
    <div className={`grid ${canDesign ? 'grid-cols-5' : 'grid-cols-2'} border-b border-white/[0.08] bg-[#141417] shrink-0`}>
      {(
        [
          ['properties', SlidersHorizontal, 'Props'],
          ['styles', TypeIcon, 'Styles'],
          ['swatches', Palette, 'Swatch'],
          ['align', AlignCenterHorizontal, 'Align'],
          ['links', Link2, 'Links'],
        ] as const
      ).filter(([id]) => canDesign || id === 'properties' || id === 'links').map(([id, Icon, lbl]) => (
        <button
          key={id}
          onClick={() => setPanelTab(id)}
          className={`py-2 flex flex-col items-center gap-0.5 text-[11px] border-b-2 transition-colors cursor-pointer ${
            panelTab === id
              ? 'border-[#C6A26B] text-[#ECEAE4] bg-[#1B1B1F]'
              : 'border-transparent text-[#8F8C84] hover:text-white'
          }`}
        >
          <Icon className="w-3.5 h-3.5" />
          <span>{lbl}</span>
        </button>
      ))}
    </div>
  );

  const renderSecondaryTab = () => {
    if (panelTab === 'styles') {
      const canApply = Boolean(selectedElement?.textStyle);
      return (
        <div className="p-3.5 space-y-3 overflow-y-auto flex-1">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs font-semibold text-[#ECEAE4]">Paragraph Styles</div>
              <div className="text-[11px] text-[#8F8C84]">
                {canApply ? `Click to apply to "${selectedElement!.name}"` : 'Select any text frame to apply'}
              </div>
            </div>
            <button
              onClick={onOpenTypographyModal}
              className="text-[11px] text-[#C6A26B] hover:underline cursor-pointer"
            >
              Fonts
            </button>
          </div>

          <div className="space-y-1.5">
            {paragraphStylePresets.map((st) => (
              <button
                key={st.id}
                disabled={!canApply}
                onClick={() => {
                  if (!selectedElement?.textStyle) return;
                  void loadGoogleFont(st.patch.fontFamily);
                  onUpdateElement(activePage.id, selectedElement.id, {
                    textStyle: {
                      ...selectedElement.textStyle,
                      ...st.patch,
                    },
                  });
                }}
                className="w-full text-left p-2.5 bg-[#121214] hover:bg-[#222228] disabled:opacity-45 border border-white/[0.07] hover:border-[#C6A26B]/50 rounded transition-colors cursor-pointer"
              >
                <div className="text-[11px] font-medium text-[#ECEAE4]">{st.name}</div>
                <div className="font-mono-tabular text-[11px] text-[#8F8C84] mt-0.5">{st.meta}</div>
              </button>
            ))}
          </div>
        </div>
      );
    }

    if (panelTab === 'swatches') {
      return (
        <div className="p-3.5 space-y-3.5 overflow-y-auto flex-1">
          <div>
            <div className="text-xs font-semibold text-[#ECEAE4]">Swatches</div>
            <div className="text-[11px] text-[#8F8C84]">
              Click any swatch to apply to target property
            </div>
          </div>

          <div className="grid grid-cols-5 gap-1 bg-[#121214] p-0.5 rounded border border-white/[0.08] text-[11px]">
            {(
              [
                ['auto', 'Auto'],
                ['text', 'Text'],
                ['fill', 'Fill'],
                ['stroke', 'Stroke'],
                ['paper', 'Paper'],
              ] as const
            ).map(([tKey, lbl]) => (
              <button
                key={tKey}
                onClick={() => setSwatchTarget(tKey)}
                className={`py-1 rounded cursor-pointer ${
                  swatchTarget === tKey ? 'bg-[#C6A26B] text-[#121214] font-medium' : 'text-[#8F8C84] hover:text-white'
                }`}
              >
                {lbl}
              </button>
            ))}
          </div>

          <div className="space-y-1.5">
            <div className="text-[11px] uppercase tracking-wider text-[#8F8C84]">
              Document Swatches ({project.designSystem.name})
            </div>
            {project.designSystem.colors.palette.map((hex, i) => (
              <button
                key={`doc_${hex}_${i}`}
                onClick={() => applySwatchColor(hex)}
                className="w-full flex items-center justify-between gap-2 px-2 py-1.5 bg-[#121214] hover:bg-[#222228] border border-white/[0.06] rounded cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <span
                    style={{ backgroundColor: hex }}
                    className="w-4 h-4 rounded-[2px] border border-white/25 shrink-0"
                  />
                  <span className="text-[11px] text-[#ECEAE4]">Doc Swatch {i + 1}</span>
                </div>
                <span className="font-mono-tabular text-[11px] text-[#8F8C84]">{hex}</span>
              </button>
            ))}
          </div>

          <div className="space-y-1.5 pt-2 border-t border-white/[0.08]">
            <div className="text-[11px] uppercase tracking-wider text-[#8F8C84]">
              Editorial Print Swatch Book
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {EDITORIAL_SWATCH_LIBRARY.map((sw) => (
                <button
                  key={sw.hex}
                  onClick={() => applySwatchColor(sw.hex)}
                  className="flex items-center gap-2 p-1.5 bg-[#121214] hover:bg-[#222228] border border-white/[0.06] rounded text-left cursor-pointer"
                >
                  <span
                    style={{ backgroundColor: sw.hex }}
                    className="w-4 h-4 rounded-[2px] border border-white/25 shrink-0"
                  />
                  <span className="text-[11px] text-[#D7D4CC] truncate">{sw.name}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      );
    }

    if (panelTab === 'align') {
      return (
        <div className="p-3.5 space-y-4 overflow-y-auto flex-1">
          <div>
            <div className="text-xs font-semibold text-[#ECEAE4]">Align & Distribute</div>
            <div className="text-[11px] text-[#8F8C84] mt-0.5">
              {selectedCount === 0
                ? 'Select 1 frame (aligns to margins) or 2+ frames (Shift+Click)'
                : selectedCount === 1
                  ? 'Aligning 1 frame to Page Margins'
                  : `Aligning ${selectedCount} selected frames`}
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-[11px] text-[#8F8C84]">Align Objects</div>
            <div className="grid grid-cols-3 gap-1.5">
              {(
                [
                  ['left', AlignStartHorizontal, 'Left'],
                  ['center_h', AlignCenterHorizontal, 'Center H'],
                  ['right', AlignEndHorizontal, 'Right'],
                  ['top', AlignStartVertical, 'Top'],
                  ['center_v', AlignCenterVertical, 'Center V'],
                  ['bottom', AlignEndVertical, 'Bottom'],
                ] as const
              ).map(([act, Icon, lbl]) => (
                <button
                  key={act}
                  disabled={selectedCount === 0}
                  onClick={() => onAlignElements(act)}
                  className="py-2 px-1.5 bg-[#121214] hover:bg-[#24242C] disabled:opacity-35 border border-white/[0.08] rounded flex flex-col items-center gap-1 text-[11px] text-[#D7D4CC] cursor-pointer"
                >
                  <Icon className="w-3.5 h-3.5 text-[#C6A26B]" />
                  <span>{lbl}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2 pt-2 border-t border-white/[0.08]">
            <div className="text-[11px] text-[#8F8C84]">Distribute Spacing (3+ Frames)</div>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                disabled={selectedCount < 3}
                onClick={() => onAlignElements('distribute_h')}
                className="py-2 px-2 bg-[#121214] hover:bg-[#24242C] disabled:opacity-35 border border-white/[0.08] rounded flex items-center justify-center gap-1.5 text-[11px] text-[#D7D4CC] cursor-pointer"
              >
                <AlignHorizontalSpaceAround className="w-3.5 h-3.5 text-[#C6A26B]" />
                <span>Horizontal</span>
              </button>
              <button
                disabled={selectedCount < 3}
                onClick={() => onAlignElements('distribute_v')}
                className="py-2 px-2 bg-[#121214] hover:bg-[#24242C] disabled:opacity-35 border border-white/[0.08] rounded flex items-center justify-center gap-1.5 text-[11px] text-[#D7D4CC] cursor-pointer"
              >
                <AlignVerticalSpaceAround className="w-3.5 h-3.5 text-[#C6A26B]" />
                <span>Vertical</span>
              </button>
            </div>
          </div>

          <div className="space-y-2 pt-2 border-t border-white/[0.08]">
            <div className="text-[11px] text-[#8F8C84]">Match Dimensions (2+ Frames)</div>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                disabled={selectedCount < 2}
                onClick={() => onAlignElements('match_width')}
                className="py-1.5 px-2 bg-[#121214] hover:bg-[#24242C] disabled:opacity-35 border border-white/[0.08] rounded text-[11px] text-[#D7D4CC] cursor-pointer"
              >
                Same Width
              </button>
              <button
                disabled={selectedCount < 2}
                onClick={() => onAlignElements('match_height')}
                className="py-1.5 px-2 bg-[#121214] hover:bg-[#24242C] disabled:opacity-35 border border-white/[0.08] rounded text-[11px] text-[#D7D4CC] cursor-pointer"
              >
                Same Height
              </button>
            </div>
          </div>
        </div>
      );
    }

    // Links Panel (InDesign Links & Effective Print DPI Preflight)
    return (
      <div className="p-3.5 space-y-3 overflow-y-auto flex-1">
        <div>
          <div className="text-xs font-semibold text-[#ECEAE4]">
            Links ({placedImageLinks.length})
          </div>
          <div className="text-[11px] text-[#8F8C84]">
            All placed photographs & effective print DPI
          </div>
        </div>

        {placedImageLinks.length === 0 ? (
          <div className="p-4 bg-[#121214] border border-white/[0.06] rounded text-[11px] text-[#8F8C84] text-center">
            No placed images in this publication yet. Use the Image Frame tool (F) or Assets panel.
          </div>
        ) : (
          <div className="space-y-1.5">
            {placedImageLinks.map((lnk) => {
              const lowDpi = lnk.effectiveDpi !== null && lnk.effectiveDpi < 180;
              return (
                <button
                  key={`${lnk.pageId}_${lnk.element.id}`}
                  onClick={() => onJumpToElement(lnk.pageId, lnk.element.id)}
                  className="w-full p-2 bg-[#121214] hover:bg-[#222228] border border-white/[0.07] hover:border-[#C6A26B]/50 rounded flex items-center gap-2.5 text-left cursor-pointer"
                >
                  <div className="w-9 h-9 bg-[#1E1E24] rounded-sm overflow-hidden shrink-0 border border-white/10">
                    {lnk.element.image?.src ? (
                      <img
                        src={lnk.element.image.src}
                        alt={lnk.element.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-[11px] text-[#7F7C75]">
                        Empty
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] font-medium text-[#ECEAE4] truncate">
                      {lnk.element.name}
                    </div>
                    <div className="font-mono-tabular text-[11px] text-[#8F8C84]">
                      p.{lnk.pageNumber} · {Math.round(lnk.element.widthMm)}×{Math.round(lnk.element.heightMm)}mm
                    </div>
                  </div>
                  <div
                    className={`font-mono-tabular text-[11px] shrink-0 ${
                      !lnk.element.image?.src
                        ? 'text-[#E07A5F]'
                        : lowDpi
                          ? 'text-[#D4A657]'
                          : 'text-[#8AA678]'
                    }`}
                  >
                    {!lnk.element.image?.src
                      ? 'Empty'
                      : lnk.effectiveDpi
                        ? `${lnk.effectiveDpi}dpi`
                        : 'OK'}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const numInput = (
    label: string,
    mmVal: number,
    onChangeMm: (mm: number) => void,
    step = 0.5
  ) => (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] text-[#8F8C84]">{label} ({unit})</span>
      <input
        type="number"
        step={step}
        value={formatNumericValue(mmVal, unit)}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          if (!Number.isNaN(v)) onChangeMm(Number(unitToMm(v, unit).toFixed(2)));
        }}
        className="w-full bg-[#121214] border border-white/[0.08] rounded px-2 py-1 font-mono-tabular text-[11px] text-[#ECEAE4] focus:outline-none focus:border-[#C6A26B]/60"
      />
    </label>
  );

  if (panelTab !== 'properties') {
    return (
      <aside className="w-[288px] shrink-0 bg-[#18181B] border-l border-white/[0.08] flex flex-col select-none">
        {renderTabBar()}
        {renderSecondaryTab()}
      </aside>
    );
  }

  // Page-Level Inspector when no element is selected
  if (!selectedElement) {
    return (
      <aside className="w-[288px] shrink-0 bg-[#18181B] border-l border-white/[0.08] flex flex-col select-none">
        {renderTabBar()}
        <div className="overflow-y-auto p-3.5 space-y-4 flex-1">
        <div>
          <div className="text-xs font-semibold text-[#ECEAE4]">Page Properties</div>
          <div className="text-[11px] text-[#8F8C84] mt-0.5">
            {selectedCount > 1
              ? `${selectedCount} elements selected`
              : `${activePage.label} · ${activePage.elements.length} elements`}
          </div>
        </div>

        <div className="space-y-2.5 pt-2 border-t border-white/[0.08]">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-[#8F8C84]">Page Label</span>
            <input
              type="text"
              value={activePage.label}
              onChange={(e) => onUpdatePage(activePage.id, { label: e.target.value })}
              className="bg-[#121214] border border-white/[0.08] rounded px-2.5 py-1.5 text-xs text-[#ECEAE4] focus:outline-none focus:border-[#C6A26B]/60"
            />
          </label>

          <div className="flex items-center justify-between">
            <span className="text-[11px] text-[#A19E95]">Paper Background</span>
            <div className="flex items-center gap-2" title={canDesign ? undefined : LOCKED_TIP}>
              {canDesign ? (
                <input
                  type="color"
                  value={activePage.backgroundColor}
                  onChange={(e) => onUpdatePage(activePage.id, { backgroundColor: e.target.value })}
                  className="w-6 h-6 rounded border border-white/15 bg-transparent cursor-pointer"
                />
              ) : (
                <span
                  style={{ backgroundColor: activePage.backgroundColor }}
                  className="w-6 h-6 rounded border border-white/15 inline-block"
                />
              )}
              <span className="font-mono-tabular text-[11px] text-[#98958D]">
                {activePage.backgroundColor}
              </span>
            </div>
          </div>

          {canDesign && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {project.designSystem.colors.palette.map((swatch, idx) => (
              <button
                key={`${swatch}_${idx}`}
                onClick={() => onUpdatePage(activePage.id, { backgroundColor: swatch })}
                title={`Apply ${swatch}`}
                style={{ backgroundColor: swatch }}
                className="w-6 h-6 rounded-sm border border-white/20 cursor-pointer"
              />
            ))}
          </div>
          )}
        </div>

        <div className="space-y-2 pt-3 border-t border-white/[0.08]">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-[#D7D4CC]">Physical Dimensions</span>
            {activePage.dimensionsOverride && (
              <span className="text-[11px] text-[#C6A26B]">Mixed-Format Override</span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2 font-mono-tabular text-[11px] text-[#A19E95] bg-[#121214] p-2.5 rounded border border-white/[0.06]">
            <div>Width: {formatNumericValue(pageDim.widthMm, unit)} {unit}</div>
            <div>Height: {formatNumericValue(pageDim.heightMm, unit)} {unit}</div>
            <div>Bleed: {formatNumericValue(pageDim.bleedMm, unit)} {unit}</div>
            <div>Cols: {pageDim.columns}</div>
          </div>
          {canDesign && (
            <button
              onClick={onOpenDimensionsModal}
              className="w-full py-1.5 px-2.5 bg-[#24242A] hover:bg-[#2E2E36] text-[11px] text-[#ECEAE4] rounded transition-colors cursor-pointer"
            >
              Configure Dimensions & Mixed Format
            </button>
          )}
        </div>

        <div className="pt-3 border-t border-white/[0.08] text-[11px] text-[#8F8C84] leading-relaxed">
          {canDesign
            ? 'Select any text frame, photograph, shape, or infographic on the spread to edit its exact physical coordinates, typography, crop, or live dataset.'
            : 'Select a text frame to change its words, a photo frame to change the photo or how it sits in the frame, or an infographic to change its data and chart type. The design itself is set by a Designer.'}
        </div>
        </div>
      </aside>
    );
  }

  const el = selectedElement;
  const overflow = el.type === 'text' ? measureTextOverflow(el) : null;
  const minBodyPt = project.designSystem.typography.minApprovedBodyPt;
  const say = (kind: 'ok' | 'warn', text: string) => setFixNote({ elementId: el.id, kind, text });
  const aiBusy = ai.status === 'working';

  /* how short "Shorten to fit" asks for: what the frame holds of typical copy, and no more than fits of these words */
  const shortenTarget = (target: BookElement): number => {
    const fitted = countWords(fitTextToFrame(target, target.text || '').fittingText);
    const capacity = frameCapacityWords(target);
    return Math.max(1, Math.min(capacity || fitted, fitted || capacity));
  };

  const runAi = async (target: BookElement, task: EditTextInstruction, request?: string) => {
    const text = target.text || '';
    setEditMode('ai');
    if (!text.trim()) {
      setAi({ ...IDLE_AI, status: 'error', elementId: target.id, task, error: 'There are no words in this frame yet. Type some first.' });
      return;
    }
    const seq = ++aiSeq.current;
    setAi({ status: 'working', elementId: target.id, task, baseText: text, suggestion: '', error: '' });
    try {
      const answer = await editTextWithAi(
        task === 'shorten'
          ? { text, instruction: task, targetWords: shortenTarget(target) }
          : task === 'custom'
            ? { text, instruction: task, request: request || '' }
            : { text, instruction: task }
      );
      if (aiSeq.current !== seq) return;
      setAi({ status: 'ready', elementId: target.id, task, baseText: text, suggestion: answer.text, error: '' });
    } catch (err) {
      if (aiSeq.current !== seq) return;
      setAi({
        status: 'error',
        elementId: target.id,
        task,
        baseText: text,
        suggestion: '',
        error: errorText(err, 'ETB2B AI could not answer just now. Please try again.'),
      });
    }
  };

  const applyAi = () => {
    if (ai.status !== 'ready' || ai.elementId !== el.id) return;
    onUpdateElement(activePage.id, el.id, { text: ai.suggestion });
    aiSeq.current += 1;
    setAi(IDLE_AI);
    say('ok', "ETB2B AI's version is in the frame. Undo brings the earlier words back.");
  };

  const discardAi = () => {
    aiSeq.current += 1;
    setAi(IDLE_AI);
  };

  const editMyself = () => {
    setEditMode('manual');
    window.requestAnimationFrame(() => {
      copyRef.current?.focus();
      copyRef.current?.scrollIntoView({ block: 'nearest' });
    });
  };

  /* the Designer's fixes: each changes the design, says what it did, and never moves anything else */
  const shrinkToFit = () => {
    const r = shrinkTextToFit(el, minBodyPt);
    if (!r.changed) {
      say(
        'warn',
        `Even at ${r.minimumPt} pt, the smallest size allowed for this text, about ${dontFit(r.overflowWords)}. Tighten the spacing, make the frame taller, continue on the next page or shorten the words.`
      );
      return;
    }
    onUpdateElement(activePage.id, el.id, { textStyle: r.element.textStyle });
    say('ok', `The type is now ${r.element.textStyle!.fontSizePt} pt and the words fit.`);
  };

  const tightenSpacing = () => {
    const r = tightenSpacingToFit(el);
    if (!r.changed) {
      say('warn', 'The spacing is already as tight as it sensibly goes. Shrink the type, make the frame taller, continue on the next page or shorten the words.');
      return;
    }
    onUpdateElement(activePage.id, el.id, { textStyle: r.element.textStyle });
    const st = r.element.textStyle!;
    say(
      r.fits ? 'ok' : 'warn',
      r.fits
        ? `Leading ${st.lineHeight}, paragraph gap ${st.paragraphSpacingMm} mm: the words fit.`
        : `The spacing is now as tight as it sensibly goes (leading ${st.lineHeight}); about ${dontFit(r.overflowWords)} yet.`
    );
  };

  const makeTaller = () => {
    const r = growFrameToFit(el, pageDim.heightMm - pageDim.margins.bottom);
    if (!r.changed) {
      say('warn', "The frame already reaches the page's bottom margin. Shrink the type, tighten the spacing, continue on the next page or shorten the words.");
      return;
    }
    onUpdateElement(activePage.id, el.id, { heightMm: r.element.heightMm });
    say(
      r.fits ? 'ok' : 'warn',
      r.fits
        ? `The frame is now ${formatNumericValue(r.element.heightMm, unit)} ${unit} tall and the words fit.`
        : `The frame now reaches the page's bottom margin; about ${dontFit(r.overflowWords)} yet.`
    );
  };

  /* both roles: the words that do not fit go on into an empty text frame of the same kind on the next page; with
     none there, a Designer gets a new frame (or a new page), a Content editor is told what to add */
  const continueOnNextPage = () => {
    const idx = project.pages.findIndex((p) => p.id === activePage.id);
    const next = idx >= 0 ? project.pages[idx + 1] : undefined;
    const split = splitOverflowTextForContinuation(el);
    if (!split.continuationText) {
      say('warn', 'There are not enough words to split. Shorten them or edit them yourself.');
      return;
    }
    const frame = next ? continuationFrame(next, el) : null;
    if (next && frame) {
      // the rest is put on the next page first, then this frame keeps what fits: at every step all the words are in the book
      onUpdateElement(next.id, frame.id, { text: split.continuationText });
      onUpdateElement(activePage.id, el.id, { text: split.fittingText });
      say('ok', `The rest (${wordsLabel(countWords(split.continuationText))}) now continues in "${frame.name}" on page ${idx + 2}.`);
      return;
    }
    if (canDesign) {
      onContinueOverflowToNextPage(activePage.id, el.id);
      say(
        'ok',
        next
          ? `The rest (${wordsLabel(countWords(split.continuationText))}) now continues in a new frame on page ${idx + 2}.`
          : `The rest (${wordsLabel(countWords(split.continuationText))}) now continues on a new page after this one.`
      );
      return;
    }
    say(
      'warn',
      next
        ? `Page ${idx + 2} has no empty text frame like this one to continue in. Add a page after this one from a layout with a text frame, then try again.`
        : 'This is the last page. Add a page after it from a layout with a text frame, then try again.'
    );
  };

  const fixBtn = 'py-1 px-2 text-left text-[11px] bg-[#3B2522] hover:bg-[#4B2E2A] text-[#F5E6E3] rounded cursor-pointer';
  const aiBtn =
    'py-1 px-2 text-left text-[11px] bg-[#C6A26B]/15 hover:bg-[#C6A26B]/25 text-[#F1D8AE] rounded cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed';

  // the photo's own pixels, from the library when the frame does not carry them (for its print resolution)
  const photoAsset =
    el.type === 'image' && el.image
      ? project.imageAssets.find((a) => (el.image!.assetId && a.id === el.image!.assetId) || a.url === el.image!.src)
      : undefined;

  return (
    <aside className="w-[288px] shrink-0 bg-[#18181B] border-l border-white/[0.08] flex flex-col select-none">
      {renderTabBar()}
      <div className="overflow-y-auto p-3.5 space-y-4 flex-1">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs font-semibold text-[#ECEAE4] truncate">{el.name}</div>
          <div className="text-[11px] text-[#8F8C84] capitalize">
            {el.type} frame{el.masterElementId ? ' · Master Linked' : ''}
          </div>
        </div>
      </div>

      {/* Geometry & Coordinates: read-only for a Content editor */}
      {!canDesign && (
        <div className="space-y-1 pt-2 border-t border-white/[0.08]" title={LOCKED_TIP}>
          <div className="text-[11px] font-medium text-[#D7D4CC] flex items-center gap-1.5">
            <Lock className="w-3 h-3 text-[#7F7C75]" />
            <span>Frame position and size</span>
          </div>
          <div className="font-mono-tabular text-[11px] text-[#8F8C84]">
            X {formatNumericValue(el.xMm, unit)} · Y {formatNumericValue(el.yMm, unit)} · {formatNumericValue(el.widthMm, unit)} ×{' '}
            {formatNumericValue(el.heightMm, unit)} {unit}
            {el.rotation ? ` · ${Math.round(el.rotation)}°` : ''}
          </div>
        </div>
      )}
      {canDesign && (
      <div className="space-y-2 pt-2 border-t border-white/[0.08]">
        <div className="text-[11px] font-medium text-[#D7D4CC]">Frame Geometry</div>
        <div className="grid grid-cols-2 gap-2">
          {numInput('X Position', el.xMm, (xMm) => onUpdateElement(activePage.id, el.id, { xMm }))}
          {numInput('Y Position', el.yMm, (yMm) => onUpdateElement(activePage.id, el.id, { yMm }))}
          {numInput('Width', el.widthMm, (widthMm) =>
            onUpdateElement(activePage.id, el.id, { widthMm: Math.max(6, widthMm) })
          )}
          {numInput('Height', el.heightMm, (heightMm) =>
            onUpdateElement(activePage.id, el.id, { heightMm: Math.max(4, heightMm) })
          )}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-[#8F8C84]">Rotation (°)</span>
            <input
              type="number"
              value={Math.round(el.rotation || 0)}
              onChange={(e) =>
                onUpdateElement(activePage.id, el.id, { rotation: Number(e.target.value) || 0 })
              }
              className="w-full bg-[#121214] border border-white/[0.08] rounded px-2 py-1 font-mono-tabular text-[11px] text-[#ECEAE4]"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-[#8F8C84]">Opacity ({Math.round((el.opacity ?? 1) * 100)}%)</span>
            <input
              type="range"
              min={0.05}
              max={1}
              step={0.05}
              value={el.opacity ?? 1}
              onChange={(e) =>
                onUpdateElement(activePage.id, el.id, { opacity: parseFloat(e.target.value) })
              }
              className="w-full accent-[#C6A26B] mt-1.5"
            />
          </label>
        </div>
      </div>
      )}

      {/* TEXT PROPERTIES */}
      {(el.type === 'text' ||
        el.type === 'header' ||
        el.type === 'footer' ||
        el.type === 'pageNumber' ||
        el.type === 'logo') &&
        el.textStyle && (
          <div className="space-y-3 pt-3 border-t border-white/[0.08]">
            {/* Text that does not fit: what each role can do about it (measured with the frame's font) */}
            {overflow?.isOverflowing && (
              <div className="p-2.5 bg-[#2B1B19] border border-[#D94F3D]/50 rounded space-y-2">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-[#E07A5F] shrink-0 mt-0.5" />
                  <div>
                    <div className="text-[11px] font-semibold text-[#F5CFC7]">
                      {dontFit(overflow.overflowWords)} this frame
                    </div>
                    <div className="text-[11px] text-[#D7ACA3]">
                      {canDesign
                        ? 'Measured with its font. Fix it here; nothing else on the page moves.'
                        : 'Measured with its font. Carry the rest to the next page or shorten the words. The type size and the frame are set by a Designer.'}
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-1">
                  {canDesign && (
                    <>
                      <button type="button" onClick={shrinkToFit} className={fixBtn}>
                        Shrink to fit <span className="text-[#D7ACA3]">(not below {minimumSizePt(el, minBodyPt)} pt)</span>
                      </button>
                      <button type="button" onClick={tightenSpacing} className={fixBtn}>
                        Tighten spacing <span className="text-[#D7ACA3]">(paragraph gap, then leading)</span>
                      </button>
                      <button type="button" onClick={makeTaller} className={fixBtn}>
                        Make the frame taller <span className="text-[#D7ACA3]">(up to the bottom margin)</span>
                      </button>
                    </>
                  )}
                  <button type="button" onClick={continueOnNextPage} className={fixBtn}>
                    Continue on the next page
                  </button>
                  <button
                    type="button"
                    onClick={() => void runAi(el, 'shorten')}
                    disabled={aiBusy}
                    className={`${aiBtn} flex items-center gap-1`}
                  >
                    <Sparkles className="w-3 h-3" />
                    <span>Shorten with ETB2B AI</span>
                  </button>
                  <button type="button" onClick={editMyself} className={`${fixBtn} flex items-center gap-1`}>
                    <PenLine className="w-3 h-3" />
                    <span>Edit myself</span>
                  </button>
                </div>
              </div>
            )}
            <div role="status" aria-live="polite">
              {fixNote && fixNote.elementId === el.id && (
                <div
                  className={`text-[11px] leading-relaxed rounded px-2 py-1.5 border ${
                    fixNote.kind === 'ok'
                      ? 'text-[#BFD6B2] bg-[#1B2419] border-[#8AA678]/40'
                      : 'text-[#E6C790] bg-[#2B1F16] border-[#D4A657]/40'
                  }`}
                >
                  {fixNote.text}
                </div>
              )}
            </div>

            {/* "Edit with AI | Edit myself": manual editing is the default; ETB2B AI only ever suggests */}
            {el.type === 'text' && (
              <div
                role="radiogroup"
                aria-label="How to change the words"
                className="grid grid-cols-2 bg-[#121214] border border-white/[0.08] rounded p-0.5"
                onKeyDown={(e) => {
                  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                    e.preventDefault();
                    const next = editMode === 'ai' ? 'manual' : 'ai';
                    setEditMode(next);
                    (e.currentTarget.querySelector(`[data-mode="${next}"]`) as HTMLButtonElement | null)?.focus();
                  }
                }}
              >
                {(
                  [
                    ['ai', Sparkles, 'Edit with AI', 'Ask ETB2B AI for new words for this frame; nothing changes until you apply them'],
                    ['manual', PenLine, 'Edit myself', 'Type the words yourself'],
                  ] as const
                ).map(([mode, Icon, label, tip]) => (
                  <button
                    key={mode}
                    type="button"
                    role="radio"
                    data-mode={mode}
                    aria-checked={editMode === mode}
                    tabIndex={editMode === mode ? 0 : -1}
                    title={tip}
                    onClick={() => (mode === 'manual' ? editMyself() : setEditMode('ai'))}
                    className={`py-1.5 rounded text-[11px] flex items-center justify-center gap-1 cursor-pointer ${
                      editMode === mode ? 'bg-[#28282F] text-[#ECEAE4]' : 'text-[#8F8C84] hover:text-white'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span>{label}</span>
                  </button>
                ))}
              </div>
            )}

            {el.type === 'text' && editMode === 'ai' && (
              <div className="p-2.5 bg-[#1E1B16] border border-[#C6A26B]/30 rounded space-y-2">
                <div className="text-[11px] text-[#CFC6B5] leading-relaxed">
                  ETB2B AI suggests new words for this frame. Nothing changes until you press Apply.
                </div>
                <div className="grid grid-cols-1 gap-1">
                  <button
                    type="button"
                    onClick={() => void runAi(el, 'shorten')}
                    disabled={aiBusy || !overflow?.isOverflowing}
                    title={overflow?.isOverflowing ? 'Shorten the words to what the frame holds' : 'The words already fit this frame'}
                    className={aiBtn}
                  >
                    Shorten to fit
                    {overflow?.isOverflowing ? ` (about ${wordsLabel(shortenTarget(el))})` : ' (the words already fit)'}
                  </button>
                  <button type="button" onClick={() => void runAi(el, 'grammar')} disabled={aiBusy} className={aiBtn}>
                    Fix grammar and spelling
                  </button>
                  <button type="button" onClick={() => void runAi(el, 'clarify')} disabled={aiBusy} className={aiBtn}>
                    Make it clearer
                  </button>
                </div>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] text-[#8F8C84]">Ask for a change</span>
                  <textarea
                    rows={2}
                    maxLength={1000}
                    value={aiRequest}
                    onChange={(e) => setAiRequest(e.target.value)}
                    placeholder="For example: make it warmer, or start with the year"
                    className="bg-[#121214] border border-white/[0.08] rounded p-2 text-[11px] text-[#ECEAE4] leading-relaxed focus:outline-none focus:border-[#C6A26B]/60 select-text"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => void runAi(el, 'custom', aiRequest.trim())}
                  disabled={aiBusy || !aiRequest.trim()}
                  className={`${aiBtn} flex items-center gap-1`}
                >
                  <Sparkles className="w-3 h-3" />
                  <span>Ask ETB2B AI</span>
                </button>

                {ai.elementId === el.id && ai.status === 'working' && (
                  <div role="status" className="text-[11px] text-[#CFC6B5] flex items-center gap-1.5">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    <span>ETB2B AI is working on it…</span>
                  </div>
                )}
                {ai.elementId === el.id && ai.status === 'error' && (
                  <div role="alert" className="text-[11px] text-[#F5CFC7] bg-[#2B1B19] border border-[#D94F3D]/40 rounded px-2 py-1.5">
                    {ai.error}
                  </div>
                )}
                {ai.elementId === el.id && ai.status === 'ready' && (() => {
                  const sugFit = fitTextToFrame(el, ai.suggestion);
                  return (
                    <div className="space-y-1.5 pt-2 border-t border-white/[0.08]">
                      <div className="text-[11px] font-medium text-[#ECEAE4]">
                        {ai.task ? AI_TASK_NAMES[ai.task] : 'Suggestion'}: ETB2B AI suggests
                      </div>
                      <div className={`text-[11px] ${sugFit.fits ? 'text-[#BFD6B2]' : 'text-[#E6C790]'}`}>
                        {countWords(ai.baseText)} → {wordsLabel(countWords(ai.suggestion))} ·{' '}
                        {sugFit.fits ? 'fits the frame' : `about ${dontFit(sugFit.overflowWords)} yet`}
                      </div>
                      <div className="max-h-48 overflow-y-auto whitespace-pre-wrap bg-[#121214] border border-white/[0.08] rounded p-2 text-[11px] text-[#ECEAE4] leading-relaxed select-text">
                        {ai.suggestion}
                      </div>
                      {(el.text || '') !== ai.baseText && (
                        <div className="text-[11px] text-[#E6C790]">
                          The frame's words changed after you asked. Apply replaces them with this suggestion.
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-1.5">
                        <button
                          type="button"
                          onClick={applyAi}
                          className="py-1.5 rounded text-[11px] font-medium bg-[#C6A26B] text-[#121214] hover:bg-[#D4B27D] cursor-pointer flex items-center justify-center gap-1"
                        >
                          <Check className="w-3.5 h-3.5" />
                          <span>Apply</span>
                        </button>
                        <button
                          type="button"
                          onClick={discardAi}
                          className="py-1.5 rounded text-[11px] bg-[#28282F] text-[#ECEAE4] hover:bg-[#33333B] cursor-pointer flex items-center justify-center gap-1"
                        >
                          <X className="w-3.5 h-3.5" />
                          <span>Discard</span>
                        </button>
                      </div>
                      <div className="text-[11px] text-[#8F8C84]">After Apply, Undo brings the earlier words back.</div>
                    </div>
                  );
                })()}
              </div>
            )}

            {!canDesign && (
              <div className="text-[11px] text-[#8F8C84] flex items-center gap-1.5" title={LOCKED_TIP}>
                <Lock className="w-3 h-3 text-[#7F7C75] shrink-0" />
                <span className="truncate">
                  {el.textStyle.fontFamily} · {el.textStyle.fontSizePt}pt · {el.textStyle.textAlign}
                </span>
              </div>
            )}
            {canDesign && (
            <>
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-[#D7D4CC]">Typography</span>
              <button
                onClick={onOpenTypographyModal}
                className="text-[11px] text-[#C6A26B] hover:underline cursor-pointer"
              >
                Google Fonts Library
              </button>
            </div>

            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-[#8F8C84]">Font Family</span>
              <select
                value={el.textStyle.fontFamily}
                onChange={(e) => {
                  const fam = e.target.value;
                  void loadGoogleFont(fam);
                  onUpdateElement(activePage.id, el.id, {
                    textStyle: { ...el.textStyle!, fontFamily: fam },
                  });
                }}
                className="bg-[#121214] border border-white/[0.08] rounded px-2 py-1.5 text-xs text-[#ECEAE4]"
              >
                {Array.from(
                  new Set([
                    el.textStyle.fontFamily,
                    project.designSystem.typography.displayFont,
                    project.designSystem.typography.headingFont,
                    project.designSystem.typography.bodyFont,
                    project.designSystem.typography.captionFont,
                    project.designSystem.typography.quoteFont,
                    project.designSystem.typography.numericalFont,
                    ...GOOGLE_FONTS_CATALOG.map((f) => f.family),
                  ])
                ).map((fam) => (
                  <option key={fam} value={fam}>
                    {fam}
                  </option>
                ))}
              </select>
            </label>

            <div className="grid grid-cols-3 gap-1.5">
              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-[#8F8C84]">Size (pt)</span>
                <input
                  type="number"
                  step={0.5}
                  min={5}
                  max={140}
                  value={el.textStyle.fontSizePt}
                  onChange={(e) =>
                    onUpdateElement(activePage.id, el.id, {
                      textStyle: {
                        ...el.textStyle!,
                        fontSizePt: Math.max(5, parseFloat(e.target.value) || 10),
                      },
                    })
                  }
                  className="bg-[#121214] border border-white/[0.08] rounded px-2 py-1 font-mono-tabular text-[11px] text-[#ECEAE4]"
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-[#8F8C84]">Weight</span>
                <select
                  value={el.textStyle.fontWeight}
                  onChange={(e) =>
                    onUpdateElement(activePage.id, el.id, {
                      textStyle: { ...el.textStyle!, fontWeight: Number(e.target.value) },
                    })
                  }
                  className="bg-[#121214] border border-white/[0.08] rounded px-1.5 py-1 text-[11px] text-[#ECEAE4]"
                >
                  {[300, 400, 500, 600, 700, 800].map((w) => (
                    <option key={w} value={w}>
                      {w}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-[#8F8C84]">Colour</span>
                <input
                  type="color"
                  value={el.textStyle.color}
                  onChange={(e) =>
                    onUpdateElement(activePage.id, el.id, {
                      textStyle: { ...el.textStyle!, color: e.target.value },
                    })
                  }
                  className="w-full h-[26px] rounded border border-white/15 bg-transparent cursor-pointer"
                />
              </label>
            </div>

            <div className="grid grid-cols-3 gap-1.5">
              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-[#8F8C84]">Leading</span>
                <input
                  type="number"
                  step={0.05}
                  min={0.9}
                  max={3}
                  value={el.textStyle.lineHeight}
                  onChange={(e) =>
                    onUpdateElement(activePage.id, el.id, {
                      textStyle: {
                        ...el.textStyle!,
                        lineHeight: parseFloat(e.target.value) || 1.4,
                      },
                    })
                  }
                  className="bg-[#121214] border border-white/[0.08] rounded px-2 py-1 font-mono-tabular text-[11px] text-[#ECEAE4]"
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-[#8F8C84]">Track (em)</span>
                <input
                  type="number"
                  step={0.01}
                  min={-0.1}
                  max={0.5}
                  value={el.textStyle.letterSpacingEm}
                  onChange={(e) =>
                    onUpdateElement(activePage.id, el.id, {
                      textStyle: {
                        ...el.textStyle!,
                        letterSpacingEm: parseFloat(e.target.value) || 0,
                      },
                    })
                  }
                  className="bg-[#121214] border border-white/[0.08] rounded px-2 py-1 font-mono-tabular text-[11px] text-[#ECEAE4]"
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-[#8F8C84]">Columns</span>
                <select
                  value={el.textStyle.columns}
                  onChange={(e) =>
                    onUpdateElement(activePage.id, el.id, {
                      textStyle: { ...el.textStyle!, columns: Number(e.target.value) },
                    })
                  }
                  className="bg-[#121214] border border-white/[0.08] rounded px-1.5 py-1 text-[11px] text-[#ECEAE4]"
                >
                  {[1, 2, 3].map((c) => (
                    <option key={c} value={c}>
                      {c} col
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {/* Alignment & Vertical Alignment */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center bg-[#121214] border border-white/[0.08] rounded p-0.5">
                {(
                  [
                    ['left', AlignLeft],
                    ['center', AlignCenter],
                    ['right', AlignRight],
                    ['justify', AlignJustify],
                  ] as const
                ).map(([al, Icon]) => (
                  <button
                    key={al}
                    onClick={() =>
                      onUpdateElement(activePage.id, el.id, {
                        textStyle: { ...el.textStyle!, textAlign: al },
                      })
                    }
                    className={`p-1.5 rounded cursor-pointer ${
                      el.textStyle!.textAlign === al
                        ? 'bg-[#28282F] text-[#C6A26B]'
                        : 'text-[#8F8C84] hover:text-white'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                  </button>
                ))}
              </div>

              <div className="flex items-center bg-[#121214] border border-white/[0.08] rounded p-0.5">
                {(
                  [
                    ['top', ArrowUpToLine],
                    ['middle', Minimize2],
                    ['bottom', ArrowDownToLine],
                  ] as const
                ).map(([va, Icon]) => (
                  <button
                    key={va}
                    onClick={() =>
                      onUpdateElement(activePage.id, el.id, {
                        textStyle: { ...el.textStyle!, verticalAlign: va },
                      })
                    }
                    title={`Vertical align: ${va}`}
                    className={`p-1.5 rounded cursor-pointer ${
                      el.textStyle!.verticalAlign === va
                        ? 'bg-[#28282F] text-[#C6A26B]'
                        : 'text-[#8F8C84] hover:text-white'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-[#8F8C84]">Paragraph Gap (mm)</span>
                <input
                  title="Space between paragraphs (an empty line between words starts a new one). Paragraphs are always at least that empty line apart; a larger gap adds the difference."
                  type="number"
                  step={0.5}
                  min={0}
                  value={el.textStyle.paragraphSpacingMm}
                  onChange={(e) =>
                    onUpdateElement(activePage.id, el.id, {
                      textStyle: {
                        ...el.textStyle!,
                        paragraphSpacingMm: Math.max(0, parseFloat(e.target.value) || 0),
                      },
                    })
                  }
                  className="bg-[#121214] border border-white/[0.08] rounded px-2 py-1 font-mono-tabular text-[11px] text-[#ECEAE4]"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-[#8F8C84]">Frame Inset (mm)</span>
                <input
                  type="number"
                  step={0.5}
                  min={0}
                  value={el.textStyle.insetMm}
                  onChange={(e) =>
                    onUpdateElement(activePage.id, el.id, {
                      textStyle: {
                        ...el.textStyle!,
                        insetMm: Math.max(0, parseFloat(e.target.value) || 0),
                      },
                    })
                  }
                  className="bg-[#121214] border border-white/[0.08] rounded px-2 py-1 font-mono-tabular text-[11px] text-[#ECEAE4]"
                />
              </label>
            </div>
            </>
            )}

            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-[#8F8C84]">Editorial Copy (Frame-Locked)</span>
              <textarea
                ref={copyRef}
                rows={4}
                value={el.text || ''}
                onChange={(e) =>
                  onUpdateElement(activePage.id, el.id, { text: e.target.value })
                }
                className="bg-[#121214] border border-white/[0.08] rounded p-2 text-[11px] text-[#ECEAE4] leading-relaxed focus:outline-none focus:border-[#C6A26B]/60"
              />
            </label>
          </div>
        )}

      {/* IMAGE PROPERTIES */}
      {el.type === 'image' && el.image && (
        <div className="space-y-3 pt-3 border-t border-white/[0.08]">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-[#D7D4CC]">Photograph Frame</span>
          </div>

          {/* its sharpness where it prints (pixels over the frame's size, over the zoom), and what to do when low */}
          <PhotoResolutionBadge element={el} pixels={photoAsset} />

          {/* Non-destructive Replace from Project Library */}
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-[#8F8C84]">Replace Image (Preserves Frame & Crop)</span>
            <select
              value={el.image.src}
              onChange={(e) => {
                const chosen = project.imageAssets.find((a) => a.url === e.target.value);
                if (!chosen) return;
                onUpdateElement(activePage.id, el.id, {
                  image: {
                    ...el.image!,
                    src: chosen.url,
                    assetId: chosen.id,
                    alt: chosen.name,
                    naturalWidth: chosen.widthPx,
                    naturalHeight: chosen.heightPx,
                  },
                });
              }}
              className="bg-[#121214] border border-white/[0.08] rounded px-2 py-1.5 text-[11px] text-[#ECEAE4]"
            >
              {project.imageAssets.map((a) => (
                <option key={a.id} value={a.url}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>

          {/* Fit vs Fill */}
          <div className="grid grid-cols-2 gap-1.5">
            <button
              onClick={() =>
                onUpdateElement(activePage.id, el.id, {
                  image: { ...el.image!, fit: 'cover' },
                })
              }
              className={`py-1.5 text-[11px] rounded border flex items-center justify-center gap-1 cursor-pointer ${
                el.image.fit === 'cover'
                  ? 'bg-[#2A2824] border-[#C6A26B] text-[#ECEAE4]'
                  : 'bg-[#121214] border-white/[0.08] text-[#98958D]'
              }`}
            >
              <Maximize className="w-3 h-3" />
              <span>Fill Frame</span>
            </button>
            <button
              onClick={() =>
                onUpdateElement(activePage.id, el.id, {
                  image: { ...el.image!, fit: 'contain' },
                })
              }
              className={`py-1.5 text-[11px] rounded border flex items-center justify-center gap-1 cursor-pointer ${
                el.image.fit === 'contain'
                  ? 'bg-[#2A2824] border-[#C6A26B] text-[#ECEAE4]'
                  : 'bg-[#121214] border-white/[0.08] text-[#98958D]'
              }`}
            >
              <ImageIcon className="w-3 h-3" />
              <span>Fit Inside</span>
            </button>
          </div>

          <label className="flex flex-col gap-1">
            <div className="flex justify-between text-[11px] text-[#8F8C84]">
              <span>Zoom Inside Frame</span>
              <span className="font-mono-tabular">{Math.round((el.image.zoom || 1) * 100)}%</span>
            </div>
            <input
              type="range"
              min={1}
              max={2.6}
              step={0.05}
              value={el.image.zoom || 1}
              onChange={(e) =>
                onUpdateElement(activePage.id, el.id, {
                  image: { ...el.image!, zoom: parseFloat(e.target.value) },
                })
              }
              className="w-full accent-[#C6A26B]"
            />
          </label>

          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-[#8F8C84]">Focal X ({el.image.focalX}%)</span>
              <input
                type="range"
                min={0}
                max={100}
                value={el.image.focalX ?? 50}
                onChange={(e) =>
                  onUpdateElement(activePage.id, el.id, {
                    image: { ...el.image!, focalX: Number(e.target.value) },
                  })
                }
                className="w-full accent-[#C6A26B]"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-[#8F8C84]">Focal Y ({el.image.focalY}%)</span>
              <input
                type="range"
                min={0}
                max={100}
                value={el.image.focalY ?? 50}
                onChange={(e) =>
                  onUpdateElement(activePage.id, el.id, {
                    image: { ...el.image!, focalY: Number(e.target.value) },
                  })
                }
                className="w-full accent-[#C6A26B]"
              />
            </label>
          </div>

          {/* Tonal Treatments (photo effects: the design's) */}
          {canDesign && (
          <div className="space-y-2 pt-2 border-t border-white/[0.06]">
            <span className="text-[11px] text-[#8F8C84]">Tonal Treatment</span>
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-0.5">
                <span className="text-[11px] text-[#8F8C84]">Grayscale ({el.image.grayscale || 0}%)</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={el.image.grayscale || 0}
                  onChange={(e) =>
                    onUpdateElement(activePage.id, el.id, {
                      image: { ...el.image!, grayscale: Number(e.target.value) },
                    })
                  }
                  className="w-full accent-[#C6A26B]"
                />
              </label>
              <label className="flex flex-col gap-0.5">
                <span className="text-[11px] text-[#8F8C84]">Contrast ({el.image.contrast ?? 100}%)</span>
                <input
                  type="range"
                  min={60}
                  max={150}
                  value={el.image.contrast ?? 100}
                  onChange={(e) =>
                    onUpdateElement(activePage.id, el.id, {
                      image: { ...el.image!, contrast: Number(e.target.value) },
                    })
                  }
                  className="w-full accent-[#C6A26B]"
                />
              </label>
            </div>
          </div>
          )}

          <button
            onClick={() =>
              onUpdateElement(activePage.id, el.id, {
                image: canDesign
                  ? {
                      ...el.image!,
                      zoom: el.image!.originalCrop?.zoom ?? 1,
                      focalX: el.image!.originalCrop?.focalX ?? 50,
                      focalY: el.image!.originalCrop?.focalY ?? 50,
                      fit: el.image!.originalCrop?.fit ?? 'cover',
                      grayscale: 0,
                      sepia: 0,
                      contrast: 100,
                      brightness: 100,
                    }
                  : {
                      // a Content editor puts back how the photo sat in the frame; its effects are the design's
                      ...el.image!,
                      zoom: el.image!.originalCrop?.zoom ?? 1,
                      focalX: el.image!.originalCrop?.focalX ?? 50,
                      focalY: el.image!.originalCrop?.focalY ?? 50,
                      fit: el.image!.originalCrop?.fit ?? 'cover',
                    },
              })
            }
            className="w-full py-1.5 text-[11px] bg-[#24242A] hover:bg-[#2F2F37] text-[#D7D4CC] rounded flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <RotateCcw className="w-3 h-3" />
            <span>{canDesign ? 'Restore Original Crop & Tone' : 'Restore Original Crop'}</span>
          </button>
          <p className="text-[11px] text-[#7F7C75] flex items-center gap-1">
            <Crop className="w-3 h-3 shrink-0" />
            <span>Double-click image on canvas to pan crop interactively.</span>
          </p>
        </div>
      )}

      {/* SHAPE & LINE PROPERTIES (the design's) */}
      {!canDesign && (el.type === 'shape' || el.type === 'line' || el.type === 'decorative') && (
        <div className="pt-3 border-t border-white/[0.08] text-[11px] text-[#8F8C84] flex items-center gap-1.5">
          <Lock className="w-3 h-3 shrink-0" />
          <span>Shapes and rules are part of the design: a Designer changes them.</span>
        </div>
      )}
      {canDesign && (el.type === 'shape' || el.type === 'line' || el.type === 'decorative') && el.shape && (
        <div className="space-y-3 pt-3 border-t border-white/[0.08]">
          <div className="text-[11px] font-medium text-[#D7D4CC]">Shape & Stroke</div>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-[#8F8C84]">Fill</span>
              <div className="flex items-center gap-1.5">
                <input
                  type="color"
                  value={el.shape.fill === 'transparent' ? '#F2EDE4' : el.shape.fill}
                  onChange={(e) =>
                    onUpdateElement(activePage.id, el.id, {
                      shape: { ...el.shape!, fill: e.target.value },
                    })
                  }
                  className="w-7 h-7 rounded border border-white/15 bg-transparent cursor-pointer"
                />
                <button
                  onClick={() =>
                    onUpdateElement(activePage.id, el.id, {
                      shape: { ...el.shape!, fill: 'transparent' },
                    })
                  }
                  className="text-[11px] text-[#8F8C84] hover:text-white cursor-pointer"
                >
                  None
                </button>
              </div>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-[#8F8C84]">Stroke</span>
              <input
                type="color"
                value={el.shape.stroke === 'transparent' ? '#C6A26B' : el.shape.stroke}
                onChange={(e) =>
                  onUpdateElement(activePage.id, el.id, {
                    shape: { ...el.shape!, stroke: e.target.value },
                  })
                }
                className="w-7 h-7 rounded border border-white/15 bg-transparent cursor-pointer"
              />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-[#8F8C84]">Stroke Width (mm)</span>
              <input
                type="number"
                step={0.1}
                min={0}
                max={10}
                value={el.shape.strokeWidthMm}
                onChange={(e) =>
                  onUpdateElement(activePage.id, el.id, {
                    shape: { ...el.shape!, strokeWidthMm: parseFloat(e.target.value) || 0 },
                  })
                }
                className="bg-[#121214] border border-white/[0.08] rounded px-2 py-1 font-mono-tabular text-[11px] text-[#ECEAE4]"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-[#8F8C84]">Corner Radius (mm)</span>
              <input
                type="number"
                step={0.5}
                min={0}
                value={el.shape.cornerRadiusMm}
                onChange={(e) =>
                  onUpdateElement(activePage.id, el.id, {
                    shape: { ...el.shape!, cornerRadiusMm: parseFloat(e.target.value) || 0 },
                  })
                }
                className="bg-[#121214] border border-white/[0.08] rounded px-2 py-1 font-mono-tabular text-[11px] text-[#ECEAE4]"
              />
            </label>
          </div>
        </div>
      )}

      {/* LIVE INFOGRAPHIC DATA EDITOR */}
      {el.type === 'infographic' && el.infographic && (
        <div className="space-y-3 pt-3 border-t border-white/[0.08]">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-[#D7D4CC]">Infographic Data Editor</span>
            {canDesign && (
              <button
                onClick={onOpenInfographicsModal}
                className="text-[11px] text-[#C6A26B] hover:underline cursor-pointer"
              >
                Browse 52 Templates
              </button>
            )}
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-[#8F8C84]">Chart type</span>
            <select
              value={el.infographic.variant}
              onChange={(e) => {
                const pick = CHART_TYPES.find((c) => c.variant === e.target.value);
                if (!pick) return;
                onUpdateElement(activePage.id, el.id, {
                  infographic: { ...el.infographic!, variant: pick.variant, templateId: pick.templateId },
                });
              }}
              className="bg-[#121214] border border-white/[0.08] rounded px-2 py-1 text-[11px] text-[#ECEAE4]"
            >
              {!CHART_TYPES.some((c) => c.variant === el.infographic.variant) && (
                <option value={el.infographic.variant}>{String(el.infographic.variant).replace(/_/g, ' ')}</option>
              )}
              {CHART_TYPES.map((c) => (
                <option key={c.variant} value={c.variant}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-[#8F8C84]">Title</span>
            <input
              type="text"
              value={el.infographic.title}
              onChange={(e) =>
                onUpdateElement(activePage.id, el.id, {
                  infographic: { ...el.infographic!, title: e.target.value },
                })
              }
              className="bg-[#121214] border border-white/[0.08] rounded px-2 py-1 text-[11px] text-[#ECEAE4]"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-[#8F8C84]">Subtitle</span>
            <input
              type="text"
              value={el.infographic.subtitle}
              onChange={(e) =>
                onUpdateElement(activePage.id, el.id, {
                  infographic: { ...el.infographic!, subtitle: e.target.value },
                })
              }
              className="bg-[#121214] border border-white/[0.08] rounded px-2 py-1 text-[11px] text-[#ECEAE4]"
            />
          </label>

          {canDesign && (
          <div className="grid grid-cols-4 gap-1.5">
            {(
              [
                ['BG', 'backgroundColor'],
                ['Ink', 'textColor'],
                ['Accent', 'accentColor'],
                ['Sec.', 'secondaryColor'],
              ] as const
            ).map(([lbl, key]) => (
              <label key={key} className="flex flex-col items-center gap-1">
                <span className="text-[11px] text-[#8F8C84]">{lbl}</span>
                <input
                  type="color"
                  value={el.infographic![key]}
                  onChange={(e) =>
                    onUpdateElement(activePage.id, el.id, {
                      infographic: { ...el.infographic!, [key]: e.target.value },
                    })
                  }
                  className="w-full h-6 rounded border border-white/15 bg-transparent cursor-pointer"
                />
              </label>
            ))}
          </div>
          )}

          {/* Data Rows */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-[#8F8C84]">
                Data Entries ({el.infographic.items.length})
              </span>
              <button
                onClick={() => {
                  const nextItem: InfographicItem = {
                    id: `it_${Date.now()}`,
                    label: `Item ${el.infographic!.items.length + 1}`,
                    value: 50,
                    unit: el.infographic!.items[0]?.unit || '%',
                    description: 'Editable metric note',
                  };
                  onUpdateElement(activePage.id, el.id, {
                    infographic: {
                      ...el.infographic!,
                      items: [...el.infographic!.items, nextItem],
                    },
                  });
                }}
                className="text-[11px] text-[#C6A26B] hover:text-[#DFC08E] flex items-center gap-0.5 cursor-pointer"
              >
                <Plus className="w-3 h-3" />
                <span>Add Row</span>
              </button>
            </div>

            <div className="space-y-1.5 max-h-56 overflow-y-auto pr-0.5">
              {el.infographic.items.map((item, idx) => (
                <div
                  key={item.id}
                  className="p-2 bg-[#121214] border border-white/[0.06] rounded space-y-1"
                >
                  <div className="flex items-center gap-1">
                    <input
                      type="text"
                      value={item.label}
                      onChange={(e) => {
                        const next = [...el.infographic!.items];
                        next[idx] = { ...item, label: e.target.value };
                        onUpdateElement(activePage.id, el.id, {
                          infographic: { ...el.infographic!, items: next },
                        });
                      }}
                      className="flex-1 bg-[#1C1C20] px-1.5 py-0.5 text-[11px] text-[#ECEAE4] rounded"
                    />
                    <input
                      type="number"
                      value={item.value}
                      onChange={(e) => {
                        const next = [...el.infographic!.items];
                        next[idx] = { ...item, value: parseFloat(e.target.value) || 0 };
                        onUpdateElement(activePage.id, el.id, {
                          infographic: { ...el.infographic!, items: next },
                        });
                      }}
                      className="w-14 bg-[#1C1C20] px-1.5 py-0.5 font-mono-tabular text-[11px] text-[#C6A26B] rounded"
                    />
                    <input
                      type="text"
                      value={item.unit || ''}
                      placeholder="%"
                      onChange={(e) => {
                        const next = [...el.infographic!.items];
                        next[idx] = { ...item, unit: e.target.value };
                        onUpdateElement(activePage.id, el.id, {
                          infographic: { ...el.infographic!, items: next },
                        });
                      }}
                      className="w-9 bg-[#1C1C20] px-1 py-0.5 text-[11px] text-[#98958D] rounded"
                    />
                    <button
                      onClick={() => {
                        const next = el.infographic!.items.filter((_, i) => i !== idx);
                        onUpdateElement(activePage.id, el.id, {
                          infographic: { ...el.infographic!, items: next },
                        });
                      }}
                      className="text-[#7F7C75] hover:text-[#E07A5F] cursor-pointer"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                  <input
                    type="text"
                    value={item.description || ''}
                    placeholder="Caption / annotation..."
                    onChange={(e) => {
                      const next = [...el.infographic!.items];
                      next[idx] = { ...item, description: e.target.value };
                      onUpdateElement(activePage.id, el.id, {
                        infographic: { ...el.infographic!, items: next },
                      });
                    }}
                    className="w-full bg-transparent text-[11px] text-[#8F8C84] focus:bg-[#1C1C20] focus:text-white px-1 py-0.5 rounded focus:outline-none"
                  />
                </div>
              ))}
            </div>
          </div>

          {canDesign && (
            <button
              onClick={() => onSaveInfographicAsTemplate(el)}
              className="w-full py-1.5 px-2.5 bg-[#24242A] hover:bg-[#303038] text-[11px] text-[#ECEAE4] rounded flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <BookmarkPlus className="w-3.5 h-3.5 text-[#C6A26B]" />
              <span>Save Infographic to My Templates</span>
            </button>
          )}
        </div>
      )}
      </div>
    </aside>
  );
};
