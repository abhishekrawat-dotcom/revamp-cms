import React, { useMemo, useState } from 'react';
import {
  BarChart3,
  BookmarkPlus,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet,
  Heart,
  Infinity as InfinityIcon,
  Layers,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import type {
  BookPage,
  BookProject,
  BookTemplate,
  BookTemplateCategory,
  CustomSavedTemplate,
  InfographicCategory,
  InfographicData,
  InfographicTemplate,
} from '../types/bookstudio';
import { BUILTIN_BOOK_TEMPLATES } from '../data/bookTemplates';
import { BUILTIN_INFOGRAPHIC_TEMPLATES } from '../data/infographicTemplates';
import { renderInfographicToSvgString } from '../engines/infographicEngine';
import {
  generateUnlimitedInfographicBatch,
  generateUnlimitedPublicationBatch,
} from '../engines/unlimitedTemplateEngine';
import {
  fetchAiTemplateRecommendations,
  generateAiInfographic,
  generateAiPublicationTemplate,
} from '../services/aiService';

interface TemplateLibraryModalProps {
  initialTab?: 'books' | 'infographics' | 'my_templates' | 'ai';
  currentProject?: BookProject | null;
  customTemplates: CustomSavedTemplate[];
  onClose: () => void;
  onCreateBookFromTemplate: (templateId: string) => void;
  onCreateBookFromTemplateObject: (tpl: BookTemplate) => void;
  onInsertBookPageLayout?: (page: BookPage) => void;
  onInsertInfographic: (template: InfographicTemplate) => void;
  onInsertCustomTemplate?: (tpl: CustomSavedTemplate) => void;
  onSaveCustomBookTemplate?: (tpl: BookTemplate) => void;
  onSaveCustomInfographicData?: (data: InfographicData) => void;
}

const BOOK_CATEGORIES: Array<'All' | BookTemplateCategory> = [
  'All',
  'Reports & Research',
  'Consulting & ESG',
  'Luxury & Premium Editorial',
  'Architecture & Interior Design',
  'Corporate & Institutional',
  'Art, Culture & Heritage',
];

const INFOGRAPHIC_CATEGORIES: Array<'All' | InfographicCategory> = [
  'All',
  'Data & Statistics',
  'Timeline & History',
  'Process & Workflow',
  'Comparison & Analysis',
  'Geography & Mapping',
  'Business & Corporate',
  'Technology & Innovation',
  'Sustainability & Impact',
  'Editorial Specials',
];

const TRIM_PRESETS = [
  { label: 'A4 Executive Report (210 × 297 mm)', w: 210, h: 297 },
  { label: 'US Letter Report (216 × 279 mm)', w: 216, h: 279 },
  { label: 'Portrait Coffee Table Book (240 × 300 mm)', w: 240, h: 300 },
  { label: 'Square Monograph (260 × 260 mm)', w: 260, h: 260 },
  { label: 'Landscape Folio Spread (300 × 240 mm)', w: 300, h: 240 },
];

const INFOGRAPHIC_VARIANT_CHOICES = [
  { value: 'auto', label: 'Auto-Select Best Visual' },
  { value: 'kpi_grid', label: 'Executive KPI Grid' },
  { value: 'horizontal_bars', label: 'Horizontal Comparison Bars' },
  { value: 'vertical_bars', label: 'Vertical Column Chart' },
  { value: 'donut_ring', label: 'Donut Breakdown Ring' },
  { value: 'line_trend', label: 'Multi-Year Line Trend' },
  { value: 'horizontal_timeline', label: 'Horizontal Milestone Timeline' },
  { value: 'process_steps', label: 'Process Workflow Steps' },
  { value: 'swot_matrix', label: 'SWOT Strategy Matrix' },
  { value: 'esg_pillars', label: 'ESG Sustainability Pillars' },
  { value: 'strategy_pyramid', label: 'Strategy Pyramid' },
  { value: 'impact_scorecard', label: 'Impact Scorecard' },
  { value: 'regional_bars', label: 'Regional Market Breakdown' },
  { value: 'india_map_data', label: 'India Regional Data Map' },
  { value: 'world_map_data', label: 'Global World Data Map' },
];

export const TemplateLibraryModal: React.FC<TemplateLibraryModalProps> = ({
  initialTab = 'books',
  currentProject,
  customTemplates,
  onClose,
  onCreateBookFromTemplate,
  onCreateBookFromTemplateObject,
  onInsertBookPageLayout,
  onInsertInfographic,
  onInsertCustomTemplate,
  onSaveCustomBookTemplate,
  onSaveCustomInfographicData,
}) => {
  const [tab, setTab] = useState<'books' | 'infographics' | 'my_templates' | 'ai'>(initialTab);
  const [search, setSearch] = useState('');
  const [docKindFilter, setDocKindFilter] = useState<'all' | 'book' | 'report'>('all');
  const [bookCat, setBookCat] = useState<'All' | BookTemplateCategory>('All');
  const [infoCat, setInfoCat] = useState<'All' | InfographicCategory>('All');
  const [favorites, setFavorites] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('bs_fav_templates') || '[]');
    } catch {
      return [];
    }
  });
  const [onlyFavorites, setOnlyFavorites] = useState(false);

  // Endless Procedural Generator Pools (Unlimited Books, Reports & Infographics)
  const [pubBatchCount, setPubBatchCount] = useState(1);
  const [infBatchCount, setInfBatchCount] = useState(1);

  const generatedPublications = useMemo(() => {
    const all: BookTemplate[] = [];
    for (let b = 0; b < pubBatchCount; b++) {
      all.push(...generateUnlimitedPublicationBatch(b, 12, 'all'));
    }
    return all;
  }, [pubBatchCount]);

  const generatedInfographics = useMemo(() => {
    const all: InfographicTemplate[] = [];
    for (let b = 0; b < infBatchCount; b++) {
      all.push(...generateUnlimitedInfographicBatch(b, 12));
    }
    return all;
  }, [infBatchCount]);

  const allPublicationTemplates = useMemo(
    () => [...BUILTIN_BOOK_TEMPLATES, ...generatedPublications],
    [generatedPublications]
  );

  const allInfographicTemplates = useMemo(
    () => [...BUILTIN_INFOGRAPHIC_TEMPLATES, ...generatedInfographics],
    [generatedInfographics]
  );

  // Interactive Multi-Page Book/Report Preview State
  const [previewBook, setPreviewBook] = useState<BookTemplate | null>(null);
  const [previewPages, setPreviewPages] = useState<BookPage[]>([]);
  const [previewPageIdx, setPreviewPageIdx] = useState(0);

  // AI Unlimited Generator & Recommender State
  const [aiMode, setAiMode] = useState<'publication' | 'infographic' | 'recommend'>('publication');
  const [aiDocKind, setAiDocKind] = useState<'report' | 'book'>('report');
  const [aiTrimIdx, setAiTrimIdx] = useState(0);
  const [aiChapters, setAiChapters] = useState(3);
  const [aiAesthetic, setAiAesthetic] = useState('Swiss Editorial Minimalist');
  const [aiPubPrompt, setAiPubPrompt] = useState(
    '2026 Global Clean Energy & Infrastructure Outlook Report covering solar grid storage, capital flows, and policy milestones.'
  );
  const [aiPubLoading, setAiPubLoading] = useState(false);
  const [aiPubError, setAiPubError] = useState<string | null>(null);
  const [aiGeneratedPub, setAiGeneratedPub] = useState<BookTemplate | null>(null);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  // AI Infographic Generator State
  const [aiInfPrompt, setAiInfPrompt] = useState(
    'Quarterly Enterprise Cloud Adoption & Operating Margin Growth across 5 regions'
  );
  const [aiInfRawData, setAiInfRawData] = useState(
    'North America: 88%, Europe: 79%, Asia Pacific: 84%, Latin America: 62%, Middle East: 71%'
  );
  const [aiInfVariant, setAiInfVariant] = useState('auto');
  const [aiInfLoading, setAiInfLoading] = useState(false);
  const [aiInfError, setAiInfError] = useState<string | null>(null);
  const [aiGeneratedInf, setAiGeneratedInf] = useState<InfographicData | null>(null);

  // AI Recommender State
  const [aiBrief, setAiBrief] = useState(
    currentProject?.subtitle ||
      'Architectural monograph featuring studio essays, full-bleed courtyard photography, and a 5-year material sustainability breakdown.'
  );
  const [aiComplexity, setAiComplexity] = useState('Moderate data & milestones');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiRecs, setAiRecs] = useState<{
    bookRecommendations: Array<{ templateId: string; reason: string }>;
    infographicRecommendations: Array<{ templateId: string; reason: string }>;
  } | null>(null);

  const toggleFav = (id: string) => {
    setFavorites((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      try {
        localStorage.setItem('bs_fav_templates', JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  const filteredBooks = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allPublicationTemplates.filter((t) => {
      const kind = t.documentKind || 'book';
      if (docKindFilter !== 'all' && kind !== docKindFilter) return false;
      if (bookCat !== 'All' && t.category !== bookCat) return false;
      if (onlyFavorites && !favorites.includes(t.id)) return false;
      if (!q) return true;
      return (
        t.name.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.category.toLowerCase().includes(q) ||
        t.tags.some((tg) => tg.toLowerCase().includes(q))
      );
    });
  }, [allPublicationTemplates, docKindFilter, search, bookCat, onlyFavorites, favorites]);

  const filteredInfographics = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allInfographicTemplates.filter((t) => {
      if (infoCat !== 'All' && t.category !== infoCat) return false;
      if (onlyFavorites && !favorites.includes(t.id)) return false;
      if (!q) return true;
      return (
        t.name.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.category.toLowerCase().includes(q) ||
        t.tags.some((tg) => tg.toLowerCase().includes(q))
      );
    });
  }, [allInfographicTemplates, search, infoCat, onlyFavorites, favorites]);

  const openBookPreview = (tpl: BookTemplate) => {
    setPreviewBook(tpl);
    setPreviewPages(tpl.buildPages());
    setPreviewPageIdx(0);
    setTab('books');
  };

  const handleUsePublicationTemplate = (tpl: BookTemplate) => {
    const isBuiltin = BUILTIN_BOOK_TEMPLATES.some((b) => b.id === tpl.id);
    if (isBuiltin) {
      onCreateBookFromTemplate(tpl.id);
    } else {
      onCreateBookFromTemplateObject(tpl);
    }
  };

  const handleRunAiPublication = async () => {
    setAiPubLoading(true);
    setAiPubError(null);
    setSavedNotice(null);
    try {
      const trim = TRIM_PRESETS[aiTrimIdx] || TRIM_PRESETS[0];
      const generated = await generateAiPublicationTemplate({
        prompt: aiPubPrompt,
        documentKind: aiDocKind,
        trimPreset: trim.label,
        widthMm: trim.w,
        heightMm: trim.h,
        chapterCount: aiChapters,
        aesthetic: aiAesthetic,
      });
      setAiGeneratedPub(generated);
    } catch (err) {
      setAiPubError(err instanceof Error ? err.message : 'Publication generation failed.');
    } finally {
      setAiPubLoading(false);
    }
  };

  const handleRunAiInfographic = async () => {
    setAiInfLoading(true);
    setAiInfError(null);
    setSavedNotice(null);
    try {
      const generated = await generateAiInfographic({
        prompt: aiInfPrompt,
        rawData: aiInfRawData,
        preferredVariant: aiInfVariant,
        designSystem: currentProject?.designSystem,
      });
      setAiGeneratedInf(generated);
    } catch (err) {
      setAiInfError(err instanceof Error ? err.message : 'Infographic generation failed.');
    } finally {
      setAiInfLoading(false);
    }
  };

  const runAiRecommendation = async () => {
    setAiLoading(true);
    setAiError(null);
    try {
      const recs = await fetchAiTemplateRecommendations({
        brief: aiBrief,
        bookCategory: currentProject?.category || 'Publication',
        contentWordCount: 4200,
        imageCount: currentProject?.imageAssets.length || 12,
        dataComplexity: aiComplexity,
        availableBookTemplates: BUILTIN_BOOK_TEMPLATES.map((b) => ({
          id: b.id,
          name: b.name,
          category: b.category,
        })),
        availableInfographics: BUILTIN_INFOGRAPHIC_TEMPLATES.map((inf) => ({
          id: inf.id,
          name: inf.name,
          category: inf.category,
        })),
      });
      setAiRecs(recs);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Recommendation failed.');
    } finally {
      setAiLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
      <div className="w-full max-w-6xl h-[89vh] bg-[#18181B] border border-white/[0.1] rounded-lg flex flex-col overflow-hidden shadow-2xl">
        {/* Top Header */}
        <div className="px-6 py-4 border-b border-white/[0.08] flex items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-lg font-medium text-[#F4F1EA]">
              Unlimited Books, Reports & Vector Infographics Studio
            </h2>
            <p className="text-[11px] text-[#98958D]">
              {allPublicationTemplates.length}+ Books & Reports Loaded (Infinite Variations) ·{' '}
              {allInfographicTemplates.length}+ Live Editable Vector Infographics · On-Demand AI Architect
            </p>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-[#98958D] hover:text-white rounded cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab & Search Bar */}
        <div className="px-6 py-2.5 border-b border-white/[0.08] bg-[#141417] flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1 flex-wrap">
            {(
              [
                ['books', BookOpen, `Books & Reports (${allPublicationTemplates.length}+)`],
                ['infographics', BarChart3, `Infographics (${allInfographicTemplates.length}+)`],
                ['ai', Sparkles, 'AI Unlimited Generator'],
                ['my_templates', Layers, `My Templates (${customTemplates.length})`],
              ] as const
            ).map(([id, Icon, label]) => (
              <button
                key={id}
                onClick={() => {
                  setTab(id);
                  setPreviewBook(null);
                }}
                className={`px-3 py-1.5 text-xs rounded flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap ${
                  tab === id
                    ? 'bg-[#28282F] text-[#ECEAE4] font-medium'
                    : 'text-[#98958D] hover:text-[#ECEAE4]'
                }`}
              >
                <Icon className="w-3.5 h-3.5 text-[#C6A26B]" />
                <span>{label}</span>
              </button>
            ))}
          </div>

          {tab !== 'ai' && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setOnlyFavorites((v) => !v)}
                className={`px-2.5 py-1.5 text-xs rounded border flex items-center gap-1 cursor-pointer ${
                  onlyFavorites
                    ? 'bg-[#2A2620] border-[#C6A26B] text-[#E6CFA5]'
                    : 'border-white/[0.08] text-[#98958D] hover:text-white'
                }`}
              >
                <Heart className="w-3 h-3" />
                <span>Favourites</span>
              </button>
              <div className="relative w-56">
                <Search className="w-3.5 h-3.5 text-[#7F7C75] absolute left-2.5 top-2" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search books, reports, charts..."
                  className="w-full bg-[#121214] border border-white/[0.08] rounded pl-8 pr-3 py-1 text-xs text-[#ECEAE4] placeholder-[#73706A] focus:outline-none focus:border-[#C6A26B]/60"
                />
              </div>
            </div>
          )}
        </div>

        {/* Main Content Area */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* BOOKS & REPORTS TAB */}
          {tab === 'books' && !previewBook && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-1 bg-[#121214] border border-white/[0.08] rounded p-0.5 text-xs">
                  {(
                    [
                      ['all', 'All Publications'],
                      ['book', 'Books & Monographs'],
                      ['report', 'Executive & Research Reports'],
                    ] as const
                  ).map(([kind, label]) => (
                    <button
                      key={kind}
                      onClick={() => setDocKindFilter(kind)}
                      className={`px-2.5 py-1 rounded cursor-pointer whitespace-nowrap ${
                        docKindFilter === kind
                          ? 'bg-[#C6A26B] text-[#121214] font-medium'
                          : 'text-[#A19E95] hover:text-white'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <button
                  onClick={() => setTab('ai')}
                  className="px-3 py-1.5 text-xs bg-[#26231D] hover:bg-[#332E24] border border-[#C6A26B]/40 text-[#E6CFA5] rounded flex items-center gap-1.5 cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5 text-[#C6A26B]" />
                  <span>Generate Custom Book / Report with AI</span>
                </button>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {BOOK_CATEGORIES.map((cat) => (
                  <button
                    key={cat}
                    onClick={() => setBookCat(cat)}
                    className={`px-3 py-1 text-xs rounded cursor-pointer ${
                      bookCat === cat
                        ? 'bg-[#2C2C34] text-[#F4F1EA] border border-[#C6A26B]/50 font-medium'
                        : 'bg-[#1F1F24] text-[#A19E95] hover:text-white'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {filteredBooks.map((tpl) => {
                  const isFav = favorites.includes(tpl.id);
                  const kind = tpl.documentKind === 'report' ? 'Report' : 'Book';
                  return (
                    <div
                      key={tpl.id}
                      className="bg-[#141417] border border-white/[0.08] hover:border-[#C6A26B]/50 rounded-md overflow-hidden flex flex-col"
                    >
                      <div
                        onClick={() => openBookPreview(tpl)}
                        className="h-40 relative overflow-hidden cursor-pointer group"
                        style={{ backgroundColor: tpl.designSystem.colors.paper }}
                      >
                        <img
                          src={tpl.coverImage}
                          alt={tpl.name}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover opacity-85 group-hover:scale-105 transition-transform duration-300"
                        />
                        <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/85 to-transparent" />
                        <div className="absolute top-2 left-2 px-1.5 py-0.5 bg-black/70 text-[10px] font-mono-tabular uppercase tracking-wider text-[#E6CFA5] rounded">
                          {kind}
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleFav(tpl.id);
                          }}
                          className="absolute top-2 right-2 p-1.5 bg-black/55 rounded text-white hover:text-[#C6A26B] cursor-pointer"
                        >
                          <Heart
                            className="w-3.5 h-3.5"
                            fill={isFav ? '#C6A26B' : 'none'}
                            color={isFav ? '#C6A26B' : 'currentColor'}
                          />
                        </button>
                        <div className="absolute bottom-2 left-2.5 right-2.5 flex items-center justify-between text-[10px] text-[#ECEAE4]">
                          <span className="truncate">{tpl.designSystem.typography.displayFont}</span>
                          <span className="font-mono-tabular shrink-0">
                            {tpl.dimensions.widthMm}×{tpl.dimensions.heightMm}mm
                          </span>
                        </div>
                      </div>

                      <div className="p-3.5 flex-1 flex flex-col justify-between gap-3">
                        <div className="space-y-1">
                          <div className="text-xs font-semibold text-[#F4F1EA]">{tpl.name}</div>
                          <div className="text-[10px] text-[#C6A26B]">{tpl.category}</div>
                          <p className="text-[11px] text-[#98958D] line-clamp-2 leading-relaxed">
                            {tpl.description}
                          </p>
                        </div>

                        <div className="flex items-center gap-1.5 pt-2 border-t border-white/[0.06]">
                          <button
                            onClick={() => openBookPreview(tpl)}
                            className="flex-1 py-1.5 text-[11px] bg-[#232329] hover:bg-[#2F2F37] text-[#ECEAE4] rounded cursor-pointer"
                          >
                            Preview Pages
                          </button>
                          <button
                            onClick={() => handleUsePublicationTemplate(tpl)}
                            className="flex-1 py-1.5 text-[11px] bg-[#C6A26B] hover:bg-[#D5B47F] text-[#121214] font-medium rounded cursor-pointer"
                          >
                            Use Template
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Endless Procedural Generator Bar */}
              <div className="pt-4 flex flex-col sm:flex-row items-center justify-between gap-3 p-4 bg-[#141417] border border-white/[0.08] rounded-md">
                <div className="flex items-center gap-3">
                  <InfinityIcon className="w-5 h-5 text-[#C6A26B] shrink-0" />
                  <div>
                    <div className="text-xs font-semibold text-[#F4F1EA]">
                      Unlimited Procedural Book & Report Engine
                    </div>
                    <div className="text-[11px] text-[#98958D]">
                      Showing {allPublicationTemplates.length} unique multi-page layouts (32 curated +{' '}
                      {generatedPublications.length} procedural variations). Generate endless fresh grids, palettes, and report structures.
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => setPubBatchCount((c) => c + 1)}
                  className="px-4 py-2 bg-[#C6A26B] hover:bg-[#D5B47F] text-[#121214] text-xs font-medium rounded flex items-center gap-1.5 whitespace-nowrap cursor-pointer shrink-0"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Generate 12 More Variations</span>
                </button>
              </div>
            </div>
          )}

          {/* INTERACTIVE MULTI-PAGE TEMPLATE PREVIEWER */}
          {tab === 'books' && previewBook && previewPages[previewPageIdx] && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-white/[0.08]">
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setPreviewBook(null)}
                    className="px-2.5 py-1 text-xs bg-[#24242A] hover:bg-[#303038] text-[#ECEAE4] rounded cursor-pointer"
                  >
                    ← Back to Library
                  </button>
                  <div>
                    <h3 className="text-sm font-semibold text-[#F4F1EA]">{previewBook.name}</h3>
                    <div className="text-[11px] text-[#98958D] font-mono-tabular">
                      {previewBook.category} · {previewBook.dimensions.widthMm}×
                      {previewBook.dimensions.heightMm}mm · Display:{' '}
                      {previewBook.designSystem.typography.displayFont} · Body:{' '}
                      {previewBook.designSystem.typography.bodyFont}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {onSaveCustomBookTemplate && (
                    <button
                      onClick={() => {
                        onSaveCustomBookTemplate(previewBook);
                        setSavedNotice(`Saved "${previewBook.name}" to My Templates.`);
                      }}
                      className="px-3 py-1.5 text-xs bg-[#232329] hover:bg-[#2F2F37] text-[#ECEAE4] rounded flex items-center gap-1 cursor-pointer"
                    >
                      <BookmarkPlus className="w-3.5 h-3.5 text-[#C6A26B]" />
                      <span>Save Template</span>
                    </button>
                  )}
                  {onInsertBookPageLayout && currentProject && (
                    <button
                      onClick={() => {
                        onInsertBookPageLayout(structuredClone(previewPages[previewPageIdx]));
                        onClose();
                      }}
                      className="px-3 py-1.5 text-xs bg-[#26262C] hover:bg-[#33333C] text-[#ECEAE4] rounded cursor-pointer"
                    >
                      Insert Page Into Active Document
                    </button>
                  )}
                  <button
                    onClick={() => handleUsePublicationTemplate(previewBook)}
                    className="px-4 py-1.5 text-xs bg-[#C6A26B] hover:bg-[#D5B47F] text-[#121214] font-medium rounded cursor-pointer"
                  >
                    Open Full Editable Document
                  </button>
                </div>
              </div>

              {savedNotice && <div className="text-xs text-[#8AA678]">{savedNotice}</div>}

              {/* Page Stepper */}
              <div className="flex flex-col items-center gap-4">
                <div className="flex items-center gap-4">
                  <button
                    disabled={previewPageIdx === 0}
                    onClick={() => setPreviewPageIdx((i) => Math.max(0, i - 1))}
                    className="p-2 bg-[#232329] hover:bg-[#2E2E36] disabled:opacity-30 rounded cursor-pointer"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>

                  {(() => {
                    const pg = previewPages[previewPageIdx];
                    const scale = 1.45;
                    const pw = previewBook.dimensions.widthMm * scale;
                    const ph = previewBook.dimensions.heightMm * scale;
                    return (
                      <div
                        style={{
                          width: `${pw}px`,
                          height: `${ph}px`,
                          backgroundColor: pg.backgroundColor,
                        }}
                        className="relative overflow-hidden shadow-2xl border border-white/15"
                      >
                        {pg.elements
                          .filter((e) => !e.hidden)
                          .sort((a, b) => a.zIndex - b.zIndex)
                          .map((el) => (
                            <div
                              key={el.id}
                              style={{
                                left: `${el.xMm * scale}px`,
                                top: `${el.yMm * scale}px`,
                                width: `${el.widthMm * scale}px`,
                                height: `${el.heightMm * scale}px`,
                                opacity: el.opacity ?? 1,
                              }}
                              className="absolute overflow-hidden"
                            >
                              {el.type === 'image' && el.image?.src && (
                                <img
                                  src={el.image.src}
                                  alt={el.name}
                                  referrerPolicy="no-referrer"
                                  className="w-full h-full object-cover"
                                />
                              )}
                              {el.type === 'infographic' && el.infographic && (
                                <div
                                  className="w-full h-full"
                                  dangerouslySetInnerHTML={{
                                    __html: renderInfographicToSvgString(
                                      el.infographic,
                                      Math.round(el.widthMm * 3),
                                      Math.round(el.heightMm * 3)
                                    ),
                                  }}
                                />
                              )}
                              {el.type === 'shape' && el.shape && (
                                <div
                                  className="w-full h-full"
                                  style={{
                                    backgroundColor: el.shape.fill,
                                    border:
                                      el.shape.strokeWidthMm > 0
                                        ? `${el.shape.strokeWidthMm * scale}px solid ${el.shape.stroke}`
                                        : 'none',
                                  }}
                                />
                              )}
                              {el.type === 'line' && el.shape && (
                                <div
                                  className="w-full mt-0.5"
                                  style={{
                                    borderTop: `${Math.max(1, el.shape.strokeWidthMm * scale)}px solid ${el.shape.stroke}`,
                                  }}
                                />
                              )}
                              {(el.type === 'text' || el.type === 'pageNumber') && el.textStyle && (
                                <div
                                  style={{
                                    fontFamily: `"${el.textStyle.fontFamily}", serif`,
                                    fontSize: `${(el.textStyle.fontSizePt / 72) * 25.4 * scale}px`,
                                    fontWeight: el.textStyle.fontWeight,
                                    fontStyle: el.textStyle.fontStyle || 'normal',
                                    color: el.textStyle.color,
                                    lineHeight: el.textStyle.lineHeight,
                                    textAlign: el.textStyle.textAlign,
                                    whiteSpace: 'pre-wrap',
                                  }}
                                >
                                  {el.type === 'pageNumber'
                                    ? String(previewPageIdx + 1).padStart(2, '0')
                                    : el.text}
                                </div>
                              )}
                            </div>
                          ))}
                      </div>
                    );
                  })()}

                  <button
                    disabled={previewPageIdx >= previewPages.length - 1}
                    onClick={() =>
                      setPreviewPageIdx((i) => Math.min(previewPages.length - 1, i + 1))
                    }
                    className="p-2 bg-[#232329] hover:bg-[#2E2E36] disabled:opacity-30 rounded cursor-pointer"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>

                <div className="flex flex-wrap items-center justify-center gap-1.5">
                  {previewPages.map((p, idx) => (
                    <button
                      key={p.id}
                      onClick={() => setPreviewPageIdx(idx)}
                      className={`px-2.5 py-1 text-[11px] rounded cursor-pointer ${
                        idx === previewPageIdx
                          ? 'bg-[#C6A26B] text-[#121214] font-medium'
                          : 'bg-[#222228] text-[#A19E95] hover:text-white'
                      }`}
                    >
                      {idx + 1}. {p.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* UNLIMITED EDITABLE VECTOR INFOGRAPHICS TAB */}
          {tab === 'infographics' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap gap-1.5">
                  {INFOGRAPHIC_CATEGORIES.map((cat) => (
                    <button
                      key={cat}
                      onClick={() => setInfoCat(cat)}
                      className={`px-2.5 py-1 text-[11px] rounded cursor-pointer ${
                        infoCat === cat
                          ? 'bg-[#C6A26B] text-[#121214] font-medium'
                          : 'bg-[#1F1F24] text-[#A19E95] hover:text-white'
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>

                <button
                  onClick={() => {
                    setAiMode('infographic');
                    setTab('ai');
                  }}
                  className="px-3 py-1.5 text-xs bg-[#26231D] hover:bg-[#332E24] border border-[#C6A26B]/40 text-[#E6CFA5] rounded flex items-center gap-1.5 cursor-pointer shrink-0"
                >
                  <Sparkles className="w-3.5 h-3.5 text-[#C6A26B]" />
                  <span>Generate Custom Infographic with AI</span>
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredInfographics.map((inf) => {
                  const isFav = favorites.includes(inf.id);
                  return (
                    <div
                      key={inf.id}
                      className="bg-[#141417] border border-white/[0.08] hover:border-[#C6A26B]/50 rounded-md overflow-hidden flex flex-col"
                    >
                      <div className="p-2.5 bg-[#0E0E10] relative">
                        <div
                          className="w-full aspect-[16/10] rounded-sm overflow-hidden"
                          dangerouslySetInnerHTML={{
                            __html: renderInfographicToSvgString(inf.defaultData, 480, 300),
                          }}
                        />
                        <button
                          onClick={() => toggleFav(inf.id)}
                          className="absolute top-4 right-4 p-1 bg-black/55 rounded text-white hover:text-[#C6A26B] cursor-pointer"
                        >
                          <Heart
                            className="w-3.5 h-3.5"
                            fill={isFav ? '#C6A26B' : 'none'}
                            color={isFav ? '#C6A26B' : 'currentColor'}
                          />
                        </button>
                      </div>

                      <div className="p-3.5 flex-1 flex flex-col justify-between gap-2.5">
                        <div>
                          <div className="text-xs font-semibold text-[#F4F1EA]">{inf.name}</div>
                          <div className="text-[10px] text-[#C6A26B] mt-0.5">{inf.category}</div>
                          <p className="text-[11px] text-[#98958D] mt-1 line-clamp-2">
                            {inf.description}
                          </p>
                        </div>

                        <button
                          onClick={() => {
                            onInsertInfographic(inf);
                            onClose();
                          }}
                          className="w-full py-1.5 text-[11px] bg-[#C6A26B] hover:bg-[#D5B47F] text-[#121214] font-medium rounded flex items-center justify-center gap-1 cursor-pointer"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>Insert Editable Vector Infographic</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Endless Procedural Infographics Bar */}
              <div className="pt-4 flex flex-col sm:flex-row items-center justify-between gap-3 p-4 bg-[#141417] border border-white/[0.08] rounded-md">
                <div className="flex items-center gap-3">
                  <InfinityIcon className="w-5 h-5 text-[#C6A26B] shrink-0" />
                  <div>
                    <div className="text-xs font-semibold text-[#F4F1EA]">
                      Unlimited Vector Infographic Synthesizer
                    </div>
                    <div className="text-[11px] text-[#98958D]">
                      Showing {allInfographicTemplates.length} editable SVG infographics (52 built-in +{' '}
                      {generatedInfographics.length} synthesized). Every chart updates live from the right data table.
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => setInfBatchCount((c) => c + 1)}
                  className="px-4 py-2 bg-[#C6A26B] hover:bg-[#D5B47F] text-[#121214] text-xs font-medium rounded flex items-center gap-1.5 whitespace-nowrap cursor-pointer shrink-0"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Generate 12 More Infographics</span>
                </button>
              </div>
            </div>
          )}

          {/* AI UNLIMITED GENERATOR & RECOMMENDER TAB */}
          {tab === 'ai' && (
            <div className="max-w-5xl mx-auto space-y-5">
              {/* Sub-mode switcher */}
              <div className="flex flex-wrap items-center gap-1.5 bg-[#141417] p-1 rounded-md border border-white/[0.08]">
                {(
                  [
                    ['publication', BookOpen, 'Generate Custom Book or Report'],
                    ['infographic', BarChart3, 'Generate Custom Vector Infographic'],
                    ['recommend', FileSpreadsheet, 'Match Existing Library Templates'],
                  ] as const
                ).map(([m, Icon, lbl]) => (
                  <button
                    key={m}
                    onClick={() => setAiMode(m)}
                    className={`flex-1 py-2 px-3 text-xs rounded flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap ${
                      aiMode === m
                        ? 'bg-[#C6A26B] text-[#121214] font-medium'
                        : 'text-[#A19E95] hover:text-white'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span>{lbl}</span>
                  </button>
                ))}
              </div>

              {savedNotice && (
                <div className="px-3 py-2 bg-[#1D2A1F] border border-[#6AA87E]/40 rounded text-xs text-[#BCE2C6]">
                  {savedNotice}
                </div>
              )}

              {/* MODE A: AI CUSTOM BOOK / REPORT GENERATOR */}
              {aiMode === 'publication' && (
                <div className="space-y-4">
                  <div className="p-5 bg-[#141417] border border-white/[0.08] rounded-md space-y-4">
                    <div>
                      <h3 className="text-sm font-semibold text-[#F4F1EA]">
                        AI Unlimited Book & Report Architect
                      </h3>
                      <p className="text-xs text-[#98958D] mt-0.5">
                        Generate a complete, bespoke multi-page Adobe InDesign-style Book or Executive Report with custom palette, Google Font pairing, written sections, and a live vector infographic.
                      </p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                      <label className="flex flex-col gap-1">
                        <span className="text-[11px] text-[#98958D]">Document Type</span>
                        <select
                          value={aiDocKind}
                          onChange={(e) => setAiDocKind(e.target.value as 'report' | 'book')}
                          className="bg-[#121214] border border-white/[0.1] rounded px-2.5 py-2 text-xs text-[#ECEAE4]"
                        >
                          <option value="report">Executive / Research Report</option>
                          <option value="book">Coffee Table / Editorial Book</option>
                        </select>
                      </label>

                      <label className="md:col-span-2 flex flex-col gap-1">
                        <span className="text-[11px] text-[#98958D]">Physical Trim Size</span>
                        <select
                          value={aiTrimIdx}
                          onChange={(e) => setAiTrimIdx(Number(e.target.value))}
                          className="bg-[#121214] border border-white/[0.1] rounded px-2.5 py-2 text-xs text-[#ECEAE4]"
                        >
                          {TRIM_PRESETS.map((p, idx) => (
                            <option key={p.label} value={idx}>
                              {p.label}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="flex flex-col gap-1">
                        <span className="text-[11px] text-[#98958D]">Chapters / Sections</span>
                        <select
                          value={aiChapters}
                          onChange={(e) => setAiChapters(Number(e.target.value))}
                          className="bg-[#121214] border border-white/[0.1] rounded px-2.5 py-2 text-xs text-[#ECEAE4]"
                        >
                          {[2, 3, 4, 5, 6].map((n) => (
                            <option key={n} value={n}>
                              {n} sections ({n + 3} pages)
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <label className="md:col-span-2 flex flex-col gap-1">
                        <span className="text-[11px] text-[#98958D]">Publication Topic, Audience & Key Themes</span>
                        <textarea
                          rows={3}
                          value={aiPubPrompt}
                          onChange={(e) => setAiPubPrompt(e.target.value)}
                          placeholder="e.g., 2026 Annual ESG & Carbon Transition Report for a renewable energy group..."
                          className="bg-[#121214] border border-white/[0.1] rounded p-2.5 text-xs text-[#ECEAE4]"
                        />
                      </label>

                      <label className="flex flex-col gap-1">
                        <span className="text-[11px] text-[#98958D]">Art Direction / Aesthetic</span>
                        <select
                          value={aiAesthetic}
                          onChange={(e) => setAiAesthetic(e.target.value)}
                          className="bg-[#121214] border border-white/[0.1] rounded px-2.5 py-2 text-xs text-[#ECEAE4]"
                        >
                          <option>Swiss Editorial Minimalist</option>
                          <option>Luxury Dark Obsidian & Gold</option>
                          <option>Institutional Boardroom Navy</option>
                          <option>Architectural Travertine & Linen</option>
                          <option>Sustainability Forest & Sand</option>
                          <option>High-Contrast Magazine Avant-Garde</option>
                        </select>
                      </label>
                    </div>

                    {aiPubError && <div className="text-xs text-[#E07A5F]">{aiPubError}</div>}

                    <button
                      onClick={() => void handleRunAiPublication()}
                      disabled={aiPubLoading}
                      className="px-4 py-2 bg-[#C6A26B] hover:bg-[#D5B47F] disabled:opacity-50 text-[#121214] text-xs font-medium rounded flex items-center gap-1.5 cursor-pointer"
                    >
                      {aiPubLoading ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Sparkles className="w-3.5 h-3.5" />
                      )}
                      <span>
                        {aiPubLoading
                          ? 'Designing Multi-Page Publication...'
                          : `Generate Custom ${aiDocKind === 'report' ? 'Report' : 'Book'} Template`}
                      </span>
                    </button>
                  </div>

                  {aiGeneratedPub && (
                    <div className="p-5 bg-[#141417] border border-[#C6A26B]/40 rounded-md flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                      <div className="space-y-1.5">
                        <div className="text-[10px] uppercase tracking-wider text-[#C6A26B]">
                          Generated {aiGeneratedPub.documentKind === 'report' ? 'Report' : 'Book'} ·{' '}
                          {aiGeneratedPub.category}
                        </div>
                        <div className="font-display text-lg text-[#F4F1EA]">{aiGeneratedPub.name}</div>
                        <p className="text-xs text-[#98958D] max-w-2xl">{aiGeneratedPub.description}</p>
                        <div className="flex items-center gap-2 pt-1">
                          {aiGeneratedPub.designSystem.colors.palette.map((c, idx) => (
                            <span
                              key={`${c}_${idx}`}
                              style={{ backgroundColor: c }}
                              className="w-5 h-5 rounded-sm border border-white/25"
                              title={c}
                            />
                          ))}
                          <span className="font-mono-tabular text-[11px] text-[#98958D] ml-1">
                            {aiGeneratedPub.dimensions.widthMm}×{aiGeneratedPub.dimensions.heightMm}mm ·{' '}
                            {aiGeneratedPub.designSystem.typography.displayFont} /{' '}
                            {aiGeneratedPub.designSystem.typography.bodyFont}
                          </span>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        <button
                          onClick={() => openBookPreview(aiGeneratedPub)}
                          className="px-3 py-2 bg-[#24242A] hover:bg-[#303038] text-xs text-[#ECEAE4] rounded cursor-pointer"
                        >
                          Preview Pages
                        </button>
                        {onSaveCustomBookTemplate && (
                          <button
                            onClick={() => {
                              onSaveCustomBookTemplate(aiGeneratedPub);
                              setSavedNotice(`Saved "${aiGeneratedPub.name}" to My Templates.`);
                            }}
                            className="px-3 py-2 bg-[#24242A] hover:bg-[#303038] text-xs text-[#ECEAE4] rounded flex items-center gap-1 cursor-pointer"
                          >
                            <BookmarkPlus className="w-3.5 h-3.5 text-[#C6A26B]" />
                            <span>Save to My Templates</span>
                          </button>
                        )}
                        <button
                          onClick={() => onCreateBookFromTemplateObject(aiGeneratedPub)}
                          className="px-4 py-2 bg-[#C6A26B] hover:bg-[#D5B47F] text-[#121214] text-xs font-medium rounded cursor-pointer"
                        >
                          Open as Editable Project
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* MODE B: AI CUSTOM VECTOR INFOGRAPHIC GENERATOR */}
              {aiMode === 'infographic' && (
                <div className="space-y-4">
                  <div className="p-5 bg-[#141417] border border-white/[0.08] rounded-md space-y-4">
                    <div>
                      <h3 className="text-sm font-semibold text-[#F4F1EA]">
                        AI Unlimited Vector Infographic Generator
                      </h3>
                      <p className="text-xs text-[#98958D] mt-0.5">
                        Describe any dataset, paste raw numbers or CSV rows, and generate a crisp, print-ready SVG infographic automatically styled to your document palette.
                      </p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <label className="md:col-span-2 flex flex-col gap-1">
                        <span className="text-[11px] text-[#98958D]">Infographic Topic or Question</span>
                        <input
                          type="text"
                          value={aiInfPrompt}
                          onChange={(e) => setAiInfPrompt(e.target.value)}
                          placeholder="e.g., 5-Year Revenue Growth vs R&D Investment..."
                          className="bg-[#121214] border border-white/[0.1] rounded px-3 py-2 text-xs text-[#ECEAE4]"
                        />
                      </label>

                      <label className="flex flex-col gap-1">
                        <span className="text-[11px] text-[#98958D]">Visual Layout Type</span>
                        <select
                          value={aiInfVariant}
                          onChange={(e) => setAiInfVariant(e.target.value)}
                          className="bg-[#121214] border border-white/[0.1] rounded px-2.5 py-2 text-xs text-[#ECEAE4]"
                        >
                          {INFOGRAPHIC_VARIANT_CHOICES.map((v) => (
                            <option key={v.value} value={v.value}>
                              {v.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>

                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] text-[#98958D]">
                        Optional Raw Data, Numbers, or Notes (leave blank to auto-synthesize realistic benchmarks)
                      </span>
                      <textarea
                        rows={3}
                        value={aiInfRawData}
                        onChange={(e) => setAiInfRawData(e.target.value)}
                        className="bg-[#121214] border border-white/[0.1] rounded p-2.5 text-xs text-[#ECEAE4]"
                      />
                    </label>

                    {aiInfError && <div className="text-xs text-[#E07A5F]">{aiInfError}</div>}

                    <button
                      onClick={() => void handleRunAiInfographic()}
                      disabled={aiInfLoading}
                      className="px-4 py-2 bg-[#C6A26B] hover:bg-[#D5B47F] disabled:opacity-50 text-[#121214] text-xs font-medium rounded flex items-center gap-1.5 cursor-pointer"
                    >
                      {aiInfLoading ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Sparkles className="w-3.5 h-3.5" />
                      )}
                      <span>{aiInfLoading ? 'Synthesizing Vector Infographic...' : 'Generate Live Vector Infographic'}</span>
                    </button>
                  </div>

                  {aiGeneratedInf && (
                    <div className="p-5 bg-[#141417] border border-[#C6A26B]/40 rounded-md grid grid-cols-1 lg:grid-cols-5 gap-5 items-center">
                      <div className="lg:col-span-3 bg-[#0E0E10] p-3 rounded border border-white/[0.08]">
                        <div
                          className="w-full aspect-[16/10] overflow-hidden rounded-sm"
                          dangerouslySetInnerHTML={{
                            __html: renderInfographicToSvgString(aiGeneratedInf, 640, 400),
                          }}
                        />
                      </div>

                      <div className="lg:col-span-2 space-y-3">
                        <div className="text-[10px] uppercase tracking-wider text-[#C6A26B]">
                          {aiGeneratedInf.categoryLabel} · {aiGeneratedInf.variant}
                        </div>
                        <div className="text-sm font-semibold text-[#F4F1EA]">{aiGeneratedInf.title}</div>
                        <p className="text-xs text-[#98958D]">{aiGeneratedInf.subtitle}</p>
                        <div className="font-mono-tabular text-[11px] text-[#A19E95]">
                          {aiGeneratedInf.items.length} editable data entries · Live SVG vector
                        </div>

                        <div className="flex flex-col gap-2 pt-2">
                          <button
                            onClick={() => {
                              onInsertInfographic({
                                id: aiGeneratedInf.templateId,
                                name: aiGeneratedInf.title,
                                category: 'Data & Statistics',
                                variant: aiGeneratedInf.variant,
                                description: aiGeneratedInf.subtitle,
                                tags: ['ai-generated'],
                                defaultWidthMm: 176,
                                defaultHeightMm: 112,
                                defaultData: aiGeneratedInf,
                              });
                              onClose();
                            }}
                            className="w-full py-2 bg-[#C6A26B] hover:bg-[#D5B47F] text-[#121214] text-xs font-medium rounded flex items-center justify-center gap-1.5 cursor-pointer"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            <span>Insert Onto Active Page</span>
                          </button>

                          {onSaveCustomInfographicData && (
                            <button
                              onClick={() => {
                                onSaveCustomInfographicData(aiGeneratedInf);
                                setSavedNotice(`Saved "${aiGeneratedInf.title}" to My Templates.`);
                              }}
                              className="w-full py-2 bg-[#24242A] hover:bg-[#303038] text-[#ECEAE4] text-xs rounded flex items-center justify-center gap-1.5 cursor-pointer"
                            >
                              <BookmarkPlus className="w-3.5 h-3.5 text-[#C6A26B]" />
                              <span>Save to My Templates</span>
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* MODE C: EXISTING LIBRARY RECOMMENDER */}
              {aiMode === 'recommend' && (
                <div className="space-y-4">
                  <div className="p-5 bg-[#141417] border border-white/[0.08] rounded-md space-y-4">
                    <div>
                      <h3 className="text-sm font-semibold text-[#F4F1EA]">
                        Editorial Library Recommender
                      </h3>
                      <p className="text-xs text-[#98958D] mt-0.5">
                        Match your brief against the 32 curated Books & Reports and 52 built-in Infographics.
                      </p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <label className="md:col-span-2 flex flex-col gap-1">
                        <span className="text-[11px] text-[#98958D]">Publication Brief</span>
                        <textarea
                          rows={3}
                          value={aiBrief}
                          onChange={(e) => setAiBrief(e.target.value)}
                          className="bg-[#121214] border border-white/[0.1] rounded p-2.5 text-xs text-[#ECEAE4]"
                        />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-[11px] text-[#98958D]">Data & Visual Complexity</span>
                        <select
                          value={aiComplexity}
                          onChange={(e) => setAiComplexity(e.target.value)}
                          className="bg-[#121214] border border-white/[0.1] rounded px-2.5 py-2 text-xs text-[#ECEAE4]"
                        >
                          <option>Image-led luxury visual book</option>
                          <option>Moderate data & milestones</option>
                          <option>Heavy corporate KPIs & ESG metrics</option>
                          <option>Historical timeline & heritage archive</option>
                        </select>
                      </label>
                    </div>

                    {aiError && <div className="text-xs text-[#E07A5F]">{aiError}</div>}

                    <button
                      onClick={() => void runAiRecommendation()}
                      disabled={aiLoading}
                      className="px-4 py-2 bg-[#C6A26B] hover:bg-[#D5B47F] disabled:opacity-50 text-[#121214] text-xs font-medium rounded flex items-center gap-1.5 cursor-pointer"
                    >
                      {aiLoading ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Sparkles className="w-3.5 h-3.5" />
                      )}
                      <span>{aiLoading ? 'Evaluating Libraries...' : 'Recommend Matching Templates'}</span>
                    </button>
                  </div>

                  {aiRecs && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="p-4 bg-[#141417] border border-white/[0.08] rounded-md space-y-3">
                        <div className="text-xs font-semibold text-[#C6A26B]">
                          Recommended Books & Reports
                        </div>
                        {aiRecs.bookRecommendations.map((rec) => {
                          const tpl = BUILTIN_BOOK_TEMPLATES.find((b) => b.id === rec.templateId);
                          if (!tpl) return null;
                          return (
                            <div
                              key={rec.templateId}
                              className="p-3 bg-[#1B1B1F] border border-white/[0.06] rounded space-y-2"
                            >
                              <div className="text-xs font-medium text-[#F4F1EA]">{tpl.name}</div>
                              <p className="text-[11px] text-[#98958D]">{rec.reason}</p>
                              <button
                                onClick={() => onCreateBookFromTemplate(tpl.id)}
                                className="px-3 py-1 bg-[#C6A26B] text-[#121214] text-[11px] font-medium rounded cursor-pointer"
                              >
                                Use Template
                              </button>
                            </div>
                          );
                        })}
                      </div>

                      <div className="p-4 bg-[#141417] border border-white/[0.08] rounded-md space-y-3">
                        <div className="text-xs font-semibold text-[#C6A26B]">
                          Recommended Editable Infographics
                        </div>
                        {aiRecs.infographicRecommendations.map((rec) => {
                          const inf = BUILTIN_INFOGRAPHIC_TEMPLATES.find((i) => i.id === rec.templateId);
                          if (!inf) return null;
                          return (
                            <div
                              key={rec.templateId}
                              className="p-3 bg-[#1B1B1F] border border-white/[0.06] rounded space-y-2"
                            >
                              <div className="text-xs font-medium text-[#F4F1EA]">{inf.name}</div>
                              <p className="text-[11px] text-[#98958D]">{rec.reason}</p>
                              <button
                                onClick={() => {
                                  onInsertInfographic(inf);
                                  onClose();
                                }}
                                className="px-3 py-1 bg-[#26262C] hover:bg-[#32323B] text-[#ECEAE4] text-[11px] rounded cursor-pointer"
                              >
                                Insert Infographic
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* MY SAVED TEMPLATES TAB */}
          {tab === 'my_templates' && (
            <div className="space-y-4">
              {customTemplates.length === 0 ? (
                <div className="py-16 text-center bg-[#141417] border border-white/[0.06] rounded-md space-y-2">
                  <Layers className="w-6 h-6 text-[#7F7C75] mx-auto" />
                  <p className="text-xs text-[#98958D]">
                    No saved custom templates yet. Save any AI-generated book/report, edited infographic, or selected canvas component to reuse it across projects.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {customTemplates.map((ct) => (
                    <div
                      key={ct.id}
                      className="p-4 bg-[#141417] border border-white/[0.08] rounded-md flex flex-col justify-between gap-3"
                    >
                      <div className="space-y-1">
                        <div className="text-[10px] uppercase tracking-wider text-[#C6A26B]">
                          {ct.templateKind} · {ct.collectionName}
                        </div>
                        <div className="text-xs font-semibold text-[#F4F1EA]">{ct.title}</div>
                        <p className="text-[11px] text-[#98958D]">{ct.description}</p>
                      </div>
                      {onInsertCustomTemplate && (
                        <button
                          onClick={() => {
                            onInsertCustomTemplate(ct);
                            onClose();
                          }}
                          className="w-full py-1.5 text-[11px] bg-[#26262C] hover:bg-[#32323B] text-[#ECEAE4] rounded cursor-pointer"
                        >
                          {ct.templateKind === 'book' ? 'Open as Editable Document' : 'Insert Into Active Page'}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
