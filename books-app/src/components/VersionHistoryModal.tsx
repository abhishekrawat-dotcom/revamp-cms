// Version history, and (Phase 2) the book's deleted pages with Restore, and its activity log. Keeping a version is
// open to everyone; restoring a whole version is a Designer's (it puts back the design as it was), so a Content editor
// is not offered it. Putting back one deleted page is content and open to both.
import React, { useCallback, useEffect, useState } from 'react';
import { Activity, FileX2, History, Loader2, Plus, RotateCcw, X } from 'lucide-react';
import type { BookProject, ProjectVersion } from '../types/bookstudio';
import {
  loadBookLog,
  loadDeletedPages,
  loadProjectVersion,
  loadProjectVersions,
  saveProjectVersion,
  type BookLogEntry,
  type DeletedPage,
} from '../services/storageService';
import { errorText } from '../services/api';
import { computeEditorialAnalytics } from '../engines/textEngine';
import { personName } from '../services/people';

type HistoryTab = 'versions' | 'deleted' | 'activity';

interface VersionHistoryModalProps {
  project: BookProject;
  /** false for a Content editor: a whole version brings back the design too */
  canRestoreVersion: boolean;
  onRestoreVersion: (version: ProjectVersion) => void;
  /** puts one deleted page back; resolves to the sentence to show (an error, or what happened) */
  onRestorePage: (page: DeletedPage) => Promise<{ ok: boolean; text: string }>;
  initialTab?: HistoryTab;
  onClose: () => void;
}

function when(iso: string): string {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? '' : new Date(t).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** The log's sentence: the server's own words (detail), else its action named plainly. */
export function logSentence(e: BookLogEntry): string {
  if (typeof e.detail === 'string' && e.detail.trim()) return e.detail.trim();
  if (Array.isArray(e.detail) && e.detail.length && e.detail.every((d) => typeof d === 'string')) return (e.detail as string[]).join(' · ');
  const a = String(e.action || '').trim();
  return a ? a.charAt(0).toUpperCase() + a.slice(1).replace(/[-_]/g, ' ') : 'Changed the book';
}

export const VersionHistoryModal: React.FC<VersionHistoryModalProps> = ({
  project,
  canRestoreVersion,
  onRestoreVersion,
  onRestorePage,
  initialTab = 'versions',
  onClose,
}) => {
  const [tab, setTab] = useState<HistoryTab>(initialTab);
  const [deleted, setDeleted] = useState<DeletedPage[] | null>(null);
  const [deletedError, setDeletedError] = useState('');
  const [restoringPageId, setRestoringPageId] = useState('');
  const [pageNotice, setPageNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [log, setLog] = useState<BookLogEntry[] | null>(null);
  const [logError, setLogError] = useState('');
  const [versions, setVersions] = useState<ProjectVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [label, setLabel] = useState('');
  const [summary, setSummary] = useState('');
  const [saving, setSaving] = useState(false);
  const [restoringId, setRestoringId] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    loadProjectVersions(project.id)
      .then((list) => {
        if (active) setVersions(list);
      })
      .catch((err) => {
        if (active) setError(errorText(err, 'The versions could not be loaded.'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [project.id]);

  const readDeleted = useCallback(() => {
    setDeletedError('');
    loadDeletedPages(project.id).then(
      (list) => setDeleted([...list].sort((a, b) => String(b.deletedAt).localeCompare(String(a.deletedAt)))),
      (err) => {
        setDeleted([]);
        setDeletedError(errorText(err, 'The deleted pages could not be loaded.'));
      }
    );
  }, [project.id]);

  const readLog = useCallback(() => {
    setLogError('');
    loadBookLog(project.id).then(setLog, (err) => {
      setLog([]);
      setLogError(errorText(err, 'The activity could not be loaded.'));
    });
  }, [project.id]);

  // each list is read the first time its tab is opened
  useEffect(() => {
    if (tab === 'deleted' && deleted === null) readDeleted();
    if (tab === 'activity' && log === null) readLog();
  }, [tab, deleted, log, readDeleted, readLog]);

  const handleRestorePage = async (p: DeletedPage) => {
    setRestoringPageId(p.pageId);
    setPageNotice(null);
    try {
      const r = await onRestorePage(p);
      setPageNotice(r);
      if (r.ok) setDeleted((list) => (list || []).filter((x) => x.pageId !== p.pageId));
      setLog(null);
    } finally {
      setRestoringPageId('');
    }
  };

  const handleCreateSnapshot = async () => {
    setSaving(true);
    setError('');
    try {
      const analytics = computeEditorialAnalytics(project);
      const ver: ProjectVersion = {
        id: `ver_${Date.now()}`,
        projectId: project.id,
        label: label.trim() || `Snapshot ${versions.length + 1}`,
        summary: summary.trim() || `${project.pages.length} pages · ${analytics.totalWords} words`,
        pageCount: project.pages.length,
        totalWords: analytics.totalWords,
        createdAt: new Date().toISOString(),
        snapshot: structuredClone({
          dimensions: project.dimensions,
          designSystem: project.designSystem,
          pages: project.pages,
          masterPages: project.masterPages,
          chapters: project.chapters,
          contentSections: project.contentSections,
        }),
      };
      const kept = await saveProjectVersion(ver);
      setVersions((prev) => [kept, ...prev]);
      setLabel('');
      setSummary('');
    } catch (err) {
      setError(errorText(err, 'The version could not be kept.'));
    } finally {
      setSaving(false);
    }
  };

  // a version's contents are read only when it is restored
  const handleRestore = async (v: ProjectVersion) => {
    setRestoringId(v.id);
    setError('');
    try {
      const full = await loadProjectVersion(project.id, v.id);
      if (!full.snapshot) throw new Error('This version has nothing in it.');
      onRestoreVersion(full);
      onClose();
    } catch (err) {
      setError(errorText(err, 'This version could not be loaded.'));
    } finally {
      setRestoringId('');
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl max-h-[84vh] bg-[#18181B] border border-white/[0.1] rounded-lg flex flex-col overflow-hidden shadow-2xl">
        <div className="px-6 py-4 border-b border-white/[0.08] flex items-center justify-between">
          <div>
            <h2 className="font-display text-lg font-medium text-[#F4F1EA] flex items-center gap-2">
              <History className="w-4 h-4 text-[#C6A26B]" />
              <span>Version History & Snapshots</span>
            </h2>
            <p className="text-[11px] text-[#98958D]">
              Keep named versions, put back deleted pages, and see who changed what.
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

        <div role="tablist" className="px-6 flex items-center gap-1 border-b border-white/[0.08] bg-[#141417]">
          {(
            [
              ['versions', History, 'Versions'],
              ['deleted', FileX2, 'Deleted pages'],
              ['activity', Activity, 'Activity'],
            ] as const
          ).map(([id, Icon, label]) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={`px-3 py-2.5 text-xs flex items-center gap-1.5 border-b-2 -mb-px cursor-pointer ${
                tab === id ? 'border-[#C6A26B] text-[#F4F1EA] font-medium' : 'border-transparent text-[#8F8C84] hover:text-[#D7D4CC]'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{label}</span>
            </button>
          ))}
        </div>

        {tab === 'deleted' && (
          <div className="p-6 space-y-3 overflow-y-auto flex-1">
            <p className="text-[11px] text-[#98958D]">
              Pages taken out of this book are kept here. Restore puts a page back where it was, with its words and photos.
            </p>
            {pageNotice && (
              <div
                role={pageNotice.ok ? 'status' : 'alert'}
                className={`px-3 py-2 text-xs rounded border ${
                  pageNotice.ok ? 'text-[#CFE3C2] bg-[#1F2A1C] border-[#8AA678]/40' : 'text-[#F2B8A2] bg-[#3A1F1A] border-[#E07A5F]/40'
                }`}
              >
                {pageNotice.text}
              </div>
            )}
            {deletedError && (
              <div role="alert" className="px-3 py-2 text-xs text-[#F2B8A2] bg-[#3A1F1A] border border-[#E07A5F]/40 rounded flex items-center justify-between gap-2">
                <span>{deletedError}</span>
                <button onClick={readDeleted} className="px-2 py-0.5 bg-[#25252C] hover:bg-[#32323B] text-[#ECEAE4] rounded cursor-pointer shrink-0">
                  Try again
                </button>
              </div>
            )}
            {deleted === null ? (
              <div className="text-xs text-[#8F8C84] py-6 text-center flex items-center justify-center gap-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading deleted pages…
              </div>
            ) : deleted.length === 0 && !deletedError ? (
              <div className="text-xs text-[#8F8C84] py-8 text-center bg-[#141417] border border-white/[0.06] rounded">
                No pages have been deleted from this book.
              </div>
            ) : (
              deleted.map((p) => (
                <div key={p.pageId} className="p-3.5 bg-[#141417] border border-white/[0.08] rounded-md flex items-center justify-between gap-3">
                  <div className="space-y-0.5 min-w-0">
                    <div className="text-xs font-semibold text-[#F4F1EA] truncate">{p.label || 'Untitled page'}</div>
                    <div className="font-mono-tabular text-[11px] text-[#7F7C75]">
                      Was page {Number(p.position) + 1} · deleted {when(p.deletedAt)}
                      {p.deletedBy ? ' by ' + personName(p.deletedBy) : ''}
                    </div>
                  </div>
                  <button
                    onClick={() => void handleRestorePage(p)}
                    disabled={!!restoringPageId}
                    className="px-3 py-1.5 bg-[#25252C] hover:bg-[#32323B] disabled:opacity-50 text-xs text-[#ECEAE4] rounded flex items-center gap-1.5 shrink-0 cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5 text-[#C6A26B]" />
                    <span>{restoringPageId === p.pageId ? 'Restoring…' : 'Restore'}</span>
                  </button>
                </div>
              ))
            )}
          </div>
        )}

        {tab === 'activity' && (
          <div className="p-6 space-y-2 overflow-y-auto flex-1">
            {logError && (
              <div role="alert" className="px-3 py-2 text-xs text-[#F2B8A2] bg-[#3A1F1A] border border-[#E07A5F]/40 rounded flex items-center justify-between gap-2">
                <span>{logError}</span>
                <button onClick={readLog} className="px-2 py-0.5 bg-[#25252C] hover:bg-[#32323B] text-[#ECEAE4] rounded cursor-pointer shrink-0">
                  Try again
                </button>
              </div>
            )}
            {log === null ? (
              <div className="text-xs text-[#8F8C84] py-6 text-center flex items-center justify-center gap-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading activity…
              </div>
            ) : log.length === 0 && !logError ? (
              <div className="text-xs text-[#8F8C84] py-8 text-center bg-[#141417] border border-white/[0.06] rounded">
                Nothing has been recorded for this book yet.
              </div>
            ) : (
              <ol className="space-y-1.5">
                {log.map((e, i) => (
                  <li key={`${e.at}_${i}`} className="px-3 py-2 bg-[#141417] border border-white/[0.06] rounded flex items-start gap-3">
                    <span className="w-7 h-7 rounded-full bg-[#2D1C24] border border-[#C6A26B]/40 text-[#E8CFA1] text-[11px] font-semibold flex items-center justify-center shrink-0 uppercase">
                      {personName(e.by).slice(0, 2)}
                    </span>
                    <div className="min-w-0">
                      <div className="text-xs text-[#ECEAE4] break-words">{logSentence(e)}</div>
                      <div className="font-mono-tabular text-[11px] text-[#7F7C75]">
                        {personName(e.by)} · {e.firstAt && e.firstAt !== e.at ? `${when(e.firstAt)} to ${when(e.at)}` : when(e.at)}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}

        {tab === 'versions' && (
        <div className="p-6 space-y-5 overflow-y-auto flex-1">
          {error && (
            <div role="alert" className="px-3 py-2 text-xs text-[#F2B8A2] bg-[#3A1F1A] border border-[#E07A5F]/40 rounded">
              {error}
            </div>
          )}
          <div className="p-4 bg-[#141417] border border-white/[0.08] rounded-md space-y-2.5">
            <div className="text-xs font-semibold text-[#F4F1EA]">Create Named Snapshot</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g., Pre-Press Proof v2"
                className="bg-[#121214] border border-white/[0.1] rounded px-2.5 py-1.5 text-xs text-[#ECEAE4]"
              />
              <input
                type="text"
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                placeholder="Notes (optional)..."
                className="bg-[#121214] border border-white/[0.1] rounded px-2.5 py-1.5 text-xs text-[#ECEAE4]"
              />
            </div>
            <button
              onClick={handleCreateSnapshot}
              disabled={saving}
              className="px-3.5 py-1.5 bg-[#C6A26B] hover:bg-[#D5B47F] disabled:opacity-50 text-[#121214] text-xs font-medium rounded flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{saving ? 'Saving Snapshot...' : 'Capture Version Snapshot'}</span>
            </button>
          </div>

          <div className="space-y-2">
            <div className="text-xs font-semibold text-[#D7D4CC]">
              Saved Milestones ({versions.length})
            </div>
            {loading ? (
              <div className="text-xs text-[#8F8C84] py-6 text-center">Loading history...</div>
            ) : versions.length === 0 ? (
              <div className="text-xs text-[#8F8C84] py-8 text-center bg-[#141417] border border-white/[0.06] rounded">
                No snapshots captured yet. Capture a snapshot before major layout or trim-size revisions.
              </div>
            ) : (
              versions.map((v) => (
                <div
                  key={v.id}
                  className="p-3.5 bg-[#141417] border border-white/[0.08] rounded-md flex items-center justify-between gap-3"
                >
                  <div className="space-y-0.5">
                    <div className="text-xs font-semibold text-[#F4F1EA]">{v.label}</div>
                    <div className="text-[11px] text-[#98958D]">{v.summary}</div>
                    <div className="font-mono-tabular text-[11px] text-[#7F7C75]">
                      {v.pageCount} pages · {v.totalWords.toLocaleString()} words ·{' '}
                      {new Date(v.createdAt).toLocaleString()}
                      {v.createdBy ? ' · ' + v.createdBy : ''}
                    </div>
                  </div>
                  {canRestoreVersion && (
                    <button
                      onClick={() => void handleRestore(v)}
                      disabled={!!restoringId}
                      className="px-3 py-1.5 bg-[#25252C] hover:bg-[#32323B] text-xs text-[#ECEAE4] rounded flex items-center gap-1.5 shrink-0 cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5 text-[#C6A26B]" />
                      <span>{restoringId === v.id ? 'Restoring…' : 'Restore'}</span>
                    </button>
                  )}
                </div>
              ))
            )}
            {!canRestoreVersion && versions.length > 0 && (
              <p className="text-[11px] text-[#7F7C75]">
                Restoring a whole version also brings back its design, so only a Designer can do it. You can still restore single deleted pages.
              </p>
            )}
          </div>
        </div>
        )}
      </div>
    </div>
  );
};
