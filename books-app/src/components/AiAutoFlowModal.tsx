import React, { useMemo, useRef, useState } from 'react';
import {
  BarChart3,
  CheckCircle2,
  FileText,
  Image as ImageIcon,
  Layers,
  Loader2,
  Sparkles,
  Upload,
  Wand2,
  X,
} from 'lucide-react';
import type { BookProject } from '../types/bookstudio';
import {
  applyAutoFlowPlanToProject,
  extractLayoutSchemaForAutoFlow,
  type AutoFlowPlan,
} from '../engines/autoFlowEngine';
import { renderInfographicToSvgString } from '../engines/infographicEngine';
import { requestAiAutoFlowPlan } from '../services/aiService';

interface AiAutoFlowModalProps {
  project: BookProject;
  onApplyFlowedProject: (updatedProject: BookProject) => void;
  onClose: () => void;
}

const SAMPLE_USER_DATA = `TITLE: Meridian Clean Energy & Grid Resilience 2026 Annual Report
SUBTITLE: Accelerating Utility-Scale Storage, Industrial Decarbonization & Regional Transmission

EXECUTIVE SUMMARY
In 2026, Meridian Energy commissioned 4.8 GW of hybrid solar-plus-storage infrastructure across 14 regional corridors, lifting total renewable generation capacity by 42% year-over-year. Operating cash flow reached $1.42 billion while fleet-wide Scope 1 and 2 emissions intensity declined by 36% relative to our 2022 baseline.

CHAPTER 1: GRID-SCALE STORAGE & CORRIDOR EXPANSION
Our engineering division completed three 600 MWh iron-air and lithium-iron-phosphate substations ahead of schedule in Gujarat, Andalusia, and West Texas. By co-locating modular battery banks directly alongside high-voltage substations, curtailment losses fell from 11.4% to 2.8% during peak summer afternoon ramps.
Pull Quote: "Storage is no longer an accessory to renewable generation—it is the backbone of sovereign grid reliability."

CHAPTER 2: CAPITAL ALLOCATION & FINANCIAL DISCIPLINE
Capital expenditure totaled $2.15 billion in FY2026, funded through 64% green project finance bonds and 36% internal operating cash flow. Return on invested capital expanded to 13.8%, supported by 18-year inflation-indexed power purchase agreements with industrial data-center and steelmaking partners.

KEY PERFORMANCE METRICS (FOR INFOGRAPHIC):
- Solar & Wind Capacity: 74% of fleet
- Utility Battery Storage: 62% YoY growth
- Grid Uptime Reliability: 99.4%
- Scope 1 & 2 Carbon Reduction: 36% vs baseline
- Green Bond Financing Share: 64%
- Regional Output Mix: West India 38%, Iberia 27%, North America 24%, Nordics 11%

CHAPTER 3: 2027–2030 STRATEGIC OUTLOOK
Over the next 48 months, Meridian will deploy $6.4 billion across offshore wind interconnects, AI-dispatched virtual power plants, and green ammonia electrolyzer hubs. By 2030, our portfolio targets 18 GW of firm zero-carbon capacity delivering 24/7 hourly-matched clean power.`;

export const AiAutoFlowModal: React.FC<AiAutoFlowModalProps> = ({
  project,
  onApplyFlowedProject,
  onClose,
}) => {
  const [rawData, setRawData] = useState('');
  const [preserveExactText, setPreserveExactText] = useState(true);
  const [imageMode, setImageMode] = useState<'placeholders' | 'keep_photos'>('placeholders');
  const [autoExtendPages, setAutoExtendPages] = useState(true);
  const [updateDocumentTitle, setUpdateDocumentTitle] = useState(true);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<AutoFlowPlan | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const layoutSchema = useMemo(() => extractLayoutSchemaForAutoFlow(project), [project]);

  const layoutCounts = useMemo(() => {
    let textFrames = 0;
    let imageFrames = 0;
    let infographicFrames = 0;
    layoutSchema.forEach((p) => {
      textFrames += p.textFrames.length;
      imageFrames += p.imageFrames.length;
      infographicFrames += p.infographicFrames.length;
    });
    return { pages: layoutSchema.length, textFrames, imageFrames, infographicFrames };
  }, [layoutSchema]);

  const wordCount = useMemo(() => {
    const trimmed = rawData.trim();
    return trimmed ? trimmed.split(/\s+/).length : 0;
  }, [rawData]);

  const handleFileUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const chunks: string[] = [];
    for (const f of Array.from(files)) {
      const txt = await f.text();
      chunks.push(`--- ${f.name} ---\n${txt.trim()}`);
    }
    setRawData((prev) => (prev.trim() ? `${prev.trim()}\n\n${chunks.join('\n\n')}` : chunks.join('\n\n')));
  };

  const handleAnalyzeAndMap = async () => {
    if (!rawData.trim()) {
      setError('Paste your text, outline, metrics, or upload a .txt / .md / .csv file first.');
      return;
    }
    setLoading(true);
    setError(null);
    setPlan(null);
    try {
      const result = await requestAiAutoFlowPlan({
        rawData,
        preserveExactText,
        autoExtendPages,
        projectTitle: project.name,
        pagesSchema: layoutSchema,
      });
      setPlan(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Auto-Flow failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleCommitFlow = () => {
    if (!plan) return;
    const updated = applyAutoFlowPlanToProject(project, plan, {
      imageMode,
      updateDocumentTitle,
    });
    onApplyFlowedProject(updated);
    onClose();
  };

  const ds = project.designSystem;

  return (
    <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
      <div className="w-full max-w-6xl h-[88vh] bg-[#18181B] border border-white/[0.1] rounded-lg flex flex-col overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="px-6 py-4 border-b border-white/[0.08] flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded bg-[#C6A26B]/15 border border-[#C6A26B]/40 text-[#C6A26B] flex items-center justify-center shrink-0">
              <Wand2 className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-display text-lg font-medium text-[#F4F1EA]">
                AI One-Input Auto-Flow & Smart Data Merge
              </h2>
              <p className="text-[11px] text-[#98958D]">
                Paste or upload all your text & metrics once — AI flows everything as-is into your exact layout, preserves image placeholders, and populates live vector infographics.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-[#98958D] hover:text-white rounded cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Main 2-Column Split */}
        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 overflow-hidden">
          {/* LEFT: Single Data Input & Flow Rules */}
          <div className="lg:col-span-6 border-r border-white/[0.08] p-5 flex flex-col gap-3.5 overflow-y-auto bg-[#141417]">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-semibold text-[#ECEAE4]">
                1. Put Your Data Once (Manuscript, Report Notes, Tables, KPIs)
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setRawData(SAMPLE_USER_DATA)}
                  className="px-2 py-1 text-[10px] bg-[#222228] hover:bg-[#2C2C34] text-[#D7D4CC] rounded cursor-pointer"
                >
                  Load Sample Data
                </button>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="px-2 py-1 text-[10px] bg-[#222228] hover:bg-[#2C2C34] text-[#E6CFA5] border border-[#C6A26B]/30 rounded flex items-center gap-1 cursor-pointer"
                >
                  <Upload className="w-3 h-3" />
                  <span>Upload .txt / .md / .csv</span>
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".txt,.md,.csv,.json"
                  className="hidden"
                  onChange={(e) => void handleFileUpload(e.target.files)}
                />
              </div>
            </div>

            <textarea
              value={rawData}
              onChange={(e) => setRawData(e.target.value)}
              placeholder="Paste your entire book manuscript, report sections, bullet points, quotes, and numeric metrics/CSV here once.&#10;&#10;BOOKSTUDIO will map every heading, paragraph, quote, image placeholder label, and infographic dataset directly into your active layout without changing your grid or typography."
              className="flex-1 min-h-[240px] w-full bg-[#101013] border border-white/[0.1] rounded-md p-3.5 text-xs text-[#ECEAE4] leading-relaxed placeholder-[#66635C] focus:outline-none focus:border-[#C6A26B]/60 resize-none"
            />

            <div className="flex items-center justify-between text-[11px] font-mono-tabular text-[#8F8C84]">
              <span>{wordCount.toLocaleString()} words ready to flow</span>
              <span>
                Target: {layoutCounts.pages} pages · {layoutCounts.textFrames} text frames ·{' '}
                {layoutCounts.imageFrames} image slots · {layoutCounts.infographicFrames} charts
              </span>
            </div>

            {/* Flow Preservation Options */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-2 border-t border-white/[0.08]">
              <label className="p-2.5 bg-[#19191E] border border-white/[0.07] rounded flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={preserveExactText}
                  onChange={(e) => setPreserveExactText(e.target.checked)}
                  className="mt-0.5 accent-[#C6A26B]"
                />
                <div>
                  <div className="text-[11px] font-medium text-[#ECEAE4]">
                    Flow Text As-Is (Verbatim)
                  </div>
                  <div className="text-[10px] text-[#8F8C84]">
                    Preserves your exact wording & numbers without rewriting.
                  </div>
                </div>
              </label>

              <label className="p-2.5 bg-[#19191E] border border-white/[0.07] rounded flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoExtendPages}
                  onChange={(e) => setAutoExtendPages(e.target.checked)}
                  className="mt-0.5 accent-[#C6A26B]"
                />
                <div>
                  <div className="text-[11px] font-medium text-[#ECEAE4]">
                    Auto-Extend Pages If Needed
                  </div>
                  <div className="text-[10px] text-[#8F8C84]">
                    Clones exact interior layout for extra sections or charts.
                  </div>
                </div>
              </label>

              <div className="p-2.5 bg-[#19191E] border border-white/[0.07] rounded space-y-1.5">
                <div className="text-[11px] font-medium text-[#ECEAE4]">Image Frame Handling</div>
                <select
                  value={imageMode}
                  onChange={(e) => setImageMode(e.target.value as 'placeholders' | 'keep_photos')}
                  className="w-full bg-[#121214] border border-white/[0.08] rounded px-2 py-1 text-[11px] text-[#ECEAE4]"
                >
                  <option value="placeholders">Clean X-Cross Placeholders (with photo briefs)</option>
                  <option value="keep_photos">Keep Existing Template Photographs</option>
                </select>
              </div>

              <label className="p-2.5 bg-[#19191E] border border-white/[0.07] rounded flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={updateDocumentTitle}
                  onChange={(e) => setUpdateDocumentTitle(e.target.checked)}
                  className="mt-0.5 accent-[#C6A26B]"
                />
                <div>
                  <div className="text-[11px] font-medium text-[#ECEAE4]">
                    Sync Document Title
                  </div>
                  <div className="text-[10px] text-[#8F8C84]">
                    Updates project title & subtitle from your source data.
                  </div>
                </div>
              </label>
            </div>

            {error && (
              <div className="p-2.5 bg-[#2B1B19] border border-[#D94F3D]/50 rounded text-xs text-[#F5CFC7]">
                {error}
              </div>
            )}

            <button
              onClick={() => void handleAnalyzeAndMap()}
              disabled={loading || !rawData.trim()}
              className="w-full py-2.5 bg-[#C6A26B] hover:bg-[#D5B47F] disabled:opacity-45 text-[#121214] text-xs font-semibold rounded flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4" />
              )}
              <span>
                {loading
                  ? 'Mapping Your Content Into Exact Layout Frames...'
                  : 'Analyze & Map Data Into Active Layout'}
              </span>
            </button>
          </div>

          {/* RIGHT: Active Layout Blueprint / Live Flow Mapping Preview */}
          <div className="lg:col-span-6 p-5 flex flex-col gap-4 overflow-y-auto bg-[#18181B]">
            {!plan ? (
              <div className="space-y-4">
                <div>
                  <div className="text-xs font-semibold text-[#ECEAE4]">
                    2. Active Template Layout Blueprint (Preserved 100%)
                  </div>
                  <p className="text-[11px] text-[#8F8C84] mt-0.5">
                    Every page coordinate, margin, column grid, Google Font, and colour swatch in{' '}
                    <span className="text-[#ECEAE4]">{project.name}</span> stays locked while your content flows in.
                  </p>
                </div>

                <div className="grid grid-cols-4 gap-2 font-mono-tabular">
                  <div className="p-2.5 bg-[#121214] border border-white/[0.06] rounded">
                    <div className="text-[10px] text-[#8F8C84]">Pages</div>
                    <div className="text-base text-[#ECEAE4] font-medium">{layoutCounts.pages}</div>
                  </div>
                  <div className="p-2.5 bg-[#121214] border border-white/[0.06] rounded">
                    <div className="text-[10px] text-[#8F8C84]">Text Frames</div>
                    <div className="text-base text-[#ECEAE4] font-medium">{layoutCounts.textFrames}</div>
                  </div>
                  <div className="p-2.5 bg-[#121214] border border-white/[0.06] rounded">
                    <div className="text-[10px] text-[#8F8C84]">Image Slots</div>
                    <div className="text-base text-[#C6A26B] font-medium">{layoutCounts.imageFrames}</div>
                  </div>
                  <div className="p-2.5 bg-[#121214] border border-white/[0.06] rounded">
                    <div className="text-[10px] text-[#8F8C84]">Infographics</div>
                    <div className="text-base text-[#C6A26B] font-medium">{layoutCounts.infographicFrames}</div>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="text-[10px] uppercase tracking-wider text-[#8F8C84]">
                    Page-by-Page Slot Map
                  </div>
                  {layoutSchema.map((pg) => (
                    <div
                      key={pg.pageId}
                      className="p-3 bg-[#121214] border border-white/[0.06] rounded flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-medium text-[#ECEAE4] truncate">
                          Page {pg.pageNumber} · {pg.label}
                        </div>
                        <div className="text-[10px] text-[#8F8C84] mt-0.5 font-mono-tabular">
                          {pg.textFrames.length} text · {pg.imageFrames.length} image placeholder ·{' '}
                          {pg.infographicFrames.length} infographic
                        </div>
                      </div>
                      <span className="text-[10px] text-[#C6A26B] font-mono-tabular shrink-0">
                        {pg.role.replace(/_/g, ' ')}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="p-3.5 bg-[#1D271E] border border-[#6AA87E]/40 rounded-md space-y-1">
                  <div className="flex items-center gap-2 text-xs font-semibold text-[#C6E8CE]">
                    <CheckCircle2 className="w-4 h-4 text-[#7BC28E]" />
                    <span>Auto-Flow Plan Ready — Layout & Styling Preserved</span>
                  </div>
                  <p className="text-[11px] text-[#A8C9B0]">{plan.summary}</p>
                </div>

                <div className="grid grid-cols-4 gap-2 font-mono-tabular">
                  <div className="p-2.5 bg-[#121214] border border-white/[0.06] rounded">
                    <div className="text-[10px] text-[#8F8C84] flex items-center gap-1">
                      <FileText className="w-3 h-3 text-[#C6A26B]" /> Text
                    </div>
                    <div className="text-sm text-[#ECEAE4] font-medium mt-0.5">
                      {plan.textUpdates.length} frames
                    </div>
                  </div>
                  <div className="p-2.5 bg-[#121214] border border-white/[0.06] rounded">
                    <div className="text-[10px] text-[#8F8C84] flex items-center gap-1">
                      <ImageIcon className="w-3 h-3 text-[#C6A26B]" /> Images
                    </div>
                    <div className="text-sm text-[#ECEAE4] font-medium mt-0.5">
                      {plan.imageUpdates.length} slots
                    </div>
                  </div>
                  <div className="p-2.5 bg-[#121214] border border-white/[0.06] rounded">
                    <div className="text-[10px] text-[#8F8C84] flex items-center gap-1">
                      <BarChart3 className="w-3 h-3 text-[#C6A26B]" /> Charts
                    </div>
                    <div className="text-sm text-[#ECEAE4] font-medium mt-0.5">
                      {plan.infographicUpdates.length +
                        plan.additionalPages.filter((p) => p.isInfographicPage).length}{' '}
                      live
                    </div>
                  </div>
                  <div className="p-2.5 bg-[#121214] border border-white/[0.06] rounded">
                    <div className="text-[10px] text-[#8F8C84] flex items-center gap-1">
                      <Layers className="w-3 h-3 text-[#C6A26B]" /> Extended
                    </div>
                    <div className="text-sm text-[#ECEAE4] font-medium mt-0.5">
                      +{plan.additionalPages.length} pages
                    </div>
                  </div>
                </div>

                {/* Populated Live Infographics Preview */}
                {(plan.infographicUpdates.length > 0 ||
                  plan.additionalPages.some((p) => p.infographic)) && (
                  <div className="space-y-2">
                    <div className="text-[10px] uppercase tracking-wider text-[#C6A26B]">
                      Populated Live Vector Infographics
                    </div>
                    {[
                      ...plan.infographicUpdates,
                      ...plan.additionalPages
                        .filter((p) => p.infographic)
                        .map((p) => p.infographic!),
                    ].map((inf, idx) => (
                      <div
                        key={idx}
                        className="p-2.5 bg-[#121214] border border-white/[0.08] rounded space-y-2"
                      >
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="font-medium text-[#ECEAE4]">{inf.title}</span>
                          <span className="font-mono-tabular text-[10px] text-[#8F8C84]">
                            {inf.variant} · {inf.items.length} data points
                          </span>
                        </div>
                        <div
                          className="w-full aspect-[16/9] rounded-sm overflow-hidden"
                          dangerouslySetInnerHTML={{
                            __html: renderInfographicToSvgString(
                              {
                                templateId: `prev_${idx}`,
                                variant: inf.variant,
                                title: inf.title,
                                subtitle: inf.subtitle,
                                categoryLabel: inf.categoryLabel || 'Live Data',
                                sourceNote: inf.sourceNote || project.name,
                                fontFamily: ds.typography.captionFont,
                                backgroundColor: ds.colors.surface,
                                textColor: ds.colors.ink,
                                accentColor: ds.colors.primaryAccent,
                                secondaryColor: ds.colors.secondaryAccent,
                                items: inf.items.map((it, i) => ({
                                  id: `p_it_${i}`,
                                  ...it,
                                })),
                                showLegend: true,
                                showValues: true,
                              },
                              520,
                              292
                            ),
                          }}
                        />
                      </div>
                    ))}
                  </div>
                )}

                {/* Image Placeholders Preview */}
                {plan.imageUpdates.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="text-[10px] uppercase tracking-wider text-[#8F8C84]">
                      Labeled Image Placeholders ({imageMode === 'placeholders' ? 'Clean X-Cross Frames' : 'Keeping Existing Photos'})
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {plan.imageUpdates.map((img, i) => (
                        <div
                          key={`${img.elementId}_${i}`}
                          className="p-2.5 bg-[#121214] border border-white/[0.06] rounded"
                        >
                          <div className="text-[11px] font-medium text-[#ECEAE4] truncate">
                            {img.placeholderTitle}
                          </div>
                          <div className="text-[10px] text-[#8F8C84] line-clamp-2 mt-0.5">
                            {img.suggestedPhotoBrief}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Text Flow Sample Preview */}
                {plan.textUpdates.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="text-[10px] uppercase tracking-wider text-[#8F8C84]">
                      Flowed Text Frames Preview ({plan.textUpdates.length} mapped)
                    </div>
                    <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                      {plan.textUpdates.slice(0, 8).map((tu, idx) => (
                        <div
                          key={`${tu.elementId}_${idx}`}
                          className="p-2 bg-[#121214] border border-white/[0.06] rounded text-[11px] text-[#D7D4CC] line-clamp-2"
                        >
                          {tu.text}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {plan.additionalPages.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="text-[10px] uppercase tracking-wider text-[#C6A26B]">
                      Auto-Extended Pages (+{plan.additionalPages.length} cloned in exact same layout)
                    </div>
                    {plan.additionalPages.map((ap, i) => (
                      <div
                        key={i}
                        className="p-2.5 bg-[#121214] border border-[#C6A26B]/25 rounded text-[11px]"
                      >
                        <div className="font-medium text-[#ECEAE4]">
                          {ap.label} — {ap.heading}
                        </div>
                        <div className="text-[10px] text-[#8F8C84] line-clamp-2 mt-0.5">
                          {ap.body}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Bottom Action Footer */}
        <div className="px-6 py-3 border-t border-white/[0.08] bg-[#141417] flex items-center justify-between gap-3">
          <div className="text-[11px] text-[#8F8C84]">
            {plan
              ? 'Applying is 100% Undo-safe (Ctrl+Z) and keeps all coordinates, margins, fonts & colours locked.'
              : 'Tip: Select any of the unlimited Book or Report templates first, then paste your data here once.'}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3.5 py-1.5 text-xs text-[#A19E95] hover:text-white cursor-pointer"
            >
              Cancel
            </button>
            <button
              onClick={handleCommitFlow}
              disabled={!plan}
              className="px-4 py-1.5 bg-[#C6A26B] hover:bg-[#D5B47F] disabled:opacity-35 text-[#121214] text-xs font-semibold rounded flex items-center gap-1.5 cursor-pointer"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Flow Content Into Publication</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
