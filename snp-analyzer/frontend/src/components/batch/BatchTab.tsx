import { useEffect, useState } from 'react';
import {
  getSessions,
  getProjects,
  createProject,
  getProject,
  deleteProject,
  addProjectSession,
  removeProjectSession,
  getProjectSummary,
} from '@/lib/api';
import type {
  SessionListItem,
  ProjectListResponse,
  ProjectResponse,
  ProjectSummaryResponse,
} from '@/types/api';

type View = 'list' | 'detail';

export function BatchTab() {
  const [view, setView] = useState<View>('list');
  const [projects, setProjects] = useState<ProjectListResponse['projects']>([]);
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [currentProject, setCurrentProject] = useState<ProjectResponse | null>(null);
  const [summary, setSummary] = useState<ProjectSummaryResponse | null>(null);
  const [newProjectName, setNewProjectName] = useState('');
  const [selectedSession, setSelectedSession] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load projects and sessions on mount
  useEffect(() => {
    loadProjects();
    loadSessions();
  }, []);

  const loadProjects = async () => {
    try {
      const data = await getProjects();
      setProjects(data.projects);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load projects');
    }
  };

  const loadSessions = async () => {
    try {
      const data = await getSessions();
      setSessions(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load sessions');
    }
  };

  const handleCreateProject = async () => {
    if (!newProjectName.trim()) return;

    try {
      setLoading(true);
      await createProject(newProjectName.trim());
      setNewProjectName('');
      await loadProjects();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create project');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteProject = async (id: string, name: string) => {
    if (!window.confirm(`Are you sure you want to delete project "${name}"?`)) {
      return;
    }

    try {
      setLoading(true);
      await deleteProject(id);
      await loadProjects();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete project');
    } finally {
      setLoading(false);
    }
  };

  const handleViewProject = async (id: string) => {
    try {
      setLoading(true);
      setError(null);
      const [projectData, summaryData] = await Promise.all([
        getProject(id),
        getProjectSummary(id),
      ]);
      setCurrentProject(projectData);
      setSummary(summaryData);
      setView('detail');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load project details');
    } finally {
      setLoading(false);
    }
  };

  const handleBackToList = () => {
    setView('list');
    setCurrentProject(null);
    setSummary(null);
    setSelectedSession('');
    setError(null);
  };

  const handleAddSession = async () => {
    if (!currentProject || !selectedSession) return;

    try {
      setLoading(true);
      setError(null);
      await addProjectSession(currentProject.id, selectedSession);
      const [projectData, summaryData] = await Promise.all([
        getProject(currentProject.id),
        getProjectSummary(currentProject.id),
      ]);
      setCurrentProject(projectData);
      setSummary(summaryData);
      setSelectedSession('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add session');
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveSession = async (sid: string) => {
    if (!currentProject) return;

    try {
      setLoading(true);
      setError(null);
      await removeProjectSession(currentProject.id, sid);
      const [projectData, summaryData] = await Promise.all([
        getProject(currentProject.id),
        getProjectSummary(currentProject.id),
      ]);
      setCurrentProject(projectData);
      setSummary(summaryData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove session');
    } finally {
      setLoading(false);
    }
  };

  const handleExportCsv = () => {
    if (!summary) return;

    const rows: string[] = [];
    rows.push('Session ID,Instrument,Wells,AA,AB,BB,NTC,Unknown,Mean Quality');

    let totalWells = 0;
    let totalAA = 0;
    let totalAB = 0;
    let totalBB = 0;
    let totalNTC = 0;
    let totalUnknown = 0;
    let totalQuality = 0;
    let plateCount = 0;

    summary.plates.forEach((plate) => {
      const aa = plate.genotype_counts?.AA || 0;
      const ab = plate.genotype_counts?.AB || 0;
      const bb = plate.genotype_counts?.BB || 0;
      const ntc = plate.genotype_counts?.NTC || 0;
      const unknown = plate.genotype_counts?.Unknown || 0;
      const wells = plate.num_wells || 0;
      const quality = plate.mean_quality || 0;

      rows.push(
        `${plate.session_id},${plate.instrument},${wells},${aa},${ab},${bb},${ntc},${unknown},${quality.toFixed(1)}`
      );

      totalWells += wells;
      totalAA += aa;
      totalAB += ab;
      totalBB += bb;
      totalNTC += ntc;
      totalUnknown += unknown;
      totalQuality += quality;
      plateCount += 1;
    });

    const avgQuality = plateCount > 0 ? totalQuality / plateCount : 0;
    rows.push(
      `TOTAL,,${totalWells},${totalAA},${totalAB},${totalBB},${totalNTC},${totalUnknown},${avgQuality.toFixed(1)}`
    );

    rows.push('');
    rows.push(
      `Concordance: ${summary.concordance.concordant_wells}/${summary.concordance.total_compared} (${summary.concordance.percentage.toFixed(1)}%)`
    );

    const csv = rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${summary.project_name.replace(/\s+/g, '_')}_summary.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Get sessions not in current project
  const availableSessions = sessions.filter(
    (s) => !currentProject?.session_ids.includes(s.session_id)
  );

  // Quality color helper
  const getQualityColor = (quality: number): string => {
    if (quality >= 70) return 'text-green-600';
    if (quality >= 50) return 'text-amber-600';
    return 'text-red-600';
  };

  // Concordance color helper
  const getConcordanceColor = (percentage: number): string => {
    if (percentage >= 90) return 'bg-green-100 border-green-400 text-green-800';
    if (percentage >= 70) return 'bg-amber-100 border-amber-400 text-amber-800';
    return 'bg-red-100 border-red-400 text-red-800';
  };

  if (view === 'list') {
    return (
      <div className="p-6">
        <div className="panel">
          {/* Header */}
          <div className="mb-6">
            <h2 className="text-xl font-semibold text-text mb-4">Projects</h2>

            {/* Create Form */}
            <div className="flex gap-2 items-center">
              <input
                type="text"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                placeholder="New project name..."
                className="px-3 py-1.5 border border-border rounded bg-surface text-text text-sm flex-1"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreateProject();
                }}
                disabled={loading}
              />
              <button
                onClick={handleCreateProject}
                disabled={loading || !newProjectName.trim()}
                className="px-3 py-1.5 bg-primary text-white rounded text-sm font-medium disabled:opacity-50"
              >
                Create
              </button>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-800 text-sm">
              {error}
            </div>
          )}

          {/* Projects Table */}
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
                    <td className="py-2 px-3 text-text-muted">
                      {new Date(proj.created_at).toLocaleDateString()}
                    </td>
                    <td className="py-2 px-3 flex gap-2">
                      <button
                        onClick={() => handleViewProject(proj.id)}
                        className="text-primary hover:text-primary/80 text-xs font-medium"
                      >
                        View
                      </button>
                      <button
                        onClick={() => handleDeleteProject(proj.id, proj.name)}
                        className="text-red-600 hover:text-red-800 text-xs font-medium"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="text-text-muted text-sm text-center py-8">
              No projects yet. Create one above.
            </div>
          )}
        </div>
      </div>
    );
  }

  // Detail View
  if (!currentProject || !summary) {
    return (
      <div className="p-6">
        <div className="panel">
          <div className="text-text-muted text-sm">Loading project details...</div>
        </div>
      </div>
    );
  }

  // Calculate totals
  const totals = summary.plates.reduce(
    (acc, plate) => ({
      wells: acc.wells + (plate.num_wells || 0),
      aa: acc.aa + (plate.genotype_counts?.AA || 0),
      ab: acc.ab + (plate.genotype_counts?.AB || 0),
      bb: acc.bb + (plate.genotype_counts?.BB || 0),
      ntc: acc.ntc + (plate.genotype_counts?.NTC || 0),
      unknown: acc.unknown + (plate.genotype_counts?.Unknown || 0),
      quality: acc.quality + (plate.mean_quality || 0),
      count: acc.count + 1,
    }),
    { wells: 0, aa: 0, ab: 0, bb: 0, ntc: 0, unknown: 0, quality: 0, count: 0 }
  );

  const avgQuality = totals.count > 0 ? totals.quality / totals.count : 0;

  return (
    <div className="p-6">
      <div className="panel">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={handleBackToList}
              className="px-3 py-1.5 bg-surface border border-border rounded text-sm font-medium text-text hover:bg-bg"
            >
              ← Back to list
            </button>
            <h2 className="text-xl font-semibold text-text">{currentProject.name}</h2>
          </div>
          <button
            onClick={handleExportCsv}
            className="px-3 py-1.5 bg-primary text-white rounded text-sm font-medium"
          >
            Export CSV
          </button>
        </div>

        {/* Add Session */}
        <div className="mb-6 flex gap-2 items-center">
          <select
            value={selectedSession}
            onChange={(e) => setSelectedSession(e.target.value)}
            className="px-3 py-1.5 border border-border rounded bg-surface text-text text-sm flex-1"
            disabled={loading || availableSessions.length === 0}
          >
            <option value="">
              {availableSessions.length === 0
                ? 'No available sessions'
                : 'Select session to add...'}
            </option>
            {availableSessions.map((s) => (
              <option key={s.session_id} value={s.session_id}>
                {s.session_id.substring(0, 8)} - {s.instrument} ({s.num_wells} wells)
              </option>
            ))}
          </select>
          <button
            onClick={handleAddSession}
            disabled={loading || !selectedSession}
            className="px-3 py-1.5 bg-primary text-white rounded text-sm font-medium disabled:opacity-50"
          >
            Add
          </button>
        </div>

        {/* Concordance Badge */}
        {summary.concordance.total_compared > 0 && (
          <div className="mb-4">
            <span
              className={`px-2 py-1 border rounded text-xs font-medium ${getConcordanceColor(
                summary.concordance.percentage
              )}`}
            >
              Concordance: {summary.concordance.concordant_wells}/
              {summary.concordance.total_compared} ({summary.concordance.percentage.toFixed(1)}%)
            </span>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-800 text-sm">
            {error}
          </div>
        )}

        {/* Plates Table */}
        {summary.plates.length > 0 ? (
          <>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 px-3 text-text-muted font-medium">Session ID</th>
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
                {summary.plates.map((plate) => (
                  <tr key={plate.session_id} className="border-b border-border">
                    <td className="py-2 px-3 text-text font-mono text-xs">
                      {plate.session_id.substring(0, 8)}
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
                      <button
                        onClick={() => handleRemoveSession(plate.session_id)}
                        className="text-red-600 hover:text-red-800 text-xs font-medium"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
                {/* Totals Row */}
                <tr className="border-t-2 border-border bg-surface">
                  <td className="py-2 px-3 text-text font-semibold">TOTAL</td>
                  <td className="py-2 px-3"></td>
                  <td className="py-2 px-3 text-text font-semibold">{totals.wells}</td>
                  <td className="py-2 px-3 text-text font-semibold">{totals.aa}</td>
                  <td className="py-2 px-3 text-text font-semibold">{totals.ab}</td>
                  <td className="py-2 px-3 text-text font-semibold">{totals.bb}</td>
                  <td className="py-2 px-3 text-text font-semibold">{totals.ntc}</td>
                  <td className="py-2 px-3 text-text font-semibold">{totals.unknown}</td>
                  <td className={`py-2 px-3 font-semibold ${getQualityColor(avgQuality)}`}>
                    {avgQuality.toFixed(1)}
                  </td>
                  <td className="py-2 px-3"></td>
                </tr>
              </tbody>
            </table>
          </>
        ) : (
          <div className="text-text-muted text-sm text-center py-8">
            No sessions in this project. Add sessions above.
          </div>
        )}
      </div>
    </div>
  );
}
