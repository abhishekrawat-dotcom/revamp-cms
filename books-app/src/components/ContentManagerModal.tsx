import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BarChart2,
  FileText,
  Plus,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type { BookProject, ContentSection } from '../types/bookstudio';
import { uploadManuscript } from '../services/storageService';
import { computeEditorialAnalytics, countWords, findTextElementsOnPage } from '../engines/textEngine';

interface ContentManagerModalProps {
  project: BookProject;
  onUpdateProject: (updated: BookProject) => void;
  onJumpToPage: (pageId: string, elementId?: string) => void;
  onClose: () => void;
}

export const ContentManagerModal: React.FC<ContentManagerModalProps> = ({
  project,
  onUpdateProject,
  onJumpToPage,
  onClose,
}) => {
  const [tab, setTab] = useState<'manuscript' | 'analytics'>('manuscript');
  const [newTitle, setNewTitle] = useState('');
  const [newBody, setNewBody] = useState('');
  const [newKind, setNewKind] = useState<ContentSection['kind']>('body');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [assignPageMap, setAssignPageMap] = useState<Record<string, string>>({});

  const analytics = useMemo(() => computeEditorialAnalytics(project), [project]);

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
      // If page has no text frame yet, place a new clean text frame aligned to margins
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
              Editorial Content Manager & Backend Word Count Analytics
            </h2>
            <p className="text-[11px] text-[#98958D]">
              Content is cleanly decoupled from page geometry. All word & character statistics below remain strictly backend editorial data — never printed on pages or exported PDFs.
            </p>
          </div>
          <button
            onClick={onClose}
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
              <span>Manuscript & Sections ({project.contentSections.length})</span>
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
                Backend Word Count Analytics ({analytics.totalWords.toLocaleString()} words)
              </span>
            </button>
          </div>

          <label className="px-3 py-1.5 bg-[#C6A26B] hover:bg-[#D5B47F] text-[#121214] text-xs font-medium rounded flex items-center gap-1.5 cursor-pointer">
            <Upload className="w-3.5 h-3.5" />
            <span>{uploading ? 'Importing...' : 'Import DOCX / PDF / TXT / RTF / CSV'}</span>
            <input
              type="file"
              accept=".docx,.pdf,.txt,.rtf,.csv"
              onChange={handleUploadManuscript}
              className="hidden"
            />
          </label>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {uploadError && (
            <div className="p-3 bg-[#2B1B19] border border-[#D94F3D]/50 rounded text-xs text-[#F5CFC7]">
              {uploadError}
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
                  const assignedPage = project.pages.find((p) => p.id === sec.assignedPageId);
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
                            {assignedPage ? `Assigned to ${assignedPage.label}` : 'Unassigned'}
                          </div>
                        </div>
                        <button
                          onClick={() =>
                            onUpdateProject({
                              ...project,
                              contentSections: project.contentSections.filter((s) => s.id !== sec.id),
                            })
                          }
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
                          <span>Assign to Page Frame</span>
                          <ArrowRight className="w-3 h-3 text-[#C6A26B]" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            /* BACKEND WORD COUNT & EDITORIAL ANALYTICS DASHBOARD */
            <div className="space-y-6">
              {/* Top Metric Strip */}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                {[
                  ['Total Book Words', analytics.totalWords.toLocaleString()],
                  ['Total Characters', analytics.totalCharacters.toLocaleString()],
                  ['Overflow Frames', String(analytics.overflowFrames.length)],
                  ['Empty Text Frames', String(analytics.emptyTextFrames.length)],
                  ['Unassigned Sections', String(analytics.unassignedSections.length)],
                ].map(([label, val]) => (
                  <div
                    key={label}
                    className="p-3.5 bg-[#141417] border border-white/[0.08] rounded-md"
                  >
                    <div className="text-[11px] text-[#98958D]">{label}</div>
                    <div className="font-mono-tabular text-xl font-semibold text-[#F4F1EA] mt-1">
                      {val}
                    </div>
                  </div>
                ))}
              </div>

              {/* Overflow & Empty Alerts */}
              {analytics.overflowFrames.length > 0 && (
                <div className="p-4 bg-[#2B1B19] border border-[#D94F3D]/50 rounded-md space-y-2">
                  <div className="text-xs font-semibold text-[#F5CFC7] flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 text-[#E07A5F]" />
                    <span>Overflowing Text Frames Requiring Editorial Action</span>
                  </div>
                  <div className="space-y-1.5">
                    {analytics.overflowFrames.map((ov) => (
                      <div
                        key={ov.elementId}
                        className="flex items-center justify-between text-xs text-[#EED5D0]"
                      >
                        <span>
                          Page {ov.pageNumber} · {ov.elementName} (+{ov.overflowWords} overflow words)
                        </span>
                        <button
                          onClick={() => {
                            onJumpToPage(ov.pageId, ov.elementId);
                            onClose();
                          }}
                          className="px-2.5 py-1 bg-[#442824] hover:bg-[#57322D] rounded text-[11px] cursor-pointer"
                        >
                          Inspect Frame
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Page-wise & Chapter-wise Tables */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                <div className="lg:col-span-2 border border-white/[0.08] rounded-md overflow-hidden">
                  <div className="px-4 py-2.5 bg-[#141417] border-b border-white/[0.08] text-xs font-semibold text-[#ECEAE4]">
                    Page-by-Page Editorial Count
                  </div>
                  <table className="w-full text-left text-xs">
                    <thead className="bg-[#161619] text-[11px] text-[#98958D] border-b border-white/[0.06]">
                      <tr>
                        <th className="px-3 py-2">Page</th>
                        <th className="px-3 py-2">Label</th>
                        <th className="px-3 py-2 text-right">Words</th>
                        <th className="px-3 py-2 text-right">Chars</th>
                        <th className="px-3 py-2 text-right">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.05]">
                      {analytics.pageStats.map((ps) => (
                        <tr
                          key={ps.pageId}
                          onClick={() => {
                            onJumpToPage(ps.pageId);
                            onClose();
                          }}
                          className="hover:bg-white/[0.03] cursor-pointer"
                        >
                          <td className="px-3 py-2 font-mono-tabular text-[#C6A26B]">
                            P.{String(ps.pageNumber).padStart(2, '0')}
                          </td>
                          <td className="px-3 py-2 text-[#ECEAE4]">{ps.label}</td>
                          <td className="px-3 py-2 text-right font-mono-tabular text-[#ECEAE4]">
                            {ps.words.toLocaleString()}
                          </td>
                          <td className="px-3 py-2 text-right font-mono-tabular text-[#98958D]">
                            {ps.characters.toLocaleString()}
                          </td>
                          <td className="px-3 py-2 text-right text-[11px]">
                            {ps.overflowCount > 0 ? (
                              <span className="text-[#E07A5F]">Overflow</span>
                            ) : ps.emptyTextFrames > 0 ? (
                              <span className="text-[#D4A657]">{ps.emptyTextFrames} Empty</span>
                            ) : (
                              <span className="text-[#8AA678]">Balanced</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="space-y-4">
                  <div className="border border-white/[0.08] rounded-md overflow-hidden">
                    <div className="px-4 py-2.5 bg-[#141417] border-b border-white/[0.08] text-xs font-semibold text-[#ECEAE4]">
                      Spread Totals
                    </div>
                    <div className="divide-y divide-white/[0.05]">
                      {analytics.spreadStats.map((sp) => (
                        <div
                          key={sp.spreadLabel}
                          className="px-3.5 py-2 flex items-center justify-between text-xs"
                        >
                          <span className="text-[#A19E95]">{sp.spreadLabel}</span>
                          <span className="font-mono-tabular text-[#ECEAE4]">
                            {sp.words.toLocaleString()} w
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="border border-white/[0.08] rounded-md overflow-hidden">
                    <div className="px-4 py-2.5 bg-[#141417] border-b border-white/[0.08] text-xs font-semibold text-[#ECEAE4]">
                      Chapter Totals
                    </div>
                    <div className="divide-y divide-white/[0.05]">
                      {analytics.chapterStats.map((ch) => (
                        <div
                          key={ch.chapterId}
                          className="px-3.5 py-2 flex items-center justify-between text-xs gap-2"
                        >
                          <span className="text-[#A19E95] truncate">{ch.title}</span>
                          <span className="font-mono-tabular text-[#ECEAE4] shrink-0">
                            {ch.words.toLocaleString()} w
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
