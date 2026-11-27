import React from 'react';
import {
  BarChart3,
  Circle,
  Eye,
  Hand,
  Minus,
  MousePointer2,
  Navigation,
  Search,
  Square,
  Type,
} from 'lucide-react';
import type { BookElement, InDesignTool } from '../types/bookstudio';

interface InDesignToolPaletteProps {
  activeTool: InDesignTool;
  previewMode: boolean;
  selectedElement: BookElement | null;
  primaryAccent: string;
  inkColor: string;
  /** false for a Content editor: the tools that draw new frames, and the fill/stroke swap, are off */
  canDesign: boolean;
  onSelectTool: (tool: InDesignTool) => void;
  onTogglePreview: () => void;
  onSwapFillStroke?: () => void;
}

const TOOL_GROUPS: Array<
  Array<{
    id: InDesignTool;
    label: string;
    shortcut: string;
    icon: React.FC<{ className?: string }>;
    isImageFrame?: boolean;
    /** draws a new frame: the design's */
    makesFrame?: boolean;
  }>
> = [
  [
    { id: 'select', label: 'Selection Tool (Move & Resize Frames)', shortcut: 'V', icon: MousePointer2 },
    { id: 'direct_select', label: 'Direct Selection Tool (Edit Content / Crop Photo)', shortcut: 'A', icon: Navigation },
  ],
  [
    { id: 'type', label: 'Type Tool (Drag to Draw Text Frame)', shortcut: 'T', icon: Type, makesFrame: true },
    { id: 'frame_image', label: 'Rectangle Image Frame Tool (Drag to Draw Photo Box)', shortcut: 'F', icon: Square, isImageFrame: true, makesFrame: true },
    { id: 'rect', label: 'Rectangle Shape Tool', shortcut: 'M', icon: Square, makesFrame: true },
    { id: 'ellipse', label: 'Ellipse Frame Tool', shortcut: 'O', icon: Circle, makesFrame: true },
    { id: 'line', label: 'Line / Hairline Rule Tool', shortcut: '\\', icon: Minus, makesFrame: true },
    { id: 'infographic', label: 'Live Infographic Frame Tool (Drag to Draw Chart)', shortcut: 'G', icon: BarChart3, makesFrame: true },
  ],
  [
    { id: 'hand', label: 'Hand Tool (Pan Pasteboard)', shortcut: 'H', icon: Hand },
    { id: 'zoom', label: 'Zoom Tool (Click Zoom In · Alt+Click Zoom Out)', shortcut: 'Z', icon: Search },
  ],
];

export const InDesignToolPalette: React.FC<InDesignToolPaletteProps> = ({
  activeTool,
  previewMode,
  selectedElement,
  primaryAccent,
  inkColor,
  canDesign,
  onSelectTool,
  onTogglePreview,
  onSwapFillStroke,
}) => {
  const fillSwatch =
    selectedElement?.type === 'text'
      ? selectedElement.textStyle?.color || inkColor
      : selectedElement?.shape?.fill && selectedElement.shape.fill !== 'transparent'
        ? selectedElement.shape.fill
        : primaryAccent;

  const strokeSwatch =
    selectedElement?.shape?.stroke && selectedElement.shape.stroke !== 'transparent'
      ? selectedElement.shape.stroke
      : inkColor;

  return (
    <aside
      aria-label="InDesign Tool Palette"
      className="w-10 shrink-0 bg-[#1B1B1F] border-r border-white/[0.08] flex flex-col items-center py-2 justify-between select-none z-20"
    >
      <div className="flex flex-col items-center gap-1 w-full px-1">
        {TOOL_GROUPS.map((group, gIdx) => (
          <React.Fragment key={gIdx}>
            {gIdx > 0 && <div className="w-5 h-px bg-white/[0.08] my-1" />}
            {group.map((tool) => {
              const Icon = tool.icon;
              const active = activeTool === tool.id;
              const off = !canDesign && !!tool.makesFrame;
              return (
                <button
                  key={tool.id}
                  onClick={() => !off && onSelectTool(tool.id)}
                  disabled={off}
                  aria-disabled={off}
                  title={off ? `${tool.label}: only a Designer can add frames` : `${tool.label} (${tool.shortcut})`}
                  className={`relative w-8 h-8 rounded flex items-center justify-center transition-colors ${
                    off
                      ? 'text-[#4F4D48] cursor-not-allowed'
                      : active
                        ? 'bg-[#C6A26B] text-[#121214] shadow-sm cursor-pointer'
                        : 'text-[#B5B2A8] hover:text-white hover:bg-white/[0.07] cursor-pointer'
                  }`}
                >
                  {tool.isImageFrame ? (
                    <svg viewBox="0 0 16 16" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.4">
                      <rect x="2" y="2.5" width="12" height="11" rx="0.5" />
                      <line x1="2.3" y1="2.8" x2="13.7" y2="13.2" strokeWidth="1" opacity="0.85" />
                      <line x1="13.7" y1="2.8" x2="2.3" y2="13.2" strokeWidth="1" opacity="0.85" />
                    </svg>
                  ) : (
                    <Icon className="w-4 h-4" />
                  )}
                  {/* the shortcut letter is in the tooltip (a corner letter would be too small to read) */}
                </button>
              );
            })}
          </React.Fragment>
        ))}
      </div>

      {/* Bottom InDesign Fill/Stroke Swatch Proxy + Screen Mode Toggle (W) */}
      <div className="flex flex-col items-center gap-2.5 w-full px-1 pt-2 border-t border-white/[0.08]">
        <button
          onClick={canDesign ? onSwapFillStroke : undefined}
          disabled={!canDesign}
          title={canDesign ? 'Fill & Stroke Swatches (Click to swap on selected shape)' : 'Fill and stroke colours are the design: a Designer changes them'}
          className={`relative w-7 h-7 group ${canDesign ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}`}
        >
          <span
            style={{ backgroundColor: strokeSwatch }}
            className="absolute bottom-0 right-0 w-4 h-4 rounded-[2px] border border-white/40 flex items-center justify-center"
          >
            <span className="w-2 h-2 bg-[#1B1B1F] rounded-[1px]" />
          </span>
          <span
            style={{ backgroundColor: fillSwatch }}
            className="absolute top-0 left-0 w-4 h-4 rounded-[2px] border border-white/70 shadow"
          />
        </button>

        <button
          onClick={onTogglePreview}
          title="Toggle Screen Mode: Normal / Presentation Preview (W)"
          className={`w-8 h-7 rounded flex flex-col items-center justify-center border transition-colors cursor-pointer ${
            previewMode
              ? 'bg-[#C6A26B] border-[#C6A26B] text-[#121214]'
              : 'bg-[#121214] border-white/[0.1] text-[#A19E95] hover:text-white'
          }`}
        >
          <Eye className="w-3.5 h-3.5" />
        </button>
      </div>
    </aside>
  );
};
