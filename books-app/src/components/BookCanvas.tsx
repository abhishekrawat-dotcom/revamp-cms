import React, { useMemo, useRef, useState } from 'react';
import { AlertTriangle, Crop, Hand, RotateCw } from 'lucide-react';
import type {
  BookElement,
  BookPage,
  BookProject,
  ImageAsset,
  InDesignTool,
  PageDimensions,
  PageRotation,
} from '../types/bookstudio';
import { formatMeasurement, getEffectivePageDimensions, mmToUnit } from '../engines/dimensionEngine';
import { renderInfographicToSvgString } from '../engines/infographicEngine';
import { measureTextOverflow } from '../engines/textEngine';
import type { ComponentDragKind } from './LeftSidebar';

const BASE_PX_PER_MM = 2.05; // crisp desktop viewing scale at 100% zoom

interface BookCanvasProps {
  project: BookProject;
  visiblePages: Array<{ page: BookPage; pageNumber: number; side: 'single' | 'left' | 'right' }>;
  activePageId: string;
  selectedElementIds: string[];
  zoom: number;
  canvasViewRotation: PageRotation;
  showGuides: boolean;
  showRulers: boolean;
  snapToGrid: boolean;
  snapToObjects: boolean;
  previewMode: boolean;
  activeTool: InDesignTool;
  /** false for a Content editor: frames are selected and their words and photos edited, never moved, resized,
      rotated or drawn (the design's) */
  canDesign: boolean;
  onSelectPage: (pageId: string) => void;
  onSelectElements: (pageId: string, ids: string[]) => void;
  onUpdateElement: (
    pageId: string,
    elementId: string,
    patch: Partial<BookElement>,
    commitHistory?: boolean
  ) => void;
  onDropComponent: (pageId: string, kind: ComponentDragKind, xMm: number, yMm: number) => void;
  onDropImageOnPage: (
    pageId: string,
    asset: ImageAsset,
    xMm: number,
    yMm: number,
    targetElementId?: string
  ) => void;
  onCreateDrawnElement: (
    pageId: string,
    tool: InDesignTool,
    rectMm: { xMm: number; yMm: number; widthMm: number; heightMm: number }
  ) => void;
  onZoomStep: (delta: number) => void;
  onSelectTool: (tool: InDesignTool) => void;
  onRotateCanvasView: (dir: 'cw' | 'ccw') => void;
  onToggleSnapGrid: () => void;
  onToggleSnapObjects: () => void;
  onExitPreview: () => void;
}

interface SnapLine {
  pageId: string;
  axis: 'x' | 'y';
  posMm: number;
}

interface DrawDraft {
  pageId: string;
  tool: InDesignTool;
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
}

const DRAW_TOOLS = new Set<InDesignTool>([
  'type',
  'frame_image',
  'rect',
  'ellipse',
  'line',
  'infographic',
]);

export const BookCanvas: React.FC<BookCanvasProps> = ({
  project,
  visiblePages,
  activePageId,
  selectedElementIds,
  zoom,
  canvasViewRotation,
  showGuides,
  showRulers,
  snapToGrid,
  snapToObjects,
  previewMode,
  activeTool,
  canDesign,
  onSelectPage,
  onSelectElements,
  onUpdateElement,
  onDropComponent,
  onDropImageOnPage,
  onCreateDrawnElement,
  onZoomStep,
  onSelectTool,
  onRotateCanvasView,
  onToggleSnapGrid,
  onToggleSnapObjects,
  onExitPreview,
}) => {
  const pxPerMm = BASE_PX_PER_MM * zoom;
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [croppingImageId, setCroppingImageId] = useState<string | null>(null);
  const [panMode, setPanMode] = useState(false);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [snapLines, setSnapLines] = useState<SnapLine[]>([]);
  const [drawDraft, setDrawDraft] = useState<DrawDraft | null>(null);
  const [dragHud, setDragHud] = useState<{ xMm: number; yMm: number; wMm: number; hMm: number } | null>(
    null
  );
  const viewportRef = useRef<HTMLDivElement>(null);

  const isPanActive = panMode || activeTool === 'hand';
  const isDrawTool = canDesign && DRAW_TOOLS.has(activeTool);
  /* a locked frame stays put for a Designer; for a Content editor nothing moves anyway, so its words and photo can
     still be edited */
  const isFrozen = (el: BookElement) => el.locked && canDesign;

  const handleViewportMouseDown = (e: React.MouseEvent) => {
    if (activeTool === 'zoom' && !previewMode) {
      e.preventDefault();
      onZoomStep(e.altKey || e.shiftKey ? -0.15 : 0.15);
      return;
    }
    if (isPanActive || e.button === 1) {
      e.preventDefault();
      const startX = e.clientX - panOffset.x;
      const startY = e.clientY - panOffset.y;
      const onMove = (me: MouseEvent) => {
        setPanOffset({ x: me.clientX - startX, y: me.clientY - startY });
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      return;
    }
    if (e.target === e.currentTarget) {
      onSelectElements(activePageId, []);
      setEditingTextId(null);
      setCroppingImageId(null);
    }
  };

  const handlePageMouseDown = (e: React.MouseEvent<HTMLDivElement>, page: BookPage, dim: PageDimensions) => {
    onSelectPage(page.id);
    if (previewMode) return;
    if (activeTool === 'zoom') {
      e.stopPropagation();
      onZoomStep(e.altKey || e.shiftKey ? -0.15 : 0.15);
      return;
    }
    if (isPanActive || e.button === 1) return;

    if (isDrawTool && e.button === 0) {
      e.stopPropagation();
      e.preventDefault();
      const rect = e.currentTarget.getBoundingClientRect();
      const startXMm = Math.max(0, Math.min(dim.widthMm, (e.clientX - rect.left) / pxPerMm));
      const startYMm = Math.max(0, Math.min(dim.heightMm, (e.clientY - rect.top) / pxPerMm));
      let currentRect = { xMm: startXMm, yMm: startYMm, widthMm: 0, heightMm: 0 };
      setDrawDraft({ pageId: page.id, tool: activeTool, ...currentRect });

      const onMove = (me: MouseEvent) => {
        const curX = Math.max(0, Math.min(dim.widthMm, (me.clientX - rect.left) / pxPerMm));
        const curY = Math.max(0, Math.min(dim.heightMm, (me.clientY - rect.top) / pxPerMm));
        const xMm = Number(Math.min(startXMm, curX).toFixed(1));
        const yMm = Number(Math.min(startYMm, curY).toFixed(1));
        const widthMm = Number(Math.abs(curX - startXMm).toFixed(1));
        const heightMm = Number(
          activeTool === 'line' ? Math.max(2, Math.abs(curY - startYMm)) : Math.abs(curY - startYMm)
        );
        currentRect = { xMm, yMm, widthMm, heightMm };
        setDrawDraft({ pageId: page.id, tool: activeTool, ...currentRect });
        setDragHud({ xMm, yMm, wMm: widthMm, hMm: heightMm });
      };

      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        setDrawDraft(null);
        setDragHud(null);
        const defaultW = activeTool === 'infographic' ? 140 : activeTool === 'line' ? 100 : 88;
        const defaultH = activeTool === 'infographic' ? 92 : activeTool === 'line' ? 2 : 52;
        const finalRect = {
          xMm: currentRect.xMm,
          yMm: currentRect.yMm,
          widthMm: currentRect.widthMm >= 6 ? currentRect.widthMm : defaultW,
          heightMm:
            activeTool === 'line'
              ? 2
              : currentRect.heightMm >= 6
                ? currentRect.heightMm
                : defaultH,
        };
        onCreateDrawnElement(page.id, activeTool, finalRect);
        onSelectTool('select');
      };

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    }
  };

  const startElementDrag = (
    e: React.MouseEvent,
    page: BookPage,
    dim: PageDimensions,
    el: BookElement
  ) => {
    if (previewMode || isFrozen(el) || editingTextId === el.id || isDrawTool || isPanActive || activeTool === 'zoom') return;
    e.stopPropagation();

    // Direct Selection Tool (A): immediately enters text edit or image crop pan
    if (activeTool === 'direct_select') {
      onSelectPage(page.id);
      onSelectElements(page.id, [el.id]);
      if (el.type === 'text' || el.type === 'header' || el.type === 'footer' || el.type === 'logo') {
        setEditingTextId(el.id);
        setCroppingImageId(null);
        return;
      }
      if (el.type === 'image' && el.image) {
        setCroppingImageId(el.id);
        setEditingTextId(null);
      }
    }

    // Crop panning inside fixed image frame
    if ((croppingImageId === el.id || (activeTool === 'direct_select' && el.type === 'image')) && el.type === 'image' && el.image) {
      const startX = e.clientX;
      const startY = e.clientY;
      const origFx = el.image.focalX ?? 50;
      const origFy = el.image.focalY ?? 50;
      const onMove = (me: MouseEvent) => {
        const dxPct = ((me.clientX - startX) / Math.max(20, el.widthMm * pxPerMm)) * 100;
        const dyPct = ((me.clientY - startY) / Math.max(20, el.heightMm * pxPerMm)) * 100;
        onUpdateElement(
          page.id,
          el.id,
          {
            image: {
              ...el.image!,
              focalX: Math.max(0, Math.min(100, Math.round(origFx - dxPct))),
              focalY: Math.max(0, Math.min(100, Math.round(origFy - dyPct))),
            },
          },
          false
        );
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      return;
    }

    onSelectPage(page.id);
    // a Content editor selects a frame (to edit its words, photo or data) but never drags it
    if (!canDesign) {
      onSelectElements(page.id, [el.id]);
      return;
    }
    if (e.shiftKey) {
      const exists = selectedElementIds.includes(el.id);
      onSelectElements(
        page.id,
        exists
          ? selectedElementIds.filter((i) => i !== el.id)
          : [...selectedElementIds, el.id]
      );
    } else if (!selectedElementIds.includes(el.id)) {
      onSelectElements(page.id, [el.id]);
    }

    const startMouseX = e.clientX;
    const startMouseY = e.clientY;
    const startX = el.xMm;
    const startY = el.yMm;
    const otherEls = page.elements.filter((o) => o.id !== el.id && !o.hidden);

    const onMove = (me: MouseEvent) => {
      let nx = startX + (me.clientX - startMouseX) / pxPerMm;
      let ny = startY + (me.clientY - startMouseY) / pxPerMm;
      const activeSnaps: SnapLine[] = [];

      if (snapToGrid) {
        const step = Math.max(1, dim.baselineGridMm || 4);
        nx = Math.round(nx / step) * step;
        ny = Math.round(ny / step) * step;
      }

      if (snapToObjects) {
        const tol = 2.2;
        const snapTargetsX = [
          dim.margins.inner,
          dim.margins.outer,
          dim.widthMm / 2,
          dim.widthMm - dim.margins.outer,
          ...otherEls.flatMap((o) => [o.xMm, o.xMm + o.widthMm / 2, o.xMm + o.widthMm]),
        ];
        const snapTargetsY = [
          dim.margins.top,
          dim.heightMm / 2,
          dim.heightMm - dim.margins.bottom,
          ...otherEls.flatMap((o) => [o.yMm, o.yMm + o.heightMm / 2, o.yMm + o.heightMm]),
        ];

        for (const tx of snapTargetsX) {
          if (Math.abs(nx - tx) < tol) {
            nx = tx;
            activeSnaps.push({ pageId: page.id, axis: 'x', posMm: tx });
            break;
          }
          if (Math.abs(nx + el.widthMm / 2 - tx) < tol) {
            nx = tx - el.widthMm / 2;
            activeSnaps.push({ pageId: page.id, axis: 'x', posMm: tx });
            break;
          }
        }
        for (const ty of snapTargetsY) {
          if (Math.abs(ny - ty) < tol) {
            ny = ty;
            activeSnaps.push({ pageId: page.id, axis: 'y', posMm: ty });
            break;
          }
          if (Math.abs(ny + el.heightMm / 2 - ty) < tol) {
            ny = ty - el.heightMm / 2;
            activeSnaps.push({ pageId: page.id, axis: 'y', posMm: ty });
            break;
          }
        }
      }

      const rx = Number(nx.toFixed(1));
      const ry = Number(ny.toFixed(1));
      setSnapLines(activeSnaps);
      setDragHud({ xMm: rx, yMm: ry, wMm: el.widthMm, hMm: el.heightMm });
      onUpdateElement(
        page.id,
        el.id,
        { xMm: rx, yMm: ry, overriddenFromMaster: el.masterElementId ? true : el.overriddenFromMaster },
        false
      );
    };

    const onUp = () => {
      setSnapLines([]);
      setDragHud(null);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const startResize = (
    e: React.MouseEvent,
    page: BookPage,
    el: BookElement,
    handle: 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'
  ) => {
    if (el.locked || !canDesign) return;
    e.stopPropagation();
    e.preventDefault();
    const startMouseX = e.clientX;
    const startMouseY = e.clientY;
    const { xMm, yMm, widthMm, heightMm } = el;
    const aspect = widthMm / Math.max(1, heightMm);

    const onMove = (me: MouseEvent) => {
      const dx = (me.clientX - startMouseX) / pxPerMm;
      const dy = (me.clientY - startMouseY) / pxPerMm;
      let nx = xMm;
      let ny = yMm;
      let nw = widthMm;
      let nh = heightMm;

      if (handle.includes('e')) nw = Math.max(8, widthMm + dx);
      if (handle.includes('s')) nh = Math.max(6, heightMm + dy);
      if (handle.includes('w')) {
        nw = Math.max(8, widthMm - dx);
        nx = xMm + (widthMm - nw);
      }
      if (handle.includes('n')) {
        nh = Math.max(6, heightMm - dy);
        ny = yMm + (heightMm - nh);
      }
      if (me.shiftKey && handle.length === 2) {
        nh = Math.max(6, nw / aspect);
      }

      const patch = {
        xMm: Number(nx.toFixed(1)),
        yMm: Number(ny.toFixed(1)),
        widthMm: Number(nw.toFixed(1)),
        heightMm: Number(nh.toFixed(1)),
        overriddenFromMaster: el.masterElementId ? true : el.overriddenFromMaster,
      };
      setDragHud({ xMm: patch.xMm, yMm: patch.yMm, wMm: patch.widthMm, hMm: patch.heightMm });
      onUpdateElement(page.id, el.id, patch, false);
    };

    const onUp = () => {
      setDragHud(null);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const startRotate = (e: React.MouseEvent, page: BookPage, el: BookElement) => {
    if (el.locked || !canDesign) return;
    e.stopPropagation();
    e.preventDefault();
    const rect = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const onMove = (me: MouseEvent) => {
      const angle = (Math.atan2(me.clientY - cy, me.clientX - cx) * 180) / Math.PI + 90;
      const snapped = me.shiftKey ? Math.round(angle / 15) * 15 : Math.round(angle);
      onUpdateElement(page.id, el.id, { rotation: (snapped + 360) % 360 }, false);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const spreadSummary = useMemo(() => {
    const totalW = visiblePages.reduce(
      (sum, vp) => sum + getEffectivePageDimensions(vp.page, project.dimensions).widthMm,
      0
    );
    const maxH = Math.max(
      ...visiblePages.map((vp) => getEffectivePageDimensions(vp.page, project.dimensions).heightMm)
    );
    return `${formatMeasurement(totalW, project.unit)} × ${formatMeasurement(maxH, project.unit)}`;
  }, [visiblePages, project.dimensions, project.unit]);

  return (
    <main
      ref={viewportRef}
      onMouseDown={handleViewportMouseDown}
      className={`flex-1 relative overflow-auto flex flex-col items-center justify-center bg-[#121214] ${
        isPanActive
          ? 'cursor-grab active:cursor-grabbing'
          : activeTool === 'zoom'
            ? 'cursor-zoom-in'
            : isDrawTool
              ? 'cursor-crosshair'
              : ''
      }`}
      style={{
        backgroundImage: previewMode
          ? 'none'
          : 'radial-gradient(rgba(255,255,255,0.035) 1px, transparent 0)',
        backgroundSize: '20px 20px',
      }}
    >
      {/* Floating Canvas Utility Strip (Hidden in Presentation Preview) */}
      {!previewMode ? (
        <div className="absolute top-2.5 left-3 right-3 z-20 flex items-center justify-between pointer-events-none">
          <div className="pointer-events-auto flex items-center gap-2 bg-[#18181B]/95 border border-white/[0.08] rounded px-2.5 py-1 text-[11px] text-[#A19E95]">
            <span className="font-mono-tabular text-[#ECEAE4]">{spreadSummary}</span>
            <span className="text-white/20">·</span>
            <span>
              Bleed {formatMeasurement(project.dimensions.bleedMm, project.unit)}
            </span>
            <span className="text-white/20">·</span>
            <span>
              Gutter {formatMeasurement(project.dimensions.gutterMm, project.unit)}
            </span>
          </div>

          <div className="pointer-events-auto flex items-center gap-1 bg-[#18181B]/95 border border-white/[0.08] rounded p-0.5 text-[11px]">
            <button
              onClick={() => setPanMode((p) => !p)}
              title="Pan Canvas Tool"
              className={`px-2 py-1 rounded flex items-center gap-1 cursor-pointer ${
                panMode ? 'bg-[#C6A26B] text-[#121214] font-medium' : 'text-[#A19E95] hover:text-white'
              }`}
            >
              <Hand className="w-3 h-3" />
              <span>Pan</span>
            </button>
            <button
              onClick={onToggleSnapGrid}
              title="Snap to Baseline Grid"
              className={`px-2 py-1 rounded cursor-pointer ${
                snapToGrid ? 'bg-[#28282F] text-[#ECEAE4]' : 'text-[#8F8C84] hover:text-white'
              }`}
            >
              Grid Snap
            </button>
            <button
              onClick={onToggleSnapObjects}
              title="Smart Alignment Guides & Object Snap"
              className={`px-2 py-1 rounded cursor-pointer ${
                snapToObjects ? 'bg-[#28282F] text-[#ECEAE4]' : 'text-[#8F8C84] hover:text-white'
              }`}
            >
              Smart Snap
            </button>
            <button
              onClick={() => onRotateCanvasView('cw')}
              title={`Rotate Canvas View Only (Currently ${canvasViewRotation}°) — does not alter physical print geometry`}
              className="px-2 py-1 rounded text-[#A19E95] hover:text-white flex items-center gap-1 cursor-pointer"
            >
              <RotateCw className="w-3 h-3" />
              <span className="font-mono-tabular">{canvasViewRotation}°</span>
            </button>
            {(panOffset.x !== 0 || panOffset.y !== 0) && (
              <button
                onClick={() => setPanOffset({ x: 0, y: 0 })}
                className="px-1.5 py-1 text-[11px] text-[#C6A26B] hover:underline cursor-pointer"
              >
                Center
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="absolute top-4 right-5 z-30">
          <button
            onClick={onExitPreview}
            className="px-3.5 py-1.5 bg-[#18181B]/90 hover:bg-[#232328] border border-white/[0.15] text-xs text-[#ECEAE4] rounded cursor-pointer"
          >
            Exit Preview
          </button>
        </div>
      )}

      {/* Drag Measurement HUD */}
      {dragHud && !previewMode && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-30 bg-[#18181B] border border-[#C6A26B]/50 rounded px-3 py-1 font-mono-tabular text-[11px] text-[#ECEAE4] shadow-lg">
          X {formatMeasurement(dragHud.xMm, project.unit)} · Y{' '}
          {formatMeasurement(dragHud.yMm, project.unit)} · W{' '}
          {formatMeasurement(dragHud.wMm, project.unit)} · H{' '}
          {formatMeasurement(dragHud.hMm, project.unit)}
        </div>
      )}

      {/* Active Crop Mode Banner */}
      {croppingImageId && !previewMode && (
        <div className="absolute top-12 left-1/2 -translate-x-1/2 z-30 bg-[#1C1C20] border border-[#C6A26B]/60 rounded px-3 py-1.5 flex items-center gap-2 text-xs text-[#ECEAE4] shadow-lg">
          <Crop className="w-3.5 h-3.5 text-[#C6A26B]" />
          <span>Crop Mode: Drag inside frame to reposition photograph without moving the frame</span>
          <button
            onClick={() => setCroppingImageId(null)}
            className="ml-2 px-2 py-0.5 bg-[#C6A26B] text-[#121214] rounded text-[11px] font-medium cursor-pointer"
          >
            Done
          </button>
        </div>
      )}

      {/* Spread Stage Container */}
      <div
        className="relative my-14 mx-12 transition-transform duration-150"
        style={{
          transform: `translate(${panOffset.x}px, ${panOffset.y}px) rotate(${canvasViewRotation}deg)`,
        }}
      >
        {/* Physical Horizontal & Vertical Rulers */}
        {showRulers && !previewMode && (
          <>
            <div
              className="absolute -top-6 left-0 right-0 h-5 bg-[#18181B] border-b border-white/[0.1] flex items-end overflow-hidden select-none"
            >
              {Array.from({ length: 40 }).map((_, idx) => {
                const mmVal = idx * 20;
                const leftPx = mmVal * pxPerMm;
                return (
                  <div
                    key={idx}
                    style={{ left: `${leftPx}px` }}
                    className="absolute bottom-0 flex flex-col items-start"
                  >
                    <span className="font-mono-tabular text-[11px] text-[#8F8C84] pl-0.5">
                      {Math.round(mmToUnit(mmVal, project.unit))}
                    </span>
                    <div className="w-px h-2 bg-white/25" />
                  </div>
                );
              })}
            </div>
            <div
              className="absolute top-0 bottom-0 -left-6 w-5 bg-[#18181B] border-r border-white/[0.1] overflow-hidden select-none"
            >
              {Array.from({ length: 30 }).map((_, idx) => {
                const mmVal = idx * 20;
                const topPx = mmVal * pxPerMm;
                return (
                  <div
                    key={idx}
                    style={{ top: `${topPx}px` }}
                    className="absolute right-0 flex items-center"
                  >
                    <span className="font-mono-tabular text-[11px] text-[#8F8C84] pr-0.5 -rotate-90 origin-right">
                      {Math.round(mmToUnit(mmVal, project.unit))}
                    </span>
                    <div className="h-px w-2 bg-white/25" />
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* Facing Pages / Spread Flex Container */}
        <div className="relative flex items-center justify-center shadow-[0_28px_70px_rgba(0,0,0,0.65)]">
          {visiblePages.map(({ page, pageNumber, side }) => {
            const dim = getEffectivePageDimensions(page, project.dimensions);
            const pageW = dim.widthMm * pxPerMm;
            const pageH = dim.heightMm * pxPerMm;
            const bleedPx = dim.bleedMm * pxPerMm;
            const isActivePage = page.id === activePageId;
            const leftMarginMm = side === 'right' ? dim.margins.inner : dim.margins.outer;
            const rightMarginMm = side === 'right' ? dim.margins.outer : dim.margins.inner;
            const contentW = Math.max(10, dim.widthMm - leftMarginMm - rightMarginMm);
            const colW =
              (contentW - dim.columnGapMm * Math.max(0, dim.columns - 1)) /
              Math.max(1, dim.columns);

            return (
              <div
                key={page.id}
                onMouseDown={(e) => handlePageMouseDown(e, page, dim)}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'copy';
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const rect = e.currentTarget.getBoundingClientRect();
                  const dropXMm = Math.max(0, (e.clientX - rect.left) / pxPerMm);
                  const dropYMm = Math.max(0, (e.clientY - rect.top) / pxPerMm);
                  const compKind = e.dataTransfer.getData('application/x-bookstudio-component');
                  if (compKind) {
                    onDropComponent(page.id, compKind as ComponentDragKind, dropXMm, dropYMm);
                    return;
                  }
                  const imgJson = e.dataTransfer.getData('application/x-bookstudio-image');
                  if (imgJson) {
                    try {
                      const asset = JSON.parse(imgJson) as ImageAsset;
                      onDropImageOnPage(page.id, asset, dropXMm, dropYMm);
                    } catch {
                      // ignore
                    }
                  }
                }}
                style={{
                  width: `${pageW}px`,
                  height: `${pageH}px`,
                  backgroundColor: page.backgroundColor || project.designSystem.colors.paper,
                }}
                className={`relative shrink-0 overflow-visible transition-shadow ${
                  isActivePage && !previewMode
                    ? 'ring-1 ring-[#C6A26B]/50'
                    : 'ring-1 ring-black/25'
                }`}
              >
                {/* Bleed Guide Box (Outside Trim) */}
                {showGuides && !previewMode && dim.bleedMm > 0 && (
                  <div
                    style={{
                      top: `-${bleedPx}px`,
                      left: `-${bleedPx}px`,
                      right: `-${bleedPx}px`,
                      bottom: `-${bleedPx}px`,
                    }}
                    className="absolute border border-dashed border-[#E07A5F]/55 pointer-events-none z-20"
                  />
                )}

                {/* Safe Area Guide */}
                {showGuides && !previewMode && dim.safeAreaMm > 0 && (
                  <div
                    style={{
                      top: `${dim.safeAreaMm * pxPerMm}px`,
                      left: `${dim.safeAreaMm * pxPerMm}px`,
                      right: `${dim.safeAreaMm * pxPerMm}px`,
                      bottom: `${dim.safeAreaMm * pxPerMm}px`,
                    }}
                    className="absolute border border-dashed border-[#6AA87E]/40 pointer-events-none z-20"
                  />
                )}

                {/* Margin & Column Guides */}
                {showGuides && !previewMode && (
                  <div
                    style={{
                      top: `${dim.margins.top * pxPerMm}px`,
                      bottom: `${dim.margins.bottom * pxPerMm}px`,
                      left: `${leftMarginMm * pxPerMm}px`,
                      right: `${rightMarginMm * pxPerMm}px`,
                    }}
                    className="absolute border border-[#56A8D8]/45 pointer-events-none z-20 flex"
                  >
                    {Array.from({ length: Math.max(1, dim.columns) }).map((_, ci) => (
                      <div
                        key={ci}
                        style={{
                          width: `${colW * pxPerMm}px`,
                          marginRight: ci < dim.columns - 1 ? `${dim.columnGapMm * pxPerMm}px` : 0,
                        }}
                        className="h-full border-x border-[#56A8D8]/20 bg-[#56A8D8]/[0.02]"
                      />
                    ))}
                  </div>
                )}

                {/* Baseline Grid Lines */}
                {showGuides && !previewMode && dim.baselineGridMm >= 2 && (
                  <div
                    className="absolute inset-0 pointer-events-none z-10 opacity-20"
                    style={{
                      backgroundImage: `linear-gradient(to bottom, rgba(86, 168, 216, 0.38) 1px, transparent 1px)`,
                      backgroundSize: `100% ${dim.baselineGridMm * pxPerMm}px`,
                    }}
                  />
                )}

                {/* Smart Alignment Snap Lines */}
                {snapLines
                  .filter((s) => s.pageId === page.id)
                  .map((line, i) =>
                    line.axis === 'x' ? (
                      <div
                        key={i}
                        style={{ left: `${line.posMm * pxPerMm}px` }}
                        className="absolute top-0 bottom-0 w-px bg-[#C6A26B] pointer-events-none z-40"
                      />
                    ) : (
                      <div
                        key={i}
                        style={{ top: `${line.posMm * pxPerMm}px` }}
                        className="absolute left-0 right-0 h-px bg-[#C6A26B] pointer-events-none z-40"
                      />
                    )
                  )}

                {/* Clipped Page Content Layer */}
                <div className="absolute inset-0 overflow-hidden">
                  {[...page.elements]
                    .filter((e) => !e.hidden)
                    .sort((a, b) => a.zIndex - b.zIndex)
                    .map((el) => {
                      const isSelected = !previewMode && selectedElementIds.includes(el.id);
                      const isEditingText = editingTextId === el.id;
                      const isCropping = croppingImageId === el.id;
                      const ov = el.type === 'text' ? measureTextOverflow(el) : null;

                      const fontPx = el.textStyle
                        ? (el.textStyle.fontSizePt / 72) * 25.4 * pxPerMm
                        : 12;

                      return (
                        <div
                          key={el.id}
                          onMouseDown={(e) => startElementDrag(e, page, dim, el)}
                          onDoubleClick={(e) => {
                            if (previewMode || isFrozen(el)) return;
                            e.stopPropagation();
                            if (
                              el.type === 'text' ||
                              el.type === 'header' ||
                              el.type === 'footer' ||
                              el.type === 'logo'
                            ) {
                              setEditingTextId(el.id);
                              setCroppingImageId(null);
                            } else if (el.type === 'image') {
                              setCroppingImageId(el.id);
                              setEditingTextId(null);
                            }
                          }}
                          onDragOver={(e) => {
                            if (el.type === 'image') {
                              e.preventDefault();
                              e.stopPropagation();
                            }
                          }}
                          onDrop={(e) => {
                            if (el.type !== 'image') return;
                            const imgJson = e.dataTransfer.getData('application/x-bookstudio-image');
                            if (!imgJson) return;
                            e.preventDefault();
                            e.stopPropagation();
                            try {
                              const asset = JSON.parse(imgJson) as ImageAsset;
                              onDropImageOnPage(page.id, asset, el.xMm, el.yMm, el.id);
                            } catch {
                              // ignore
                            }
                          }}
                          style={{
                            left: `${el.xMm * pxPerMm}px`,
                            top: `${el.yMm * pxPerMm}px`,
                            width: `${el.widthMm * pxPerMm}px`,
                            height: `${el.heightMm * pxPerMm}px`,
                            transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
                            opacity: el.opacity ?? 1,
                            zIndex: isSelected ? 30 : el.zIndex,
                          }}
                          data-overflow={!previewMode && ov?.isOverflowing ? 'true' : undefined}
                          className={`absolute group ${
                            previewMode
                              ? ''
                              : isCropping
                                ? 'cursor-move ring-2 ring-[#C6A26B]'
                                : isSelected
                                  ? 'ring-1 ring-[#C6A26B]'
                                  : 'hover:ring-1 hover:ring-[#56A8D8]/60'
                          } ${
                            /* text that does not fit: a clear red outline on the frame, for both roles (editor only:
                               preview and exports never show it) */
                            !previewMode && ov?.isOverflowing ? 'outline-2 outline-dashed outline-offset-1 outline-[#D94F3D]' : ''
                          }`}
                        >
                          {/* IMAGE FRAME */}
                          {el.type === 'image' && (
                            <div
                              className="w-full h-full overflow-hidden relative bg-[#E5E1D8]"
                              style={{
                                borderRadius: `${(el.image?.borderRadiusMm || 0) * pxPerMm}px`,
                              }}
                            >
                              {el.image?.src ? (
                                <img
                                  src={el.image.src}
                                  alt={el.image.alt || el.name}
                                  draggable={false}
                                  referrerPolicy="no-referrer"
                                  className="w-full h-full select-none pointer-events-none"
                                  style={{
                                    objectFit: el.image.fit || 'cover',
                                    objectPosition: `${el.image.focalX ?? 50}% ${el.image.focalY ?? 50}%`,
                                    transform: `scale(${el.image.zoom || 1})`,
                                    filter: [
                                      el.image.brightness !== undefined && el.image.brightness !== 100
                                        ? `brightness(${el.image.brightness}%)`
                                        : '',
                                      el.image.contrast !== undefined && el.image.contrast !== 100
                                        ? `contrast(${el.image.contrast}%)`
                                        : '',
                                      el.image.grayscale ? `grayscale(${el.image.grayscale}%)` : '',
                                      el.image.sepia ? `sepia(${el.image.sepia}%)` : '',
                                    ]
                                      .filter(Boolean)
                                      .join(' '),
                                  }}
                                />
                                ) : (
                                  <div className="w-full h-full relative flex flex-col items-center justify-center text-[#6B6760] text-[11px] border border-[#9E998F] bg-[#EAE6DD]/80">
                                    <svg
                                      viewBox="0 0 100 100"
                                      preserveAspectRatio="none"
                                      className="absolute inset-0 w-full h-full pointer-events-none"
                                    >
                                      <line x1="0" y1="0" x2="100" y2="100" stroke="#A6A096" strokeWidth="0.6" />
                                      <line x1="100" y1="0" x2="0" y2="100" stroke="#A6A096" strokeWidth="0.6" />
                                    </svg>
                                    <div className="relative z-10 bg-[#EAE6DD]/92 px-2 py-1 text-center max-w-[88%] rounded-[2px] border border-[#C9C3B8]/80">
                                      <div className="text-[11px] font-semibold tracking-wide uppercase text-[#4B4842] truncate">
                                        {el.name || 'Image Placeholder'}
                                      </div>
                                      <div className="text-[11px] text-[#736E65] truncate">
                                        {el.image?.alt && el.image.alt !== 'Empty image frame'
                                          ? el.image.alt
                                          : 'Drop photograph or select in Properties'}
                                      </div>
                                    </div>
                                  </div>
                                )}
                            </div>
                          )}

                          {/* SHAPE / LINE / DECORATIVE */}
                          {(el.type === 'shape' || el.type === 'line' || el.type === 'decorative') &&
                            el.shape && (
                              el.type === 'line' || el.shape.shapeKind === 'rule' ? (
                                <div className="w-full h-full flex items-center">
                                  <div
                                    className="w-full"
                                    style={{
                                      borderTopWidth: `${Math.max(1, (el.shape.strokeWidthMm || 0.4) * pxPerMm)}px`,
                                      borderTopStyle: el.shape.dashStyle || 'solid',
                                      borderTopColor: el.shape.stroke || '#C6A26B',
                                    }}
                                  />
                                </div>
                              ) : (
                                <div
                                  className="w-full h-full"
                                  style={{
                                    backgroundColor: el.shape.fill || 'transparent',
                                    borderWidth:
                                      el.shape.strokeWidthMm > 0
                                        ? `${el.shape.strokeWidthMm * pxPerMm}px`
                                        : 0,
                                    borderStyle: el.shape.dashStyle || 'solid',
                                    borderColor: el.shape.stroke || 'transparent',
                                    borderRadius:
                                      el.shape.shapeKind === 'ellipse'
                                        ? '9999px'
                                        : `${(el.shape.cornerRadiusMm || 0) * pxPerMm}px`,
                                  }}
                                />
                              )
                            )}

                          {/* INFOGRAPHIC SVG */}
                          {el.type === 'infographic' && el.infographic && (
                            <div
                              className="w-full h-full overflow-hidden pointer-events-none"
                              dangerouslySetInnerHTML={{
                                __html: renderInfographicToSvgString(
                                  el.infographic,
                                  Math.round(el.widthMm * 3.2),
                                  Math.round(el.heightMm * 3.2)
                                ),
                              }}
                            />
                          )}

                          {/* TEXT / HEADER / FOOTER / PAGE NUMBER / LOGO */}
                          {(el.type === 'text' ||
                            el.type === 'header' ||
                            el.type === 'footer' ||
                            el.type === 'pageNumber' ||
                            el.type === 'logo') &&
                            el.textStyle && (
                              <div
                                className="w-full h-full overflow-hidden flex flex-col"
                                style={{
                                  padding: `${(el.textStyle.insetMm || 0) * pxPerMm}px`,
                                  justifyContent:
                                    el.textStyle.verticalAlign === 'middle'
                                      ? 'center'
                                      : el.textStyle.verticalAlign === 'bottom'
                                        ? 'flex-end'
                                        : 'flex-start',
                                }}
                              >
                                {isEditingText ? (
                                  <textarea
                                    autoFocus
                                    value={el.text || ''}
                                    onMouseDown={(e) => e.stopPropagation()}
                                    onChange={(e) =>
                                      onUpdateElement(
                                        page.id,
                                        el.id,
                                        // the master link is the design's: a Content editor's edit changes the words only
                                        canDesign
                                          ? {
                                              text: e.target.value,
                                              overriddenFromMaster: el.masterElementId
                                                ? true
                                                : el.overriddenFromMaster,
                                            }
                                          : { text: e.target.value },
                                        false
                                      )
                                    }
                                    onBlur={() => setEditingTextId(null)}
                                    style={{
                                      fontFamily: `"${el.textStyle.fontFamily}", serif`,
                                      fontSize: `${fontPx}px`,
                                      fontWeight: el.textStyle.fontWeight,
                                      fontStyle: el.textStyle.fontStyle || 'normal',
                                      color: el.textStyle.color,
                                      lineHeight: el.textStyle.lineHeight,
                                      letterSpacing: `${el.textStyle.letterSpacingEm}em`,
                                      textAlign: el.textStyle.textAlign,
                                      textTransform: el.textStyle.textTransform || 'none',
                                    }}
                                    className="w-full h-full bg-transparent resize-none focus:outline-none"
                                  />
                                ) : (
                                  <div
                                    style={{
                                      fontFamily: `"${el.textStyle.fontFamily}", serif`,
                                      fontSize: `${fontPx}px`,
                                      fontWeight: el.textStyle.fontWeight,
                                      fontStyle: el.textStyle.fontStyle || 'normal',
                                      color: el.textStyle.color,
                                      lineHeight: el.textStyle.lineHeight,
                                      letterSpacing: `${el.textStyle.letterSpacingEm}em`,
                                      textAlign: el.textStyle.textAlign,
                                      textTransform: el.textStyle.textTransform || 'none',
                                      columnCount: el.textStyle.columns || 1,
                                      columnGap: `${(el.textStyle.columnGapMm || 5) * pxPerMm}px`,
                                      whiteSpace: 'pre-wrap',
                                    }}
                                    className="w-full select-none pointer-events-none"
                                  >
                                    {el.type === 'pageNumber'
                                      ? (el.text || '{{page}}').replace(
                                          '{{page}}',
                                          String(pageNumber).padStart(2, '0')
                                        )
                                      : el.text || ''}
                                  </div>
                                )}
                              </div>
                            )}

                          {/* OVERFLOW WARNING INDICATOR (Never shown in Preview or Exports) */}
                          {!previewMode && ov?.isOverflowing && (
                            <div
                              title={`Text doesn't fit: about ${ov.overflowWords} more words than the frame holds. Select the frame and see the Properties panel.`}
                              className="absolute -bottom-2.5 right-0 translate-y-1/2 px-1 h-[18px] bg-[#D94F3D] text-white flex items-center gap-0.5 rounded-sm shadow z-40 text-[11px] font-semibold whitespace-nowrap pointer-events-none"
                            >
                              <AlertTriangle className="w-2.5 h-2.5" />
                              <span>+{ov.overflowWords} words don't fit</span>
                            </div>
                          )}

                          {/* RESIZE & ROTATE HANDLES */}
                          {isSelected && canDesign && !el.locked && !isEditingText && !isCropping && (
                            <>
                              {(
                                [
                                  ['nw', '-top-1 -left-1 cursor-nwse-resize'],
                                  ['n', '-top-1 left-1/2 -translate-x-1/2 cursor-ns-resize'],
                                  ['ne', '-top-1 -right-1 cursor-nesw-resize'],
                                  ['e', 'top-1/2 -right-1 -translate-y-1/2 cursor-ew-resize'],
                                  ['se', '-bottom-1 -right-1 cursor-nwse-resize'],
                                  ['s', '-bottom-1 left-1/2 -translate-x-1/2 cursor-ns-resize'],
                                  ['sw', '-bottom-1 -left-1 cursor-nesw-resize'],
                                  ['w', 'top-1/2 -left-1 -translate-y-1/2 cursor-ew-resize'],
                                ] as const
                              ).map(([h, cls]) => (
                                <div
                                  key={h}
                                  onMouseDown={(e) => startResize(e, page, el, h)}
                                  className={`absolute w-2 h-2 bg-white border border-[#C6A26B] z-40 ${cls}`}
                                />
                              ))}
                              <div
                                onMouseDown={(e) => startRotate(e, page, el)}
                                title="Drag to rotate element (Shift snaps 15°)"
                                className="absolute -top-5 left-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-[#18181B] border border-[#C6A26B] cursor-grab z-40"
                              />
                            </>
                          )}
                        </div>
                      );
                    })}

                  {/* LIVE INDESIGN RUBBER-BAND DRAW PREVIEW */}
                  {drawDraft && drawDraft.pageId === page.id && (
                    <div
                      style={{
                        left: `${drawDraft.xMm * pxPerMm}px`,
                        top: `${drawDraft.yMm * pxPerMm}px`,
                        width: `${Math.max(2, drawDraft.widthMm * pxPerMm)}px`,
                        height: `${Math.max(2, drawDraft.heightMm * pxPerMm)}px`,
                        borderRadius: drawDraft.tool === 'ellipse' ? '9999px' : '0px',
                      }}
                      className="absolute border border-[#C6A26B] bg-[#C6A26B]/12 pointer-events-none z-50 overflow-hidden"
                    >
                      {drawDraft.tool === 'frame_image' && (
                        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-full">
                          <line x1="0" y1="0" x2="100" y2="100" stroke="#C6A26B" strokeWidth="0.8" />
                          <line x1="100" y1="0" x2="0" y2="100" stroke="#C6A26B" strokeWidth="0.8" />
                        </svg>
                      )}
                    </div>
                  )}
                </div>

                {/* Page Footer Caption below trim (Editor Only) */}
                {!previewMode && (
                  <div className="absolute -bottom-6 left-0 right-0 flex items-center justify-between text-[11px] text-[#8F8C84] pointer-events-none">
                    <span>
                      Page {pageNumber} · {page.label}
                    </span>
                    <span className="font-mono-tabular">
                      {formatMeasurement(dim.widthMm, project.unit, 0)} ×{' '}
                      {formatMeasurement(dim.heightMm, project.unit, 0)}
                      {page.dimensionsOverride ? ' (Custom)' : ''}
                    </span>
                  </div>
                )}
              </div>
            );
          })}

          {/* Realistic Book Binding Spine Shadow on Facing Spreads */}
          {visiblePages.length === 2 && (
            <div className="absolute top-0 bottom-0 left-1/2 -translate-x-1/2 w-10 book-spine-shadow pointer-events-none z-20" />
          )}
        </div>
      </div>
    </main>
  );
};
