import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, Wand2, X } from 'lucide-react';
import type { BookProject } from '../types/bookstudio';
import { fitTextToFrame } from '../engines/textEngine';
import { useFontsVersion } from '../engines/textMeasure';
import {
  collectPlaceholderTexts,
  groupOfSection,
  layoutKinds,
  manuscriptOrder,
  pageLayoutChoices,
  planPour,
  sectionPlacement,
  suggestedLayout,
  wordsIn,
  type PourPlan,
} from '../engines/pourEngine';
import { BUILTIN_BOOK_TEMPLATES } from '../data/bookTemplates';
import { designChanges } from '../services/bookRules';

/* "Pour manuscript into frames" (Books Phase 3, 27 Nov 2026; no AI): the chosen manuscript sections go into the book's
   own text frames in reading order, kinds matched, each frame filled only as far as its text fits with the real font.
   No frame is moved, resized or restyled. A preview comes first; Apply is one change, undone with Undo. */

interface PourManuscriptModalProps {
  project: BookProject;
  /** the page open on the canvas: the pour starts there unless another page is chosen */
  activePageId: string;
  /** a Designer's pour marks a master page's frame as changed on its page, as typing in it does */
  canDesign: boolean;
  onApply: (updated: BookProject, plan: PourPlan) => void;
  onClose: () => void;
}

const KIND: Record<string, string> = {
  heading: 'Heading',
  subheading: 'Subheading',
  body: 'Body text',
  caption: 'Caption',
  quote: 'Quote',
  interview: 'Interview',
};

export const PourManuscriptModal: React.FC<PourManuscriptModalProps> = ({ project, activePageId, canDesign, onApply, onClose }) => {
  const fonts = useFontsVersion();
  const sections = useMemo(() => manuscriptOrder(project.contentSections), [project.contentSections]);
  const where = useMemo(() => sectionPlacement(project), [project]);
  const notPlacedIds = useMemo(() => sections.filter((s) => !where[s.id]?.placed && wordsIn(s.body) > 0).map((s) => s.id), [sections, where]);

  const [chosen, setChosen] = useState<Set<string>>(() => new Set(notPlacedIds));
  const defaultStart = useMemo(() => {
    const idx = project.pages.findIndex((p) => p.id === activePageId);
    // the front cover is rarely where a manuscript begins: from it, start on the next page
    if ((idx <= 0 || project.pages[idx]?.role === 'front_cover') && project.pages.length > 1) return project.pages[Math.max(1, idx + 1)]?.id || project.pages[1].id;
    return project.pages[idx]?.id || project.pages[0]?.id || '';
  }, [project.pages, activePageId]);
  const [startPageId, setStartPageId] = useState(defaultStart);
  const [replace, setReplace] = useState(false);
  const [whenFull, setWhenFull] = useState<'stop' | 'add'>('stop');
  const [layoutId, setLayoutId] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const placeholders = useMemo(() => collectPlaceholderTexts(project, BUILTIN_BOOK_TEMPLATES), [project.masterPages, project.designSystem]);
  const ids = useMemo(() => sections.filter((s) => chosen.has(s.id)).map((s) => s.id), [sections, chosen]);
  const base = { sectionIds: ids, startPageId, replaceExisting: replace, placeholders, fit: fitTextToFrame, markOverridden: canDesign };

  /* the pour as it would stop: which page it reaches with the book's own frames (for the layouts offered) */
  const stopPlan = useMemo(() => {
    void fonts;
    return planPour(project, { ...base, addPagesFrom: null });
  }, [project, ids, startPageId, replace, placeholders, canDesign, fonts]);

  const layouts = useMemo(() => {
    const lastPage = project.pages.find((p) => p.id === stopPlan.lastExistingPageId) || project.pages.find((p) => p.id === startPageId) || null;
    const list = pageLayoutChoices(project, lastPage);
    const start = project.pages.find((p) => p.id === startPageId);
    if (start && start.id !== lastPage?.id) list.push(...pageLayoutChoices({ ...project, masterPages: [] }, start));
    return list;
  }, [project, stopPlan.lastExistingPageId, startPageId]);
  /* until one is chosen, the layout offered is one with the frames the words left over need */
  const suggested = useMemo(() => {
    const needed = [...new Set(stopPlan.leftovers.map((l) => groupOfSection(l.kind)))];
    return suggestedLayout(project, layouts, needed);
  }, [project, layouts, stopPlan.leftovers]);
  const chosenLayout = layouts.find((l) => l.id === layoutId) ? layoutId : suggested;
  const textless = useMemo(() => new Set(layouts.filter((l) => layoutKinds(project, l.id).size === 0).map((l) => l.id)), [project, layouts]);

  const plan = useMemo(() => {
    void fonts;
    if (whenFull === 'stop' || !chosenLayout) return stopPlan;
    return planPour(project, { ...base, addPagesFrom: chosenLayout });
  }, [stopPlan, whenFull, chosenLayout, project, ids, startPageId, replace, placeholders, canDesign, fonts]);

  /* the guard's own question, asked first: a Content editor's pour must leave the design as it is */
  const refusal = useMemo(() => (canDesign ? [] : designChanges(project, plan.project)), [canDesign, project, plan]);

  const chosenWords = sections.filter((s) => chosen.has(s.id)).reduce((a, s) => a + wordsIn(s.body), 0);
  const toggle = (id: string) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const canApply = plan.sectionsPlaced > 0 && refusal.length === 0;

  return (
    <div className="fixed inset-0 z-[60] bg-black/75 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="pour-title">
      <div className="w-full max-w-5xl max-h-[90vh] bg-[#18181B] border border-white/[0.1] rounded-lg flex flex-col overflow-hidden shadow-2xl">
        <div className="px-6 py-4 border-b border-white/[0.08] flex items-start justify-between gap-4">
          <div>
            <h2 id="pour-title" className="text-base font-semibold text-[#F4F1EA] flex items-center gap-2">
              <Wand2 className="w-4 h-4 text-[#C6A26B]" />
              <span>Pour manuscript into frames</span>
            </h2>
            <p className="text-xs text-[#A19E95] mt-1 max-w-3xl leading-relaxed">
              Puts the sections you choose into the book's text frames in reading order: page by page, and on a page top to bottom, then
              left to right. Headings go to heading or title frames, body text to body frames, quotes to quote frames and captions to
              caption frames. Each frame takes only what fits; the rest goes on into the next frame of its kind. No frame is moved,
              resized or restyled. This is not AI.
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1.5 text-[#A19E95] hover:text-white rounded cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* 1 the sections */}
          <section className="lg:col-span-2 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs font-semibold text-[#F4F1EA]">
                1. Sections to place ({chosen.size} of {sections.length}, {chosenWords.toLocaleString()} words)
              </h3>
            </div>
            <div className="flex flex-wrap gap-1.5 text-[11px]">
              <button onClick={() => setChosen(new Set(notPlacedIds))} className="px-2 py-0.5 rounded bg-white/[0.06] hover:bg-white/[0.12] text-[#ECEAE4] cursor-pointer">
                Not yet placed ({notPlacedIds.length})
              </button>
              <button
                onClick={() => setChosen(new Set(sections.filter((s) => wordsIn(s.body) > 0).map((s) => s.id)))}
                className="px-2 py-0.5 rounded bg-white/[0.06] hover:bg-white/[0.12] text-[#ECEAE4] cursor-pointer"
              >
                All
              </button>
              <button onClick={() => setChosen(new Set())} className="px-2 py-0.5 rounded bg-white/[0.06] hover:bg-white/[0.12] text-[#ECEAE4] cursor-pointer">
                None
              </button>
            </div>
            {sections.length === 0 ? (
              <p className="text-xs text-[#A19E95] p-3 bg-[#141417] border border-white/[0.08] rounded">
                There is no manuscript yet. Import a Word, PDF or text file, or add a section, in the Content manager first.
              </p>
            ) : (
              <ul className="max-h-[52vh] overflow-y-auto space-y-1 pr-1">
                {sections.map((s) => {
                  const w = wordsIn(s.body);
                  const at = where[s.id];
                  return (
                    <li key={s.id}>
                      <label
                        className={`flex items-start gap-2 p-2 rounded border text-xs cursor-pointer ${
                          chosen.has(s.id) ? 'bg-[#232119] border-[#C6A26B]/40' : 'bg-[#141417] border-white/[0.06]'
                        } ${w === 0 ? 'opacity-60 cursor-not-allowed' : ''}`}
                      >
                        <input type="checkbox" className="mt-0.5 accent-[#C6A26B]" checked={chosen.has(s.id)} disabled={w === 0} onChange={() => toggle(s.id)} />
                        <span className="min-w-0 flex-1">
                          <span className="block text-[#ECEAE4] truncate">{s.title || 'Untitled section'}</span>
                          <span className="block text-[11px] text-[#A19E95]">
                            {KIND[s.kind] || s.kind} · {w.toLocaleString()} words ·{' '}
                            {w === 0 ? 'empty' : at?.placed ? `already on page ${at.pageNumbers.join(', ')}` : 'not on any page'}
                          </span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* 2 how, and 3 the preview */}
          <section className="lg:col-span-3 space-y-4">
            <div className="space-y-3 p-4 bg-[#141417] border border-white/[0.08] rounded-md">
              <h3 className="text-xs font-semibold text-[#F4F1EA]">2. How</h3>
              <label className="flex items-center gap-2 text-xs text-[#ECEAE4]">
                <span className="w-28 shrink-0 text-[#A19E95]">Start from</span>
                <select
                  value={startPageId}
                  onChange={(e) => setStartPageId(e.target.value)}
                  className="flex-1 bg-[#121214] border border-white/[0.1] rounded px-2 py-1 text-xs text-[#ECEAE4]"
                >
                  {project.pages.map((p, i) => (
                    <option key={p.id} value={p.id}>
                      Page {i + 1} · {p.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-start gap-2 text-xs text-[#ECEAE4] cursor-pointer">
                <input type="checkbox" className="mt-0.5 accent-[#C6A26B]" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
                <span>
                  Replace text in frames that already have words
                  <span className="block text-[11px] text-[#A19E95] leading-relaxed">
                    Left unticked, only empty frames are filled. A frame still holding a template's sample words (its master page's, the
                    template the book was made from, or "Lorem ipsum") counts as empty either way.
                  </span>
                </span>
              </label>
              <fieldset className="space-y-1.5">
                <legend className="text-xs text-[#A19E95] mb-1">When the frames run out</legend>
                <label className="flex items-center gap-2 text-xs text-[#ECEAE4] cursor-pointer">
                  <input type="radio" name="pour-full" className="accent-[#C6A26B]" checked={whenFull === 'stop'} onChange={() => setWhenFull('stop')} />
                  <span>Stop, and tell me how many words were not placed</span>
                </label>
                <label className="flex items-center gap-2 text-xs text-[#ECEAE4] cursor-pointer flex-wrap">
                  <input
                    type="radio"
                    name="pour-full"
                    className="accent-[#C6A26B]"
                    checked={whenFull === 'add'}
                    disabled={!layouts.length}
                    onChange={() => setWhenFull('add')}
                  />
                  <span>Add pages from layout</span>
                  <select
                    value={chosenLayout}
                    onChange={(e) => {
                      setLayoutId(e.target.value);
                      setWhenFull('add');
                    }}
                    aria-label="Layout for the added pages"
                    className="min-w-0 max-w-full flex-1 bg-[#121214] border border-white/[0.1] rounded px-2 py-1 text-xs text-[#ECEAE4]"
                  >
                    {layouts.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.kind === 'master' ? `Master: ${l.label}` : l.label}
                        {textless.has(l.id) ? ' (no text frames)' : ''}
                      </option>
                    ))}
                  </select>
                </label>
                {whenFull === 'add' && (
                  <p className="text-[11px] text-[#A19E95] leading-relaxed pl-6">
                    The pages go in after the last page that gets words, each a copy of that layout with new frames. Text frames the
                    pour does not fill on them are left empty.
                  </p>
                )}
              </fieldset>
            </div>

            <div className="space-y-3 p-4 bg-[#141417] border border-white/[0.08] rounded-md" aria-live="polite">
              <h3 className="text-xs font-semibold text-[#F4F1EA]">3. Preview</h3>
              <p className={`text-sm font-medium ${plan.wordsLeftOver ? 'text-[#F2DDB3]' : 'text-[#CFE3C2]'}`}>
                {ids.length === 0 ? 'Choose at least one section.' : plan.summary.charAt(0).toUpperCase() + plan.summary.slice(1) + '.'}
              </p>

              {plan.framesKeptWithWords > 0 && !replace && (
                <p className="text-[11px] text-[#C8C5BC] flex gap-1.5">
                  <Info className="w-3.5 h-3.5 shrink-0 text-[#A19E95]" />
                  <span>
                    {plan.framesKeptWithWords} frame{plan.framesKeptWithWords === 1 ? '' : 's'} that already {plan.framesKeptWithWords === 1 ? 'has' : 'have'} words{' '}
                    {plan.framesKeptWithWords === 1 ? 'is' : 'are'} left as {plan.framesKeptWithWords === 1 ? 'it is' : 'they are'}. Tick "Replace text…" to use{' '}
                    {plan.framesKeptWithWords === 1 ? 'it' : 'them'} too.
                  </span>
                </p>
              )}
              {plan.alreadyPlaced.length > 0 && (
                <p className="text-[11px] text-[#F2DDB3] flex gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  <span>
                    {plan.alreadyPlaced.length} chosen section{plan.alreadyPlaced.length === 1 ? ' is' : 's are'} already on a page, so{' '}
                    {plan.alreadyPlaced.length === 1 ? 'it' : 'they'} will be in the book twice.
                  </span>
                </p>
              )}
              {whenFull === 'stop' && plan.wordsLeftOver > 0 && layouts.length > 0 && (
                <p className="text-[11px] text-[#C8C5BC] flex gap-1.5">
                  <Info className="w-3.5 h-3.5 shrink-0 text-[#A19E95]" />
                  <span>To place the rest, choose "Add pages from layout".</span>
                </p>
              )}

              {plan.placements.length > 0 && (
                <div>
                  <div className="text-[11px] text-[#A19E95] mb-1">Goes where</div>
                  <ul className="max-h-48 overflow-y-auto divide-y divide-white/[0.05] border border-white/[0.06] rounded">
                    {plan.placements.map((p) => (
                      <li key={p.sectionId} className="px-2.5 py-1.5 text-[11px] text-[#ECEAE4] flex items-start justify-between gap-3">
                        <span className="min-w-0 truncate">
                          <CheckCircle2 className="inline w-3 h-3 mr-1 text-[#8AA678] align-[-2px]" />
                          {p.title || 'Untitled section'} <span className="text-[#A19E95]">({p.words.toLocaleString()} words)</span>
                        </span>
                        <span className="shrink-0 text-right text-[#C8C5BC]">
                          {p.pieces
                            .map((x) => `p.${x.pageNumber}${x.isNewPage ? ' (new)' : ''} ${x.elementName}`)
                            .filter((v, i, a) => a.indexOf(v) === i)
                            .join(', ')}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {plan.leftovers.length > 0 && (
                <div>
                  <div className="text-[11px] text-[#F2DDB3] mb-1">Not placed ({plan.wordsLeftOver.toLocaleString()} words)</div>
                  <ul className="max-h-40 overflow-y-auto divide-y divide-white/[0.05] border border-[#D4A657]/30 rounded">
                    {plan.leftovers.map((l) => (
                      <li key={l.sectionId} className="px-2.5 py-1.5 text-[11px] text-[#ECEAE4]">
                        {l.title || 'Untitled section'} <span className="text-[#A19E95]">({l.words.toLocaleString()} words)</span>:{' '}
                        <span className="text-[#C8C5BC]">{l.why}.</span>
                      </li>
                    ))}
                  </ul>
                  <p className="text-[11px] text-[#A19E95] mt-1">They stay in the manuscript, listed as not on any page.</p>
                </div>
              )}

              {refusal.length > 0 && (
                <p role="alert" className="text-[11px] text-[#F5CFC7] p-2 rounded bg-[#2B1B19] border border-[#D94F3D]/45">
                  This pour cannot be applied, because it would change the design ({refusal[0].replace(/[.\s]+$/, '')}). Choose another
                  layout for the added pages, or ask a Designer.
                </p>
              )}
            </div>
          </section>
        </div>

        <div className="px-6 py-3 border-t border-white/[0.08] flex items-center justify-between gap-3">
          <span className="text-[11px] text-[#A19E95]">Apply makes one change: Undo takes all of it back.</span>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-3 py-1.5 text-xs rounded bg-white/[0.06] hover:bg-white/[0.12] text-[#ECEAE4] cursor-pointer">
              Cancel
            </button>
            <button
              onClick={() => canApply && onApply(plan.project, plan)}
              disabled={!canApply}
              className="px-3.5 py-1.5 text-xs font-medium rounded bg-[#C6A26B] hover:bg-[#D5B47F] text-[#121214] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              {plan.sectionsPlaced > 0 ? `Place ${plan.sectionsPlaced} section${plan.sectionsPlaced === 1 ? '' : 's'}` : 'Nothing to place'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
