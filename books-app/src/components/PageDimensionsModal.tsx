import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeftRight,
  Check,
  Plus,
  RotateCcw,
  RotateCw,
  X,
} from 'lucide-react';
import type {
  BindingType,
  BookPage,
  BookProject,
  DimensionPreset,
  MeasurementUnit,
  PageDimensions,
  PageRotation,
  PrintSettings,
  ResizeStrategy,
} from '../types/bookstudio';
import {
  BINDING_LABELS,
  BUILTIN_DIMENSION_PRESETS,
  calculateSpineWidthMm,
  formatMeasurement,
  formatNumericValue,
  getEffectivePageDimensions,
  inferOrientation,
  PAPER_STOCK_SPECS,
  rotatePageContentElements,
  transformPageElementsForResize,
  unitToMm,
} from '../engines/dimensionEngine';

interface PageDimensionsModalProps {
  project: BookProject;
  activePage: BookPage;
  canvasViewRotation: PageRotation;
  onRotateCanvasView: (dir: 'cw' | 'ccw') => void;
  onUpdateProject: (updated: BookProject) => void;
  onClose: () => void;
}

const UNITS: MeasurementUnit[] = ['mm', 'in', 'cm', 'pt', 'px'];

export const PageDimensionsModal: React.FC<PageDimensionsModalProps> = ({
  project,
  activePage,
  canvasViewRotation,
  onRotateCanvasView,
  onUpdateProject,
  onClose,
}) => {
  const [scope, setScope] = useState<'book' | 'active_page'>('book');
  const [unit, setUnit] = useState<MeasurementUnit>(project.unit);
  const [strategy, setStrategy] = useState<ResizeStrategy>('reflow');
  const [customPresetName, setCustomPresetName] = useState('');

  const initialDim =
    scope === 'active_page'
      ? getEffectivePageDimensions(activePage, project.dimensions)
      : project.dimensions;

  const [draftDim, setDraftDim] = useState<PageDimensions>(structuredClone(initialDim));
  const [draftPrint, setDraftPrint] = useState<PrintSettings>(
    structuredClone(project.printSettings)
  );

  const handleScopeSwitch = (nextScope: 'book' | 'active_page') => {
    setScope(nextScope);
    const base =
      nextScope === 'active_page'
        ? getEffectivePageDimensions(activePage, project.dimensions)
        : project.dimensions;
    setDraftDim(structuredClone(base));
  };

  const allPresets = useMemo(
    () => [...BUILTIN_DIMENSION_PRESETS, ...(project.customDimensionPresets || [])],
    [project.customDimensionPresets]
  );

  const spineInfo = useMemo(
    () => calculateSpineWidthMm(project.pages.length, draftPrint),
    [project.pages.length, draftPrint]
  );

  const mixedFormatCount = useMemo(
    () => project.pages.filter((p) => Boolean(p.dimensionsOverride)).length,
    [project.pages]
  );

  const setDimMm = (field: 'widthMm' | 'heightMm' | 'gutterMm' | 'bleedMm' | 'safeAreaMm' | 'columnGapMm' | 'baselineGridMm', mm: number) => {
    const clean = Math.max(0, Number(mm.toFixed(2)));
    setDraftDim((prev) => {
      const next = { ...prev, [field]: clean };
      if (field === 'widthMm' || field === 'heightMm') {
        next.orientation = inferOrientation(next.widthMm, next.heightMm);
      }
      return next;
    });
  };

  const setMarginMm = (side: 'top' | 'bottom' | 'inner' | 'outer', mm: number) => {
    setDraftDim((prev) => ({
      ...prev,
      margins: { ...prev.margins, [side]: Math.max(0, Number(mm.toFixed(2))) },
    }));
  };

  const applyPreset = (preset: DimensionPreset) => {
    setDraftDim((prev) => ({
      ...prev,
      widthMm: preset.widthMm,
      heightMm: preset.heightMm,
      orientation: inferOrientation(preset.widthMm, preset.heightMm),
      presetName: preset.name,
    }));
  };

  const handleSwapPhysicalOrientation = () => {
    setDraftDim((prev) => ({
      ...prev,
      widthMm: prev.heightMm,
      heightMm: prev.widthMm,
      orientation: inferOrientation(prev.heightMm, prev.widthMm),
    }));
  };

  const handleRotatePageContentNow = (dir: 'cw' | 'ccw') => {
    const dim = getEffectivePageDimensions(activePage, project.dimensions);
    const rotated = rotatePageContentElements(activePage.elements, dim, dir);
    onUpdateProject({
      ...project,
      pages: project.pages.map((p) => (p.id === activePage.id ? { ...p, elements: rotated } : p)),
    });
  };

  const handleSaveCustomPreset = () => {
    if (!customPresetName.trim()) return;
    const preset: DimensionPreset = {
      id: `cust_dim_${Date.now()}`,
      name: `${customPresetName.trim()} (${Math.round(draftDim.widthMm)} × ${Math.round(draftDim.heightMm)} mm)`,
      widthMm: draftDim.widthMm,
      heightMm: draftDim.heightMm,
      orientation: inferOrientation(draftDim.widthMm, draftDim.heightMm),
      category: 'custom',
    };
    onUpdateProject({
      ...project,
      customDimensionPresets: [...(project.customDimensionPresets || []), preset],
    });
    setCustomPresetName('');
  };

  const handleClearMixedFormatOverride = () => {
    const oldDim = getEffectivePageDimensions(activePage, project.dimensions);
    const updatedPages = project.pages.map((p) => {
      if (p.id !== activePage.id) return p;
      return {
        ...p,
        dimensionsOverride: null,
        elements: transformPageElementsForResize(p.elements, oldDim, project.dimensions, strategy),
      };
    });
    onUpdateProject({ ...project, unit, printSettings: draftPrint, pages: updatedPages });
    onClose();
  };

  const handleApplyChanges = () => {
    const finalDim: PageDimensions = {
      ...draftDim,
      widthMm: Math.max(60, draftDim.widthMm),
      heightMm: Math.max(60, draftDim.heightMm),
      orientation: inferOrientation(draftDim.widthMm, draftDim.heightMm),
    };

    if (scope === 'active_page') {
      const oldDim = getEffectivePageDimensions(activePage, project.dimensions);
      const updatedPages = project.pages.map((p) => {
        if (p.id !== activePage.id) return p;
        return {
          ...p,
          dimensionsOverride: finalDim,
          elements: transformPageElementsForResize(p.elements, oldDim, finalDim, strategy),
        };
      });
      onUpdateProject({
        ...project,
        unit,
        printSettings: draftPrint,
        pages: updatedPages,
      });
    } else {
      const oldBookDim = project.dimensions;
      const updatedPages = project.pages.map((p) => {
        if (p.dimensionsOverride) return p; // preserve explicit mixed-format overrides
        return {
          ...p,
          elements: transformPageElementsForResize(p.elements, oldBookDim, finalDim, strategy),
        };
      });
      onUpdateProject({
        ...project,
        unit,
        dimensions: finalDim,
        designSystem: {
          ...project.designSystem,
          grid: {
            columns: finalDim.columns,
            gutterMm: finalDim.columnGapMm,
            margins: finalDim.margins,
          },
        },
        printSettings: draftPrint,
        pages: updatedPages,
      });
    }
    onClose();
  };

  // Before / After visual preview dimensions (normalized to fit 110px box)
  const beforeDim =
    scope === 'active_page'
      ? getEffectivePageDimensions(activePage, project.dimensions)
      : project.dimensions;
  const maxRef = Math.max(beforeDim.widthMm, beforeDim.heightMm, draftDim.widthMm, draftDim.heightMm, 1);
  const previewScale = 86 / maxRef;

  const numBox = (label: string, mmVal: number, onMm: (mm: number) => void, step = 1) => (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] text-[#98958D]">
        {label} ({unit})
      </span>
      <input
        type="number"
        step={step}
        value={formatNumericValue(mmVal, unit)}
        onChange={(e) => {
          const val = parseFloat(e.target.value);
          if (!Number.isNaN(val)) onMm(unitToMm(val, unit));
        }}
        className="bg-[#121214] border border-white/[0.1] rounded px-2 py-1.5 font-mono-tabular text-xs text-[#ECEAE4]"
      />
    </label>
  );

  return (
    <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
      <div className="w-full max-w-5xl max-h-[90vh] bg-[#18181B] border border-white/[0.1] rounded-lg flex flex-col overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="px-6 py-4 border-b border-white/[0.08] flex items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-lg font-medium text-[#F4F1EA]">
              Page Dimensions, Mixed-Format Layout & Print Production
            </h2>
            <p className="text-[11px] text-[#98958D]">
              Physical trim geometry stored in millimetres — convert display units freely without altering actual print size.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-[#98958D] hover:text-white rounded cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scope & Unit Switcher Strip */}
        <div className="px-6 py-3 border-b border-white/[0.08] bg-[#141417] flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => handleScopeSwitch('book')}
              className={`px-3 py-1.5 text-xs rounded cursor-pointer ${
                scope === 'book'
                  ? 'bg-[#C6A26B] text-[#121214] font-medium'
                  : 'bg-[#222228] text-[#A19E95] hover:text-white'
              }`}
            >
              Entire Book Default
            </button>
            <button
              onClick={() => handleScopeSwitch('active_page')}
              className={`px-3 py-1.5 text-xs rounded cursor-pointer ${
                scope === 'active_page'
                  ? 'bg-[#C6A26B] text-[#121214] font-medium'
                  : 'bg-[#222228] text-[#A19E95] hover:text-white'
              }`}
            >
              Selected Page Only ({activePage.label} — Mixed-Format / Foldout)
            </button>
          </div>

          <div className="flex items-center gap-1 bg-[#121214] border border-white/[0.08] rounded p-0.5">
            {UNITS.map((u) => (
              <button
                key={u}
                onClick={() => setUnit(u)}
                className={`px-2.5 py-1 text-[11px] font-mono-tabular rounded cursor-pointer ${
                  unit === u
                    ? 'bg-[#28282F] text-[#ECEAE4]'
                    : 'text-[#8F8C84] hover:text-white'
                }`}
              >
                {u}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {(mixedFormatCount > 0 || scope === 'active_page') && (
            <div className="p-3 bg-[#242018] border border-[#C6A26B]/40 rounded text-xs text-[#E8D2A9] flex items-start justify-between gap-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-[#C6A26B] shrink-0 mt-0.5" />
                <span>
                  Mixed-format publication support active ({mixedFormatCount} custom-sized page
                  {mixedFormatCount === 1 ? '' : 's'}). Confirm foldout scoring, tip-in inserts, or gatefold finishing specifications with your bindery.
                </span>
              </div>
              {scope === 'active_page' && activePage.dimensionsOverride && (
                <button
                  onClick={handleClearMixedFormatOverride}
                  className="px-2.5 py-1 bg-[#342E22] hover:bg-[#443C2C] text-[11px] text-[#F4E3C2] rounded shrink-0 cursor-pointer"
                >
                  Revert to Book Size
                </button>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Left Column: Trim Size, Presets, Margins & Guides */}
            <div className="space-y-4">
              <div className="p-4 bg-[#141417] border border-white/[0.08] rounded-md space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-[#F4F1EA]">
                    Trim Size & Presets
                  </span>
                  <span className="font-mono-tabular text-[11px] text-[#C6A26B]">
                    Spread: {formatMeasurement(draftDim.widthMm * 2, unit)} ×{' '}
                    {formatMeasurement(draftDim.heightMm, unit)}
                  </span>
                </div>

                <select
                  value=""
                  onChange={(e) => {
                    const found = allPresets.find((p) => p.id === e.target.value);
                    if (found) applyPreset(found);
                  }}
                  className="w-full bg-[#121214] border border-white/[0.1] rounded px-2.5 py-1.5 text-xs text-[#ECEAE4]"
                >
                  <option value="">Choose a standard or coffee table preset...</option>
                  {allPresets.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>

                <div className="grid grid-cols-2 gap-3">
                  {numBox('Trim Width', draftDim.widthMm, (mm) => setDimMm('widthMm', mm))}
                  {numBox('Trim Height', draftDim.heightMm, (mm) => setDimMm('heightMm', mm))}
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <input
                    type="text"
                    value={customPresetName}
                    onChange={(e) => setCustomPresetName(e.target.value)}
                    placeholder="Save current size as custom preset..."
                    className="flex-1 bg-[#121214] border border-white/[0.1] rounded px-2.5 py-1 text-xs text-[#ECEAE4]"
                  />
                  <button
                    onClick={handleSaveCustomPreset}
                    className="px-2.5 py-1 bg-[#26262C] hover:bg-[#32323B] text-xs text-[#ECEAE4] rounded flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="w-3 h-3" />
                    <span>Save Preset</span>
                  </button>
                </div>
              </div>

              {/* Margins, Bleed, Gutter & Grid */}
              <div className="p-4 bg-[#141417] border border-white/[0.08] rounded-md space-y-3">
                <div className="text-xs font-semibold text-[#F4F1EA]">
                  Margins, Bleed, Gutter & Baseline Grid
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {numBox('Top', draftDim.margins.top, (mm) => setMarginMm('top', mm), 0.5)}
                  {numBox('Bottom', draftDim.margins.bottom, (mm) => setMarginMm('bottom', mm), 0.5)}
                  {numBox('Inner', draftDim.margins.inner, (mm) => setMarginMm('inner', mm), 0.5)}
                  {numBox('Outer', draftDim.margins.outer, (mm) => setMarginMm('outer', mm), 0.5)}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {numBox('Bleed', draftDim.bleedMm, (mm) => setDimMm('bleedMm', mm), 0.5)}
                  {numBox('Safe Area', draftDim.safeAreaMm, (mm) => setDimMm('safeAreaMm', mm), 0.5)}
                  {numBox('Gutter', draftDim.gutterMm, (mm) => setDimMm('gutterMm', mm), 0.5)}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <label className="flex flex-col gap-1">
                    <span className="text-[10px] text-[#98958D]">Columns</span>
                    <input
                      type="number"
                      min={1}
                      max={6}
                      value={draftDim.columns}
                      onChange={(e) =>
                        setDraftDim((prev) => ({
                          ...prev,
                          columns: Math.max(1, Math.min(6, Number(e.target.value) || 2)),
                        }))
                      }
                      className="bg-[#121214] border border-white/[0.1] rounded px-2 py-1.5 font-mono-tabular text-xs text-[#ECEAE4]"
                    />
                  </label>
                  {numBox('Col Gap', draftDim.columnGapMm, (mm) => setDimMm('columnGapMm', mm), 0.5)}
                  {numBox(
                    'Baseline',
                    draftDim.baselineGridMm,
                    (mm) => setDimMm('baselineGridMm', mm),
                    0.5
                  )}
                </div>
              </div>
            </div>

            {/* Right Column: Separate Rotation Controls, Resize Strategy & Print/Spine Calculator */}
            <div className="space-y-4">
              {/* Explicitly Separated Rotation vs Orientation Controls */}
              <div className="p-4 bg-[#141417] border border-white/[0.08] rounded-md space-y-3">
                <div className="text-xs font-semibold text-[#F4F1EA]">
                  View Rotation vs. Content Rotation vs. Physical Orientation
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <div className="p-2.5 bg-[#1B1B20] rounded border border-white/[0.06] space-y-1.5">
                    <div className="text-[10px] text-[#98958D]">1. Canvas View Only</div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => onRotateCanvasView('ccw')}
                        className="flex-1 py-1 bg-[#26262D] hover:bg-[#32323B] rounded flex justify-center cursor-pointer"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                      </button>
                      <span className="font-mono-tabular text-[11px] px-1 text-[#C6A26B]">
                        {canvasViewRotation}°
                      </span>
                      <button
                        onClick={() => onRotateCanvasView('cw')}
                        className="flex-1 py-1 bg-[#26262D] hover:bg-[#32323B] rounded flex justify-center cursor-pointer"
                      >
                        <RotateCw className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="p-2.5 bg-[#1B1B20] rounded border border-white/[0.06] space-y-1.5">
                    <div className="text-[10px] text-[#98958D]">2. Rotate Page Content</div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleRotatePageContentNow('ccw')}
                        className="flex-1 py-1 bg-[#26262D] hover:bg-[#32323B] text-[10px] rounded cursor-pointer"
                      >
                        -90°
                      </button>
                      <button
                        onClick={() => handleRotatePageContentNow('cw')}
                        className="flex-1 py-1 bg-[#26262D] hover:bg-[#32323B] text-[10px] rounded cursor-pointer"
                      >
                        +90°
                      </button>
                    </div>
                  </div>

                  <div className="p-2.5 bg-[#1B1B20] rounded border border-white/[0.06] space-y-1.5">
                    <div className="text-[10px] text-[#98958D]">3. Physical Orientation</div>
                    <button
                      onClick={handleSwapPhysicalOrientation}
                      className="w-full py-1 bg-[#26262D] hover:bg-[#32323B] text-[11px] text-[#ECEAE4] rounded flex items-center justify-center gap-1 cursor-pointer"
                    >
                      <ArrowLeftRight className="w-3 h-3 text-[#C6A26B]" />
                      <span className="capitalize">{draftDim.orientation}</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* 3 Non-Destructive Resize Strategies + Before/After Preview */}
              <div className="p-4 bg-[#141417] border border-white/[0.08] rounded-md space-y-3">
                <div className="text-xs font-semibold text-[#F4F1EA]">
                  Non-Destructive Resize Strategy & Before / After Preview
                </div>

                <div className="grid grid-cols-3 gap-1.5">
                  {(
                    [
                      ['reflow', 'Reflow Layout', 'Preserve type scale, remap to new margins'],
                      ['scale', 'Scale Layout', 'Proportionally scale frames & typography'],
                      ['preserve', 'Preserve Original', 'Keep coordinates untouched for manual refinement'],
                    ] as const
                  ).map(([id, title, desc]) => (
                    <button
                      key={id}
                      onClick={() => setStrategy(id)}
                      className={`p-2 text-left rounded border cursor-pointer ${
                        strategy === id
                          ? 'bg-[#2A261F] border-[#C6A26B] text-[#F4F1EA]'
                          : 'bg-[#1B1B20] border-white/[0.06] text-[#98958D]'
                      }`}
                    >
                      <div className="text-[11px] font-medium">{title}</div>
                      <div className="text-[9px] mt-0.5 leading-snug opacity-80">{desc}</div>
                    </button>
                  ))}
                </div>

                <div className="flex items-center justify-around py-3 bg-[#101012] rounded border border-white/[0.05]">
                  <div className="flex flex-col items-center gap-1.5">
                    <div
                      style={{
                        width: `${Math.round(beforeDim.widthMm * previewScale)}px`,
                        height: `${Math.round(beforeDim.heightMm * previewScale)}px`,
                      }}
                      className="bg-[#ECE8DF] border border-white/25 relative"
                    >
                      <div className="absolute inset-2 border border-dashed border-[#56A8D8]/70" />
                    </div>
                    <span className="font-mono-tabular text-[10px] text-[#98958D]">
                      Before: {formatMeasurement(beforeDim.widthMm, unit, 0)} ×{' '}
                      {formatMeasurement(beforeDim.heightMm, unit, 0)}
                    </span>
                  </div>
                  <span className="text-[#C6A26B] text-sm">→</span>
                  <div className="flex flex-col items-center gap-1.5">
                    <div
                      style={{
                        width: `${Math.round(draftDim.widthMm * previewScale)}px`,
                        height: `${Math.round(draftDim.heightMm * previewScale)}px`,
                      }}
                      className="bg-[#FBF9F5] border border-[#C6A26B] relative"
                    >
                      <div className="absolute inset-2 border border-dashed border-[#C6A26B]/80" />
                    </div>
                    <span className="font-mono-tabular text-[10px] text-[#ECEAE4]">
                      After: {formatMeasurement(draftDim.widthMm, unit, 0)} ×{' '}
                      {formatMeasurement(draftDim.heightMm, unit, 0)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Print Production & Printer-Spec Spine Width Calculator */}
              <div className="p-4 bg-[#141417] border border-white/[0.08] rounded-md space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-[#F4F1EA]">
                    Print Production & Spine Width Calculator
                  </span>
                  <span className="font-mono-tabular text-xs font-semibold text-[#C6A26B]">
                    Spine: {formatMeasurement(spineInfo.spineMm, unit)}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <label className="flex flex-col gap-1">
                    <span className="text-[10px] text-[#98958D]">Binding Type</span>
                    <select
                      value={draftPrint.bindingType}
                      onChange={(e) =>
                        setDraftPrint({ ...draftPrint, bindingType: e.target.value as BindingType })
                      }
                      className="bg-[#121214] border border-white/[0.1] rounded px-2 py-1.5 text-xs text-[#ECEAE4]"
                    >
                      {Object.entries(BINDING_LABELS).map(([k, lbl]) => (
                        <option key={k} value={k}>
                          {lbl}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="flex flex-col gap-1">
                    <span className="text-[10px] text-[#98958D]">Paper Stock Preset</span>
                    <select
                      value={draftPrint.paperStockName}
                      onChange={(e) => {
                        const spec = PAPER_STOCK_SPECS.find((s) => s.name === e.target.value);
                        setDraftPrint({
                          ...draftPrint,
                          paperStockName: e.target.value,
                          paperCaliperMm: spec ? spec.caliperMm : draftPrint.paperCaliperMm,
                        });
                      }}
                      className="bg-[#121214] border border-white/[0.1] rounded px-2 py-1.5 text-xs text-[#ECEAE4]"
                    >
                      {PAPER_STOCK_SPECS.map((s) => (
                        <option key={s.name} value={s.name}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <label className="flex flex-col gap-1">
                    <span className="text-[10px] text-[#98958D]">Paper Caliper (mm/sheet)</span>
                    <input
                      type="number"
                      step={0.005}
                      min={0.05}
                      value={draftPrint.paperCaliperMm}
                      onChange={(e) =>
                        setDraftPrint({
                          ...draftPrint,
                          paperCaliperMm: parseFloat(e.target.value) || 0.14,
                        })
                      }
                      className="bg-[#121214] border border-white/[0.1] rounded px-2 py-1 font-mono-tabular text-xs text-[#ECEAE4]"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-[10px] text-[#98958D]">Cover Board (mm)</span>
                    <input
                      type="number"
                      step={0.1}
                      min={0}
                      value={draftPrint.coverBoardCaliperMm}
                      onChange={(e) =>
                        setDraftPrint({
                          ...draftPrint,
                          coverBoardCaliperMm: parseFloat(e.target.value) || 0,
                        })
                      }
                      className="bg-[#121214] border border-white/[0.1] rounded px-2 py-1 font-mono-tabular text-xs text-[#ECEAE4]"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-[10px] text-[#98958D]">Glue Tolerance (mm)</span>
                    <input
                      type="number"
                      step={0.1}
                      min={0}
                      value={draftPrint.printerToleranceMm}
                      onChange={(e) =>
                        setDraftPrint({
                          ...draftPrint,
                          printerToleranceMm: parseFloat(e.target.value) || 0,
                        })
                      }
                      className="bg-[#121214] border border-white/[0.1] rounded px-2 py-1 font-mono-tabular text-xs text-[#ECEAE4]"
                    />
                  </label>
                </div>

                <div className="text-[10px] text-[#98958D] font-mono-tabular">
                  {project.pages.length} pages · Text block {spineInfo.textBlockMm} mm · Boards{' '}
                  {spineInfo.boardsMm} mm · Tolerance {draftPrint.printerToleranceMm} mm
                </div>
                {spineInfo.warning && (
                  <div className="text-[11px] text-[#E6C790]">{spineInfo.warning}</div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-white/[0.08] bg-[#141417] flex items-center justify-between">
          <span className="text-[11px] text-[#8F8C84]">
            All resize actions are non-destructive and fully reversible via Undo or Version History.
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3.5 py-2 text-xs text-[#A19E95] hover:text-white cursor-pointer"
            >
              Cancel
            </button>
            <button
              onClick={handleApplyChanges}
              className="px-4 py-2 bg-[#C6A26B] hover:bg-[#D5B47F] text-[#121214] text-xs font-medium rounded flex items-center gap-1.5 cursor-pointer"
            >
              <Check className="w-3.5 h-3.5" />
              <span>
                {scope === 'active_page'
                  ? `Apply Custom Size to ${activePage.label}`
                  : 'Apply Dimensions & Production Specs'}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
