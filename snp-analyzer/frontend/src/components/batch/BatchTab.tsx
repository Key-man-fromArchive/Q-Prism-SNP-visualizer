import { useEffect, useRef, useState } from 'react';
import {
  getSessions,
  getProjects,
  createProject,
  getProject,
  deleteProject,
  addProjectSession,
  removeProjectSession,
  getProjectSummary,
  getSessionInfo,
  deleteSession,
  bulkDeleteSessions,
  bulkAddProjectSessions,
  bulkRemoveProjectSessions,
} from '@/lib/api';
import type {
  SessionListItem,
  ProjectListResponse,
  ProjectResponse,
  ProjectSummaryResponse,
} from '@/types/api';
import { useSessionStore } from '@/stores/session-store';

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
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const filtered = query
    ? projects.filter((p) => p.name.toLowerCase().includes(query.toLowerCase()))
    : projects;

  return (
    <div ref={ref} className="relative inline-block">
      <button
        onClick={() => { if (!disabled) setOpen(!open); }}
        disabled={disabled}
        className="text-primary hover:text-primary/80 text-xs font-medium disabled:opacity-50 whitespace-nowrap"
      >
        {label || '+ Project'}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-52 bg-surface border border-border rounded shadow-lg z-50">
          <div className="p-1.5">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search project..."
              className="w-full px-2 py-1 text-xs border border-border rounded bg-bg text-text"
              autoFocus
            />
          </div>
          <div className="max-h-40 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-xs text-text-muted">
                {projects.length === 0 ? 'No projects' : 'No match'}
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
        </div>
      )}
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────
export function BatchTab({ onLoadSession }: BatchTabProps) {
  const [view, setView] = useState<View>('list');
  const [projects, setProjects] = useState<ProjectListResponse['projects']>([]);
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
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
  const setSession = useSessionStore((s) => s.setSession);
  const resetSession = useSessionStore((s) => s.reset);

  useEffect(() => { loadProjects(); loadSessions(); }, []);

  const loadProjects = async () => {
    try { setProjects((await getProjects()).projects); }
    catch (err) { setError(err instanceof Error ? err.message : 'Failed to load projects'); }
  };

  const loadSessions = async () => {
    try { setSessions(await getSessions()); setCheckedSessions(new Set()); }
    catch (err) { setError(err instanceof Error ? err.message : 'Failed to load sessions'); }
  };

  // ── Project CRUD ───────────────────────────────────────────────────────────
  const handleCreateProject = async () => {
    if (!newProjectName.trim()) return;
    try {
      setLoading(true);
      await createProject(newProjectName.trim());
      setNewProjectName('');
      await loadProjects();
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed to create project'); }
    finally { setLoading(false); }
  };

  const handleDeleteProject = async (id: string, name: string) => {
    if (!window.confirm(`Delete project "${name}"?`)) return;
    try { setLoading(true); await deleteProject(id); await loadProjects(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Failed to delete project'); }
    finally { setLoading(false); }
  };

  const handleViewProject = async (id: string) => {
    try {
      setLoading(true); setError(null);
      const [pd, sd] = await Promise.all([getProject(id), getProjectSummary(id)]);
      setCurrentProject(pd); setSummary(sd); setView('detail');
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed to load project details'); }
    finally { setLoading(false); }
  };

  const handleBackToList = () => {
    setView('list'); setCurrentProject(null); setSummary(null);
    setSelectedSession(''); setError(null); setCheckedDetailSessions(new Set());
  };

  // ── Session actions (detail view) ──────────────────────────────────────────
  const handleAddSession = async () => {
    if (!currentProject || !selectedSession) return;
    try {
      setLoading(true); setError(null);
      await addProjectSession(currentProject.id, selectedSession);
      const [pd, sd] = await Promise.all([getProject(currentProject.id), getProjectSummary(currentProject.id)]);
      setCurrentProject(pd); setSummary(sd); setSelectedSession('');
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed to add session'); }
    finally { setLoading(false); }
  };

  const handleRemoveSession = async (sid: string) => {
    if (!currentProject) return;
    try {
      setLoading(true); setError(null);
      await removeProjectSession(currentProject.id, sid);
      const [pd, sd] = await Promise.all([getProject(currentProject.id), getProjectSummary(currentProject.id)]);
      setCurrentProject(pd); setSummary(sd);
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed to remove session'); }
    finally { setLoading(false); }
  };

  // ── Bulk remove sessions from project ──────────────────────────────────
  const handleBulkRemoveFromProject = async () => {
    if (!currentProject || checkedDetailSessions.size === 0) return;
    const count = checkedDetailSessions.size;
    if (!window.confirm(`Remove ${count} session(s) from project "${currentProject.name}"?`)) return;
    try {
      setLoading(true); setError(null);
      await bulkRemoveProjectSessions(currentProject.id, [...checkedDetailSessions]);
      setCheckedDetailSessions(new Set());
      const [pd, sd] = await Promise.all([getProject(currentProject.id), getProjectSummary(currentProject.id)]);
      setCurrentProject(pd); setSummary(sd);
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed to bulk remove sessions'); }
    finally { setLoading(false); }
  };

  const handleLoadSession = async (sid: string) => {
    try { setLoading(true); setError(null); setSession(sid, await getSessionInfo(sid)); onLoadSession?.(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Failed to load session'); }
    finally { setLoading(false); }
  };

  // ── Session delete (single) ────────────────────────────────────────────────
  const handleDeleteSession = async (sid: string) => {
    const s = sessions.find((x) => x.session_id === sid);
    if (!window.confirm(`Delete session "${fmtSession(sid, s?.raw_filename)}" permanently?\nThis removes it from all projects.`)) return;
    try {
      setLoading(true); setError(null);
      if (activeSessionId === sid) resetSession();
      await deleteSession(sid);
      await Promise.all([loadSessions(), loadProjects()]);
      if (currentProject) {
        try {
          const [pd, sd] = await Promise.all([getProject(currentProject.id), getProjectSummary(currentProject.id)]);
          setCurrentProject(pd); setSummary(sd);
        } catch { /* ok */ }
      }
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed to delete session'); }
    finally { setLoading(false); }
  };

  // ── Session delete (bulk) ──────────────────────────────────────────────────
  const handleBulkDelete = async () => {
    const count = checkedSessions.size;
    if (count === 0) return;
    if (!window.confirm(`Delete ${count} session(s) permanently?\nThis removes them from all projects and cannot be undone.`)) return;
    try {
      setLoading(true); setError(null);
      if (activeSessionId && checkedSessions.has(activeSessionId)) resetSession();
      await bulkDeleteSessions([...checkedSessions]);
      setError(null);
      await Promise.all([loadSessions(), loadProjects()]);
    } catch (err) { setError(err instanceof Error ? err.message : 'Bulk delete failed'); }
    finally { setLoading(false); }
  };

  // ── Add session to project (from session list) ────────────────────────────
  const handleAddToProject = async (sid: string, projectId: string, projectName: string) => {
    try {
      setLoading(true); setError(null);
      await addProjectSession(projectId, sid);
      setError(null);
      await loadProjects();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed';
      setError(`Add to "${projectName}": ${msg}`);
    } finally { setLoading(false); }
  };

  // ── Bulk add selected sessions to project ────────────────────────────────
  const handleBulkAddToProject = async (projectId: string, projectName: string) => {
    const count = checkedSessions.size;
    if (count === 0) return;
    try {
      setLoading(true); setError(null);
      const res = await bulkAddProjectSessions(projectId, [...checkedSessions]);
      setCheckedSessions(new Set());
      await loadProjects();
      if (res.added < count) {
        setError(`Added ${res.added}/${count} to "${projectName}" (${count - res.added} already in project or missing)`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed';
      setError(`Bulk add to "${projectName}": ${msg}`);
    } finally { setLoading(false); }
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
    const rows: string[] = ['Session ID,Filename,Instrument,Wells,AA,AB,BB,NTC,Unknown,Mean Quality'];
    let tw = 0, taa = 0, tab = 0, tbb = 0, tntc = 0, tu = 0, tq = 0, pc = 0;
    summary.plates.forEach((p) => {
      const aa = p.genotype_counts?.AA || 0, ab2 = p.genotype_counts?.AB || 0;
      const bb = p.genotype_counts?.BB || 0, ntc = p.genotype_counts?.NTC || 0;
      const uk = p.genotype_counts?.Unknown || 0, w = p.num_wells || 0, q = p.mean_quality || 0;
      rows.push(`${p.session_id},${p.raw_filename||''},${p.instrument},${w},${aa},${ab2},${bb},${ntc},${uk},${q.toFixed(1)}`);
      tw += w; taa += aa; tab += ab2; tbb += bb; tntc += ntc; tu += uk; tq += q; pc++;
    });
    const aq = pc > 0 ? tq / pc : 0;
    rows.push(`TOTAL,,,${tw},${taa},${tab},${tbb},${tntc},${tu},${aq.toFixed(1)}`);
    rows.push('', `Concordance: ${summary.concordance.concordant_wells}/${summary.concordance.total_compared} (${summary.concordance.percentage.toFixed(1)}%)`);
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    a.download = `${summary.project_name.replace(/\s+/g, '_')}_summary.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  };

  // ── Derived data ───────────────────────────────────────────────────────────
  const sessionFilenameMap: Record<string, string> = {};
  if (currentProject?.sessions) {
    for (const s of currentProject.sessions) if ((s as any).raw_filename) sessionFilenameMap[s.session_id] = (s as any).raw_filename;
  }
  for (const s of sessions) if (s.raw_filename) sessionFilenameMap[s.session_id] = s.raw_filename;

  const availableSessions = sessions.filter((s) => !currentProject?.session_ids.includes(s.session_id));
  const getQualityColor = (q: number) => q >= 70 ? 'text-green-600' : q >= 50 ? 'text-amber-600' : 'text-red-600';
  const getConcordanceColor = (p: number) =>
    p >= 90 ? 'bg-green-100 border-green-400 text-green-800 dark:bg-green-900/30 dark:border-green-700 dark:text-green-300'
    : p >= 70 ? 'bg-amber-100 border-amber-400 text-amber-800 dark:bg-amber-900/30 dark:border-amber-700 dark:text-amber-300'
    : 'bg-red-100 border-red-400 text-red-800 dark:bg-red-900/30 dark:border-red-700 dark:text-red-300';

  // ═══════════════════════════════════ List View ═════════════════════════════
  if (view === 'list') {
    return (
      <div className="p-6 flex flex-col gap-6">
        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded text-red-800 text-sm dark:bg-red-900/20 dark:border-red-800 dark:text-red-300">
            {error}
            <button onClick={() => setError(null)} className="ml-2 text-red-600 hover:text-red-800 font-bold">&times;</button>
          </div>
        )}

        {/* ── Projects ── */}
        <div className="panel">
          <div className="mb-4">
            <h2 className="text-xl font-semibold text-text mb-3">Projects</h2>
            <div className="flex gap-2 items-center">
              <input type="text" value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                placeholder="New project name..."
                className="px-3 py-1.5 border border-border rounded bg-surface text-text text-sm flex-1"
                onKeyDown={(e) => { if (e.key === 'Enter') handleCreateProject(); }}
                disabled={loading} />
              <button onClick={handleCreateProject}
                disabled={loading || !newProjectName.trim()}
                className="px-3 py-1.5 bg-primary text-white rounded text-sm font-medium disabled:opacity-50">Create</button>
            </div>
          </div>
          {projects.length > 0 ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 px-3 text-text-muted font-medium">Name</th>
                  <th className="text-left py-2 px-3 text-text-muted font-medium">Sessions</th>
                  <th className="text-left py-2 px-3 text-text-muted font-medium">Created</th>
                  <th className="text-left py-2 px-3 text-text-muted font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((proj) => (
                  <tr key={proj.id} className="border-b border-border">
                    <td className="py-2 px-3 text-text">{proj.name}</td>
                    <td className="py-2 px-3 text-text">{proj.session_count}</td>
                    <td className="py-2 px-3 text-text-muted">{new Date(proj.created_at).toLocaleDateString()}</td>
                    <td className="py-2 px-3 flex gap-2">
                      <button onClick={() => handleViewProject(proj.id)} className="text-primary hover:text-primary/80 text-xs font-medium">View</button>
                      <button onClick={() => handleDeleteProject(proj.id, proj.name)} className="text-red-600 hover:text-red-800 text-xs font-medium">Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="text-text-muted text-sm text-center py-6">No projects yet.</div>
          )}
        </div>

        {/* ── Sessions ── */}
        <div className="panel">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-semibold text-text">Sessions</h2>
            <div className="flex items-center gap-3">
              <span className="text-xs text-text-muted">{sessions.length} session(s)</span>
              {checkedSessions.size > 0 && (
                <>
                  <ProjectPicker
                    projects={projects}
                    disabled={loading}
                    onSelect={(pid, pname) => handleBulkAddToProject(pid, pname)}
                    label={`Add Selected (${checkedSessions.size}) to Project`}
                  />
                  <button
                    onClick={handleBulkDelete}
                    disabled={loading}
                    className="px-2.5 py-1 bg-red-600 text-white rounded text-xs font-medium hover:bg-red-700 disabled:opacity-50"
                  >
                    Delete Selected ({checkedSessions.size})
                  </button>
                </>
              )}
            </div>
          </div>

          {sessions.length > 0 ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="py-2 px-2 w-8">
                    <input type="checkbox"
                      checked={sessions.length > 0 && checkedSessions.size === sessions.length}
                      onChange={toggleAll}
                      className="accent-primary" />
                  </th>
                  <th className="text-left py-2 px-3 text-text-muted font-medium">Session</th>
                  <th className="text-left py-2 px-3 text-text-muted font-medium">Instrument</th>
                  <th className="text-left py-2 px-3 text-text-muted font-medium">Wells</th>
                  <th className="text-left py-2 px-3 text-text-muted font-medium">Cycles</th>
                  <th className="text-left py-2 px-3 text-text-muted font-medium">Uploaded</th>
                  <th className="text-left py-2 px-3 text-text-muted font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => {
                  const isActive = activeSessionId === s.session_id;
                  const checked = checkedSessions.has(s.session_id);
                  return (
                    <tr key={s.session_id} className={`border-b border-border ${isActive ? 'bg-primary/5' : ''} ${checked ? 'bg-red-50 dark:bg-red-900/10' : ''}`}>
                      <td className="py-2 px-2">
                        <input type="checkbox" checked={checked}
                          onChange={() => toggleCheck(s.session_id)}
                          className="accent-primary" />
                      </td>
                      <td className="py-2 px-3 text-text text-xs">
                        <span className="font-mono">{s.session_id.substring(0, 8)}</span>
                        {s.raw_filename && <span className="ml-1 text-text-muted">[{s.raw_filename}]</span>}
                        {isActive && <span className="ml-1 text-[10px] text-primary font-medium">(active)</span>}
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
                            className="text-primary hover:text-primary/80 text-xs font-medium disabled:opacity-50">Load</button>
                          <ProjectPicker
                            projects={projects}
                            disabled={loading}
                            onSelect={(pid, pname) => handleAddToProject(s.session_id, pid, pname)}
                          />
                          <button onClick={() => handleDeleteSession(s.session_id)} disabled={loading}
                            className="text-red-600 hover:text-red-800 text-xs font-medium disabled:opacity-50">Delete</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <div className="text-text-muted text-sm text-center py-6">No sessions. Upload a file first.</div>
          )}
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════ Detail View ═══════════════════════════
  if (!currentProject || !summary) {
    return <div className="p-6"><div className="panel"><div className="text-text-muted text-sm">Loading...</div></div></div>;
  }

  const totals = summary.plates.reduce(
    (a, p) => ({
      wells: a.wells + (p.num_wells || 0), aa: a.aa + (p.genotype_counts?.AA || 0),
      ab: a.ab + (p.genotype_counts?.AB || 0), bb: a.bb + (p.genotype_counts?.BB || 0),
      ntc: a.ntc + (p.genotype_counts?.NTC || 0), unknown: a.unknown + (p.genotype_counts?.Unknown || 0),
      quality: a.quality + (p.mean_quality || 0), count: a.count + 1,
    }),
    { wells: 0, aa: 0, ab: 0, bb: 0, ntc: 0, unknown: 0, quality: 0, count: 0 }
  );
  const avgQuality = totals.count > 0 ? totals.quality / totals.count : 0;

  return (
    <div className="p-6">
      <div className="panel">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button onClick={handleBackToList}
              className="px-3 py-1.5 bg-surface border border-border rounded text-sm font-medium text-text hover:bg-bg">
              &#8592; Back
            </button>
            <h2 className="text-xl font-semibold text-text">{currentProject.name}</h2>
          </div>
          <button onClick={handleExportCsv}
            className="px-3 py-1.5 bg-primary text-white rounded text-sm font-medium">Export CSV</button>
        </div>

        {/* Add Session */}
        <div className="mb-6 flex gap-2 items-center">
          <select value={selectedSession}
            onChange={(e) => setSelectedSession(e.target.value)}
            className="px-3 py-1.5 border border-border rounded bg-surface text-text text-sm flex-1"
            disabled={loading || availableSessions.length === 0}>
            <option value="">{availableSessions.length === 0 ? 'No available sessions' : 'Select session to add...'}</option>
            {availableSessions.map((s) => (
              <option key={s.session_id} value={s.session_id}>
                {fmtSession(s.session_id, s.raw_filename)} - {s.instrument} ({s.num_wells} wells)
              </option>
            ))}
          </select>
          <button onClick={handleAddSession} disabled={loading || !selectedSession}
            className="px-3 py-1.5 bg-primary text-white rounded text-sm font-medium disabled:opacity-50">Add</button>
        </div>

        {/* Bulk remove bar */}
        {checkedDetailSessions.size > 0 && (
          <div className="mb-4 flex items-center gap-3">
            <button
              onClick={handleBulkRemoveFromProject}
              disabled={loading}
              className="px-2.5 py-1 bg-amber-600 text-white rounded text-xs font-medium hover:bg-amber-700 disabled:opacity-50"
            >
              Remove Selected ({checkedDetailSessions.size}) from Project
            </button>
          </div>
        )}

        {summary.concordance.total_compared > 0 && (
          <div className="mb-4">
            <span className={`px-2 py-1 border rounded text-xs font-medium ${getConcordanceColor(summary.concordance.percentage)}`}>
              Concordance: {summary.concordance.concordant_wells}/{summary.concordance.total_compared} ({summary.concordance.percentage.toFixed(1)}%)
            </span>
          </div>
        )}

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-800 text-sm dark:bg-red-900/20 dark:border-red-800 dark:text-red-300">
            {error}
            <button onClick={() => setError(null)} className="ml-2 text-red-600 hover:text-red-800 font-bold">&times;</button>
          </div>
        )}

        {summary.plates.length > 0 ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="py-2 px-2 w-8">
                  <input type="checkbox"
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
                <th className="text-left py-2 px-3 text-text-muted font-medium">Session</th>
                <th className="text-left py-2 px-3 text-text-muted font-medium">Instrument</th>
                <th className="text-left py-2 px-3 text-text-muted font-medium">Wells</th>
                <th className="text-left py-2 px-3 text-text-muted font-medium">AA</th>
                <th className="text-left py-2 px-3 text-text-muted font-medium">AB</th>
                <th className="text-left py-2 px-3 text-text-muted font-medium">BB</th>
                <th className="text-left py-2 px-3 text-text-muted font-medium">NTC</th>
                <th className="text-left py-2 px-3 text-text-muted font-medium">Unknown</th>
                <th className="text-left py-2 px-3 text-text-muted font-medium">Quality</th>
                <th className="text-left py-2 px-3 text-text-muted font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {summary.plates.map((plate) => {
                const fn = plate.raw_filename || sessionFilenameMap[plate.session_id] || '';
                const isActive = activeSessionId === plate.session_id;
                const detailChecked = checkedDetailSessions.has(plate.session_id);
                return (
                  <tr key={plate.session_id} className={`border-b border-border ${isActive ? 'bg-primary/5' : ''} ${detailChecked ? 'bg-amber-50 dark:bg-amber-900/10' : ''}`}>
                    <td className="py-2 px-2">
                      <input type="checkbox" checked={detailChecked}
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
                      {isActive && <span className="ml-1 text-[10px] text-primary font-medium">(active)</span>}
                    </td>
                    <td className="py-2 px-3 text-text">{plate.instrument}</td>
                    <td className="py-2 px-3 text-text">{plate.num_wells}</td>
                    <td className="py-2 px-3 text-text">{plate.genotype_counts?.AA || 0}</td>
                    <td className="py-2 px-3 text-text">{plate.genotype_counts?.AB || 0}</td>
                    <td className="py-2 px-3 text-text">{plate.genotype_counts?.BB || 0}</td>
                    <td className="py-2 px-3 text-text">{plate.genotype_counts?.NTC || 0}</td>
                    <td className="py-2 px-3 text-text">{plate.genotype_counts?.Unknown || 0}</td>
                    <td className={`py-2 px-3 font-medium ${getQualityColor(plate.mean_quality || 0)}`}>
                      {(plate.mean_quality || 0).toFixed(1)}
                    </td>
                    <td className="py-2 px-3">
                      <div className="flex gap-2">
                        <button onClick={() => handleLoadSession(plate.session_id)} disabled={loading || plate.missing}
                          className="text-primary hover:text-primary/80 text-xs font-medium disabled:opacity-50">Load</button>
                        <button onClick={() => handleRemoveSession(plate.session_id)} disabled={loading}
                          className="text-text-muted hover:text-text text-xs font-medium disabled:opacity-50">Remove</button>
                        <button onClick={() => handleDeleteSession(plate.session_id)} disabled={loading}
                          className="text-red-600 hover:text-red-800 text-xs font-medium disabled:opacity-50">Delete</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              <tr className="border-t-2 border-border bg-surface">
                <td className="py-2 px-2"></td>
                <td className="py-2 px-3 text-text font-semibold">TOTAL</td>
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
          </table>
        ) : (
          <div className="text-text-muted text-sm text-center py-8">No sessions in this project.</div>
        )}
      </div>
    </div>
  );
}
