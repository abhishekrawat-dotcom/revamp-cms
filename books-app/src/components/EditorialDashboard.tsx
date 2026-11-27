import React, { useMemo, useState } from 'react';
import { AlertTriangle, BarChart2, CheckCircle2, FileText, Square, Wand2, X } from 'lucide-react';
import type { BookProject } from '../types/bookstudio';
import { measureTextOverflow } from '../engines/textEngine';
import { useFontsVersion } from '../engines/textMeasure';
import { collectPlaceholderTexts, editorialCounts, type EditorialCounts, type FrameRef } from '../engines/pourEngine';
import { BUILTIN_BOOK_TEMPLATES } from '../data/bookTemplates';

/* Word counts (Books Phase 3, 27 Nov 2026): words and characters per page, spread and chapter, the text that doesn't
   fit (measured as the page draws it), empty frames, frames still holding a template's sample words, and the
   manuscript on no page. Editorial information only: it is never drawn on a page or exported. It is worked out from the
   book each time it changes, so it is always current. */

/** the counts, measured again when the book changes and when a font finishes loading (it changes what fits) */
export function useEditorialCounts(project: BookProject): EditorialCounts {
  const fonts = useFontsVersion();
  const placeholders = useMemo(() => collectPlaceholderTexts(project, BUILTIN_BOOK_TEMPLATES), [project.masterPages, project.designSystem]);
  return useMemo(() => {
    void fonts;
    return editorialCounts(project, measureTextOverflow, placeholders);
  }, [project, placeholders, fonts]);
}

const KIND: Record<string, string> = {
  heading: 'Heading',
  subheading: 'Subheading',
  body: 'Body text',
  caption: 'Caption',
  quote: 'Quote',
  interview: 'Interview',
};

interface PanelProps {
  project: BookProject;
  /** select the frame (or the page) on the canvas */
  onGoTo: (pageId: string, elementId?: string) => void;
  /** opens "Pour manuscript into frames" */
  onOpenPour?: () => void;
  /** 'drawer': one column beside the canvas; 'wide': two columns, in the Content manager */
  variant?: 'drawer' | 'wide';
}

const n = (v: number) => v.toLocaleString();

const FrameList: React.FC<{
  title: string;
  items: FrameRef[];
  tone: 'red' | 'amber' | 'grey';
  empty: string;
  note?: string;
  onGoTo: PanelProps['onGoTo'];
  extra?: (r: FrameRef) => string;
}> = ({ title, items, tone, empty, note, onGoTo, extra }) => {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, 8);
  const colour = tone === 'red' ? 'text-[#F5CFC7]' : tone === 'amber' ? 'text-[#F2DDB3]' : 'text-[#D7D4CC]';
  const box =
    tone === 'red' && items.length
      ? 'bg-[#2B1B19] border-[#D94F3D]/45'
      : tone === 'amber' && items.length
        ? 'bg-[#2A231A] border-[#D4A657]/40'
        : 'bg-[#141417] border-white/[0.08]';
  return (
    <section className={`p-3 rounded-md border space-y-2 ${box}`}>
      <h3 className={`text-xs font-semibold flex items-center gap-1.5 ${items.length ? colour : 'text-[#ECEAE4]'}`}>
        {items.length ? <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> : <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-[#8AA678]" />}
        <span>
          {title} ({items.length})
        </span>
      </h3>
      {items.length === 0 ? (
        <p className="text-[11px] text-[#A19E95]">{empty}</p>
      ) : (
        <>
          {note && <p className="text-[11px] text-[#C8C5BC] leading-relaxed">{note}</p>}
          <ul className="space-y-1">
            {shown.map((r) => (
              <li key={r.elementId} className="flex items-center justify-between gap-2 text-[11px] text-[#ECEAE4]">
                <span className="min-w-0 truncate">
                  <span className="font-mono-tabular text-[#C6A26B]">Page {r.pageNumber}</span> · {r.elementName}
                  {extra ? <span className={colour}> · {extra(r)}</span> : null}
                </span>
                <button
                  onClick={() => onGoTo(r.pageId, r.elementId)}
                  className="shrink-0 px-2 py-0.5 rounded bg-white/[0.06] hover:bg-white/[0.12] text-[#ECEAE4] cursor-pointer"
                  aria-label={`Go to ${r.elementName} on page ${r.pageNumber}`}
                >
                  Go to
                </button>
              </li>
            ))}
          </ul>
          {items.length > 8 && (
            <button onClick={() => setAll((a) => !a)} className="text-[11px] text-[#C6A26B] hover:text-[#DFC08E] cursor-pointer">
              {all ? 'Show fewer' : `Show all ${items.length}`}
            </button>
          )}
        </>
      )}
    </section>
  );
};

/** the word counts, for the drawer and for the Content manager's "Word counts" tab */
export const EditorialCountsPanel: React.FC<PanelProps> = ({ project, onGoTo, onOpenPour, variant = 'drawer' }) => {
  const c = useEditorialCounts(project);
  const [table, setTable] = useState<'pages' | 'spreads' | 'chapters'>('pages');
  const wide = variant === 'wide';

  const tiles: Array<[string, string, string?]> = [
    ['Words', n(c.totalWords)],
    ['Characters', n(c.totalCharacters)],
    ['Pages', n(project.pages.length)],
    ["Don't fit", n(c.overflowing.length), c.overflowing.length ? 'text-[#F5A08C]' : undefined],
    ['Empty frames', n(c.empty.length), c.empty.length ? 'text-[#E6C27E]' : undefined],
    ['Not placed', n(c.notPlaced.length), c.notPlaced.length ? 'text-[#E6C27E]' : undefined],
  ];

  const lists = (
    <div className="space-y-3">
      <FrameList
        title="Text that doesn't fit"
        items={c.overflowing}
        tone="red"
        empty="Every frame's text fits."
        note="Shorten the text, or carry the rest on to another frame. Exports print only what fits."
        extra={(r) => `+${n(r.overflowWords || 0)} words`}
        onGoTo={onGoTo}
      />
      <FrameList
        title="Empty text frames"
        items={c.empty}
        tone="amber"
        empty="No text frame is empty."
        note="Type in them, or pour the manuscript into them."
        onGoTo={onGoTo}
      />
      <FrameList
        title="Sample words still on pages"
        items={c.sample}
        tone="amber"
        empty="No frame still holds a template's sample words."
        note="These frames still hold a template's sample words or 'Lorem ipsum', which would print as they are."
        onGoTo={onGoTo}
      />
      <section
        className={`p-3 rounded-md border space-y-2 ${c.notPlaced.length ? 'bg-[#2A231A] border-[#D4A657]/40' : 'bg-[#141417] border-white/[0.08]'}`}
      >
        <h3 className={`text-xs font-semibold flex items-center gap-1.5 ${c.notPlaced.length ? 'text-[#F2DDB3]' : 'text-[#ECEAE4]'}`}>
          {c.notPlaced.length ? <FileText className="w-3.5 h-3.5 shrink-0" /> : <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-[#8AA678]" />}
          <span>Manuscript not on any page ({c.notPlaced.length})</span>
        </h3>
        {project.contentSections.length === 0 ? (
          <p className="text-[11px] text-[#A19E95]">No manuscript yet. Add or import it in the Content manager.</p>
        ) : c.notPlaced.length === 0 ? (
          <p className="text-[11px] text-[#A19E95]">Every manuscript section is on a page.</p>
        ) : (
          <>
            <ul className="space-y-1 max-h-48 overflow-y-auto">
              {c.notPlaced.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-2 text-[11px] text-[#ECEAE4]">
                  <span className="min-w-0 truncate">{s.title || 'Untitled section'}</span>
                  <span className="shrink-0 font-mono-tabular text-[#A19E95]">
                    {KIND[s.kind] || s.kind} · {n(s.words)} words
                  </span>
                </li>
              ))}
            </ul>
            {onOpenPour && (
              <button
                onClick={onOpenPour}
                className="w-full mt-1 px-3 py-1.5 rounded bg-[#C6A26B] hover:bg-[#D5B47F] text-[#121214] text-xs font-medium flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Wand2 className="w-3.5 h-3.5" />
                <span>Pour into frames…</span>
              </button>
            )}
          </>
        )}
      </section>
    </div>
  );

  const rows =
    table === 'pages'
      ? c.pages.map((p) => ({
          key: p.key,
          label: `${p.pageNumber}. ${p.label}`,
          sub: p.chapterTitle,
          words: p.words,
          characters: p.characters,
          go: () => onGoTo(p.key),
          flag: p.overflowing ? "doesn't fit" : p.empty ? `${p.empty} empty` : p.sample ? 'sample words' : '',
          flagTone: p.overflowing ? 'text-[#F5A08C]' : 'text-[#E6C27E]',
        }))
      : (table === 'spreads' ? c.spreads : c.chapters).map((r) => ({
          key: r.key,
          label: r.label,
          sub: table === 'chapters' ? `${r.pageCount} page${r.pageCount === 1 ? '' : 's'}` : '',
          words: r.words,
          characters: r.characters,
          go: r.pageIds.length ? () => onGoTo(r.pageIds[0]) : undefined,
          flag: '',
          flagTone: '',
        }));

  const countsTable = (
    <section className="rounded-md border border-white/[0.08] overflow-hidden">
      <div className="px-3 py-2 bg-[#141417] border-b border-white/[0.08] flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold text-[#ECEAE4]">Counts</h3>
        <div className="flex items-center gap-0.5" role="tablist" aria-label="Count by">
          {(['pages', 'spreads', 'chapters'] as const).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={table === t}
              onClick={() => setTable(t)}
              className={`px-2 py-0.5 rounded text-[11px] cursor-pointer ${
                table === t ? 'bg-[#2B2B31] text-[#ECEAE4] font-medium' : 'text-[#A19E95] hover:text-[#ECEAE4]'
              }`}
            >
              {t === 'pages' ? 'Pages' : t === 'spreads' ? 'Spreads' : 'Chapters'}
            </button>
          ))}
        </div>
      </div>
      {/* a fixed layout: the numbers keep their columns (sized for six figures and the "Characters" heading), and the
          name takes what is left, cut short with "…" (its full text in the tooltip), so no column is ever cut off */}
      <table className="w-full table-fixed text-left text-[11px]">
        <colgroup>
          <col />
          <col className="w-[64px]" />
          <col className="w-[84px]" />
        </colgroup>
        <thead className="bg-[#161619] text-[#A19E95] border-b border-white/[0.06]">
          <tr>
            <th className="px-3 py-1.5 font-medium">{table === 'pages' ? 'Page' : table === 'spreads' ? 'Spread' : 'Chapter'}</th>
            <th className="pl-1 pr-2 py-1.5 font-medium text-right">Words</th>
            <th className="pl-1 pr-3 py-1.5 font-medium text-right">Characters</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.05]">
          {rows.length === 0 && (
            <tr>
              <td colSpan={3} className="px-3 py-2 text-[#A19E95]">
                {table === 'chapters' ? 'This book has no chapters yet. Add them in the Book tab on the left.' : 'No pages.'}
              </td>
            </tr>
          )}
          {rows.map((r) => (
            <tr
              key={r.key}
              onClick={r.go}
              className={r.go ? 'hover:bg-white/[0.03] cursor-pointer' : ''}
              title={r.go ? 'Go to this page' : undefined}
            >
              <td className="px-3 py-1.5 text-[#ECEAE4] min-w-0">
                <div className="truncate" title={r.label}>
                  {r.label}
                </div>
                {(r.sub || r.flag) && (
                  <div className="text-[11px] text-[#A19E95] truncate">
                    {r.sub}
                    {r.sub && r.flag ? ' · ' : ''}
                    {r.flag && <span className={r.flagTone}>{r.flag}</span>}
                  </div>
                )}
              </td>
              <td className="pl-1 pr-2 py-1.5 text-right font-mono-tabular text-[#ECEAE4] whitespace-nowrap">{n(r.words)}</td>
              <td className="pl-1 pr-3 py-1.5 text-right font-mono-tabular text-[#A19E95] whitespace-nowrap">{n(r.characters)}</td>
            </tr>
          ))}
        </tbody>
        {rows.length > 0 && (
          <tfoot className="border-t border-white/[0.08] bg-[#141417]">
            <tr>
              <td className="px-3 py-1.5 font-semibold text-[#ECEAE4]">The book</td>
              <td className="pl-1 pr-2 py-1.5 text-right font-mono-tabular font-semibold text-[#ECEAE4] whitespace-nowrap">{n(c.totalWords)}</td>
              <td className="pl-1 pr-3 py-1.5 text-right font-mono-tabular text-[#A19E95] whitespace-nowrap">{n(c.totalCharacters)}</td>
            </tr>
          </tfoot>
        )}
      </table>
    </section>
  );

  return (
    <div className="space-y-4">
      <div className={`grid gap-2 ${wide ? 'grid-cols-3 md:grid-cols-6' : 'grid-cols-3'}`}>
        {tiles.map(([label, value, tone]) => (
          <div key={label} className="p-2.5 bg-[#141417] border border-white/[0.08] rounded-md">
            <div className="text-[11px] text-[#A19E95]">{label}</div>
            <div className={`font-mono-tabular text-base font-semibold mt-0.5 ${tone || 'text-[#F4F1EA]'}`}>{value}</div>
          </div>
        ))}
      </div>
      {wide ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
          {lists}
          {countsTable}
        </div>
      ) : (
        <>
          {lists}
          {countsTable}
        </>
      )}
      <p className="text-[11px] text-[#A19E95] leading-relaxed">
        Hidden frames, running heads and page numbers are not counted. These counts are for editing only: they are never
        printed or exported.
      </p>
    </div>
  );
};

/** the word counts beside the canvas: it stays open while the book is edited and follows every change */
export const EditorialDashboard: React.FC<Omit<PanelProps, 'variant'> & { onClose: () => void }> = ({ project, onGoTo, onOpenPour, onClose }) => (
  <aside
    aria-label="Word counts"
    className="absolute right-0 top-0 bottom-0 z-[45] w-[440px] max-w-full bg-[#18181B] border-l border-white/[0.1] shadow-2xl flex flex-col"
  >
    <div className="px-4 py-3 border-b border-white/[0.08] flex items-start justify-between gap-3">
      <div>
        <h2 className="text-sm font-semibold text-[#F4F1EA] flex items-center gap-1.5">
          <BarChart2 className="w-4 h-4 text-[#C6A26B]" />
          <span>Word counts</span>
        </h2>
        <p className="text-[11px] text-[#A19E95] mt-0.5">Updates as the book changes. Never printed or exported.</p>
      </div>
      <button onClick={onClose} aria-label="Close word counts" className="p-1.5 text-[#A19E95] hover:text-white rounded cursor-pointer">
        <X className="w-4 h-4" />
      </button>
    </div>
    <div className="flex-1 overflow-y-auto p-4">
      <EditorialCountsPanel project={project} onGoTo={onGoTo} onOpenPour={onOpenPour} variant="drawer" />
    </div>
    <div className="px-4 py-2 border-t border-white/[0.08] text-[11px] text-[#A19E95] flex items-center gap-1.5">
      <Square className="w-3 h-3 text-[#D94F3D]" />
      <span>On the page, text that doesn't fit has a red dashed outline.</span>
    </div>
  </aside>
);
