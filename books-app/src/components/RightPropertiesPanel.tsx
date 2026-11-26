import React, { useMemo, useState } from 'react';
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
  Crop,
  Image as ImageIcon,
  Link2,
  Maximize,
  Minimize2,
  Palette,
  Plus,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Type as TypeIcon,
} from 'lucide-react';
import type {
  AlignAction,
  BookElement,
  BookPage,
  BookProject,
  InfographicItem,
} from '../types/bookstudio';
import {
  formatNumericValue,
  getEffectivePageDimensions,
  MM_PER_INCH,
  unitToMm,
} from '../engines/dimensionEngine';
import { GOOGLE_FONTS_CATALOG, loadGoogleFont } from '../engines/fontEngine';
import {
  expandFrameHeightForText,
  fitTextWithinApprovedLimits,
  measureTextOverflow,
  tightenParagraphSpacing,
} from '../engines/textEngine';

interface RightPropertiesPanelProps {
  project: BookProject;
  activePage: BookPage;
  selectedElement: BookElement | null;
  selectedCount: number;
  onUpdateElement: (pageId: string, elementId: string, patch: Partial<BookElement>) => void;
  onUpdatePage: (pageId: string, patch: Partial<BookPage>) => void;
  onAlignElements: (action: AlignAction) => void;
  onJumpToElement: (pageId: string, elementId: string) => void;
  onContinueOverflowToNextPage: (pageId: string, elementId: string) => void;
  onOpenTypographyModal: () => void;
  onOpenDimensionsModal: () => void;
  onOpenInfographicsModal: () => void;
  onSaveInfographicAsTemplate: (el: BookElement) => void;
  onRequestAiTextFit: (el: BookElement) => void;
}

type InspectorTab = 'properties' | 'styles' | 'swatches' | 'align' | 'links';

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
  onUpdateElement,
  onUpdatePage,
  onAlignElements,
  onJumpToElement,
  onContinueOverflowToNextPage,
  onOpenTypographyModal,
  onOpenDimensionsModal,
  onOpenInfographicsModal,
  onSaveInfographicAsTemplate,
  onRequestAiTextFit,
}) => {
  const [panelTab, setPanelTab] = useState<InspectorTab>('properties');
  const [swatchTarget, setSwatchTarget] = useState<'auto' | 'text' | 'fill' | 'stroke' | 'paper'>('auto');
  const unit = project.unit;
  const pageDim = getEffectivePageDimensions(activePage, project.dimensions);

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
    <div className="grid grid-cols-5 border-b border-white/[0.08] bg-[#141417] shrink-0">
      {(
        [
          ['properties', SlidersHorizontal, 'Props'],
          ['styles', TypeIcon, 'Styles'],
          ['swatches', Palette, 'Swatch'],
          ['align', AlignCenterHorizontal, 'Align'],
          ['links', Link2, 'Links'],
        ] as const
      ).map(([id, Icon, lbl]) => (
        <button
          key={id}
          onClick={() => setPanelTab(id)}
          className={`py-2 flex flex-col items-center gap-0.5 text-[9px] border-b-2 transition-colors cursor-pointer ${
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
              <div className="text-[10px] text-[#8F8C84]">
                {canApply ? `Click to apply to "${selectedElement!.name}"` : 'Select any text frame to apply'}
              </div>
            </div>
            <button
              onClick={onOpenTypographyModal}
              className="text-[10px] text-[#C6A26B] hover:underline cursor-pointer"
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
                <div className="font-mono-tabular text-[10px] text-[#8F8C84] mt-0.5">{st.meta}</div>
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
            <div className="text-[10px] text-[#8F8C84]">
              Click any swatch to apply to target property
            </div>
          </div>

          <div className="grid grid-cols-5 gap-1 bg-[#121214] p-0.5 rounded border border-white/[0.08] text-[10px]">
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
            <div className="text-[10px] uppercase tracking-wider text-[#8F8C84]">
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
                <span className="font-mono-tabular text-[10px] text-[#8F8C84]">{hex}</span>
              </button>
            ))}
          </div>

          <div className="space-y-1.5 pt-2 border-t border-white/[0.08]">
            <div className="text-[10px] uppercase tracking-wider text-[#8F8C84]">
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
                  <span className="text-[10px] text-[#D7D4CC] truncate">{sw.name}</span>
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
            <div className="text-[10px] text-[#8F8C84] mt-0.5">
              {selectedCount === 0
                ? 'Select 1 frame (aligns to margins) or 2+ frames (Shift+Click)'
                : selectedCount === 1
                  ? 'Aligning 1 frame to Page Margins'
                  : `Aligning ${selectedCount} selected frames`}
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-[10px] text-[#8F8C84]">Align Objects</div>
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
                  className="py-2 px-1.5 bg-[#121214] hover:bg-[#24242C] disabled:opacity-35 border border-white/[0.08] rounded flex flex-col items-center gap-1 text-[10px] text-[#D7D4CC] cursor-pointer"
                >
                  <Icon className="w-3.5 h-3.5 text-[#C6A26B]" />
                  <span>{lbl}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2 pt-2 border-t border-white/[0.08]">
            <div className="text-[10px] text-[#8F8C84]">Distribute Spacing (3+ Frames)</div>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                disabled={selectedCount < 3}
                onClick={() => onAlignElements('distribute_h')}
                className="py-2 px-2 bg-[#121214] hover:bg-[#24242C] disabled:opacity-35 border border-white/[0.08] rounded flex items-center justify-center gap-1.5 text-[10px] text-[#D7D4CC] cursor-pointer"
              >
                <AlignHorizontalSpaceAround className="w-3.5 h-3.5 text-[#C6A26B]" />
                <span>Horizontal</span>
              </button>
              <button
                disabled={selectedCount < 3}
                onClick={() => onAlignElements('distribute_v')}
                className="py-2 px-2 bg-[#121214] hover:bg-[#24242C] disabled:opacity-35 border border-white/[0.08] rounded flex items-center justify-center gap-1.5 text-[10px] text-[#D7D4CC] cursor-pointer"
              >
                <AlignVerticalSpaceAround className="w-3.5 h-3.5 text-[#C6A26B]" />
                <span>Vertical</span>
              </button>
            </div>
          </div>

          <div className="space-y-2 pt-2 border-t border-white/[0.08]">
            <div className="text-[10px] text-[#8F8C84]">Match Dimensions (2+ Frames)</div>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                disabled={selectedCount < 2}
                onClick={() => onAlignElements('match_width')}
                className="py-1.5 px-2 bg-[#121214] hover:bg-[#24242C] disabled:opacity-35 border border-white/[0.08] rounded text-[10px] text-[#D7D4CC] cursor-pointer"
              >
                Same Width
              </button>
              <button
                disabled={selectedCount < 2}
                onClick={() => onAlignElements('match_height')}
                className="py-1.5 px-2 bg-[#121214] hover:bg-[#24242C] disabled:opacity-35 border border-white/[0.08] rounded text-[10px] text-[#D7D4CC] cursor-pointer"
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
          <div className="text-[10px] text-[#8F8C84]">
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
                      <div className="w-full h-full flex items-center justify-center text-[8px] text-[#7F7C75]">
                        Empty
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] font-medium text-[#ECEAE4] truncate">
                      {lnk.element.name}
                    </div>
                    <div className="font-mono-tabular text-[10px] text-[#8F8C84]">
                      p.{lnk.pageNumber} · {Math.round(lnk.element.widthMm)}×{Math.round(lnk.element.heightMm)}mm
                    </div>
                  </div>
                  <div
                    className={`font-mono-tabular text-[10px] shrink-0 ${
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
      <span className="text-[10px] text-[#8F8C84]">{label} ({unit})</span>
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
            <span className="text-[10px] text-[#8F8C84]">Page Label</span>
            <input
              type="text"
              value={activePage.label}
              onChange={(e) => onUpdatePage(activePage.id, { label: e.target.value })}
              className="bg-[#121214] border border-white/[0.08] rounded px-2.5 py-1.5 text-xs text-[#ECEAE4] focus:outline-none focus:border-[#C6A26B]/60"
            />
          </label>

          <div className="flex items-center justify-between">
            <span className="text-[11px] text-[#A19E95]">Paper Background</span>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={activePage.backgroundColor}
                onChange={(e) => onUpdatePage(activePage.id, { backgroundColor: e.target.value })}
                className="w-6 h-6 rounded border border-white/15 bg-transparent cursor-pointer"
              />
              <span className="font-mono-tabular text-[11px] text-[#98958D]">
                {activePage.backgroundColor}
              </span>
            </div>
          </div>

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
        </div>

        <div className="space-y-2 pt-3 border-t border-white/[0.08]">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-[#D7D4CC]">Physical Dimensions</span>
            {activePage.dimensionsOverride && (
              <span className="text-[10px] text-[#C6A26B]">Mixed-Format Override</span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2 font-mono-tabular text-[11px] text-[#A19E95] bg-[#121214] p-2.5 rounded border border-white/[0.06]">
            <div>Width: {formatNumericValue(pageDim.widthMm, unit)} {unit}</div>
            <div>Height: {formatNumericValue(pageDim.heightMm, unit)} {unit}</div>
            <div>Bleed: {formatNumericValue(pageDim.bleedMm, unit)} {unit}</div>
            <div>Cols: {pageDim.columns}</div>
          </div>
          <button
            onClick={onOpenDimensionsModal}
            className="w-full py-1.5 px-2.5 bg-[#24242A] hover:bg-[#2E2E36] text-[11px] text-[#ECEAE4] rounded transition-colors cursor-pointer"
          >
            Configure Dimensions & Mixed Format
          </button>
        </div>

        <div className="pt-3 border-t border-white/[0.08] text-[11px] text-[#8F8C84] leading-relaxed">
          Select any text frame, photograph, shape, or infographic on the spread to edit its exact physical coordinates, typography, crop, or live dataset.
        </div>
        </div>
      </aside>
    );
  }

  const el = selectedElement;
  const overflow = el.type === 'text' ? measureTextOverflow(el) : null;

  // Calculate effective print DPI for image frames
  let effectiveDpi: number | null = null;
  if (el.type === 'image' && el.image?.naturalWidth && el.image?.naturalHeight) {
    const wIn = Math.max(0.1, el.widthMm / MM_PER_INCH);
    const hIn = Math.max(0.1, el.heightMm / MM_PER_INCH);
    effectiveDpi = Math.round(
      Math.min(el.image.naturalWidth / wIn, el.image.naturalHeight / hIn) / (el.image.zoom || 1)
    );
  }

  return (
    <aside className="w-[288px] shrink-0 bg-[#18181B] border-l border-white/[0.08] flex flex-col select-none">
      {renderTabBar()}
      <div className="overflow-y-auto p-3.5 space-y-4 flex-1">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs font-semibold text-[#ECEAE4] truncate">{el.name}</div>
          <div className="text-[10px] text-[#8F8C84] capitalize">
            {el.type} frame{el.masterElementId ? ' · Master Linked' : ''}
          </div>
        </div>
      </div>

      {/* Geometry & Coordinates (Shared across all element types) */}
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
            <span className="text-[10px] text-[#8F8C84]">Rotation (°)</span>
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
            <span className="text-[10px] text-[#8F8C84]">Opacity ({Math.round((el.opacity ?? 1) * 100)}%)</span>
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

      {/* TEXT PROPERTIES */}
      {(el.type === 'text' ||
        el.type === 'header' ||
        el.type === 'footer' ||
        el.type === 'pageNumber' ||
        el.type === 'logo') &&
        el.textStyle && (
          <div className="space-y-3 pt-3 border-t border-white/[0.08]">
            {/* Overflow Alert & Controlled Remedies */}
            {overflow?.isOverflowing && (
              <div className="p-2.5 bg-[#2B1B19] border border-[#D94F3D]/50 rounded space-y-2">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-[#E07A5F] shrink-0 mt-0.5" />
                  <div>
                    <div className="text-[11px] font-semibold text-[#F5CFC7]">
                      Text Overflow (+{overflow.overflowWords} words)
                    </div>
                    <div className="text-[10px] text-[#D7ACA3]">
                      Frame preserved without disturbing surrounding photography. Choose a controlled action:
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-1">
                  <button
                    onClick={() =>
                      onUpdateElement(
                        activePage.id,
                        el.id,
                        fitTextWithinApprovedLimits(el, project.designSystem.typography.minApprovedBodyPt)
                      )
                    }
                    className="py-1 px-2 text-left text-[10px] bg-[#3B2522] hover:bg-[#4B2E2A] text-[#F5E6E3] rounded cursor-pointer"
                  >
                    1. Reduce font size (min {project.designSystem.typography.minApprovedBodyPt}pt)
                  </button>
                  <button
                    onClick={() =>
                      onUpdateElement(
                        activePage.id,
                        el.id,
                        expandFrameHeightForText(el, pageDim.heightMm)
                      )
                    }
                    className="py-1 px-2 text-left text-[10px] bg-[#3B2522] hover:bg-[#4B2E2A] text-[#F5E6E3] rounded cursor-pointer"
                  >
                    2. Expand text frame vertically
                  </button>
                  <button
                    onClick={() =>
                      onUpdateElement(activePage.id, el.id, tightenParagraphSpacing(el))
                    }
                    className="py-1 px-2 text-left text-[10px] bg-[#3B2522] hover:bg-[#4B2E2A] text-[#F5E6E3] rounded cursor-pointer"
                  >
                    3. Tighten line height & paragraph spacing
                  </button>
                  <button
                    onClick={() => onContinueOverflowToNextPage(activePage.id, el.id)}
                    className="py-1 px-2 text-left text-[10px] bg-[#3B2522] hover:bg-[#4B2E2A] text-[#F5E6E3] rounded cursor-pointer"
                  >
                    4. Continue overflow onto next page
                  </button>
                  <button
                    onClick={() => onRequestAiTextFit(el)}
                    className="py-1 px-2 text-left text-[10px] bg-[#C6A26B]/20 hover:bg-[#C6A26B]/30 text-[#F1D8AE] rounded flex items-center gap-1 cursor-pointer"
                  >
                    <Sparkles className="w-3 h-3" />
                    <span>5. Request optional AI copy tightening</span>
                  </button>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-[#D7D4CC]">Typography</span>
              <button
                onClick={onOpenTypographyModal}
                className="text-[10px] text-[#C6A26B] hover:underline cursor-pointer"
              >
                Google Fonts Library
              </button>
            </div>

            <label className="flex flex-col gap-1">
              <span className="text-[10px] text-[#8F8C84]">Font Family</span>
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
                <span className="text-[10px] text-[#8F8C84]">Size (pt)</span>
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
                <span className="text-[10px] text-[#8F8C84]">Weight</span>
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
                <span className="text-[10px] text-[#8F8C84]">Colour</span>
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
                <span className="text-[10px] text-[#8F8C84]">Leading</span>
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
                <span className="text-[10px] text-[#8F8C84]">Track (em)</span>
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
                <span className="text-[10px] text-[#8F8C84]">Columns</span>
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
                <span className="text-[10px] text-[#8F8C84]">Paragraph Gap (mm)</span>
                <input
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
                <span className="text-[10px] text-[#8F8C84]">Frame Inset (mm)</span>
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

            <label className="flex flex-col gap-1">
              <span className="text-[10px] text-[#8F8C84]">Editorial Copy (Frame-Locked)</span>
              <textarea
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
            {effectiveDpi !== null && (
              <span
                className={`font-mono-tabular text-[10px] ${
                  effectiveDpi < 150
                    ? 'text-[#E07A5F]'
                    : effectiveDpi < 240
                      ? 'text-[#D4A657]'
                      : 'text-[#8AA678]'
                }`}
              >
                {effectiveDpi} DPI
              </span>
            )}
          </div>

          {effectiveDpi !== null && effectiveDpi < 180 && (
            <div className="p-2 bg-[#2B1F16] border border-[#D4A657]/40 rounded text-[10px] text-[#E6C790] flex items-start gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>Effective resolution ({effectiveDpi} DPI) is below 300 DPI print target.</span>
            </div>
          )}

          {/* Non-destructive Replace from Project Library */}
          <label className="flex flex-col gap-1">
            <span className="text-[10px] text-[#8F8C84]">Replace Image (Preserves Frame & Crop)</span>
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
            <div className="flex justify-between text-[10px] text-[#8F8C84]">
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
              <span className="text-[10px] text-[#8F8C84]">Focal X ({el.image.focalX}%)</span>
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
              <span className="text-[10px] text-[#8F8C84]">Focal Y ({el.image.focalY}%)</span>
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

          {/* Tonal Treatments */}
          <div className="space-y-2 pt-2 border-t border-white/[0.06]">
            <span className="text-[10px] text-[#8F8C84]">Tonal Treatment</span>
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-0.5">
                <span className="text-[10px] text-[#8F8C84]">Grayscale ({el.image.grayscale || 0}%)</span>
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
                <span className="text-[10px] text-[#8F8C84]">Contrast ({el.image.contrast ?? 100}%)</span>
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

          <button
            onClick={() =>
              onUpdateElement(activePage.id, el.id, {
                image: {
                  ...el.image!,
                  zoom: el.image!.originalCrop?.zoom ?? 1,
                  focalX: el.image!.originalCrop?.focalX ?? 50,
                  focalY: el.image!.originalCrop?.focalY ?? 50,
                  fit: el.image!.originalCrop?.fit ?? 'cover',
                  grayscale: 0,
                  sepia: 0,
                  contrast: 100,
                  brightness: 100,
                },
              })
            }
            className="w-full py-1.5 text-[11px] bg-[#24242A] hover:bg-[#2F2F37] text-[#D7D4CC] rounded flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <RotateCcw className="w-3 h-3" />
            <span>Restore Original Crop & Tone</span>
          </button>
          <p className="text-[10px] text-[#7F7C75] flex items-center gap-1">
            <Crop className="w-3 h-3 shrink-0" />
            <span>Double-click image on canvas to pan crop interactively.</span>
          </p>
        </div>
      )}

      {/* SHAPE & LINE PROPERTIES */}
      {(el.type === 'shape' || el.type === 'line' || el.type === 'decorative') && el.shape && (
        <div className="space-y-3 pt-3 border-t border-white/[0.08]">
          <div className="text-[11px] font-medium text-[#D7D4CC]">Shape & Stroke</div>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] text-[#8F8C84]">Fill</span>
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
                  className="text-[10px] text-[#8F8C84] hover:text-white cursor-pointer"
                >
                  None
                </button>
              </div>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] text-[#8F8C84]">Stroke</span>
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
              <span className="text-[10px] text-[#8F8C84]">Stroke Width (mm)</span>
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
              <span className="text-[10px] text-[#8F8C84]">Corner Radius (mm)</span>
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
            <button
              onClick={onOpenInfographicsModal}
              className="text-[10px] text-[#C6A26B] hover:underline cursor-pointer"
            >
              Browse 52 Templates
            </button>
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-[10px] text-[#8F8C84]">Title</span>
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
            <span className="text-[10px] text-[#8F8C84]">Subtitle</span>
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
                <span className="text-[9px] text-[#8F8C84]">{lbl}</span>
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

          {/* Data Rows */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-[#8F8C84]">
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
                className="text-[10px] text-[#C6A26B] hover:text-[#DFC08E] flex items-center gap-0.5 cursor-pointer"
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
                      className="flex-1 bg-[#1C1C20] px-1.5 py-0.5 text-[10px] text-[#ECEAE4] rounded"
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
                      className="w-14 bg-[#1C1C20] px-1.5 py-0.5 font-mono-tabular text-[10px] text-[#C6A26B] rounded"
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
                      className="w-9 bg-[#1C1C20] px-1 py-0.5 text-[10px] text-[#98958D] rounded"
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
                    className="w-full bg-transparent text-[10px] text-[#8F8C84] focus:bg-[#1C1C20] focus:text-white px-1 py-0.5 rounded focus:outline-none"
                  />
                </div>
              ))}
            </div>
          </div>

          <button
            onClick={() => onSaveInfographicAsTemplate(el)}
            className="w-full py-1.5 px-2.5 bg-[#24242A] hover:bg-[#303038] text-[11px] text-[#ECEAE4] rounded flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <BookmarkPlus className="w-3.5 h-3.5 text-[#C6A26B]" />
            <span>Save Infographic to My Templates</span>
          </button>
        </div>
      )}
      </div>
    </aside>
  );
};
