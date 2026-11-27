import React, { useMemo, useState } from 'react';
import { BookPlus, Copy, FileX2, Plus, Trash2 } from 'lucide-react';
import type { BookPage, BookProject } from '../types/bookstudio';
import { getEffectivePageDimensions } from '../engines/dimensionEngine';
import { initialsOf } from '../services/people';

interface BottomPageNavigatorProps {
  project: BookProject;
  activePageId: string;
  onSelectPage: (pageId: string) => void;
  /** "Add page" and "Insert spread" open the layout picker (which of the book's layouts the new page is made from) */
  onAddPage: () => void;
  onInsertSpread: () => void;
  /** the layout picker is open */
  layoutPickerOpen?: boolean;
  onDuplicatePage: (pageId: string) => void;
  onDeletePage: (pageId: string) => void;
  onReorderPages: (fromIdx: number, toIdx: number) => void;
  /** others with this book open, and the page each is on: their initials mark that page's thumbnail */
  othersHere: Array<{ email: string; name: string; pageId: string }>;
  /** opens Version history on its Deleted pages tab */
  onOpenDeletedPages: () => void;
}

export const BottomPageNavigator: React.FC<BottomPageNavigatorProps> = ({
  project,
  activePageId,
  onSelectPage,
  onAddPage,
  onInsertSpread,
  layoutPickerOpen = false,
  onDuplicatePage,
  onDeletePage,
  onReorderPages,
  othersHere,
  onOpenDeletedPages,
}) => {
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const othersByPage = useMemo(() => {
    const m: Record<string, Array<{ email: string; name: string }>> = {};
    othersHere.forEach((o) => {
      if (!o.pageId) return;
      (m[o.pageId] = m[o.pageId] || []).push({ email: o.email, name: o.name });
    });
    return m;
  }, [othersHere]);

  // Group pages into realistic book spreads: Page 1 (Front Cover) solo, then pairs (2-3, 4-5, ...)
  const spreadGroups: Array<{ label: string; items: Array<{ page: BookPage; index: number }> }> = [];
  if (project.pages.length > 0) {
    spreadGroups.push({
      label: 'Cover',
      items: [{ page: project.pages[0], index: 0 }],
    });
    for (let i = 1; i < project.pages.length; i += 2) {
      const pair = [{ page: project.pages[i], index: i }];
      if (project.pages[i + 1]) {
        pair.push({ page: project.pages[i + 1], index: i + 1 });
      }
      spreadGroups.push({
        label:
          pair.length === 2
            ? `${pair[0].index + 1}–${pair[1].index + 1}`
            : `${pair[0].index + 1}`,
        items: pair,
      });
    }
  }

  return (
    <footer className="h-[118px] shrink-0 bg-[#18181B] border-t border-white/[0.08] px-3 py-2 flex items-center gap-3 select-none z-20">
      {/* Left Quick Actions */}
      <div className="flex flex-col gap-1.5 shrink-0 pr-3 border-r border-white/[0.08]">
        <button
          onClick={onInsertSpread}
          aria-haspopup="dialog"
          aria-expanded={layoutPickerOpen}
          title="Insert two facing pages after this page: choose their layout"
          className="px-2.5 py-1.5 bg-[#24242A] hover:bg-[#2F2F37] text-[11px] text-[#ECEAE4] rounded flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
        >
          <BookPlus className="w-3.5 h-3.5 text-[#C6A26B]" />
          <span>Insert Spread</span>
        </button>
        <div className="flex items-center gap-1">
          <button
            onClick={onAddPage}
            aria-haspopup="dialog"
            aria-expanded={layoutPickerOpen}
            title="Add a page after this page: choose its layout"
            className="flex-1 px-2 py-1 bg-[#1E1E22] hover:bg-[#2A2A30] text-[11px] text-[#C8C5BC] rounded flex items-center justify-center gap-1 cursor-pointer"
          >
            <Plus className="w-3 h-3" />
            <span>Page</span>
          </button>
          <button
            onClick={() => onDuplicatePage(activePageId)}
            title="Duplicate Active Page"
            className="p-1 bg-[#1E1E22] hover:bg-[#2A2A30] text-[#C8C5BC] rounded cursor-pointer"
          >
            <Copy className="w-3 h-3" />
          </button>
          <button
            onClick={() => onDeletePage(activePageId)}
            disabled={project.pages.length <= 1}
            title="Delete Active Page"
            className="p-1 bg-[#1E1E22] hover:bg-[#3A2220] text-[#C8C5BC] hover:text-[#E07A5F] disabled:opacity-30 rounded cursor-pointer"
          >
            <Trash2 className="w-3 h-3" />
          </button>
          <button
            onClick={onOpenDeletedPages}
            title="Deleted pages: put a page back"
            aria-label="Deleted pages"
            className="p-1 bg-[#1E1E22] hover:bg-[#2A2A30] text-[#C8C5BC] rounded cursor-pointer"
          >
            <FileX2 className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Horizontal Spread Thumbnail Strip */}
      <div className="flex-1 overflow-x-auto flex items-center gap-3 pb-1">
        {spreadGroups.map((group, gIdx) => {
          const isGroupActive = group.items.some((it) => it.page.id === activePageId);
          return (
            <div key={gIdx} className="flex flex-col items-center gap-1 shrink-0">
              <div
                className={`flex items-center p-1 rounded border transition-colors ${
                  isGroupActive
                    ? 'border-[#C6A26B]/80 bg-[#25231F]'
                    : 'border-white/[0.06] bg-[#141417] hover:border-white/[0.18]'
                }`}
              >
                {group.items.map(({ page, index }) => {
                  const dim = getEffectivePageDimensions(page, project.dimensions);
                  const ratio = dim.widthMm / Math.max(1, dim.heightMm);
                  const thumbH = 62;
                  const thumbW = Math.max(36, Math.min(84, Math.round(thumbH * ratio)));
                  const isActive = page.id === activePageId;
                  const here = othersByPage[page.id] || [];

                  return (
                    <div
                      key={page.id}
                      draggable
                      onDragStart={() => setDragIdx(index)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => {
                        if (dragIdx !== null && dragIdx !== index) {
                          onReorderPages(dragIdx, index);
                        }
                        setDragIdx(null);
                      }}
                      onClick={() => onSelectPage(page.id)}
                      style={{
                        width: `${thumbW}px`,
                        height: `${thumbH}px`,
                        backgroundColor: page.backgroundColor || project.designSystem.colors.paper,
                      }}
                      title={`Page ${index + 1}: ${page.label}${page.dimensionsOverride ? ' (Mixed-Format Custom Size)' : ''}${
                        here.length ? ` — also here: ${here.map((h) => h.name).join(', ')}` : ''
                      } — Drag to reorder`}
                      className={`relative overflow-hidden cursor-pointer border ${
                        isActive ? 'border-[#C6A26B]' : 'border-black/25'
                      }`}
                    >
                      {/* Miniature live elements preview */}
                      {page.elements
                        .filter((e) => !e.hidden)
                        .slice(0, 12)
                        .map((el) => {
                          const leftPct = (el.xMm / dim.widthMm) * 100;
                          const topPct = (el.yMm / dim.heightMm) * 100;
                          const wPct = (el.widthMm / dim.widthMm) * 100;
                          const hPct = (el.heightMm / dim.heightMm) * 100;

                          return (
                            <div
                              key={el.id}
                              style={{
                                left: `${leftPct}%`,
                                top: `${topPct}%`,
                                width: `${wPct}%`,
                                height: `${hPct}%`,
                              }}
                              className="absolute overflow-hidden pointer-events-none"
                            >
                              {el.type === 'image' && el.image?.src ? (
                                <img
                                  src={el.image.src}
                                  alt=""
                                  referrerPolicy="no-referrer"
                                  className="w-full h-full object-cover"
                                />
                              ) : el.type === 'infographic' ? (
                                <div className="w-full h-full bg-[#A67C46]/35 border border-[#A67C46]/60" />
                              ) : el.type === 'text' ? (
                                <div
                                  className="w-full h-full opacity-45"
                                  style={{
                                    backgroundColor:
                                      el.textRole === 'display' || el.textRole === 'heading'
                                        ? el.textStyle?.color || '#1C1917'
                                        : 'transparent',
                                    backgroundImage:
                                      el.textRole !== 'display' && el.textRole !== 'heading'
                                        ? 'repeating-linear-gradient(to bottom, rgba(30,30,30,0.4) 0px, rgba(30,30,30,0.4) 1px, transparent 1px, transparent 3px)'
                                        : undefined,
                                  }}
                                />
                              ) : el.type === 'line' ? (
                                <div
                                  className="w-full h-px mt-0.5"
                                  style={{ backgroundColor: el.shape?.stroke || '#A67C46' }}
                                />
                              ) : null}
                            </div>
                          );
                        })}

                      {page.dimensionsOverride && (
                        <div className="absolute top-0.5 right-0.5 w-1.5 h-1.5 bg-[#C6A26B]" />
                      )}

                      {here.length > 0 && (
                        <div className="absolute bottom-0.5 left-0.5 flex items-center gap-0.5 pointer-events-none">
                          {here.slice(0, 2).map((h) => (
                            <span
                              key={h.email}
                              className="h-[18px] min-w-[18px] px-0.5 rounded-full bg-[#2E6B4F] text-white text-[11px] font-bold leading-none flex items-center justify-center shadow ring-1 ring-white/70"
                            >
                              {initialsOf(h.email)}
                            </span>
                          ))}
                          {here.length > 2 && (
                            <span className="h-[18px] px-1 rounded-full bg-[#2E6B4F] text-white text-[11px] font-bold leading-none flex items-center shadow">
                              +{here.length - 2}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <span className="font-mono-tabular text-[11px] text-[#8F8C84]">{group.label}</span>
            </div>
          );
        })}
      </div>

      {/* Right Summary */}
      <div className="hidden md:flex flex-col items-end text-[11px] text-[#8F8C84] font-mono-tabular shrink-0 pl-2 border-l border-white/[0.08]">
        <span className="text-[#ECEAE4]">{project.pages.length} Pages</span>
        <span>{project.chapters.length} Chapters</span>
      </div>
    </footer>
  );
};
