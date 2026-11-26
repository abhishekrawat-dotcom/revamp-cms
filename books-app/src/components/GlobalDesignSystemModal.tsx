import React, { useMemo, useState } from 'react';
import { AlertTriangle, Check, Lock, Palette, Plus, ShieldCheck, Unlock, X } from 'lucide-react';
import type { BookProject, DesignSystem } from '../types/bookstudio';
import { runPreflightCheck } from '../engines/preflightEngine';

interface GlobalDesignSystemModalProps {
  project: BookProject;
  onUpdateProject: (updated: BookProject) => void;
  onJumpToPage: (pageId: string, elementId?: string) => void;
  onClose: () => void;
}

export const GlobalDesignSystemModal: React.FC<GlobalDesignSystemModalProps> = ({
  project,
  onUpdateProject,
  onJumpToPage,
  onClose,
}) => {
  const [ds, setDs] = useState<DesignSystem>(structuredClone(project.designSystem));
  const [newSwatch, setNewSwatch] = useState('#A67C46');

  const consistencyIssues = useMemo(
    () =>
      runPreflightCheck(project).filter(
        (i) => i.category === 'design_consistency' || i.category === 'missing_font'
      ),
    [project]
  );

  const handleSave = () => {
    onUpdateProject({
      ...project,
      designSystem: ds,
    });
    onClose();
  };

  const applyPaperToAllPages = () => {
    onUpdateProject({
      ...project,
      designSystem: ds,
      pages: project.pages.map((p) =>
        p.role === 'front_cover' ? p : { ...p, backgroundColor: ds.colors.paper }
      ),
    });
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
      <div className="w-full max-w-4xl max-h-[88vh] bg-[#18181B] border border-white/[0.1] rounded-lg flex flex-col overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="px-6 py-4 border-b border-white/[0.08] flex items-center justify-between">
          <div>
            <h2 className="font-display text-lg font-medium text-[#F4F1EA]">
              Global Design System & Editorial Consistency Checker
            </h2>
            <p className="text-[11px] text-[#98958D]">
              Master colours, approved typography limits, spacing tokens, and non-intrusive consistency review.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-[#98958D] hover:text-white rounded cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Approval Lock Banner */}
          <div className="p-4 bg-[#141417] border border-white/[0.08] rounded-md flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-0.5">
              <div className="text-xs font-semibold text-[#F4F1EA] flex items-center gap-2">
                <Palette className="w-4 h-4 text-[#C6A26B]" />
                <span>{ds.name}</span>
              </div>
              <div className="text-[11px] text-[#98958D]">
                Source Authority: {ds.sourceTemplateName || 'Custom Editorial System'}
              </div>
            </div>
            <button
              onClick={() => setDs((prev) => ({ ...prev, approved: !prev.approved }))}
              className={`px-3 py-1.5 text-xs rounded border flex items-center gap-1.5 cursor-pointer ${
                ds.approved
                  ? 'bg-[#1D251C] border-[#8AA678]/50 text-[#CDE2BF]'
                  : 'bg-[#26262C] border-white/[0.1] text-[#D7D4CC]'
              }`}
            >
              {ds.approved ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
              <span>{ds.approved ? 'Approved Master System' : 'Draft System'}</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Colour System */}
            <div className="p-4 bg-[#141417] border border-white/[0.08] rounded-md space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#F4F1EA]">Master Colour Tokens</span>
                <button
                  onClick={applyPaperToAllPages}
                  className="text-[10px] text-[#C6A26B] hover:underline cursor-pointer"
                >
                  Apply Paper Stock to Interior Pages
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                {(
                  [
                    ['Paper Stock', 'paper'],
                    ['Surface Tint', 'surface'],
                    ['Primary Ink', 'ink'],
                    ['Muted Ink', 'mutedInk'],
                    ['Primary Accent', 'primaryAccent'],
                    ['Secondary Accent', 'secondaryAccent'],
                  ] as const
                ).map(([label, key]) => (
                  <label
                    key={key}
                    className="flex items-center justify-between p-2 bg-[#1A1A1E] rounded border border-white/[0.06]"
                  >
                    <span className="text-[11px] text-[#D7D4CC]">{label}</span>
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono-tabular text-[10px] text-[#8F8C84]">
                        {ds.colors[key]}
                      </span>
                      <input
                        type="color"
                        value={ds.colors[key]}
                        onChange={(e) =>
                          setDs({
                            ...ds,
                            colors: { ...ds.colors, [key]: e.target.value },
                          })
                        }
                        className="w-5 h-5 rounded border border-white/15 bg-transparent cursor-pointer"
                      />
                    </div>
                  </label>
                ))}
              </div>

              <div className="pt-2 border-t border-white/[0.06] space-y-2">
                <div className="text-[10px] text-[#98958D]">Approved Palette Swatches</div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {ds.colors.palette.map((hex, i) => (
                    <button
                      key={`${hex}_${i}`}
                      onClick={() =>
                        setDs({
                          ...ds,
                          colors: {
                            ...ds.colors,
                            palette: ds.colors.palette.filter((_, idx) => idx !== i),
                          },
                        })
                      }
                      title={`${hex} (Click to remove)`}
                      style={{ backgroundColor: hex }}
                      className="w-6 h-6 rounded-sm border border-white/25 cursor-pointer"
                    />
                  ))}
                  <div className="flex items-center gap-1 ml-1">
                    <input
                      type="color"
                      value={newSwatch}
                      onChange={(e) => setNewSwatch(e.target.value)}
                      className="w-6 h-6 rounded border border-white/15 bg-transparent cursor-pointer"
                    />
                    <button
                      onClick={() =>
                        setDs({
                          ...ds,
                          colors: { ...ds.colors, palette: [...ds.colors.palette, newSwatch] },
                        })
                      }
                      className="p-1 bg-[#26262C] text-[#ECEAE4] rounded cursor-pointer"
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Spacing & Typography Guardrails */}
            <div className="p-4 bg-[#141417] border border-white/[0.08] rounded-md space-y-3">
              <div className="text-xs font-semibold text-[#F4F1EA]">
                Spacing & Typography Guardrails
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] text-[#98958D]">Min Approved Body Size (pt)</span>
                  <input
                    type="number"
                    step={0.5}
                    min={6}
                    max={14}
                    value={ds.typography.minApprovedBodyPt}
                    onChange={(e) =>
                      setDs({
                        ...ds,
                        typography: {
                          ...ds.typography,
                          minApprovedBodyPt: parseFloat(e.target.value) || 8.5,
                        },
                      })
                    }
                    className="bg-[#121214] border border-white/[0.1] rounded px-2.5 py-1.5 font-mono-tabular text-xs text-[#ECEAE4]"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] text-[#98958D]">Baseline Rhythm (mm)</span>
                  <input
                    type="number"
                    step={0.5}
                    min={2}
                    value={ds.spacing.baselineMm}
                    onChange={(e) =>
                      setDs({
                        ...ds,
                        spacing: { ...ds.spacing, baselineMm: parseFloat(e.target.value) || 4 },
                      })
                    }
                    className="bg-[#121214] border border-white/[0.1] rounded px-2.5 py-1.5 font-mono-tabular text-xs text-[#ECEAE4]"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] text-[#98958D]">Paragraph Gap (mm)</span>
                  <input
                    type="number"
                    step={0.5}
                    min={0}
                    value={ds.spacing.paragraphGapMm}
                    onChange={(e) =>
                      setDs({
                        ...ds,
                        spacing: { ...ds.spacing, paragraphGapMm: parseFloat(e.target.value) || 4 },
                      })
                    }
                    className="bg-[#121214] border border-white/[0.1] rounded px-2.5 py-1.5 font-mono-tabular text-xs text-[#ECEAE4]"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] text-[#98958D]">Caption Offset (mm)</span>
                  <input
                    type="number"
                    step={0.5}
                    min={0}
                    value={ds.spacing.imageCaptionGapMm}
                    onChange={(e) =>
                      setDs({
                        ...ds,
                        spacing: {
                          ...ds.spacing,
                          imageCaptionGapMm: parseFloat(e.target.value) || 3,
                        },
                      })
                    }
                    className="bg-[#121214] border border-white/[0.1] rounded px-2.5 py-1.5 font-mono-tabular text-xs text-[#ECEAE4]"
                  />
                </label>
              </div>
              <div className="pt-2 border-t border-white/[0.06] text-[11px] text-[#98958D] space-y-1">
                <div>Display: {ds.typography.displayFont} ({ds.typography.scale.displayPt}pt)</div>
                <div>Heading: {ds.typography.headingFont} ({ds.typography.scale.headingPt}pt)</div>
                <div>Body: {ds.typography.bodyFont} ({ds.typography.scale.bodyPt}pt)</div>
              </div>
            </div>
          </div>

          {/* Live Design Consistency Checker */}
          <div className="p-4 bg-[#141417] border border-white/[0.08] rounded-md space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold text-[#F4F1EA] flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-[#C6A26B]" />
                <span>Design Consistency Checker (Advisory Only — Never Overrides Intentional Edits)</span>
              </div>
              <span className="font-mono-tabular text-[11px] text-[#98958D]">
                {consistencyIssues.length} notice{consistencyIssues.length === 1 ? '' : 's'}
              </span>
            </div>

            {consistencyIssues.length === 0 ? (
              <div className="text-xs text-[#8AA678]">
                Every page adheres cleanly to the approved palette and typography hierarchy.
              </div>
            ) : (
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {consistencyIssues.map((issue) => (
                  <div
                    key={issue.id}
                    className="p-2.5 bg-[#1B1B20] border border-white/[0.06] rounded flex items-start justify-between gap-3"
                  >
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="w-3.5 h-3.5 text-[#D4A657] shrink-0 mt-0.5" />
                      <div>
                        <div className="text-xs font-medium text-[#ECEAE4]">{issue.title}</div>
                        <div className="text-[11px] text-[#98958D]">{issue.detail}</div>
                      </div>
                    </div>
                    {issue.pageId && (
                      <button
                        onClick={() => {
                          onJumpToPage(issue.pageId!, issue.elementId);
                          onClose();
                        }}
                        className="px-2 py-1 text-[10px] bg-[#28282F] hover:bg-[#34343D] text-[#ECEAE4] rounded shrink-0 cursor-pointer"
                      >
                        Go to Page
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-white/[0.08] bg-[#141417] flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3.5 py-2 text-xs text-[#A19E95] hover:text-white cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 bg-[#C6A26B] hover:bg-[#D5B47F] text-[#121214] text-xs font-medium rounded flex items-center gap-1.5 cursor-pointer"
          >
            <Check className="w-3.5 h-3.5" />
            <span>Save Design System</span>
          </button>
        </div>
      </div>
    </div>
  );
};
