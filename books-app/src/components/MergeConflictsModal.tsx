// When this tab's save crossed another person's: the things both changed differently, side by side, with a choice for
// each (services/bookRules.ts mergeBooks found them; everything else was already put together). It also explains the
// rare case where the two cannot be put together, and offers the way out that loses nothing.
import React, { useEffect, useRef, useState } from 'react';
import { GitMerge } from 'lucide-react';
import type { ConflictChoice, MergeConflict } from '../services/bookRules';
import { personName } from '../services/people';

export interface MergeDialogState {
  /** conflicts: choose per item; cannot: the two could not be put together (reason says why) */
  mode: 'conflicts' | 'cannot';
  bookId: string;
  bookName: string;
  /** who saved the newer copy (an email, or '' when the server did not say) */
  updatedBy: string;
  conflicts: MergeConflict[];
  reason?: string;
  /** a heading of its own (a save the server refused for another reason than someone else's save) */
  title?: string;
}

interface MergeConflictsModalProps {
  state: MergeDialogState;
  /** Designers may keep their version as a new book; a Content editor cannot start a book */
  canKeepCopy: boolean;
  busy: boolean;
  onResolve: (choices: Record<string, ConflictChoice>) => void;
  onUseLatest: () => void;
  onKeepCopy: () => void;
}


function clip(s: string, n: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

function fileName(src: string): string {
  const clean = String(src || '').split('?')[0];
  const last = clean.split('/').filter(Boolean).pop() || '';
  return /^(display|print|thumb)$/.test(last) ? '' : last;
}

/** A short, readable picture of one side of a conflict. */
export function previewOf(c: MergeConflict, v: unknown): string {
  if (v === undefined || v === null || v === '') return '(empty)';
  if (typeof v === 'string') return clip(v, 180);
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return v.length === 1 ? '1 item' : `${v.length} items`;
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (c.field === 'image' || 'src' in o) {
      const name = (typeof o.alt === 'string' && o.alt) || fileName(String(o.src || ''));
      const crop = typeof o.zoom === 'number' && o.zoom !== 1 ? ` · zoom ${Math.round(o.zoom * 100)}%` : '';
      return o.src ? `Photo: ${clip(name || 'a photo', 80)}${crop}` : 'No photo';
    }
    if (c.field === 'infographic' || Array.isArray(o.items)) {
      const rows = Array.isArray(o.items) ? o.items.length : 0;
      return clip(`${String(o.title || 'Infographic')} · ${rows} row${rows === 1 ? '' : 's'}${o.variant ? ' · ' + String(o.variant).replace(/_/g, ' ') : ''}`, 180);
    }
    if (c.kind === 'contentSections') return clip(`${String(o.title || 'Section')}: ${String(o.body || '')}`, 180);
    if (c.kind === 'imageAssets') {
      const tags = Array.isArray(o.tags) && o.tags.length ? ` · tags: ${o.tags.join(', ')}` : '';
      return clip(`${String(o.name || 'Photo')}${tags}`, 180);
    }
    const named = o.title || o.name || o.label;
    if (typeof named === 'string' && named) return clip(named, 180);
    try {
      return clip(JSON.stringify(v), 160);
    } catch {
      return '(a change)';
    }
  }
  return String(v);
}

export const MergeConflictsModal: React.FC<MergeConflictsModalProps> = ({
  state,
  canKeepCopy,
  busy,
  onResolve,
  onUseLatest,
  onKeepCopy,
}) => {
  const [choices, setChoices] = useState<Record<string, ConflictChoice>>({});
  const firstRef = useRef<HTMLButtonElement>(null);
  const who = personName(state.updatedBy);

  // focus moves into the dialog, so typing cannot reach the page behind it
  useEffect(() => {
    firstRef.current?.focus();
  }, [state]);

  const all = (side: ConflictChoice): Record<string, ConflictChoice> =>
    Object.fromEntries(state.conflicts.map((c) => [c.id, side]));
  const chosen = state.conflicts.every((c) => choices[c.id]);

  return (
    <div className="fixed inset-0 z-[80] bg-black/75 flex items-center justify-center p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="merge-title"
        className="w-full max-w-3xl max-h-[86vh] bg-[#18181B] border border-white/[0.12] rounded-lg flex flex-col overflow-hidden shadow-2xl"
      >
        <div className="px-6 py-4 border-b border-white/[0.08] flex items-start gap-3">
          <GitMerge className="w-4 h-4 text-[#C6A26B] mt-1 shrink-0" />
          <div className="min-w-0">
            <h2 id="merge-title" className="font-display text-lg font-medium text-[#F4F1EA]">
              {state.title
                ? state.title
                : state.mode === 'conflicts'
                  ? `You and ${who} changed the same thing`
                  : `Your changes could not be put together with ${who}'s`}
            </h2>
            <p className="text-[11px] text-[#A19E95] mt-0.5">
              {state.mode === 'conflicts'
                ? `${who} saved "${state.bookName}" while you were working. Everything else from both of you is already kept. For each item below, choose whose version to keep, then save.`
                : state.reason || 'The newer saved book and yours cannot be combined.'}
            </p>
          </div>
        </div>

        {state.mode === 'conflicts' ? (
          <div className="p-5 space-y-3 overflow-y-auto flex-1">
            {state.conflicts.map((c, i) => {
              const pick = choices[c.id];
              const side = (s: ConflictChoice, title: string, value: unknown, ref?: React.Ref<HTMLButtonElement>) => (
                <button
                  ref={ref}
                  type="button"
                  aria-pressed={pick === s}
                  onClick={() => setChoices((prev) => ({ ...prev, [c.id]: s }))}
                  className={`flex-1 min-w-0 text-left p-2.5 rounded border cursor-pointer transition-colors ${
                    pick === s
                      ? 'bg-[#2A2824] border-[#C6A26B] text-[#F4F1EA]'
                      : 'bg-[#121214] border-white/[0.08] text-[#D7D4CC] hover:border-white/[0.2]'
                  }`}
                >
                  <div className="text-[11px] uppercase tracking-wider text-[#C6A26B] mb-1">
                    {pick === s ? '✓ ' : ''}
                    {title}
                  </div>
                  <div className="text-[11px] leading-relaxed break-words">{previewOf(c, value)}</div>
                </button>
              );
              return (
                <div key={c.id} className="p-3 bg-[#141417] border border-white/[0.08] rounded-md space-y-2">
                  <div className="text-xs font-medium text-[#ECEAE4]">{c.label}</div>
                  <div className="flex flex-col sm:flex-row gap-2">
                    {side('mine', 'Keep yours', c.mine, i === 0 ? firstRef : undefined)}
                    {side('theirs', `Keep ${who}'s`, c.theirs)}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="p-5 text-xs text-[#D7D4CC] leading-relaxed flex-1 overflow-y-auto space-y-2">
            <p>
              {canKeepCopy
                ? 'Keep yours as a separate book so neither version is lost, or open the newest saved copy and let your unsaved changes go.'
                : 'Open the newest saved copy to go on. Your unsaved changes here will be let go, so copy any words you want to keep first.'}
            </p>
          </div>
        )}

        <div className="px-5 py-3.5 border-t border-white/[0.08] flex flex-wrap items-center justify-between gap-2 bg-[#141417]">
          <div className="flex items-center gap-2">
            {canKeepCopy && (
              <button
                type="button"
                disabled={busy}
                onClick={onKeepCopy}
                className="px-3 py-1.5 text-xs text-[#D7D4CC] hover:text-white bg-[#232329] hover:bg-[#2C2C34] disabled:opacity-50 rounded cursor-pointer"
              >
                Keep mine as a copy
              </button>
            )}
            {state.mode === 'cannot' && (
              <button
                ref={firstRef}
                type="button"
                disabled={busy}
                onClick={onUseLatest}
                className="px-3 py-1.5 text-xs font-medium bg-[#C6A26B] hover:bg-[#D5B47F] text-[#121214] disabled:opacity-50 rounded cursor-pointer"
              >
                Open the newest saved copy
              </button>
            )}
          </div>
          {state.mode === 'conflicts' && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => onResolve(all('mine'))}
                className="px-3 py-1.5 text-xs text-[#ECEAE4] bg-[#25252C] hover:bg-[#32323B] disabled:opacity-50 rounded cursor-pointer"
              >
                Keep all mine
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => onResolve(all('theirs'))}
                className="px-3 py-1.5 text-xs text-[#ECEAE4] bg-[#25252C] hover:bg-[#32323B] disabled:opacity-50 rounded cursor-pointer"
              >
                Keep all theirs
              </button>
              <button
                type="button"
                disabled={busy || !chosen}
                title={chosen ? '' : 'Choose one version for each item first'}
                onClick={() => onResolve(choices)}
                className="px-3.5 py-1.5 text-xs font-medium bg-[#C6A26B] hover:bg-[#D5B47F] text-[#121214] disabled:opacity-40 rounded cursor-pointer"
              >
                {busy ? 'Saving…' : 'Save my choices'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

