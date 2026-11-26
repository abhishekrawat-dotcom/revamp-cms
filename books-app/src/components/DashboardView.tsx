import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  ArchiveRestore,
  BarChart3,
  BookOpen,
  Cloud,
  Copy,
  Download,
  FilePlus2,
  FolderOpen,
  LayoutGrid,
  ArrowLeft,
  Loader2,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';
import type { BookSummary } from '../types/bookstudio';
import { formatMeasurement } from '../engines/dimensionEngine';
import { mountAccountMenu, type SignedInUser } from '../services/api';

interface DashboardViewProps {
  projects: BookSummary[];
  activeProjectId: string | null;
  user: SignedInUser | null;
  /** the list is still being read, or could not be (the sentence to show) */
  loading: boolean;
  loadError: string;
  onRetryLoad: () => void;
  /** a book being opened, copied or backed up: its card shows that */
  busyId: string | null;
  onDownloadBackup: (projectId: string) => void;
  onOpenProject: (projectId: string) => void;
  onCreateBlankBook: () => void;
  onOpenTemplateUpload: () => void;
  onOpenBookTemplates: () => void;
  onOpenInfographicsLibrary: () => void;
  onDuplicateProject: (projectId: string) => void;
  onToggleArchiveProject: (projectId: string) => void;
  onDeleteProject: (projectId: string) => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  projects,
  activeProjectId,
  user,
  onOpenProject,
  onCreateBlankBook,
  onOpenTemplateUpload,
  onOpenBookTemplates,
  onOpenInfographicsLibrary,
  onDuplicateProject,
  onToggleArchiveProject,
  onDeleteProject,
  loading,
  loadError,
  onRetryLoad,
  busyId,
  onDownloadBackup,
}) => {
  const accountRef = useRef<HTMLSpanElement | null>(null);
  useEffect(() => mountAccountMenu(accountRef.current), []);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<'active' | 'archived'>('active');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const filteredProjects = useMemo(() => {
    const q = search.trim().toLowerCase();
    return projects.filter((p) => {
      const statusOk =
        filterStatus === 'archived' ? p.status === 'archived' : p.status !== 'archived';
      const qOk =
        !q ||
        p.name.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q) ||
        p.subtitle.toLowerCase().includes(q);
      return statusOk && qOk;
    });
  }, [projects, search, filterStatus]);

  return (
    <div className="min-h-screen bg-[#121214] text-[#ECEAE4] flex flex-col">
      {/* Top Studio Header */}
      <header className="h-14 border-b border-white/[0.08] bg-[#18181B] px-6 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <a
            href="/Event_Listing.html"
            title="Back to EventSphere's events"
            className="p-1.5 -ml-1.5 text-[#A19E95] hover:text-white hover:bg-white/[0.06] rounded"
          >
            <ArrowLeft className="w-4 h-4" />
          </a>
          <span className="font-display text-lg font-semibold tracking-wide text-[#ECEAE4]">
            BOOKSTUDIO
          </span>
          <span className="text-white/20">·</span>
          <span className="text-xs text-[#98958D]">
            InDesign-Class Book, Executive Report & Vector Infographic Publishing Studio
          </span>
        </div>

        <div className="flex items-center gap-3">
          {activeProjectId && (
            <button
              onClick={() => onOpenProject(activeProjectId)}
              className="px-3 py-1.5 text-xs text-[#D7D4CC] hover:text-white bg-[#232329] hover:bg-[#2C2C34] border border-white/[0.08] rounded transition-colors cursor-pointer"
            >
              Return to Active Studio
            </button>
          )}
          <span className="flex items-center gap-2 text-xs text-[#A19E95]" title="Books are kept in EventSphere">
            <Cloud className="w-3.5 h-3.5 text-[#8AA678]" />
            <span className="hidden sm:inline">{user ? user.email : ''}</span>
          </span>
          <span ref={accountRef} data-rv-account-host />
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-8 space-y-10">
        {/* Creation Pathways */}
        <section className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2">
            <div>
              <h1 className="font-display text-2xl sm:text-3xl font-medium text-[#F4F1EA]">
                Start a New Publication
              </h1>
              <p className="text-xs text-[#98958D] mt-1">
                Launch unlimited books, executive reports, and live vector infographics, import existing IDML/PDF design systems, or start from custom press trim sizes.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            <button
              onClick={onOpenTemplateUpload}
              className="group text-left p-5 bg-[#18181B] hover:bg-[#1E1E22] border border-[#C6A26B]/40 hover:border-[#C6A26B] rounded-md transition-colors flex flex-col justify-between gap-4 cursor-pointer"
            >
              <div className="w-9 h-9 rounded bg-[#C6A26B]/15 text-[#C6A26B] flex items-center justify-center">
                <Upload className="w-4 h-4" />
              </div>
              <div className="space-y-1">
                <div className="text-sm font-medium text-[#F4F1EA] group-hover:text-[#E5C996] transition-colors">
                  Upload Design Template
                </div>
                <p className="text-xs text-[#98958D] leading-relaxed">
                  Import JPG, PNG, PDF, or IDML reference spreads with content and photographs. Recreate your exact design system after approval.
                </p>
              </div>
              <div className="text-[11px] text-[#C6A26B] font-medium">
                Analyze & Approve Master System →
              </div>
            </button>

            <button
              onClick={onOpenBookTemplates}
              className="group text-left p-5 bg-[#18181B] hover:bg-[#1E1E22] border border-white/[0.08] hover:border-white/[0.2] rounded-md transition-colors flex flex-col justify-between gap-4 cursor-pointer"
            >
              <div className="w-9 h-9 rounded bg-white/[0.05] text-[#C6A26B] flex items-center justify-center">
                <LayoutGrid className="w-4 h-4" />
              </div>
              <div className="space-y-1">
                <div className="text-sm font-medium text-[#F4F1EA]">
                  Unlimited Books & Reports
                </div>
                <p className="text-xs text-[#98958D] leading-relaxed">
                  32 curated Book & Executive Report templates plus infinite procedural variations and on-demand AI publication generation.
                </p>
              </div>
              <div className="text-[11px] text-[#D7D4CC] group-hover:text-white">
                Explore Unlimited Templates →
              </div>
            </button>

            <button
              onClick={onOpenInfographicsLibrary}
              className="group text-left p-5 bg-[#18181B] hover:bg-[#1E1E22] border border-white/[0.08] hover:border-white/[0.2] rounded-md transition-colors flex flex-col justify-between gap-4 cursor-pointer"
            >
              <div className="w-9 h-9 rounded bg-white/[0.05] text-[#C6A26B] flex items-center justify-center">
                <BarChart3 className="w-4 h-4" />
              </div>
              <div className="space-y-1">
                <div className="text-sm font-medium text-[#F4F1EA]">
                  Unlimited Vector Infographics
                </div>
                <p className="text-xs text-[#98958D] leading-relaxed">
                  52 built-in SVG templates plus endless procedural and AI-generated charts, timelines, maps, SWOT matrices, and ESG scorecards.
                </p>
              </div>
              <div className="text-[11px] text-[#D7D4CC] group-hover:text-white">
                Open Infographic Studio →
              </div>
            </button>

            <button
              onClick={onCreateBlankBook}
              className="group text-left p-5 bg-[#18181B] hover:bg-[#1E1E22] border border-white/[0.08] hover:border-white/[0.2] rounded-md transition-colors flex flex-col justify-between gap-4 cursor-pointer"
            >
              <div className="w-9 h-9 rounded bg-white/[0.05] text-[#C6A26B] flex items-center justify-center">
                <FilePlus2 className="w-4 h-4" />
              </div>
              <div className="space-y-1">
                <div className="text-sm font-medium text-[#F4F1EA]">
                  Custom Blank Edition
                </div>
                <p className="text-xs text-[#98958D] leading-relaxed">
                  Begin from clean master pages with exact physical dimensions in mm, in, cm, pt, or px, custom margins, bleed, and bindery specifications.
                </p>
              </div>
              <div className="text-[11px] text-[#D7D4CC] group-hover:text-white">
                Create Blank Book →
              </div>
            </button>
          </div>
        </section>

        {/* Saved Publications */}
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.08] pb-3">
            <div className="flex items-center gap-4">
              <h2 className="text-sm font-semibold text-[#ECEAE4]">
                Studio Projects ({filteredProjects.length})
              </h2>
              <div className="flex items-center gap-1 text-xs">
                <button
                  onClick={() => setFilterStatus('active')}
                  className={`px-2.5 py-1 rounded cursor-pointer ${
                    filterStatus === 'active'
                      ? 'bg-[#26262C] text-[#ECEAE4]'
                      : 'text-[#8F8C84] hover:text-[#D7D4CC]'
                  }`}
                >
                  Active
                </button>
                <button
                  onClick={() => setFilterStatus('archived')}
                  className={`px-2.5 py-1 rounded cursor-pointer ${
                    filterStatus === 'archived'
                      ? 'bg-[#26262C] text-[#ECEAE4]'
                      : 'text-[#8F8C84] hover:text-[#D7D4CC]'
                  }`}
                >
                  Archived
                </button>
              </div>
            </div>

            <div className="relative w-64">
              <Search className="w-3.5 h-3.5 text-[#7F7C75] absolute left-2.5 top-2.5" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter publications..."
                className="w-full bg-[#18181B] border border-white/[0.08] rounded pl-8 pr-3 py-1.5 text-xs text-[#ECEAE4] placeholder-[#73706A] focus:outline-none focus:border-[#C6A26B]/60"
              />
            </div>
          </div>

          {loading ? (
            <div className="py-16 text-center bg-[#18181B] border border-white/[0.06] rounded-md text-sm text-[#A19E95] flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Loading the team's books…</span>
            </div>
          ) : loadError ? (
            <div role="alert" className="py-12 text-center bg-[#18181B] border border-[#E07A5F]/30 rounded-md space-y-3">
              <p className="text-sm text-[#F2B8A2]">{loadError}</p>
              <button
                onClick={onRetryLoad}
                className="px-3 py-1.5 bg-[#25252C] hover:bg-[#32323B] text-xs text-[#ECEAE4] rounded cursor-pointer"
              >
                Try again
              </button>
            </div>
          ) : filteredProjects.length === 0 ? (
            <div className="py-16 text-center bg-[#18181B] border border-white/[0.06] rounded-md space-y-2">
              <BookOpen className="w-6 h-6 text-[#7F7C75] mx-auto" />
              <p className="text-sm text-[#A19E95]">
                {projects.length === 0
                  ? 'No books yet. Start one with the options above.'
                  : search.trim()
                    ? `No ${filterStatus === 'archived' ? 'archived' : 'active'} books match your search.`
                    : `No ${filterStatus === 'archived' ? 'archived' : 'active'} books.`}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {filteredProjects.map((proj) => {
                const busy = busyId === proj.id;
                const updatedDate = new Date(proj.updatedAt).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                });
                const isConfirmingDelete = confirmDeleteId === proj.id;

                return (
                  <article
                    key={proj.id}
                    className="bg-[#18181B] border border-white/[0.08] hover:border-white/[0.16] rounded-md overflow-hidden flex flex-col transition-colors"
                  >
                    <div
                      onClick={() => onOpenProject(proj.id)}
                      className="h-44 bg-[#101012] relative overflow-hidden cursor-pointer group"
                    >
                      {proj.coverThumbnail ? (
                        <img
                          src={proj.coverThumbnail}
                          alt={proj.name}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover opacity-85 group-hover:scale-103 transition-transform duration-300"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-[#5A5852]">
                          <BookOpen className="w-10 h-10" />
                        </div>
                      )}
                      <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/80 to-transparent" />
                      <div className="absolute bottom-2.5 left-3 right-3 flex items-center justify-between text-[11px] text-[#E6E3DC]">
                        <span className="truncate">{proj.category}</span>
                        <span className="font-mono-tabular shrink-0">
                          {formatMeasurement(proj.dimensions.widthMm, proj.unit, 0)} ×{' '}
                          {formatMeasurement(proj.dimensions.heightMm, proj.unit, 0)}
                        </span>
                      </div>
                    </div>

                    <div className="p-4 flex-1 flex flex-col justify-between gap-3">
                      <div className="space-y-1">
                        <h3
                          onClick={() => onOpenProject(proj.id)}
                          className="font-display text-base font-medium text-[#F4F1EA] hover:text-[#DFC08E] cursor-pointer truncate"
                        >
                          {proj.name}
                        </h3>
                        <div className="font-mono-tabular text-[11px] text-[#98958D]">
                          {proj.pageCount} pages · {(proj.wordCount || 0).toLocaleString()} words · Updated {updatedDate}
                          {proj.updatedBy ? ` by ${proj.updatedBy}` : ''}
                        </div>
                      </div>

                      {isConfirmingDelete ? (
                        <div className="flex items-center justify-between gap-2 pt-2 border-t border-white/[0.08]">
                          <span className="text-[11px] text-[#E07A5F]">Delete this book for everyone?</span>
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => setConfirmDeleteId(null)}
                              className="px-2 py-1 text-[11px] text-[#A19E95] hover:text-white cursor-pointer"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={() => {
                                onDeleteProject(proj.id);
                                setConfirmDeleteId(null);
                              }}
                              className="px-2.5 py-1 text-[11px] bg-[#A33B2E] hover:bg-[#C04637] text-white rounded cursor-pointer"
                            >
                              Confirm
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between pt-2 border-t border-white/[0.08]">
                          <button
                            onClick={() => onOpenProject(proj.id)}
                            className="px-3 py-1.5 bg-[#C6A26B] hover:bg-[#D5B47F] text-[#121214] text-xs font-medium rounded flex items-center gap-1.5 cursor-pointer"
                          >
                            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FolderOpen className="w-3.5 h-3.5" />}
                            <span>{busy ? 'Opening…' : 'Open Studio'}</span>
                          </button>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => onDuplicateProject(proj.id)}
                              title="Duplicate Book Project"
                              className="p-1.5 text-[#98958D] hover:text-[#ECEAE4] hover:bg-white/[0.06] rounded cursor-pointer"
                            >
                              <Copy className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => onDownloadBackup(proj.id)}
                              title="Download .bookstudio.zip Backup Package"
                              className="p-1.5 text-[#98958D] hover:text-[#ECEAE4] hover:bg-white/[0.06] rounded cursor-pointer"
                            >
                              <Download className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => onToggleArchiveProject(proj.id)}
                              title={proj.status === 'archived' ? 'Unarchive Project' : 'Archive Project'}
                              className="p-1.5 text-[#98958D] hover:text-[#ECEAE4] hover:bg-white/[0.06] rounded cursor-pointer"
                            >
                              {proj.status === 'archived' ? (
                                <ArchiveRestore className="w-3.5 h-3.5" />
                              ) : (
                                <Archive className="w-3.5 h-3.5" />
                              )}
                            </button>
                            <button
                              onClick={() => setConfirmDeleteId(proj.id)}
                              title="Delete Project"
                              className="p-1.5 text-[#98958D] hover:text-[#E07A5F] hover:bg-white/[0.06] rounded cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </main>
    </div>
  );
};
