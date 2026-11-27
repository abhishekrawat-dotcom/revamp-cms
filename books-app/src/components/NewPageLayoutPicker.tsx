import React, { useEffect, useMemo, useRef } from 'react';
import { LayoutTemplate, X } from 'lucide-react';
import type { BookElement, BookPage, BookProject } from '../types/bookstudio';
import { getEffectivePageDimensions } from '../engines/dimensionEngine';
import { pageFromLayout, pageLayoutChoices } from '../engines/pourEngine';

/* Choosing a new page's layout (Books Phase 3, 27 Nov 2026). A new page is always made from one of the book's own
   layouts: a master page (by name), or a copy of the current page; Designers may also add an empty page like it. Each is
   what lib/book-rules.js accepts from a Content editor. */

interface NewPageLayoutPickerProps {
  project: BookProject;
  /** the page open on the canvas: the new page(s) go in after it, and it is the one "A copy of page N" copies */
  currentPage: BookPage;
  /** 1: "Add page"; 2: "Insert spread" (two facing pages of the layout) */
  count: 1 | 2;
  canDesign: boolean;
  onChoose: (choiceId: string) => void;
  onClose: () => void;
}

/** the layout drawn small: its frames as boxes on its background */
const LayoutThumb: React.FC<{ project: BookProject; page: BookPage | null }> = ({ project, page }) => {
  if (!page) return <div className="w-[38px] h-[50px] bg-[#2A2A30] rounded-sm shrink-0" />;
  const dim = getEffectivePageDimensions(page, project.dimensions);
  const h = 50;
  const w = Math.max(30, Math.min(70, Math.round((h * dim.widthMm) / Math.max(1, dim.heightMm))));
  const box = (el: BookElement) => ({
    left: `${(el.xMm / dim.widthMm) * 100}%`,
    top: `${(el.yMm / dim.heightMm) * 100}%`,
    width: `${(el.widthMm / dim.widthMm) * 100}%`,
    height: `${Math.max(2, (el.heightMm / dim.heightMm) * 100)}%`,
  });
  return (
    <div
      aria-hidden="true"
      className="relative shrink-0 overflow-hidden rounded-sm border border-black/30"
      style={{ width: w, height: h, backgroundColor: page.backgroundColor || project.designSystem.colors.paper }}
    >
      {page.elements
        .filter((e) => !e.hidden)
        .slice(0, 14)
        .map((el) => (
          <div
            key={el.id}
            className={`absolute ${el.type === 'image' ? 'bg-[#8F8C84]/60' : el.type === 'text' ? 'bg-[#1C1917]/35' : 'border border-[#A67C46]/60'}`}
            style={box(el)}
          />
        ))}
    </div>
  );
};

export const NewPageLayoutPicker: React.FC<NewPageLayoutPickerProps> = ({ project, currentPage, count, canDesign, onChoose, onClose }) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const choices = useMemo(() => pageLayoutChoices(project, currentPage, { includeBlank: canDesign }), [project, currentPage, canDesign]);
  const previews = useMemo(
    () => Object.fromEntries(choices.map((c) => [c.id, pageFromLayout(project, c.id, { newId: (p) => `preview_${p}_${Math.random().toString(36).slice(2, 7)}` })])),
    [project, choices]
  );
  const pageNo = project.pages.findIndex((p) => p.id === currentPage.id) + 1;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    panelRef.current?.querySelector<HTMLButtonElement>('button[data-choice]')?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[55]" onMouseDown={onClose}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-page-title"
        onMouseDown={(e) => e.stopPropagation()}
        className="absolute left-3 bottom-[126px] w-[360px] max-w-[calc(100vw-24px)] max-h-[calc(100vh-180px)] flex flex-col bg-[#1D1D22] border border-white/[0.14] rounded-lg shadow-2xl"
      >
        <div className="px-4 py-3 border-b border-white/[0.08] flex items-start justify-between gap-2">
          <div>
            <h2 id="new-page-title" className="text-sm font-semibold text-[#F4F1EA] flex items-center gap-1.5">
              <LayoutTemplate className="w-4 h-4 text-[#C6A26B]" />
              <span>{count === 2 ? `Insert two facing pages after page ${pageNo}` : `Add a page after page ${pageNo}`}</span>
            </h2>
            <p className="text-[11px] text-[#A19E95] mt-0.5">Choose the layout. A new page is always made from one of the book's layouts.</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1 text-[#A19E95] hover:text-white rounded cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
        <ul className="flex-1 overflow-y-auto p-2 space-y-1">
          {choices.map((c) => (
            <li key={c.id}>
              <button
                data-choice
                onClick={() => onChoose(c.id)}
                className="w-full p-2 rounded border border-white/[0.06] bg-[#18181B] hover:border-[#C6A26B]/60 hover:bg-[#232119] focus:outline-none focus:ring-1 focus:ring-[#C6A26B] text-left flex items-center gap-3 cursor-pointer"
              >
                <LayoutThumb project={project} page={previews[c.id]} />
                <span className="min-w-0">
                  <span className="block text-xs font-medium text-[#ECEAE4] truncate">
                    {c.kind === 'master' ? `Master: ${c.label}` : c.label}
                  </span>
                  <span className="block text-[11px] text-[#A19E95] leading-snug">
                    {c.kind === 'master' ? `Linked to the master page: ${c.detail}.` : `${c.detail.charAt(0).toUpperCase()}${c.detail.slice(1)}.`}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        {count === 2 && <p className="px-4 pb-3 text-[11px] text-[#A19E95]">Both pages are made from the layout you choose.</p>}
      </div>
    </div>
  );
};
