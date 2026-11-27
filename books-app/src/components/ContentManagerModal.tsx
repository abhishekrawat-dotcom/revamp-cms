import React, { useMemo, useState } from 'react';
import {
  ArrowRight,
  BarChart2,
  CheckCircle2,
  FileText,
  Plus,
  Trash2,
  Upload,
  Wand2,
  X,
} from 'lucide-react';
import type { BookProject, ContentSection } from '../types/bookstudio';
import { uploadManuscript } from '../services/storageService';
import { countWords, findTextElementsOnPage } from '../engines/textEngine';
import { sectionPlacement } from '../engines/pourEngine';
import { EditorialCountsPanel, useEditorialCounts } from './EditorialDashboard';
import { PourManuscriptModal } from './PourManuscriptModal';

interface ContentManagerModalProps {
  project: BookProject;
  /** the page open on the canvas (the pour starts there) */
  activePageId: string;
  /** false for a Content editor: a section is put only into a frame the page has */
  canDesign: boolean;
  /** which part opens first: the manuscript, the word counts, or "Pour manuscript into frames" */
  initialView?: 'manuscript' | 'analytics' | 'pour';
  onUpdateProject: (updated: BookProject) => void;
  onJumpToPage: (pageId: string, elementId?: string) => void;
  /** takes back the last change (after a pour) */
  onUndo?: () => void;
  onClose: () => void;
}

export const ContentManagerModal: React.FC<ContentManagerModalProps> = ({
  project,
  activePageId,
  canDesign,
  initialView = 'manuscript',
  onUpdateProject,
  onJumpToPage,
  onUndo,
  onClose,
}) => {
  const [tab, setTab] = useState<'manuscript' | 'analytics'>(initialView === 'analytics' ? 'analytics' : 'manuscript');
  const [pourOpen, setPourOpen] = useState(initialView === 'pour');
  const [poured, setPoured] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [newBody, setNewBody] = useState('');
  const [newKind, setNewKind] = useState<ContentSection['kind']>('body');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [assignPageMap, setAssignPageMap] = useState<Record<string, string>>({});

  const counts = useEditorialCounts(project);
  const placement = useMemo(() => sectionPlacement(project), [project]);

  const handleUploadManuscript = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      const data = await uploadManuscript(file);
      const incoming: ContentSection[] = (data.sections || []).map(
        (s: ContentSection, i: number) => ({
          id: `sec_${Date.now()}_${i}`,
          title: s.title || `Imported Section ${i + 1}`,
          kind: s.kind || 'body',
          body: s.body,
          orderIndex: project.contentSections.length + i,
        })
      );
      onUpdateProject({
        ...project,
        contentSections: [...project.contentSections, ...incoming],
      });
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleAddSection = () => {
    if (!newTitle.trim() && !newBody.trim()) return;
    const sec: ContentSection = {
      id: `sec_${Date.now()}`,
      title: newTitle.trim() || `Section ${project.contentSections.length + 1}`,
      kind: newKind,
      body: newBody.trim(),
      orderIndex: project.contentSections.length,
    };
    onUpdateProject({
      ...project,
      contentSections: [...project.contentSections, sec],
    });
    setNewTitle('');
    setNewBody('');
  };

  const handleAssignToPage = (section: ContentSection) => {
    const targetPageId = assignPageMap[section.id] || project.pages[0]?.id;
    if (!targetPageId) return;
    const targetPage = project.pages.find((p) => p.id === targetPageId);
    if (!targetPage) return;

    // Assign into matching text frame on page without altering frame geometry
    const textFrames = findTextElementsOnPage(targetPage);
    const chosenFrame =
      textFrames.find((f) => f.textRole === section.kind) ||
      textFrames.find((f) => f.textRole === 'body') ||
      textFrames[0];
    // a new frame is the design's: a Content editor puts the section into a frame the page already has
    if (!chosenFrame && !canDesign) {
      const n = project.pages.findIndex((p) => p.id === targetPageId) + 1;
      setUploadError(`Page ${n} has no text frame to put this section in. Choose another page, or use "Pour into frames", which finds the frames for you.`);
      return;
    }
    setUploadError(null);

    const updatedPages = project.pages.map((p) => {
      if (p.id !== targetPageId) return p;
      if (chosenFrame) {
        return {
          ...p,
          elements: p.elements.map((el) =>
            el.id === chosenFrame.id
              ? { ...el, text: section.body, contentSectionId: section.id }
              : el
          ),
        };
      }
      // If page has no text frame yet, place a new clean text frame aligned to margins (a Designer's only: see above)
      const m = project.dimensions.margins;
      const w = Math.max(60, project.dimensions.widthMm - m.inner - m.outer);
      return {
        ...p,
        elements: [
          ...p.elements,
          {
            id: `el_txt_${Date.now()}`,
            name: section.title,
            type: 'text' as const,
            xMm: m.outer,
            yMm: m.top + 10,
            widthMm: w,
            heightMm: 90,
            rotation: 0,
            opacity: 1,
            locked: false,
            hidden: false,
            zIndex: p.elements.length + 2,
            contentSectionId: section.id,
            textRole: section.kind === 'quote' ? ('quote' as const) : ('body' as const),
            text: section.body,
            textStyle: {
              fontFamily: project.designSystem.typography.bodyFont,
              fontSizePt: project.designSystem.typography.scale.bodyPt,
              fontWeight: 400,
              color: project.designSystem.colors.ink,
              lineHeight: 1.55,
              letterSpacingEm: 0,
              textAlign: 'left' as const,
              verticalAlign: 'top' as const,
              paragraphSpacingMm: 4,
              columns: 1,
              columnGapMm: 5,
              insetMm: 0,
            },
          },
        ],
      };
    });

    const updatedSections = project.contentSections.map((s) =>
      s.id === section.id
        ? { ...s, assignedPageId: targetPageId, assignedElementId: chosenFrame?.id }
        : s
    );

    onUpdateProject({
      ...project,
      pages: updatedPages,
      contentSections: updatedSections,
    });
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
      <div className="w-full max-w-5xl h-[86vh] bg-[#18181B] border border-white/[0.1] rounded-lg flex flex-col overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="px-6 py-4 border-b border-white/[0.08] flex items-center justify-between">
          <div>
            <h2 className="font-display text-lg font-medium text-[#F4F1EA]">
              Manuscript and word counts
            </h2>
            <p className="text-[11px] text-[#98958D]">
              Import or write the book's text here, then put it into the page frames. The word counts are for editing only: they are never printed or exported.
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 text-[#98958D] hover:text-white rounded cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="px-6 py-2 border-b border-white/[0.08] bg-[#141417] flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setTab('manuscript')}
              className={`px-3 py-1.5 text-xs rounded flex items-center gap-1.5 cursor-pointer ${
                tab === 'manuscript'
                  ? 'bg-[#28282F] text-[#ECEAE4] font-medium'
                  : 'text-[#98958D] hover:text-white'
              }`}
            >
              <FileText className="w-3.5 h-3.5 text-[#C6A26B]" />
              <span>Manuscript ({project.contentSections.length} sections)</span>
            </button>
            <button
              onClick={() => setTab('analytics')}
              className={`px-3 py-1.5 text-xs rounded flex items-center gap-1.5 cursor-pointer ${
                tab === 'analytics'
                  ? 'bg-[#28282F] text-[#ECEAE4] font-medium'
                  : 'text-[#98958D] hover:text-white'
              }`}
            >
              <BarChart2 className="w-3.5 h-3.5 text-[#C6A26B]" />
              <span>
                Word counts ({counts.totalWords.toLocaleString()} words)
              </span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setPourOpen(true)}
              disabled={project.contentSections.length === 0}
              title={
                project.contentSections.length === 0
                  ? 'Import or add the manuscript first'
                  : 'Put the manuscript into the book\'s text frames in reading order, without moving any frame'
              }
              className="px-3 py-1.5 bg-[#26262C] hover:bg-[#32323B] border border-[#C6A26B]/40 text-[#ECEAE4] text-xs font-medium rounded flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              <Wand2 className="w-3.5 h-3.5 text-[#C6A26B]" />
              <span>Pour into frames{counts.notPlaced.length ? ` (${counts.notPlaced.length} not placed)` : ''}</span>
            </button>
            <label className="px-3 py-1.5 bg-[#C6A26B] hover:bg-[#D5B47F] text-[#121214] text-xs font-medium rounded flex items-center gap-1.5 cursor-pointer">
              <Upload className="w-3.5 h-3.5" />
              <span>{uploading ? 'Importing...' : 'Import Word, PDF, text, RTF or CSV'}</span>
              <input
                type="file"
                accept=".docx,.pdf,.txt,.rtf,.csv"
                onChange={handleUploadManuscript}
                className="hidden"
              />
            </label>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {uploadError && (
            <div role="alert" className="p-3 bg-[#2B1B19] border border-[#D94F3D]/50 rounded text-xs text-[#F5CFC7]">
              {uploadError}
            </div>
          )}
          {poured && (
            <div role="status" className="p-3 bg-[#1F2A1C] border border-[#8AA678]/45 rounded text-xs text-[#CFE3C2] flex items-center gap-3">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span className="flex-1">Placed: {poured}.</span>
              {onUndo && (
                <button
                  onClick={() => {
                    onUndo();
                    setPoured(null);
                  }}
                  className="px-2.5 py-1 rounded bg-white/[0.08] hover:bg-white/[0.14] text-[#ECEAE4] cursor-pointer"
                >
                  Undo
                </button>
              )}
              <button onClick={() => setPoured(null)} aria-label="Dismiss" className="px-1 text-[#A19E95] hover:text-white cursor-pointer">
                ✕
              </button>
            </div>
          )}

          {tab === 'manuscript' ? (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Add Section Form */}
              <div className="p-4 bg-[#141417] border border-white/[0.08] rounded-md space-y-3 h-fit">
                <div className="text-xs font-semibold text-[#F4F1EA]">
                  Add / Paste Editorial Section
                </div>
                <input
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="Section or essay heading..."
                  className="w-full bg-[#121214] border border-white/[0.1] rounded px-2.5 py-1.5 text-xs text-[#ECEAE4]"
                />
                <select
                  value={newKind}
                  onChange={(e) => setNewKind(e.target.value as ContentSection['kind'])}
                  className="w-full bg-[#121214] border border-white/[0.1] rounded px-2.5 py-1.5 text-xs text-[#ECEAE4]"
                >
                  <option value="body">Editorial Body Copy</option>
                  <option value="heading">Heading / Chapter Title</option>
                  <option value="quote">Pull Quote</option>
                  <option value="caption">Image Caption</option>
                  <option value="interview">Interview Excerpt</option>
                </select>
                <textarea
                  rows={6}
                  value={newBody}
                  onChange={(e) => setNewBody(e.target.value)}
                  placeholder="Write or paste manuscript copy..."
                  className="w-full bg-[#121214] border border-white/[0.1] rounded p-2.5 text-xs text-[#ECEAE4] leading-relaxed"
                />
                <div className="flex items-center justify-between">
                  <span className="font-mono-tabular text-[11px] text-[#8F8C84]">
                    {countWords(newBody)} words
                  </span>
                  <button
                    onClick={handleAddSection}
                    className="px-3 py-1.5 bg-[#C6A26B] text-[#121214] text-xs font-medium rounded flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Save Section</span>
                  </button>
                </div>
              </div>

              {/* Sections List */}
              <div className="lg:col-span-2 space-y-3">
                {project.contentSections.map((sec) => {
                  const where = placement[sec.id];
                  return (
                    <div
                      key={sec.id}
                      className="p-4 bg-[#141417] border border-white/[0.08] rounded-md space-y-2.5"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="text-xs font-semibold text-[#F4F1EA]">{sec.title}</div>
                          <div className="font-mono-tabular text-[11px] text-[#98958D] mt-0.5">
                            {sec.kind} · {countWords(sec.body)} words ·{' '}
                            {where?.placed
                              ? `On page${where.pageNumbers.length === 1 ? '' : 's'} ${where.pageNumbers.join(', ')}`
                              : 'Not on any page'}
                          </div>
                        </div>
                        <button
                          onClick={() =>
                            onUpdateProject({
                              ...project,
                              contentSections: project.contentSections.filter((s) => s.id !== sec.id),
                            })
                          }
                          aria-label={`Delete the section ${sec.title}`}
                          title="Delete this section from the manuscript (the words already on pages stay)"
                          className="p-1 text-[#7F7C75] hover:text-[#E07A5F] cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <textarea
                        rows={3}
                        value={sec.body}
                        onChange={(e) =>
                          onUpdateProject({
                            ...project,
                            contentSections: project.contentSections.map((s) =>
                              s.id === sec.id ? { ...s, body: e.target.value } : s
                            ),
                          })
                        }
                        className="w-full bg-[#121214] border border-white/[0.06] rounded p-2 text-xs text-[#D7D4CC] leading-relaxed"
                      />

                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <select
                          value={assignPageMap[sec.id] || sec.assignedPageId || project.pages[0]?.id || ''}
                          onChange={(e) =>
                            setAssignPageMap((prev) => ({ ...prev, [sec.id]: e.target.value }))
                          }
                          className="bg-[#121214] border border-white/[0.1] rounded px-2 py-1 text-[11px] text-[#ECEAE4]"
                        >
                          {project.pages.map((p, idx) => (
                            <option key={p.id} value={p.id}>
                              Page {idx + 1} · {p.label}
                            </option>
                          ))}
                        </select>
                        <button
                          onClick={() => handleAssignToPage(sec)}
                          className="px-3 py-1 bg-[#26262C] hover:bg-[#32323B] text-[11px] text-[#ECEAE4] rounded flex items-center gap-1 cursor-pointer"
                        >
                          <span>Put into a frame on this page</span>
                          <ArrowRight className="w-3 h-3 text-[#C6A26B]" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            /* the word counts: the same panel as the drawer beside the canvas */
            <EditorialCountsPanel
              project={project}
              variant="wide"
              onGoTo={(pageId, elId) => {
                onJumpToPage(pageId, elId);
                onClose();
              }}
              onOpenPour={() => setPourOpen(true)}
            />
          )}
        </div>
      </div>
      {pourOpen && (
        <PourManuscriptModal
          project={project}
          activePageId={activePageId}
          canDesign={canDesign}
          onApply={(updated, plan) => {
            onUpdateProject(updated);
            setPourOpen(false);
            setTab('manuscript');
            setPoured(plan.summary);
          }}
          onClose={() => setPourOpen(false)}
        />
      )}
    </div>
  );
};
