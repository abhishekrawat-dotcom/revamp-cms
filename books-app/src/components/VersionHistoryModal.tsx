import React, { useEffect, useState } from 'react';
import { History, Plus, RotateCcw, X } from 'lucide-react';
import type { BookProject, ProjectVersion } from '../types/bookstudio';
import { loadProjectVersion, loadProjectVersions, saveProjectVersion } from '../services/storageService';
import { errorText } from '../services/api';
import { computeEditorialAnalytics } from '../engines/textEngine';

interface VersionHistoryModalProps {
  project: BookProject;
  onRestoreVersion: (version: ProjectVersion) => void;
  onClose: () => void;
}

export const VersionHistoryModal: React.FC<VersionHistoryModalProps> = ({
  project,
  onRestoreVersion,
  onClose,
}) => {
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
              Save named milestones and restore previous book editions non-destructively.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-[#98958D] hover:text-white rounded cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

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
                    <div className="font-mono-tabular text-[10px] text-[#7F7C75]">
                      {v.pageCount} pages · {v.totalWords.toLocaleString()} words ·{' '}
                      {new Date(v.createdAt).toLocaleString()}
                      {v.createdBy ? ' · ' + v.createdBy : ''}
                    </div>
                  </div>
                  <button
                    onClick={() => void handleRestore(v)}
                    disabled={!!restoringId}
                    className="px-3 py-1.5 bg-[#25252C] hover:bg-[#32323B] text-xs text-[#ECEAE4] rounded flex items-center gap-1.5 shrink-0 cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5 text-[#C6A26B]" />
                    <span>{restoringId === v.id ? 'Restoring…' : 'Restore'}</span>
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
