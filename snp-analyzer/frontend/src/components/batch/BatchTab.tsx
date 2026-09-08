import { useEffect, useEffectEvent, useState } from 'react';
import { UploadJobSummary } from '@/components/upload/UploadJobSummary';
import { SessionEmptyState, SessionRecoveryFeedback } from '@/components/upload/SessionRecoveryFeedback';
import { useRecentSessions } from '@/hooks/use-recent-sessions';
import { projectGenotypeCounts } from './project-summary';
import { projectCsv, projectDownloadName } from './project-export';
import { readProject } from './project-read';
import { ArrowLeft, X } from 'lucide-react';
import { useI18n } from '@/hooks/use-i18n';
import { useConfirm } from '@/hooks/use-confirm';
import { Modal } from '@/components/shared/ui/Modal';
import {
  getProjects,
  createProject,
  deleteProject,
  addProjectSession,
  removeProjectSession,
  deleteSession,
  bulkDeleteSessions,
  bulkAddProjectSessions,
  bulkRemoveProjectSessions,
} from '@/lib/api';
import type {
  ProjectListResponse,
  ProjectResponse,
  ProjectSummaryResponse,
} from '@/types/api';
import { useSessionStore } from '@/stores/session-store';
import { useAuthStore } from '@/stores/auth-store';
import { useOwnedOperation } from '@/hooks/use-owned-operation';
import { validManagementList, validProjectListItem } from '@/lib/management-payload';

type View = 'list' | 'detail';
type BatchTabProps = { onLoadSession?: () => void };

/** Format: "a3074218 [sample_data.pcrd]" or just "a3074218" */
function fmtSession(sid: string, filename?: string): string {
  const short = sid.substring(0, 8);
  return filename ? `${short} [${filename}]` : short;
}

// ─── Searchable Project Picker (dropdown) ────────────────────────────────────
type ProjectPickerProps = {
  projects: { id: string; name: string }[];
  onSelect: (projectId: string, projectName: string) => void;
  disabled?: boolean;
  label?: string;
};

function ProjectPicker({ projects, onSelect, disabled, label }: ProjectPickerProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const filtered = query
    ? projects.filter((p) => p.name.toLowerCase().includes(query.toLowerCase()))
    : projects;

  return (
    <div className="relative inline-block">
      <button
        onClick={() => { if (!disabled) setOpen(!open); }}
        disabled={disabled}
        className="text-primary hover:text-primary/80 text-xs font-medium disabled:opacity-50 whitespace-nowrap"
      >
        {label || t.plusProject}
      </button>
      {open && (
        <Modal open onClose={() => setOpen(false)} title={t.searchProject} closeLabel={t.close}>
          <div className="p-1.5">
            <input
              type="text"
              aria-label={t.searchProject}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t.searchProject}
              className="w-full px-2 py-1 text-xs border border-border rounded bg-bg text-text"
              autoFocus
            />
          </div>
          <div className="max-h-40 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-xs text-text-muted">
                {projects.length === 0 ? t.noProjects : t.noMatch}
              </div>
            ) : (
              filtered.map((p) => (
                <button
                  key={p.id}
                  onClick={() => { onSelect(p.id, p.name); setOpen(false); setQuery(''); }}
                  className="w-full text-left px-3 py-1.5 text-xs text-text hover:bg-bg transition-colors truncate"
                >
                  {p.name}
                </button>
              ))
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────
export function BatchTab({ onLoadSession }: BatchTabProps) {
  const generation = useAuthStore(s => s.generation);
  const entry = useSessionStore(s => s.entryGeneration);
  return <ProjectWorkspace key={`${generation}:${entry}`} onLoadSession={onLoadSession} />;
}

function ProjectWorkspace({ onLoadSession }: BatchTabProps) {
  const { t } = useI18n();
  const listOwner = useOwnedOperation(), detailOwner = useOwnedOperation(), actionOwner = useOwnedOperation(), confirmationOwner = useOwnedOperation();
  const { confirm, confirmDialog } = useConfirm();
  const [view, setView] = useState<View>('list');
  const [projects, setProjects] = useState<ProjectListResponse['projects']>([]);
  const recovery = useRecentSessions(null, onLoadSession);
  const { sessions, open: handleLoadSession } = recovery;
  const [currentProject, setCurrentProject] = useState<ProjectResponse | null>(null);
  const [summary, setSummary] = useState<ProjectSummaryResponse | null>(null);
  const [newProjectName, setNewProjectName] = useState('');
  const [selectedSession, setSelectedSession] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Bulk selection state (sessions list)
  const [checkedSessions, setCheckedSessions] = useState<Set<string>>(new Set());
  // Bulk selection state (project detail view)
  const [checkedDetailSessions, setCheckedDetailSessions] = useState<Set<string>>(new Set());

  const activeSessionId = useSessionStore((s) => s.sessionId);
  const resetSession = useSessionStore((s) => s.reset);

  const loadInitialData = useEffectEvent(() => { loadProjects(); });
  useEffect(() => { loadInitialData(); }, []);

  const loadProjects = async () => {
    const ticket = listOwner.begin();
    try {
      const response = await getProjects();
      if (!validManagementList(response, 'projects', validProjectListItem)) throw new Error('Invalid project list');
      if (listOwner.current(ticket)) setProjects(response.projects);
    }
    catch { if (listOwner.current(ticket)) setError(t.errLoadProjects); }
  };

  const loadSessions = async () => {
    if (await recovery.reload()) setCheckedSessions(new Set());
  };

  // ── Project CRUD ───────────────────────────────────────────────────────────
  const handleCreateProject = async () => {
    if (!newProjectName.trim()) return;
    const ticket = actionOwner.begin();
    try {
      setLoading(true);
      await createProject(newProjectName.trim());
      if (!actionOwner.current(ticket)) return;
      setNewProjectName('');
      await loadProjects();
    } catch { if (actionOwner.current(ticket)) setError(t.errCreateProject); }
    finally { if (actionOwner.current(ticket)) setLoading(false); }
  };

  const handleDeleteProject = async (id: string, name: string) => {
    const confirmationTicket = confirmationOwner.begin();
    if (!(await confirm({ title: t.delete, message: t.deleteProjectConfirm(name), danger: true }))) return;
    if (!confirmationOwner.current(confirmationTicket)) return;
    const ticket = actionOwner.begin();
    if (!actionOwner.current(ticket)) return;
    try { setLoading(true); await deleteProject(id); if (actionOwner.current(ticket)) await loadProjects(); }
    catch { if (actionOwner.current(ticket)) setError(t.errDeleteProject); }
    finally { if (actionOwner.current(ticket)) setLoading(false); }
  };

  const handleViewProject = async (id: string) => {
    actionOwner.begin();
    const ticket = detailOwner.begin();
    try {
      setLoading(true); setError(null);
      const [pd, sd] = await readProject(id);
      if (!detailOwner.current(ticket)) return;
      setCurrentProject(pd); setSummary(sd); setView('detail');
    } catch { if (detailOwner.current(ticket)) setError(t.errLoadProjectDetails); }
    finally { if (detailOwner.current(ticket)) setLoading(false); }
  };

  const handleBackToList = () => {
    detailOwner.begin();
    actionOwner.begin();
    setView('list'); setCurrentProject(null); setSummary(null);
    setSelectedSession(''); setError(null); setCheckedDetailSessions(new Set());
  };

  // ── Session actions (detail view) ──────────────────────────────────────────
  const handleAddSession = async () => {
    if (!currentProject || !selectedSession) return;
    const ticket = actionOwner.begin();
    try {
      setLoading(true); setError(null);
      await addProjectSession(currentProject.id, selectedSession);
      if (!actionOwner.current(ticket)) return;
      const [pd, sd] = await readProject(currentProject.id);
      if (!actionOwner.current(ticket)) return;
      setCurrentProject(pd); setSummary(sd); setSelectedSession('');
    } catch { if (actionOwner.current(ticket)) setError(t.errAddSession); }
    finally { if (actionOwner.current(ticket)) setLoading(false); }
  };

  const handleRemoveSession = async (sid: string) => {
    if (!currentProject) return;
    const ticket = actionOwner.begin();
    try {
      setLoading(true); setError(null);
      await removeProjectSession(currentProject.id, sid);
      if (!actionOwner.current(ticket)) return;
      const [pd, sd] = await readProject(currentProject.id);
      if (!actionOwner.current(ticket)) return;
      setCurrentProject(pd); setSummary(sd);
    } catch { if (actionOwner.current(ticket)) setError(t.errRemoveSession); }
    finally { if (actionOwner.current(ticket)) setLoading(false); }
  };

  // ── Bulk remove sessions from project ──────────────────────────────────
  const handleBulkRemoveFromProject = async () => {
    if (!currentProject || checkedDetailSessions.size === 0) return;
    const count = checkedDetailSessions.size;
    const confirmationTicket = confirmationOwner.begin();
    if (!(await confirm({ title: t.remove, message: t.bulkRemoveConfirm(count, currentProject.name), danger: true }))) return;
    if (!confirmationOwner.current(confirmationTicket)) return;
    const ticket = actionOwner.begin();
    if (!actionOwner.current(ticket)) return;
    try {
      setLoading(true); setError(null);
      await bulkRemoveProjectSessions(currentProject.id, [...checkedDetailSessions]);
      if (!actionOwner.current(ticket)) return;
      setCheckedDetailSessions(new Set());
      const [pd, sd] = await readProject(currentProject.id);
      if (!actionOwner.current(ticket)) return;
      setCurrentProject(pd); setSummary(sd);
    } catch { if (actionOwner.current(ticket)) setError(t.errBulkRemoveSessions); }
    finally { if (actionOwner.current(ticket)) setLoading(false); }
  };

  // ── Session delete (single) ────────────────────────────────────────────────
  const handleDeleteSession = async (sid: string) => {
    const s = sessions.find((x) => x.session_id === sid);
    const confirmationTicket = confirmationOwner.begin();
    if (!(await confirm({ title: t.delete, message: t.deleteSessionConfirm(fmtSession(sid, s?.raw_filename)), danger: true }))) return;
    if (!confirmationOwner.current(confirmationTicket)) return;
    const ticket = actionOwner.begin();
    if (!actionOwner.current(ticket)) return;
    try {
      setLoading(true); setError(null);
      await deleteSession(sid);
      if (!actionOwner.current(ticket)) return;
      if (activeSessionId === sid) { resetSession(); return; }
      await Promise.all([loadSessions(), loadProjects()]);
      if (!actionOwner.current(ticket)) return;
      if (currentProject) {
        try {
          const [pd, sd] = await readProject(currentProject.id);
          if (!actionOwner.current(ticket)) return;
          setCurrentProject(pd); setSummary(sd);
        } catch { /* ok */ }
      }
    } catch { if (actionOwner.current(ticket)) setError(t.errDeleteSession); }
    finally { if (actionOwner.current(ticket)) setLoading(false); }
  };

  // ── Session delete (bulk) ──────────────────────────────────────────────────
  const handleBulkDelete = async () => {
    const count = checkedSessions.size;
    if (count === 0) return;
    const confirmationTicket = confirmationOwner.begin();
    if (!(await confirm({ title: t.delete, message: t.bulkDeleteConfirm(count), danger: true }))) return;
    if (!confirmationOwner.current(confirmationTicket)) return;
    const ticket = actionOwner.begin();
    if (!actionOwner.current(ticket)) return;
    try {
      setLoading(true); setError(null);
      await bulkDeleteSessions([...checkedSessions]);
      if (!actionOwner.current(ticket)) return;
      if (activeSessionId && checkedSessions.has(activeSessionId)) { resetSession(); return; }
      setError(null);
      await Promise.all([loadSessions(), loadProjects()]);
    } catch { if (actionOwner.current(ticket)) setError(t.libraryActionFailed); }
    finally { if (actionOwner.current(ticket)) setLoading(false); }
  };

  // ── Add session to project (from session list) ────────────────────────────
  const handleAddToProject = async (sid: string, projectId: string, projectName: string) => {
    const ticket = actionOwner.begin();
    try {
      setLoading(true); setError(null);
      await addProjectSession(projectId, sid);
      if (!actionOwner.current(ticket)) return;
      setError(null);
      await loadProjects();
    } catch {
      if (actionOwner.current(ticket)) setError(t.batchAddTo(projectName, t.libraryActionFailed));
    } finally { if (actionOwner.current(ticket)) setLoading(false); }
  };

  // ── Bulk add selected sessions to project ────────────────────────────────
  const handleBulkAddToProject = async (projectId: string, projectName: string) => {
    const ticket = actionOwner.begin();
    const count = checkedSessions.size;
    if (count === 0) return;
    try {
      setLoading(true); setError(null);
      const res = await bulkAddProjectSessions(projectId, [...checkedSessions]);
      if (!actionOwner.current(ticket)) return;
      setCheckedSessions(new Set());
      await loadProjects();
      if (!actionOwner.current(ticket)) return;
      if (res.added < count) {
        setError(t.batchAddResult(res.added, count, projectName, count - res.added));
      }
    } catch {
      if (actionOwner.current(ticket)) setError(t.batchBulkAddTo(projectName, t.libraryActionFailed));
    } finally { if (actionOwner.current(ticket)) setLoading(false); }
  };

  // ── Checkbox helpers ───────────────────────────────────────────────────────
  const toggleCheck = (sid: string) => {
    setCheckedSessions((prev) => {
      const next = new Set(prev);
      if (next.has(sid)) next.delete(sid); else next.add(sid);
      return next;
    });
  };

  const toggleAll = () => {
    if (checkedSessions.size === sessions.length) {
      setCheckedSessions(new Set());
    } else {
      setCheckedSessions(new Set(sessions.map((s) => s.session_id)));
    }
  };

  // ── Export CSV ─────────────────────────────────────────────────────────────
  const handleExportCsv = () => {
    if (!summary) return;
    const blob = new Blob([projectCsv(summary, t.compareUnavailable)], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    a.download = projectDownloadName(summary.project_name);
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  };

  // ── Derived data ───────────────────────────────────────────────────────────
  const sessionFilenameMap: Record<string, string> = {};
  if (currentProject?.sessions) {
    for (const s of currentProject.sessions) if (s.raw_filename) sessionFilenameMap[s.session_id] = s.raw_filename;
  }
  for (const s of sessions) if (s.raw_filename) sessionFilenameMap[s.session_id] = s.raw_filename;

  const availableSessions = sessions.filter((s) => !currentProject?.session_ids.includes(s.session_id));
  const getQualityColor = (q: number) => q >= 70 ? 'text-success' : q >= 50 ? 'text-warning' : 'text-danger';
  const getConcordanceColor = (p: number | null) =>
    p === null ? 'bg-bg border-border text-text-muted'
    :
    p >= 90 ? 'bg-success/15 border-success/30 text-success'
    : p >= 70 ? 'bg-warning/15 border-warning/30 text-warning'
    : 'bg-danger/15 border-danger/30 text-danger';

  // ═══════════════════════════════════ List View ═════════════════════════════
  if (view === 'list') {
    return (
      <div className="p-4 sm:p-6 min-w-0 flex flex-col gap-6">
        <UploadJobSummary onCheckSessions={() => void loadSessions()} />
        <SessionRecoveryFeedback state={recovery} />
        {error && (
          <div role="alert" className="p-3 bg-danger/10 border border-danger/30 rounded text-danger text-sm">
            {error}
            <button type="button" onClick={() => { setError(null); void loadProjects(); }}>{t.retry}</button>
            <button onClick={() => setError(null)} aria-label={t.close} className="ml-2 text-danger hover:opacity-80 inline-flex items-center align-middle"><X size={14} aria-hidden="true" /></button>
          </div>
        )}

        {/* ── Projects ── */}
        <div className="panel">
          <div className="mb-4">
            <h2 className="text-xl font-semibold text-text mb-3">{t.projects}</h2>
            <div className="flex flex-wrap gap-2 items-center">
              <input type="text" value={newProjectName} aria-label={t.newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                placeholder={t.newProjectName}
                className="px-3 py-1.5 border border-border rounded bg-surface text-text text-sm flex-1 min-w-0"
                onKeyDown={(e) => { if (e.key === 'Enter') handleCreateProject(); }}
                disabled={loading} />
              <button onClick={handleCreateProject}
                disabled={loading || !newProjectName.trim()}
                className="px-3 py-1.5 bg-primary text-white rounded text-sm font-medium disabled:opacity-50">{t.create}</button>
            </div>
          </div>
          {projects.length > 0 ? (
            <div role="region" aria-label={t.projects} tabIndex={0} className="max-w-full overflow-x-auto"><table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 px-3 text-text-muted font-medium">{t.nameLabel}</th>
                  <th className="text-left py-2 px-3 text-text-muted font-medium">{t.sessions}</th>
                  <th className="text-left py-2 px-3 text-text-muted font-medium">{t.created}</th>
                  <th className="text-left py-2 px-3 text-text-muted font-medium">{t.actions}</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((proj) => (
                  <tr key={proj.id} className="border-b border-border">
                    <td className="py-2 px-3 text-text">{proj.name}</td>
                    <td className="py-2 px-3 text-text">{proj.session_count}</td>
                    <td className="py-2 px-3 text-text-muted">{new Date(proj.created_at).toLocaleDateString()}</td>
                    <td className="py-2 px-3 flex gap-2">
                      <button onClick={() => handleViewProject(proj.id)} className="text-primary hover:text-primary/80 text-xs font-medium">{t.view}</button>
                      <button onClick={() => handleDeleteProject(proj.id, proj.name)} className="text-danger hover:opacity-80 text-xs font-medium">{t.delete}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          ) : (
            <div className="text-text-muted text-sm text-center py-6">{t.noProjectsYet}</div>
          )}
        </div>

        {/* ── Sessions ── */}
        <div className="panel">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-semibold text-text">{t.sessions}</h2>
            <div className="flex items-center gap-3">
              <span className="text-xs text-text-muted">{t.nSessions(sessions.length)}</span>
              {checkedSessions.size > 0 && (
                <>
                  <ProjectPicker
                    projects={projects}
                    disabled={loading}
                    onSelect={(pid, pname) => handleBulkAddToProject(pid, pname)}
                    label={t.addSelectedToProject(checkedSessions.size)}
                  />
                  <button
                    onClick={handleBulkDelete}
                    disabled={loading}
                    className="px-2.5 py-1 bg-danger text-white rounded text-xs font-medium hover:opacity-90 disabled:opacity-50"
                  >
                    {t.deleteSelected(checkedSessions.size)}
                  </button>
                </>
              )}
            </div>
          </div>

          {sessions.length > 0 ? (
            <div role="region" aria-label={t.sessions} tabIndex={0} className="max-w-full overflow-x-auto"><table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="py-2 px-2 w-8">
                    <input type="checkbox" aria-label={t.selectAllSessions}
                      checked={sessions.length > 0 && checkedSessions.size === sessions.length}
                      onChange={toggleAll}
                      className="accent-primary" />
                  </th>
                  <th className="text-left py-2 px-3 text-text-muted font-medium">{t.session}</th>
                  <th className="text-left py-2 px-3 text-text-muted font-medium">{t.instrument}</th>
                  <th className="text-left py-2 px-3 text-text-muted font-medium">{t.wells}</th>
                  <th className="text-left py-2 px-3 text-text-muted font-medium">{t.cycles}</th>
                  <th className="text-left py-2 px-3 text-text-muted font-medium">{t.uploaded}</th>
                  <th className="text-left py-2 px-3 text-text-muted font-medium">{t.actions}</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => {
                  const isActive = activeSessionId === s.session_id;
                  const checked = checkedSessions.has(s.session_id);
                  return (
                    <tr key={s.session_id} className={`border-b border-border ${isActive ? 'bg-primary/5' : ''} ${checked ? 'bg-danger/10' : ''}`}>
                      <td className="py-2 px-2">
                        <input type="checkbox" checked={checked} aria-label={t.selectSession(fmtSession(s.session_id, s.raw_filename))}
                          onChange={() => toggleCheck(s.session_id)}
                          className="accent-primary" />
                      </td>
                      <td className="py-2 px-3 text-text text-xs">
                        <span className="font-mono">{s.session_id.substring(0, 8)}</span>
                        {s.raw_filename && <span className="ml-1 text-text-muted">[{s.raw_filename}]</span>}
                        {isActive && <span className="ml-1 text-[10px] text-primary font-medium">({t.active})</span>}
                      </td>
                      <td className="py-2 px-3 text-text">{s.instrument}</td>
                      <td className="py-2 px-3 text-text">{s.num_wells}</td>
                      <td className="py-2 px-3 text-text">{s.num_cycles}</td>
                      <td className="py-2 px-3 text-text-muted text-xs">
                        {s.uploaded_at ? new Date(s.uploaded_at).toLocaleString() : '-'}
                      </td>
                      <td className="py-2 px-3">
                        <div className="flex gap-2 items-center">
                          <button onClick={() => handleLoadSession(s.session_id)} disabled={loading}
                            className="text-primary hover:text-primary/80 text-xs font-medium disabled:opacity-50">{t.load}</button>
                          <ProjectPicker
                            projects={projects}
                            disabled={loading}
                            onSelect={(pid, pname) => handleAddToProject(s.session_id, pid, pname)}
                          />
                          <button onClick={() => handleDeleteSession(s.session_id)} disabled={loading}
                            className="text-danger hover:opacity-80 text-xs font-medium disabled:opacity-50">{t.delete}</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table></div>
          ) : (
            <SessionEmptyState status={recovery.status} />
          )}
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════ Detail View ═══════════════════════════
  if (!currentProject || !summary) {
    return <div className="p-6"><div className="panel"><div className="text-text-muted text-sm">{t.loading}</div></div></div>;
  }

  const totals = summary.plates.reduce(
    (a, p) => ({
      wells: a.wells + (p.num_wells || 0), aa: a.aa + (projectGenotypeCounts(p).AA || 0),
      ab: a.ab + (projectGenotypeCounts(p).AB || 0), bb: a.bb + (projectGenotypeCounts(p).BB || 0),
      ntc: a.ntc + (projectGenotypeCounts(p).NTC || 0), unknown: a.unknown + (projectGenotypeCounts(p).Unknown || 0),
      quality: a.quality + (p.mean_quality || 0), count: a.count + 1,
    }),
    { wells: 0, aa: 0, ab: 0, bb: 0, ntc: 0, unknown: 0, quality: 0, count: 0 }
  );
  const avgQuality = totals.count > 0 ? totals.quality / totals.count : 0;

  return (
    <div className="p-4 sm:p-6 min-w-0">
      <UploadJobSummary onCheckSessions={handleBackToList} />
      <SessionRecoveryFeedback state={recovery} />
      <div className="panel">
        <div className="mb-6 flex flex-wrap items-start gap-3">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <button onClick={handleBackToList}
              className="px-3 py-1.5 bg-surface border border-border rounded text-sm font-medium text-text hover:bg-bg inline-flex items-center gap-1.5">
              <ArrowLeft size={14} aria-hidden="true" /> {t.back}
            </button>
            <h2 title={currentProject.name} className="min-w-0 break-words text-xl font-semibold text-text">{currentProject.name}</h2>
          </div>
          <button onClick={handleExportCsv}
            className="flex-none px-3 py-1.5 bg-primary text-white rounded text-sm font-medium">{t.exportCSVBtn}</button>
        </div>

        {/* Add Session */}
        <div className="mb-6 flex gap-2 items-center">
          <select value={selectedSession} aria-label={t.session}
            onChange={(e) => setSelectedSession(e.target.value)}
            className="px-3 py-1.5 border border-border rounded bg-surface text-text text-sm flex-1"
            disabled={loading || availableSessions.length === 0}>
            <option value="">{availableSessions.length === 0 ? t.noAvailableSessions : t.selectSessionToAdd}</option>
            {availableSessions.map((s) => (
              <option key={s.session_id} value={s.session_id}>
                {fmtSession(s.session_id, s.raw_filename)} - {s.instrument} ({s.num_wells} wells)
              </option>
            ))}
          </select>
          <button onClick={handleAddSession} disabled={loading || !selectedSession}
            className="px-3 py-1.5 bg-primary text-white rounded text-sm font-medium disabled:opacity-50">{t.add}</button>
        </div>

        {/* Bulk remove bar */}
        {checkedDetailSessions.size > 0 && (
          <div className="mb-4 flex items-center gap-3">
            <button
              onClick={handleBulkRemoveFromProject}
              disabled={loading}
              className="px-2.5 py-1 bg-warning text-white rounded text-xs font-medium hover:opacity-90 disabled:opacity-50"
            >
              {t.removeSelectedFromProject(checkedDetailSessions.size)}
            </button>
          </div>
        )}

        <div className="mb-4">
          <span className={`px-2 py-1 border rounded text-xs font-medium ${getConcordanceColor(summary.concordance.percentage)}`}>
            {t.concordance}: {summary.concordance.concordant_wells}/{summary.concordance.total_compared} ({summary.concordance.percentage === null ? t.compareUnavailable : `${summary.concordance.percentage.toFixed(1)}%`})
          </span>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-danger/10 border border-danger/30 rounded text-danger text-sm">
            {error}
            <button onClick={() => setError(null)} aria-label={t.close} className="ml-2 text-danger hover:opacity-80 inline-flex items-center align-middle"><X size={14} aria-hidden="true" /></button>
          </div>
        )}

        {summary.plates.length > 0 ? (
          <div role="region" aria-label={t.sessions} tabIndex={0} className="max-w-full overflow-x-auto"><table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="py-2 px-2 w-8">
                  <input type="checkbox" aria-label={t.selectAllProjectSessions}
                    checked={summary.plates.length > 0 && checkedDetailSessions.size === summary.plates.length}
                    onChange={() => {
                      if (checkedDetailSessions.size === summary.plates.length) {
                        setCheckedDetailSessions(new Set());
                      } else {
                        setCheckedDetailSessions(new Set(summary.plates.map((p) => p.session_id)));
                      }
                    }}
                    className="accent-primary" />
                </th>
                <th className="text-left py-2 px-3 text-text-muted font-medium">{t.session}</th>
                <th className="text-left py-2 px-3 text-text-muted font-medium">{t.instrument}</th>
                <th className="text-left py-2 px-3 text-text-muted font-medium">{t.wells}</th>
                <th className="text-left py-2 px-3 text-text-muted font-medium">AA</th>
                <th className="text-left py-2 px-3 text-text-muted font-medium">AB</th>
                <th className="text-left py-2 px-3 text-text-muted font-medium">BB</th>
                <th className="text-left py-2 px-3 text-text-muted font-medium">{t.wellTypeNTC}</th>
                <th className="text-left py-2 px-3 text-text-muted font-medium">{t.wellTypeUnknown}</th>
                <th className="text-left py-2 px-3 text-text-muted font-medium">{t.score}</th>
                <th className="text-left py-2 px-3 text-text-muted font-medium">{t.actions}</th>
              </tr>
            </thead>
            <tbody>
              {summary.plates.map((plate) => {
                const fn = plate.raw_filename || sessionFilenameMap[plate.session_id] || '';
                const isActive = activeSessionId === plate.session_id;
                const detailChecked = checkedDetailSessions.has(plate.session_id);
                return (
                  <tr key={plate.session_id} className={`border-b border-border ${isActive ? 'bg-primary/5' : ''} ${detailChecked ? 'bg-warning/10' : ''}`}>
                    <td className="py-2 px-2">
                    <input type="checkbox" checked={detailChecked} aria-label={t.selectSession(fmtSession(plate.session_id, fn))}
                        onChange={() => {
                          setCheckedDetailSessions((prev) => {
                            const next = new Set(prev);
                            if (next.has(plate.session_id)) next.delete(plate.session_id); else next.add(plate.session_id);
                            return next;
                          });
                        }}
                        className="accent-primary" />
                    </td>
                    <td className="py-2 px-3 text-text text-xs">
                      <span className="font-mono">{plate.session_id.substring(0, 8)}</span>
                      {fn && <span className="ml-1 text-text-muted">[{fn}]</span>}
                      {isActive && <span className="ml-1 text-[10px] text-primary font-medium">({t.active})</span>}
                    </td>
                    <td className="py-2 px-3 text-text">{plate.instrument}</td>
                    <td className="py-2 px-3 text-text">{plate.num_wells}</td>
                    <td className="py-2 px-3 text-text">{projectGenotypeCounts(plate).AA || 0}</td>
                    <td className="py-2 px-3 text-text">{projectGenotypeCounts(plate).AB || 0}</td>
                    <td className="py-2 px-3 text-text">{projectGenotypeCounts(plate).BB || 0}</td>
                    <td className="py-2 px-3 text-text">{projectGenotypeCounts(plate).NTC || 0}</td>
                    <td className="py-2 px-3 text-text">{projectGenotypeCounts(plate).Unknown || 0}</td>
                    <td className={`py-2 px-3 font-medium ${getQualityColor(plate.mean_quality || 0)}`}>
                      {(plate.mean_quality || 0).toFixed(1)}
                    </td>
                    <td className="py-2 px-3">
                      <div className="flex gap-2">
                        <button onClick={() => handleLoadSession(plate.session_id)} disabled={loading || plate.missing}
                          className="text-primary hover:text-primary/80 text-xs font-medium disabled:opacity-50">{t.load}</button>
                        <button onClick={() => handleRemoveSession(plate.session_id)} disabled={loading}
                          className="text-text-muted hover:text-text text-xs font-medium disabled:opacity-50">{t.remove}</button>
                        <button onClick={() => handleDeleteSession(plate.session_id)} disabled={loading}
                          className="text-danger hover:opacity-80 text-xs font-medium disabled:opacity-50">{t.delete}</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              <tr className="border-t-2 border-border bg-surface">
                <td className="py-2 px-2"></td>
                <td className="py-2 px-3 text-text font-semibold">{t.total}</td>
                <td className="py-2 px-3"></td>
                <td className="py-2 px-3 text-text font-semibold">{totals.wells}</td>
                <td className="py-2 px-3 text-text font-semibold">{totals.aa}</td>
                <td className="py-2 px-3 text-text font-semibold">{totals.ab}</td>
                <td className="py-2 px-3 text-text font-semibold">{totals.bb}</td>
                <td className="py-2 px-3 text-text font-semibold">{totals.ntc}</td>
                <td className="py-2 px-3 text-text font-semibold">{totals.unknown}</td>
                <td className={`py-2 px-3 font-semibold ${getQualityColor(avgQuality)}`}>{avgQuality.toFixed(1)}</td>
                <td className="py-2 px-3"></td>
              </tr>
            </tbody>
          </table></div>
        ) : (
          <div className="text-text-muted text-sm text-center py-8">{t.noSessionsInProject}</div>
        )}
      </div>
      {confirmDialog}
    </div>
  );
}
