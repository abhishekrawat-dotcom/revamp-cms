import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Archive,
  CheckCircle2,
  Download,
  FileDown,
  Image as ImageIcon,
  Info,
  Loader2,
  X,
} from 'lucide-react';
import type { BookPage, BookProject } from '../types/bookstudio';
import { calculateSpineWidthMm, formatMeasurement } from '../engines/dimensionEngine';
import {
  exportBookPdf,
  exportProjectBackupPackage,
  exportSinglePageImage,
  exportSpreadImage,
} from '../engines/exportEngine';
import { runPreflightCheck } from '../engines/preflightEngine';
import { useFontsVersion } from '../engines/textMeasure';

interface ExportPreflightModalProps {
  project: BookProject;
  /** false for a Content editor: the print settings are the design's (shown, not changed); exporting is open to both */
  canDesign: boolean;
  activePage: BookPage;
  activePageIndex: number;
  onUpdateProject: (updated: BookProject) => void;
  onJumpToPage: (pageId: string, elementId?: string) => void;
  onClose: () => void;
}

export const ExportPreflightModal: React.FC<ExportPreflightModalProps> = ({
  project,
  canDesign,
  activePage,
  activePageIndex,
  onUpdateProject,
  onJumpToPage,
  onClose,
}) => {
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [severityFilter, setSeverityFilter] = useState<'all' | 'error' | 'warning' | 'info'>('all');

  // checked again once fonts finish loading: text that doesn't fit is measured with the real font
  const fontsVersion = useFontsVersion();
  const issues = useMemo(() => runPreflightCheck(project), [project, fontsVersion]);
  const errorCount = issues.filter((i) => i.severity === 'error').length;
  const warnCount = issues.filter((i) => i.severity === 'warning').length;
  const infoCount = issues.filter((i) => i.severity === 'info').length;

  const filteredIssues = useMemo(
    () => (severityFilter === 'all' ? issues : issues.filter((i) => i.severity === severityFilter)),
    [issues, severityFilter]
  );

  const spine = useMemo(
    () => calculateSpineWidthMm(project.pages.length, project.printSettings),
    [project.pages.length, project.printSettings]
  );

  const runExport = async (key: string, fn: () => Promise<void>, successLabel: string) => {
    setBusyAction(key);
    setStatusMessage(null);
    try {
      await fn();
      setStatusMessage(successLabel);
    } catch (err) {
      setStatusMessage(err instanceof Error ? `Export failed: ${err.message}` : 'Export failed.');
    } finally {
      setBusyAction(null);
    }
  };

  // Determine spread pair containing activePageIndex
  const spreadLeftIdx = activePageIndex === 0 ? 0 : activePageIndex % 2 === 1 ? activePageIndex : activePageIndex - 1;
  const spreadLeftPage = project.pages[spreadLeftIdx] || activePage;
  const spreadRightPage =
    activePageIndex === 0 ? null : project.pages[spreadLeftIdx + 1] || null;

  return (
    <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
      <div className="w-full max-w-5xl max-h-[90vh] bg-[#18181B] border border-white/[0.1] rounded-lg flex flex-col overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="px-6 py-4 border-b border-white/[0.08] flex items-center justify-between">
          <div>
            <h2 className="font-display text-lg font-medium text-[#F4F1EA]">
              Print Production Preflight & Publishing Export
            </h2>
            <p className="text-[11px] text-[#98958D]">
              11-point press inspection · Exact physical trim geometry · Backend editorial word counts strictly excluded from all exports
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-[#98958D] hover:text-white rounded cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* Left 3 Columns: 11-Point Preflight Report */}
          <div className="lg:col-span-3 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-semibold text-[#F4F1EA]">
                Pre-Export Production Preflight
              </div>
              <div className="flex items-center gap-1 text-[11px]">
                {(
                  [
                    ['all', `All (${issues.length})`],
                    ['error', `Errors (${errorCount})`],
                    ['warning', `Warnings (${warnCount})`],
                    ['info', `Info (${infoCount})`],
                  ] as const
                ).map(([k, lbl]) => (
                  <button
                    key={k}
                    onClick={() => setSeverityFilter(k)}
                    className={`px-2 py-1 rounded cursor-pointer ${
                      severityFilter === k
                        ? 'bg-[#28282F] text-[#ECEAE4]'
                        : 'text-[#8F8C84] hover:text-white'
                    }`}
                  >
                    {lbl}
                  </button>
                ))}
              </div>
            </div>

            {filteredIssues.length === 0 ? (
              <div className="p-6 bg-[#141417] border border-[#8AA678]/35 rounded-md flex items-center gap-3 text-xs text-[#CDE2BF]">
                <CheckCircle2 className="w-5 h-5 text-[#8AA678] shrink-0" />
                <div>
                  <div className="font-medium">Preflight Clear</div>
                  <div className="text-[#9BB58C] mt-0.5">
                    No issues found in this filter. Ready for print-ready PDF generation.
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
                {filteredIssues.map((iss) => (
                  <div
                    key={iss.id}
                    className="p-3 bg-[#141417] border border-white/[0.08] rounded-md flex items-start justify-between gap-3"
                  >
                    <div className="flex items-start gap-2.5">
                      {iss.severity === 'error' ? (
                        <AlertCircle className="w-4 h-4 text-[#E07A5F] shrink-0 mt-0.5" />
                      ) : iss.severity === 'warning' ? (
                        <AlertTriangle className="w-4 h-4 text-[#D4A657] shrink-0 mt-0.5" />
                      ) : (
                        <Info className="w-4 h-4 text-[#78A8C8] shrink-0 mt-0.5" />
                      )}
                      <div className="space-y-0.5">
                        <div className="text-xs font-medium text-[#ECEAE4]">{iss.title}</div>
                        <div className="text-[11px] text-[#98958D]">{iss.detail}</div>
                        <div className="text-[11px] text-[#C6A26B]">{iss.suggestion}</div>
                      </div>
                    </div>
                    {iss.pageId && (
                      <button
                        onClick={() => {
                          onJumpToPage(iss.pageId!, iss.elementId);
                          onClose();
                        }}
                        className="px-2 py-1 text-[11px] bg-[#25252B] hover:bg-[#31313A] text-[#ECEAE4] rounded shrink-0 cursor-pointer"
                      >
                        Jump
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Right 2 Columns: Print Settings & Export Actions */}
          <div className="lg:col-span-2 space-y-4">
            <div className="p-4 bg-[#141417] border border-white/[0.08] rounded-md space-y-3">
              <div className="text-xs font-semibold text-[#F4F1EA]">Press Spec Summary</div>
              <div className="space-y-1 text-[11px] text-[#A19E95] font-mono-tabular">
                <div>
                  Trim: {formatMeasurement(project.dimensions.widthMm, project.unit)} ×{' '}
                  {formatMeasurement(project.dimensions.heightMm, project.unit)}
                </div>
                <div>
                  Bleed: {formatMeasurement(project.dimensions.bleedMm, project.unit)} · Spine:{' '}
                  {formatMeasurement(spine.spineMm, project.unit)}
                </div>
                <div>
                  Pages: {project.pages.length} · Stock: {project.printSettings.paperStockName}
                </div>
              </div>

              <div
                className="pt-2 border-t border-white/[0.06] space-y-2 text-xs text-[#D7D4CC]"
                title={canDesign ? undefined : 'The print settings are part of the design: a Designer changes them'}
              >
                {!canDesign && (
                  <div className="text-[11px] text-[#8F8C84]">Print settings are set by a Designer.</div>
                )}
                <label className={`flex items-center gap-2 ${canDesign ? 'cursor-pointer' : 'opacity-60 cursor-not-allowed'}`}>
                  <input
                    type="checkbox"
                    checked={project.printSettings.includeBleed}
                    disabled={!canDesign}
                    onChange={(e) =>
                      onUpdateProject({
                        ...project,
                        printSettings: {
                          ...project.printSettings,
                          includeBleed: e.target.checked,
                        },
                      })
                    }
                    className="accent-[#C6A26B]"
                  />
                  <span>Include {project.dimensions.bleedMm} mm Print Bleed</span>
                </label>
                <label className={`flex items-center gap-2 ${canDesign ? 'cursor-pointer' : 'opacity-60 cursor-not-allowed'}`}>
                  <input
                    type="checkbox"
                    checked={project.printSettings.includeCropMarks}
                    disabled={!canDesign}
                    onChange={(e) =>
                      onUpdateProject({
                        ...project,
                        printSettings: {
                          ...project.printSettings,
                          includeCropMarks: e.target.checked,
                        },
                      })
                    }
                    className="accent-[#C6A26B]"
                  />
                  <span>Include Trim & Crop Marks</span>
                </label>
                <label className={`flex items-center gap-2 ${canDesign ? 'cursor-pointer' : 'opacity-60 cursor-not-allowed'}`}>
                  <input
                    type="checkbox"
                    checked={project.printSettings.includeRegistrationMarks}
                    disabled={!canDesign}
                    onChange={(e) =>
                      onUpdateProject({
                        ...project,
                        printSettings: {
                          ...project.printSettings,
                          includeRegistrationMarks: e.target.checked,
                        },
                      })
                    }
                    className="accent-[#C6A26B]"
                  />
                  <span>Include Slug & Trim Spec Metadata</span>
                </label>
              </div>
            </div>

            {/* Export Triggers */}
            <div className="space-y-2">
              <button
                disabled={busyAction !== null}
                onClick={() =>
                  runExport(
                    'pdf_print',
                    () => exportBookPdf(project, { printReady: true }),
                    'Print-Ready PDF exported with trim size, bleed, and crop marks.'
                  )
                }
                className="w-full py-2.5 px-4 bg-[#C6A26B] hover:bg-[#D5B47F] disabled:opacity-50 text-[#121214] text-xs font-semibold rounded flex items-center justify-center gap-2 cursor-pointer"
              >
                {busyAction === 'pdf_print' ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <FileDown className="w-4 h-4" />
                )}
                <span>Export Print-Ready PDF (Bleed + Crop Marks)</span>
              </button>

              <button
                disabled={busyAction !== null}
                onClick={() =>
                  runExport(
                    'pdf_std',
                    () => exportBookPdf(project, { printReady: false }),
                    'Standard digital review PDF exported.'
                  )
                }
                className="w-full py-2 px-4 bg-[#24242A] hover:bg-[#303038] disabled:opacity-50 text-[#ECEAE4] text-xs rounded flex items-center justify-center gap-2 cursor-pointer"
              >
                {busyAction === 'pdf_std' ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Download className="w-3.5 h-3.5 text-[#C6A26B]" />
                )}
                <span>Export Standard Review PDF</span>
              </button>

              <div className="grid grid-cols-2 gap-2">
                <button
                  disabled={busyAction !== null}
                  onClick={() =>
                    runExport(
                      'page_png',
                      () => exportSinglePageImage(activePage, activePageIndex + 1, project, 'png'),
                      `Exported Page ${activePageIndex + 1} as PNG.`
                    )
                  }
                  className="py-2 px-3 bg-[#1F1F24] hover:bg-[#2A2A32] border border-white/[0.08] text-[11px] text-[#ECEAE4] rounded flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <ImageIcon className="w-3.5 h-3.5 text-[#C6A26B]" />
                  <span>Page PNG</span>
                </button>
                <button
                  disabled={busyAction !== null}
                  onClick={() =>
                    runExport(
                      'page_jpg',
                      () => exportSinglePageImage(activePage, activePageIndex + 1, project, 'jpg'),
                      `Exported Page ${activePageIndex + 1} as JPG.`
                    )
                  }
                  className="py-2 px-3 bg-[#1F1F24] hover:bg-[#2A2A32] border border-white/[0.08] text-[11px] text-[#ECEAE4] rounded flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <ImageIcon className="w-3.5 h-3.5 text-[#C6A26B]" />
                  <span>Page JPG</span>
                </button>
                <button
                  disabled={busyAction !== null}
                  onClick={() =>
                    runExport(
                      'spread_png',
                      () =>
                        exportSpreadImage(
                          spreadLeftPage,
                          spreadRightPage,
                          spreadLeftIdx + 1,
                          project,
                          'png'
                        ),
                      'Exported active spread as PNG.'
                    )
                  }
                  className="py-2 px-3 bg-[#1F1F24] hover:bg-[#2A2A32] border border-white/[0.08] text-[11px] text-[#ECEAE4] rounded flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <ImageIcon className="w-3.5 h-3.5 text-[#C6A26B]" />
                  <span>Spread PNG</span>
                </button>
                <button
                  disabled={busyAction !== null}
                  onClick={() =>
                    runExport(
                      'spread_jpg',
                      () =>
                        exportSpreadImage(
                          spreadLeftPage,
                          spreadRightPage,
                          spreadLeftIdx + 1,
                          project,
                          'jpg'
                        ),
                      'Exported active spread as JPG.'
                    )
                  }
                  className="py-2 px-3 bg-[#1F1F24] hover:bg-[#2A2A32] border border-white/[0.08] text-[11px] text-[#ECEAE4] rounded flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <ImageIcon className="w-3.5 h-3.5 text-[#C6A26B]" />
                  <span>Spread JPG</span>
                </button>
              </div>

              <button
                disabled={busyAction !== null}
                onClick={() =>
                  runExport(
                    'backup_zip',
                    () => exportProjectBackupPackage(project),
                    'Downloaded complete .bookstudio.zip project archive.'
                  )
                }
                className="w-full py-2 px-4 bg-[#1B1B20] hover:bg-[#26262E] border border-white/[0.08] text-[#D7D4CC] text-xs rounded flex items-center justify-center gap-2 cursor-pointer"
              >
                <Archive className="w-3.5 h-3.5 text-[#C6A26B]" />
                <span>Download Project Backup (.bookstudio.zip)</span>
              </button>

              {statusMessage && (
                <div className="p-2.5 bg-[#1D251C] border border-[#8AA678]/40 rounded text-[11px] text-[#CDE2BF]">
                  {statusMessage}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
