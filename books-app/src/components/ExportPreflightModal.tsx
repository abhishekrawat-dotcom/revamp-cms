import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Archive,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Download,
  FileDown,
  Image as ImageIcon,
  Info,
  Loader2,
  X,
} from 'lucide-react';
import type { BookPage, BookProject, PreflightIssue } from '../types/bookstudio';
import { calculateSpineWidthMm, formatMeasurement } from '../engines/dimensionEngine';
import { downloadBlob, exportProjectBackupPackage, exportSinglePageImage, exportSpreadImage } from '../engines/exportEngine';
import { defaultPdfOptions, exportBookPdf, PdfFontError, type PdfExportOptions } from '../engines/pdfEngine';
import { runPreflightCheck } from '../engines/preflightEngine';
import { collectPlaceholderTexts } from '../engines/pourEngine';
import {
  exportGate,
  fontErrorAdvice,
  imageFileName,
  pdfFileName,
  progressFraction,
  progressLabel,
  resolvePageRange,
  summarizePdf,
  TICK_LABEL,
  warningsSignature,
  type ExportKind,
  type PdfSummary,
} from '../engines/exportGate';
import { useFontsVersion } from '../engines/textMeasure';
import { BUILTIN_BOOK_TEMPLATES } from '../data/bookTemplates';

/* The export dialog (Books Phase 4, 27 Nov 2026). Left: the pre-export check (preflightEngine.ts), problems first, each
   with "Go to". Right: what to export, its options, and the button.
     - Print-ready PDF (pdfEngine.ts): vector text, embedded fonts, bleed, crop marks, trim and bleed boxes. Stopped by
       every problem of the check; waits for one tick when there are warnings (exportGate.ts).
     - Review PDF: the trim size, no marks, for reading on screen. Never stopped.
     - Page and spread images (PNG, JPG) and the backup (.bookstudio.zip). Never stopped.
   While a PDF is made: a progress bar, and Cancel is the only way out. Afterwards: a short summary, and the file is
   downloaded as "<Book name> – print-ready.pdf" or "<Book name> – review.pdf". The export's choices are for this
   export only: nothing in the dialog changes the book, so both roles use it the same way. */

interface ExportPreflightModalProps {
  project: BookProject;
  /** false for a Content editor: fonts are the design's, so the advice for a font that can't be embedded differs */
  canDesign: boolean;
  activePage: BookPage;
  activePageIndex: number;
  onJumpToPage: (pageId: string, elementId?: string) => void;
  onClose: () => void;
}

type PdfMode = 'print' | 'review';

type RunState =
  | { phase: 'idle' }
  | { phase: 'running'; mode: PdfMode; label: string; fraction: number }
  | { phase: 'working'; what: string }
  | { phase: 'done'; summary: PdfSummary; blob: Blob }
  | { phase: 'saved'; text: string }
  | { phase: 'cancelled' }
  | { phase: 'fonts'; lines: string[]; fix: string }
  | { phase: 'failed'; text: string };

const KINDS: Array<{ id: ExportKind; title: string; detail: string }> = [
  { id: 'print', title: 'Print-ready PDF', detail: 'For the printer: sharp text with its fonts embedded, bleed and crop marks.' },
  { id: 'review', title: 'Review PDF', detail: 'For reading on screen: the trim size, no marks.' },
  { id: 'images', title: 'Page and spread images', detail: 'PNG or JPG of this page or this spread.' },
  { id: 'backup', title: 'Backup', detail: 'The whole book as a .bookstudio.zip, to keep or move.' },
];

const GROUP_LABEL: Record<PreflightIssue['category'], string> = {
  missing_image: 'Missing photos',
  missing_font: "Fonts that can't be embedded",
  text_overflow: "Text that doesn't fit",
  mixed_format: 'Page sizes',
  binding: 'Page count and binding',
  page_sequence: 'Page count',
  low_resolution: 'Photo resolution',
  safe_area: 'Safe margin',
  bleed: 'Bleed and page edges',
  empty_frame: 'Empty frames and template words',
  design_consistency: 'Design system',
  font_embedding: 'Fonts',
};

const TARGETS = [200, 240, 300, 350, 400];

function groupIssues(list: PreflightIssue[]): Array<{ key: string; label: string; items: PreflightIssue[] }> {
  const map = new Map<string, PreflightIssue[]>();
  for (const i of list) {
    const items = map.get(i.category) || [];
    items.push(i);
    map.set(i.category, items);
  }
  return Array.from(map.entries()).map(([key, items]) => ({ key, label: GROUP_LABEL[key as PreflightIssue['category']] || 'Other', items }));
}

const TONE = {
  error: { icon: AlertCircle, colour: 'text-[#E98B73]', box: 'bg-[#2B1B19] border-[#D94F3D]/45', head: 'text-[#F5CFC7]' },
  warning: { icon: AlertTriangle, colour: 'text-[#D4A657]', box: 'bg-[#2A231A] border-[#D4A657]/35', head: 'text-[#F2DDB3]' },
  info: { icon: Info, colour: 'text-[#8DB6D2]', box: 'bg-[#141417] border-white/[0.08]', head: 'text-[#D7D4CC]' },
} as const;

const IssueGroup: React.FC<{
  severity: PreflightIssue['severity'];
  label: string;
  items: PreflightIssue[];
  defaultOpen: boolean;
  goToDisabled: boolean;
  onGoTo: (i: PreflightIssue) => void;
}> = ({ severity, label, items, defaultOpen, goToDisabled, onGoTo }) => {
  const [open, setOpen] = useState(defaultOpen);
  const [all, setAll] = useState(false);
  const t = TONE[severity];
  const Icon = t.icon;
  const shown = all ? items : items.slice(0, 6);
  return (
    <section className={`rounded-md border ${t.box}`}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full px-3 py-2 flex items-center gap-2 text-left cursor-pointer"
      >
        {open ? (
          <ChevronDown className="w-3.5 h-3.5 text-[#A19E95] shrink-0" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-[#A19E95] shrink-0" />
        )}
        <Icon className={`w-3.5 h-3.5 shrink-0 ${t.colour}`} />
        <span className={`text-xs font-semibold ${t.head}`}>
          {label} ({items.length})
        </span>
      </button>
      {open && (
        <ul className="px-3 pb-3 space-y-2">
          {shown.map((iss) => (
            <li key={iss.id} className="p-2.5 bg-[#141417] border border-white/[0.06] rounded flex items-start justify-between gap-3">
              <div className="min-w-0 space-y-0.5">
                <div className="text-xs font-medium text-[#ECEAE4]">{iss.title}</div>
                <div className="text-[11px] text-[#A19E95] leading-relaxed">{iss.detail}</div>
                <div className="text-[11px] text-[#D9BC8C] leading-relaxed">{iss.suggestion}</div>
              </div>
              {iss.pageId && (
                <button
                  onClick={() => onGoTo(iss)}
                  disabled={goToDisabled}
                  aria-label={`Go to page ${iss.pageNumber ?? ''}: ${iss.title}`}
                  className="px-2 py-1 text-[11px] bg-[#25252B] hover:bg-[#31313A] disabled:opacity-40 disabled:cursor-not-allowed text-[#ECEAE4] rounded shrink-0 cursor-pointer"
                >
                  Go to
                </button>
              )}
            </li>
          ))}
          {items.length > 6 && (
            <li>
              <button onClick={() => setAll((a) => !a)} className="text-[11px] text-[#C6A26B] hover:text-[#DFC08E] cursor-pointer">
                {all ? 'Show fewer' : `Show all ${items.length}`}
              </button>
            </li>
          )}
        </ul>
      )}
    </section>
  );
};

const Check: React.FC<{
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
  children: React.ReactNode;
  hint?: string;
}> = ({ checked, disabled, onChange, children, hint }) => (
  <label
    className={`flex items-start gap-2 text-xs text-[#D7D4CC] ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
    title={hint}
  >
    <input
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={(e) => onChange(e.target.checked)}
      className="accent-[#C6A26B] mt-0.5"
    />
    <span>{children}</span>
  </label>
);

export const ExportPreflightModal: React.FC<ExportPreflightModalProps> = ({
  project,
  canDesign,
  activePage,
  activePageIndex,
  onJumpToPage,
  onClose,
}) => {
  const pageCount = project.pages.length;

  /* the check, run again when fonts finish loading (text that doesn't fit is measured with the real font) */
  const fontsVersion = useFontsVersion();
  const placeholders = useMemo(
    () => collectPlaceholderTexts(project, BUILTIN_BOOK_TEMPLATES),
    [project.masterPages, project.designSystem]
  );
  const issues = useMemo(() => runPreflightCheck(project, { placeholders }), [project, placeholders, fontsVersion]);
  const errors = useMemo(() => issues.filter((i) => i.severity === 'error'), [issues]);
  const warnings = useMemo(() => issues.filter((i) => i.severity === 'warning'), [issues]);
  const notes = useMemo(() => issues.filter((i) => i.severity === 'info'), [issues]);

  const [kind, setKind] = useState<ExportKind>('print');
  const [opts, setOpts] = useState<Record<PdfMode, PdfExportOptions>>(() => ({
    print: defaultPdfOptions(project, 'print'),
    review: defaultPdfOptions(project, 'review'),
  }));
  const [rangeAll, setRangeAll] = useState(true);
  const [rangeFrom, setRangeFrom] = useState('1');
  const [rangeTo, setRangeTo] = useState(String(Math.max(1, pageCount)));
  /* the tick covers the warnings it was given; a warning that was not there then asks again */
  const [tickedFor, setTickedFor] = useState<string | null>(null);
  const signature = useMemo(() => warningsSignature(issues), [issues]);
  const ticked = tickedFor !== null && tickedFor === signature;

  const [run, setRun] = useState<RunState>({ phase: 'idle' });
  const abortRef = useRef<AbortController | null>(null);
  const busy = run.phase === 'running' || run.phase === 'working';

  const gate = exportGate(issues, kind, ticked);
  const range = resolvePageRange({ all: rangeAll, from: rangeFrom, to: rangeTo }, pageCount);
  const pdfMode: PdfMode | null = kind === 'print' || kind === 'review' ? kind : null;
  const mode = pdfMode ? opts[pdfMode] : null;

  const spine = useMemo(
    () => calculateSpineWidthMm(project.pages.length, project.printSettings),
    [project.pages.length, project.printSettings]
  );

  /* never closed while an export runs: Cancel first */
  const close = () => {
    if (busy) return;
    onClose();
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);
  // the dialog going away mid-export stops the export
  useEffect(() => () => abortRef.current?.abort(), []);
  /* the progress (with its Cancel) and the result sit below the options: brought into view when they appear (at 1440×900
     they rendered below the scroll area, out of sight, with the close button disabled — browser QA, 27 Nov 2026) */
  useEffect(() => {
    if (run.phase === 'idle') return;
    const el = document.getElementById('bk-export-status');
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [run.phase]);

  const setOpt = (m: PdfMode, patch: Partial<PdfExportOptions>) => setOpts((o) => ({ ...o, [m]: { ...o[m], ...patch } }));
  const setMark = (key: keyof PdfExportOptions['marks'], value: boolean) =>
    setOpts((o) => ({ ...o, print: { ...o.print, marks: { ...o.print.marks, [key]: value } } }));

  const goTo = (i: PreflightIssue) => {
    if (busy || !i.pageId) return;
    onJumpToPage(i.pageId, i.elementId);
    onClose();
  };

  const exportPdf = async (m: PdfMode) => {
    if (busy || !range.ok) return;
    if (!exportGate(issues, m, ticked).canExport) return;
    const controller = new AbortController();
    abortRef.current = controller;
    const options: PdfExportOptions = { ...opts[m], mode: m, pages: range.pages };
    setRun({ phase: 'running', mode: m, label: progressLabel(0, 0), fraction: 0 });
    try {
      const result = await exportBookPdf(
        project,
        options,
        (done, total, what) => {
          if (controller.signal.aborted) return;
          setRun({ phase: 'running', mode: m, label: progressLabel(done, total, what), fraction: progressFraction(done, total) });
        },
        controller.signal
      );
      if (controller.signal.aborted) {
        setRun({ phase: 'cancelled' });
        return;
      }
      const summary = summarizePdf(result, {
        bookName: project.name,
        mode: m,
        targetPpi: options.targetPpi,
        pages: options.pages,
        spreads: options.spreads,
        bookPages: pageCount,
      });
      downloadBlob(result.blob, summary.fileName);
      setRun({ phase: 'done', summary, blob: result.blob });
    } catch (err) {
      const e = err as { name?: string; message?: string; fonts?: unknown };
      if (controller.signal.aborted || e?.name === 'AbortError') {
        setRun({ phase: 'cancelled' });
      } else if (err instanceof PdfFontError || (e?.name === 'PdfFontError' && Array.isArray(e.fonts))) {
        const advice = fontErrorAdvice((err as PdfFontError).fonts || [], canDesign);
        setRun({ phase: 'fonts', lines: advice.lines, fix: advice.fix });
      } else {
        setRun({
          phase: 'failed',
          text: `The PDF could not be made${e?.message ? `: ${e.message}` : '.'} Try again; if it keeps failing, export a review PDF or page images meanwhile.`,
        });
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  };

  const cancel = () => abortRef.current?.abort();

  /* the page images and the backup take a moment: no Cancel needed */
  const runQuick = async (what: string, fn: () => Promise<void>, done: string) => {
    if (busy) return;
    setRun({ phase: 'working', what });
    try {
      await fn();
      setRun({ phase: 'saved', text: done });
    } catch (err) {
      setRun({
        phase: 'failed',
        text: `${what} could not be made${err instanceof Error && err.message ? `: ${err.message}` : '.'} Please try again.`,
      });
    }
  };

  // the spread holding the current page: page 1 alone, then 2–3, 4–5…
  const spreadLeftIdx = activePageIndex === 0 ? 0 : activePageIndex % 2 === 1 ? activePageIndex : activePageIndex - 1;
  const spreadLeftPage = project.pages[spreadLeftIdx] || activePage;
  const spreadRightPage = activePageIndex === 0 ? null : project.pages[spreadLeftIdx + 1] || null;
  const pageNo = activePageIndex + 1;
  const spreadLabel = spreadRightPage ? `Pages ${spreadLeftIdx + 1}–${spreadLeftIdx + 2}` : `Page ${spreadLeftIdx + 1}`;

  const chooseKind = (k: ExportKind) => {
    if (busy) return;
    setKind(k);
    if (run.phase !== 'idle') setRun({ phase: 'idle' });
  };

  const errorGroups = groupIssues(errors);
  const warningGroups = groupIssues(warnings);
  const noteGroups = groupIssues(notes);
  const bleedMm = Number(project.dimensions.bleedMm) || 0;

  return (
    <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-title"
        className="w-full max-w-5xl max-h-[90vh] bg-[#18181B] border border-white/[0.1] rounded-lg flex flex-col overflow-hidden shadow-2xl"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-white/[0.08] flex items-center justify-between gap-4">
          <div>
            <h2 id="export-title" className="font-display text-lg font-medium text-[#F4F1EA]">
              Export
            </h2>
            <p className="text-[11px] text-[#A19E95]">
              The book is checked first. Word counts, guides and the red "doesn't fit" outlines are never exported.
            </p>
          </div>
          <button
            onClick={close}
            disabled={busy}
            aria-label={busy ? 'Cancel the export first' : 'Close'}
            title={busy ? 'Cancel the export first' : 'Close'}
            className="p-1.5 text-[#A19E95] hover:text-white disabled:opacity-30 disabled:cursor-not-allowed rounded cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* Left: the check */}
          <div className="lg:col-span-3 space-y-3 min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xs font-semibold text-[#F4F1EA]">Pre-export check</h3>
              <div className="flex items-center gap-1.5 text-[11px]">
                <span
                  className={`px-2 py-0.5 rounded border ${
                    errors.length ? 'border-[#D94F3D]/50 text-[#F5CFC7]' : 'border-white/[0.08] text-[#A19E95]'
                  }`}
                >
                  {errors.length} {errors.length === 1 ? 'problem' : 'problems'}
                </span>
                <span
                  className={`px-2 py-0.5 rounded border ${
                    warnings.length ? 'border-[#D4A657]/45 text-[#F2DDB3]' : 'border-white/[0.08] text-[#A19E95]'
                  }`}
                >
                  {warnings.length} {warnings.length === 1 ? 'warning' : 'warnings'}
                </span>
                <span className="px-2 py-0.5 rounded border border-white/[0.08] text-[#A19E95]">
                  {notes.length} {notes.length === 1 ? 'note' : 'notes'}
                </span>
              </div>
            </div>

            {errors.length === 0 && warnings.length === 0 ? (
              <div className="p-4 bg-[#141417] border border-[#8AA678]/35 rounded-md flex items-center gap-3 text-xs text-[#CDE2BF]">
                <CheckCircle2 className="w-5 h-5 text-[#8AA678] shrink-0" />
                <div>
                  <div className="font-medium">Nothing to fix</div>
                  <div className="text-[#B5CDA7] mt-0.5">Every photo is in place, the fonts load and all the text fits.</div>
                </div>
              </div>
            ) : (
              <p className="text-[11px] text-[#A19E95] leading-relaxed">
                {errors.length
                  ? 'Problems stop a print-ready PDF until they are fixed. '
                  : 'No problems: a print-ready PDF can be made. '}
                {warnings.length ? 'Warnings need a look and one tick before a print-ready PDF.' : ''}
              </p>
            )}

            <div className="space-y-2">
              {errorGroups.map((g) => (
                <IssueGroup key={`e_${g.key}`} severity="error" label={g.label} items={g.items} defaultOpen goToDisabled={busy} onGoTo={goTo} />
              ))}
              {warningGroups.map((g) => (
                <IssueGroup
                  key={`w_${g.key}`}
                  severity="warning"
                  label={g.label}
                  items={g.items}
                  defaultOpen={warningGroups.length === 1 && errors.length === 0}
                  goToDisabled={busy}
                  onGoTo={goTo}
                />
              ))}
              {noteGroups.map((g) => (
                <IssueGroup
                  key={`i_${g.key}`}
                  severity="info"
                  label={`Note: ${g.label}`}
                  items={g.items}
                  defaultOpen={false}
                  goToDisabled={busy}
                  onGoTo={goTo}
                />
              ))}
            </div>
          </div>

          {/* Right: what to export */}
          <div className="lg:col-span-2 space-y-4 min-w-0">
            <div className="text-[11px] text-[#A19E95] font-mono-tabular leading-relaxed">
              {formatMeasurement(project.dimensions.widthMm, project.unit)} × {formatMeasurement(project.dimensions.heightMm, project.unit)} · bleed{' '}
              {formatMeasurement(bleedMm, project.unit)} · spine {formatMeasurement(spine.spineMm, project.unit)} · {pageCount}{' '}
              {pageCount === 1 ? 'page' : 'pages'}
            </div>

            <div role="radiogroup" aria-label="What to export" className="space-y-1.5">
              {KINDS.map((k) => (
                <button
                  key={k.id}
                  role="radio"
                  aria-checked={kind === k.id}
                  disabled={busy}
                  onClick={() => chooseKind(k.id)}
                  className={`w-full text-left px-3 py-2 rounded-md border flex items-start gap-2.5 cursor-pointer disabled:cursor-not-allowed ${
                    kind === k.id ? 'bg-[#26231D] border-[#C6A26B]/60' : 'bg-[#141417] border-white/[0.08] hover:border-white/[0.18]'
                  }`}
                >
                  <span
                    className={`mt-0.5 w-3.5 h-3.5 rounded-full border shrink-0 flex items-center justify-center ${
                      kind === k.id ? 'border-[#C6A26B]' : 'border-[#6B6760]'
                    }`}
                  >
                    {kind === k.id && <span className="w-1.5 h-1.5 rounded-full bg-[#C6A26B]" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-xs font-medium text-[#ECEAE4]">{k.title}</span>
                    <span className="block text-[11px] text-[#A19E95]">{k.detail}</span>
                  </span>
                </button>
              ))}
            </div>

            {/* the PDF's options */}
            {pdfMode && mode && (
              <fieldset disabled={busy} className="p-3 bg-[#141417] border border-white/[0.08] rounded-md space-y-3">
                <div className="space-y-1.5">
                  <div className="text-[11px] font-semibold text-[#D7D4CC]">Pages</div>
                  <label className="flex items-center gap-2 text-xs text-[#D7D4CC] cursor-pointer">
                    <input type="radio" name="export-range" checked={rangeAll} onChange={() => setRangeAll(true)} className="accent-[#C6A26B]" />
                    <span>
                      All {pageCount} {pageCount === 1 ? 'page' : 'pages'}
                    </span>
                  </label>
                  <div className="flex items-center gap-2 text-xs text-[#D7D4CC] flex-wrap">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="radio" name="export-range" checked={!rangeAll} onChange={() => setRangeAll(false)} className="accent-[#C6A26B]" />
                      <span>From</span>
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      aria-label="First page"
                      value={rangeFrom}
                      onFocus={() => setRangeAll(false)}
                      onChange={(e) => setRangeFrom(e.target.value)}
                      className="w-14 px-1.5 py-1 bg-[#1F1F24] border border-white/[0.12] rounded text-xs text-[#ECEAE4] font-mono-tabular focus:outline-none focus:ring-1 focus:ring-[#C6A26B]/60"
                    />
                    <span>to</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      aria-label="Last page"
                      value={rangeTo}
                      onFocus={() => setRangeAll(false)}
                      onChange={(e) => setRangeTo(e.target.value)}
                      className="w-14 px-1.5 py-1 bg-[#1F1F24] border border-white/[0.12] rounded text-xs text-[#ECEAE4] font-mono-tabular focus:outline-none focus:ring-1 focus:ring-[#C6A26B]/60"
                    />
                  </div>
                  {!range.ok && <div className="text-[11px] text-[#F5A08C]">{range.error}</div>}
                </div>

                <Check checked={mode.spreads} onChange={(v) => setOpt(pdfMode, { spreads: v })}>
                  As spreads (facing pages side by side)
                </Check>

                {pdfMode === 'print' && (
                  <>
                    <div className="space-y-1.5">
                      <div className="text-[11px] font-semibold text-[#D7D4CC]">Marks</div>
                      <div className="grid grid-cols-2 gap-1.5">
                        <Check checked={mode.marks.crop} onChange={(v) => setMark('crop', v)}>
                          Crop marks
                        </Check>
                        <Check
                          checked={mode.marks.bleed && bleedMm > 0}
                          disabled={!(bleedMm > 0)}
                          hint={bleedMm > 0 ? undefined : 'This book has no bleed: a Designer sets one in Document Setup'}
                          onChange={(v) => setMark('bleed', v)}
                        >
                          Bleed ({formatMeasurement(bleedMm, project.unit, project.unit === 'mm' ? 0 : undefined)})
                        </Check>
                        <Check checked={mode.marks.registration} onChange={(v) => setMark('registration', v)}>
                          Registration marks
                        </Check>
                        <Check
                          checked={mode.marks.slug}
                          onChange={(v) => setMark('slug', v)}
                          hint="The book's name, the page and its size, printed outside the trim"
                        >
                          Slug line
                        </Check>
                      </div>
                    </div>
                    <label className="flex items-center justify-between gap-2 text-xs text-[#D7D4CC]">
                      <span>Photo resolution target</span>
                      <select
                        value={mode.targetPpi}
                        onChange={(e) => setOpt('print', { targetPpi: Number(e.target.value) })}
                        className="px-1.5 py-1 bg-[#1F1F24] border border-white/[0.12] rounded text-xs text-[#ECEAE4] focus:outline-none focus:ring-1 focus:ring-[#C6A26B]/60"
                      >
                        {Array.from(new Set([...TARGETS, mode.targetPpi]))
                          .sort((a, b) => a - b)
                          .map((t) => (
                            <option key={t} value={t}>
                              {t} ppi{t === 300 ? ' (usual for print)' : ''}
                            </option>
                          ))}
                      </select>
                    </label>
                    <p className="text-[11px] text-[#A19E95] leading-relaxed">
                      RGB PDF: your printer converts it to CMYK. Ask them for their PDF requirements.
                    </p>
                  </>
                )}
              </fieldset>
            )}

            {kind === 'images' && (
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    ['png', 'page'],
                    ['jpg', 'page'],
                    ['png', 'spread'],
                    ['jpg', 'spread'],
                  ] as const
                ).map(([fmt, which]) => (
                  <button
                    key={`${which}_${fmt}`}
                    disabled={busy}
                    onClick={() =>
                      which === 'page'
                        ? runQuick(
                            'The page image',
                            () => exportSinglePageImage(activePage, pageNo, project, fmt),
                            `Downloaded "${imageFileName(project.name, pageNo, null, fmt)}".`
                          )
                        : runQuick(
                            'The spread image',
                            () => exportSpreadImage(spreadLeftPage, spreadRightPage, spreadLeftIdx + 1, project, fmt),
                            `Downloaded "${imageFileName(project.name, spreadLeftIdx + 1, spreadRightPage ? spreadLeftIdx + 2 : null, fmt)}".`
                          )
                    }
                    className="py-2 px-3 bg-[#1F1F24] hover:bg-[#2A2A32] disabled:opacity-50 border border-white/[0.08] text-[11px] text-[#ECEAE4] rounded flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <ImageIcon className="w-3.5 h-3.5 text-[#C6A26B]" />
                    <span>
                      {which === 'page' ? `Page ${pageNo}` : spreadLabel} · {fmt.toUpperCase()}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {/* the gate */}
            {kind === 'print' && warnings.length > 0 && (
              <div className={`p-2.5 rounded border ${ticked ? 'border-[#8AA678]/40 bg-[#1D251C]' : 'border-[#D4A657]/40 bg-[#2A231A]'}`}>
                <Check checked={ticked} disabled={busy} onChange={(v) => setTickedFor(v ? signature : null)}>
                  {TICK_LABEL} ({warnings.length})
                </Check>
              </div>
            )}

            {gate.note && (
              <p className={`text-[11px] leading-relaxed ${gate.blocked ? 'text-[#F5CFC7]' : 'text-[#A19E95]'}`}>{gate.note}</p>
            )}

            {pdfMode && (
              <button
                disabled={busy || !gate.canExport || !range.ok}
                onClick={() => void exportPdf(pdfMode)}
                className={`w-full py-2.5 px-4 text-xs font-semibold rounded flex items-center justify-center gap-2 cursor-pointer disabled:cursor-not-allowed ${
                  pdfMode === 'print'
                    ? 'bg-[#C6A26B] hover:bg-[#D5B47F] text-[#121214] disabled:bg-[#3A342A] disabled:text-[#C9BFA9]'
                    : 'bg-[#2A2A31] hover:bg-[#34343C] text-[#ECEAE4] disabled:opacity-50'
                }`}
              >
                {pdfMode === 'print' ? <FileDown className="w-4 h-4" /> : <Download className="w-4 h-4 text-[#C6A26B]" />}
                <span>{gate.canExport && !range.ok ? 'Choose the pages to export' : gate.buttonLabel}</span>
              </button>
            )}

            {kind === 'backup' && (
              <button
                disabled={busy}
                onClick={() => runQuick('The backup', () => exportProjectBackupPackage(project), 'Downloaded the backup (.bookstudio.zip).')}
                className="w-full py-2.5 px-4 bg-[#2A2A31] hover:bg-[#34343C] disabled:opacity-50 text-[#ECEAE4] text-xs font-semibold rounded flex items-center justify-center gap-2 cursor-pointer"
              >
                <Archive className="w-4 h-4 text-[#C6A26B]" />
                <span>{gate.buttonLabel}</span>
              </button>
            )}

            {/* while it runs, and afterwards */}
            {run.phase === 'running' && (
              <div id="bk-export-status" className="p-3 bg-[#141417] border border-[#C6A26B]/40 rounded-md space-y-2" aria-live="polite">
                <div className="flex items-center justify-between gap-2 text-xs text-[#ECEAE4]">
                  <span className="flex items-center gap-2 min-w-0">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-[#C6A26B] shrink-0" />
                    <span className="truncate">{run.mode === 'print' ? 'Making the print-ready PDF' : 'Making the review PDF'}</span>
                  </span>
                  <span className="font-mono-tabular text-[11px] text-[#A19E95]">{Math.round(run.fraction * 100)}%</span>
                </div>
                <div
                  role="progressbar"
                  aria-label={run.label}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(run.fraction * 100)}
                  className="h-1.5 rounded-full bg-white/[0.08] overflow-hidden"
                >
                  <div className="h-full bg-[#C6A26B] transition-[width] duration-200" style={{ width: `${Math.round(run.fraction * 100)}%` }} />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] text-[#A19E95] min-w-0 truncate">{run.label}</span>
                  <button
                    onClick={cancel}
                    className="px-2.5 py-1 text-[11px] font-medium bg-[#2B1B19] hover:bg-[#3A2320] border border-[#D94F3D]/45 text-[#F5CFC7] rounded shrink-0 cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {run.phase === 'working' && (
              <div
                className="p-2.5 bg-[#141417] border border-white/[0.08] rounded text-[11px] text-[#D7D4CC] flex items-center gap-2"
                aria-live="polite"
              >
                <Loader2 className="w-3.5 h-3.5 animate-spin text-[#C6A26B]" />
                <span>{run.what}: making it…</span>
              </div>
            )}

            {run.phase === 'saved' && (
              <div id="bk-export-status" className="p-2.5 bg-[#1D251C] border border-[#8AA678]/40 rounded text-[11px] text-[#CDE2BF] break-words" aria-live="polite">
                {run.text}
              </div>
            )}

            {run.phase === 'cancelled' && (
              <div id="bk-export-status" className="p-2.5 bg-[#141417] border border-white/[0.08] rounded text-[11px] text-[#D7D4CC]" aria-live="polite">
                Export cancelled. Nothing was downloaded.
              </div>
            )}

            {run.phase === 'failed' && (
              <div id="bk-export-status" className="p-2.5 bg-[#2B1B19] border border-[#D94F3D]/45 rounded text-[11px] text-[#F5CFC7] leading-relaxed" aria-live="polite">
                {run.text}
              </div>
            )}

            {run.phase === 'fonts' && (
              <div id="bk-export-status" className="p-3 bg-[#2B1B19] border border-[#D94F3D]/45 rounded space-y-1.5" aria-live="polite">
                <div className="text-xs font-semibold text-[#F5CFC7]">
                  {run.lines.length === 1 ? "A font couldn't be embedded" : "Some fonts couldn't be embedded"}, so the PDF was not made
                </div>
                <ul className="list-disc pl-4 space-y-0.5 text-[11px] text-[#F5CFC7]">
                  {run.lines.map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                </ul>
                <p className="text-[11px] text-[#E9D7D2] leading-relaxed">{run.fix}</p>
              </div>
            )}

            {run.phase === 'done' && (
              <div id="bk-export-status" className="p-3 bg-[#1D251C] border border-[#8AA678]/40 rounded space-y-2" aria-live="polite">
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-[#8AA678] shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-[#CDE2BF]">{run.summary.heading}</div>
                    <div className="text-[11px] text-[#B5CDA7] break-words">Downloaded as "{run.summary.fileName}"</div>
                  </div>
                </div>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
                  {run.summary.facts.map((f) => (
                    <React.Fragment key={f.label}>
                      <dt className="text-[#A19E95]">{f.label}</dt>
                      <dd className="text-[#ECEAE4]">{f.value}</dd>
                    </React.Fragment>
                  ))}
                </dl>
                {run.summary.fonts.length > 0 && (
                  <div className="space-y-0.5">
                    <div className="text-[11px] font-semibold text-[#D7D4CC]">Fonts embedded</div>
                    <ul className="text-[11px] text-[#D7D4CC] space-y-0.5">
                      {run.summary.fonts.map((l) => (
                        <li key={l}>{l}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {run.summary.fontNotes.length > 0 && (
                  <ul className="text-[11px] text-[#F2DDB3] list-disc pl-4 space-y-0.5">
                    {run.summary.fontNotes.map((l) => (
                      <li key={l}>{l}</li>
                    ))}
                  </ul>
                )}
                {run.summary.fontsMissing.length > 0 && (
                  <ul className="text-[11px] text-[#F5CFC7] list-disc pl-4 space-y-0.5">
                    {run.summary.fontsMissing.map((l) => (
                      <li key={l}>{l}</li>
                    ))}
                  </ul>
                )}
                {run.summary.warnings.length > 0 && (
                  <div className="space-y-0.5">
                    <div className="text-[11px] font-semibold text-[#F2DDB3]">Warnings</div>
                    <ul className="text-[11px] text-[#F2DDB3] list-disc pl-4 space-y-0.5">
                      {run.summary.warnings.map((l) => (
                        <li key={l}>{l}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <button
                  onClick={() => run.phase === 'done' && downloadBlob(run.blob, run.summary.fileName)}
                  className="px-2.5 py-1 text-[11px] bg-[#25252B] hover:bg-[#31313A] text-[#ECEAE4] rounded cursor-pointer"
                >
                  Download again
                </button>
              </div>
            )}

            {pdfMode && run.phase === 'idle' && range.ok && (
              <p className="text-[11px] text-[#A19E95] break-words">Downloads as "{pdfFileName(project.name, pdfMode)}".</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
