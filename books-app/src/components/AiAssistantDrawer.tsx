import React, { useState } from 'react';
import { Check, Loader2, Send, Sparkles, X } from 'lucide-react';
import type {
  AiEditorialSuggestion,
  BookElement,
  BookPage,
  BookProject,
} from '../types/bookstudio';
import { askEditorialAssistant } from '../services/aiService';

interface AiAssistantDrawerProps {
  project: BookProject;
  activePage: BookPage;
  selectedElement: BookElement | null;
  initialPrompt?: string;
  /** false for a Content editor: only a suggestion that changes words can be applied; the rest change the design */
  canDesign: boolean;
  onApplySuggestion: (suggestion: AiEditorialSuggestion) => void;
  onClose: () => void;
}

const QUICK_MODES = [
  { id: 'layout', label: 'Page Layout Critique', prompt: 'Review the visual balance, white space, and grid alignment of this page while strictly respecting the approved design system.' },
  { id: 'overflow', label: 'Resolve Overflow', prompt: 'Diagnose any text overflow on this page and propose non-destructive typography or layout remedies.' },
  { id: 'image_placement', label: 'Image Framing', prompt: 'Evaluate photograph placement, focal rhythm, and caption pairing on this spread.' },
  { id: 'typography', label: 'Typography Refinement', prompt: 'Suggest subtle hierarchy, leading, or tracking refinements within our approved fonts.' },
  { id: 'chapter_opener', label: 'Chapter Opener', prompt: 'Suggest an elevated luxury coffee table book treatment for this chapter opening spread.' },
  { id: 'infographic', label: 'Infographic Idea', prompt: 'Recommend the best infographic layout to visually support this page narrative.' },
  { id: 'copy_fit', label: 'Tighten Selected Copy', prompt: 'Tighten the selected text frame copy slightly so it fits comfortably within its frame without losing editorial voice.' },
];

export const AiAssistantDrawer: React.FC<AiAssistantDrawerProps> = ({
  project,
  activePage,
  selectedElement,
  initialPrompt = '',
  canDesign,
  onApplySuggestion,
  onClose,
}) => {
  const [mode, setMode] = useState('layout');
  const [prompt, setPrompt] = useState(initialPrompt);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<AiEditorialSuggestion[]>([]);
  const [appliedIds, setAppliedIds] = useState<string[]>([]);

  const handleAsk = async (customPrompt?: string, customMode?: string) => {
    const finalPrompt = (customPrompt ?? prompt).trim();
    if (!finalPrompt) return;
    setLoading(true);
    setError(null);
    try {
      const res = await askEditorialAssistant({
        prompt: finalPrompt,
        mode: customMode || mode,
        designSystem: project.designSystem,
        currentPage: activePage,
        bookSummary: {
          name: project.name,
          category: project.category,
          pageCount: project.pages.length,
          dimensionsMm: `${project.dimensions.widthMm}x${project.dimensions.heightMm}`,
        },
        selectedElement,
      });
      setSummary(res.summary);
      setSuggestions(res.suggestions);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Assistant request failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-full max-w-md bg-[#18181B] border-l border-white/[0.1] shadow-2xl flex flex-col">
      {/* Header */}
      <div className="px-5 py-4 border-b border-white/[0.08] flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-[#F4F1EA] flex items-center gap-1.5">
            <Sparkles className="w-4 h-4 text-[#C6A26B]" />
            <span>Editorial Design Assistant</span>
          </h2>
          <p className="text-[11px] text-[#98958D] mt-0.5">
            Optional guidance strictly honoring your approved design system. Every change requires your approval.
          </p>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 text-[#98958D] hover:text-white rounded cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Active Context Bar */}
      <div className="px-5 py-2.5 bg-[#141417] border-b border-white/[0.08] text-[11px] text-[#98958D]">
        Context: <span className="text-[#ECEAE4]">{activePage.label}</span>
        {selectedElement && (
          <>
            {' '}
            · Selected: <span className="text-[#C6A26B]">{selectedElement.name}</span>
          </>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        <div className="flex flex-wrap gap-1.5">
          {QUICK_MODES.map((m) => (
            <button
              key={m.id}
              onClick={() => {
                setMode(m.id);
                setPrompt(m.prompt);
                void handleAsk(m.prompt, m.id);
              }}
              className={`px-2.5 py-1 text-[11px] rounded border transition-colors cursor-pointer ${
                mode === m.id
                  ? 'bg-[#2A261F] border-[#C6A26B]/70 text-[#F4F1EA]'
                  : 'bg-[#1F1F24] border-white/[0.07] text-[#A19E95] hover:text-white'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        {error && (
          <div className="p-3 bg-[#2B1B19] border border-[#D94F3D]/50 rounded text-xs text-[#F5CFC7]">
            {error}
          </div>
        )}

        {loading && (
          <div className="py-10 flex flex-col items-center justify-center gap-2 text-xs text-[#98958D]">
            <Loader2 className="w-5 h-5 animate-spin text-[#C6A26B]" />
            <span>Evaluating spread within approved design rules...</span>
          </div>
        )}

        {!loading && summary && (
          <div className="p-3.5 bg-[#141417] border border-white/[0.08] rounded-md text-xs text-[#D7D4CC] leading-relaxed">
            {summary}
          </div>
        )}

        {!loading && suggestions.length > 0 && (
          <div className="space-y-3">
            {suggestions.map((sug) => {
              const isApplied = appliedIds.includes(sug.id);
              return (
                <div
                  key={sug.id}
                  className="p-3.5 bg-[#141417] border border-white/[0.08] rounded-md space-y-2.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-xs font-semibold text-[#F4F1EA]">{sug.title}</div>
                    <span className="text-[11px] text-[#C6A26B] capitalize">
                      {sug.category.replace('_', ' ')}
                    </span>
                  </div>
                  <p className="text-[11px] text-[#98958D] leading-relaxed">{sug.rationale}</p>

                  {sug.actionType !== 'advisory_only' && !canDesign && sug.actionType !== 'update_text' && (
                    <div className="pt-1 text-[11px] text-[#8F8C84]">
                      This would change the design, so only a Designer can apply it.
                    </div>
                  )}
                  {sug.actionType !== 'advisory_only' && (canDesign || sug.actionType === 'update_text') && (
                    <div className="flex items-center gap-2 pt-1">
                      <button
                        disabled={isApplied}
                        onClick={() => {
                          onApplySuggestion(sug);
                          setAppliedIds((prev) => [...prev, sug.id]);
                        }}
                        className="px-3 py-1 bg-[#C6A26B] hover:bg-[#D5B47F] disabled:opacity-50 text-[#121214] text-[11px] font-medium rounded flex items-center gap-1 cursor-pointer"
                      >
                        <Check className="w-3 h-3" />
                        <span>{isApplied ? 'Applied' : 'Approve & Apply'}</span>
                      </button>
                      <button
                        onClick={() =>
                          setSuggestions((prev) => prev.filter((x) => x.id !== sug.id))
                        }
                        className="px-2.5 py-1 text-[11px] text-[#8F8C84] hover:text-white cursor-pointer"
                      >
                        Dismiss
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Prompt Input */}
      <div className="p-4 border-t border-white/[0.08] bg-[#141417] flex gap-2">
        <input
          type="text"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleAsk();
          }}
          placeholder="Ask for layout, overflow, or typography guidance..."
          className="flex-1 bg-[#121214] border border-white/[0.1] rounded px-3 py-2 text-xs text-[#ECEAE4] placeholder-[#73706A] focus:outline-none focus:border-[#C6A26B]"
        />
        <button
          onClick={() => void handleAsk()}
          disabled={loading || !prompt.trim()}
          className="px-3 py-2 bg-[#C6A26B] hover:bg-[#D5B47F] disabled:opacity-40 text-[#121214] rounded cursor-pointer"
        >
          <Send className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
