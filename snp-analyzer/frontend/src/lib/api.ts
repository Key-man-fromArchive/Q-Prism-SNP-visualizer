import type {
  UploadResponse,
  ScatterResponse,
  PlateResponse,
  AmplificationResponse,
  CtResponse,
  ProtocolResponse,
  ProtocolStep,
  ClusteringRequest,
  ClusteringResult,
  ManualWellTypeUpdate,
  WellTypesResponse,
  QcResponse,
  SamplesResponse,
  SessionListItem,
  CompareScatterResponse,
  CompareStatsResponse,
  StatisticsResponse,
  PresetsListResponse,
  PresetResponse,
  QualityResponse,
  ProjectListResponse,
  ProjectResponse,
  ProjectSummaryResponse,
} from '@/types/api';

/**
 * Build query string from params object, skipping undefined values
 */
function buildQuery(params: Record<string, string | number | boolean | undefined>): string {
  const entries = Object.entries(params)
    .filter(([_, value]) => value !== undefined)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);

  return entries.length > 0 ? `?${entries.join('&')}` : '';
}

/**
 * Generic fetch wrapper with error handling
 */
async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);

  if (!res.ok) {
    let errorMessage = `HTTP ${res.status}: ${res.statusText}`;
    try {
      const errorData = await res.json();
      if (errorData.detail) {
        errorMessage = typeof errorData.detail === 'string'
          ? errorData.detail
          : JSON.stringify(errorData.detail);
      }
    } catch {
      // If JSON parsing fails, use default error message
    }
    throw new Error(errorMessage);
  }

  return res.json();
}

// ============================================================================
// Upload
// ============================================================================

export async function uploadFile(file: File): Promise<UploadResponse> {
  const formData = new FormData();
  formData.append('file', file);

  return apiFetch<UploadResponse>('/api/upload', {
    method: 'POST',
    body: formData,
  });
}

// ============================================================================
// Data
// ============================================================================

export async function getScatter(
  sid: string,
  cycle?: number,
  useRox?: boolean
): Promise<ScatterResponse> {
  const query = buildQuery({ cycle, use_rox: useRox });
  return apiFetch<ScatterResponse>(`/api/data/${sid}/scatter${query}`);
}

export async function getPlate(
  sid: string,
  cycle?: number,
  useRox?: boolean
): Promise<PlateResponse> {
  const query = buildQuery({ cycle, use_rox: useRox });
  return apiFetch<PlateResponse>(`/api/data/${sid}/plate${query}`);
}

export async function getAmplification(
  sid: string,
  wells: string[],
  useRox?: boolean
): Promise<AmplificationResponse> {
  const query = buildQuery({ wells: wells.join(','), use_rox: useRox });
  return apiFetch<AmplificationResponse>(`/api/data/${sid}/amplification${query}`);
}

export async function getAllAmplification(
  sid: string,
  useRox?: boolean
): Promise<AmplificationResponse> {
  const query = buildQuery({ use_rox: useRox });
  return apiFetch<AmplificationResponse>(`/api/data/${sid}/amplification/all${query}`);
}

export async function getCtData(
  sid: string,
  useRox?: boolean
): Promise<CtResponse> {
  const query = buildQuery({ use_rox: useRox });
  return apiFetch<CtResponse>(`/api/data/${sid}/ct${query}`);
}

export async function exportPdf(
  sid: string,
  useRox?: boolean
): Promise<Blob> {
  const query = buildQuery({ use_rox: useRox });
  const res = await fetch(`/api/data/${sid}/export/pdf${query}`);

  if (!res.ok) {
    throw new Error(`Failed to export PDF: ${res.statusText}`);
  }

  return res.blob();
}

export async function getProtocol(sid: string): Promise<ProtocolResponse> {
  return apiFetch<ProtocolResponse>(`/api/data/${sid}/protocol`);
}

export async function updateProtocol(
  sid: string,
  steps: ProtocolStep[]
): Promise<{ status: string }> {
  return apiFetch<{ status: string }>(`/api/data/${sid}/protocol`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(steps),
  });
}

// ============================================================================
// Clustering
// ============================================================================

export async function runClustering(
  sid: string,
  req: ClusteringRequest
): Promise<ClusteringResult> {
  return apiFetch<ClusteringResult>(`/api/data/${sid}/cluster`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
}

export async function getCluster(sid: string): Promise<ClusteringResult> {
  return apiFetch<ClusteringResult>(`/api/data/${sid}/cluster`);
}

export async function setWellTypes(
  sid: string,
  req: ManualWellTypeUpdate
): Promise<WellTypesResponse> {
  return apiFetch<WellTypesResponse>(`/api/data/${sid}/welltypes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
}

export async function getWellTypes(sid: string): Promise<WellTypesResponse> {
  return apiFetch<WellTypesResponse>(`/api/data/${sid}/welltypes`);
}

export async function deleteWellTypes(sid: string): Promise<{ status: string }> {
  return apiFetch<{ status: string }>(`/api/data/${sid}/welltypes`, {
    method: 'DELETE',
  });
}

export async function bulkSetWellTypes(
  sid: string,
  assignments: Record<string, string>
): Promise<WellTypesResponse> {
  return apiFetch<WellTypesResponse>(`/api/data/${sid}/welltypes/bulk`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ assignments }),
  });
}

// ============================================================================
// Export
// ============================================================================

export async function exportCsv(
  sid: string,
  cycle?: number,
  useRox?: boolean
): Promise<Blob> {
  const query = buildQuery({ cycle, use_rox: useRox });
  const res = await fetch(`/api/data/${sid}/export/csv${query}`);

  if (!res.ok) {
    throw new Error(`Failed to export CSV: ${res.statusText}`);
  }

  return res.blob();
}

// ============================================================================
// QC
// ============================================================================

export async function getQc(
  sid: string,
  cycle?: number,
  useRox?: boolean
): Promise<QcResponse> {
  const query = buildQuery({ cycle, use_rox: useRox });
  return apiFetch<QcResponse>(`/api/data/${sid}/qc${query}`);
}

// ============================================================================
// Samples
// ============================================================================

export async function getSamples(sid: string): Promise<SamplesResponse> {
  return apiFetch<SamplesResponse>(`/api/data/${sid}/samples`);
}

export async function updateSamples(
  sid: string,
  samples: Record<string, string>
): Promise<SamplesResponse> {
  return apiFetch<SamplesResponse>(`/api/data/${sid}/samples`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ samples }),
  });
}

export async function deleteSamples(sid: string): Promise<SamplesResponse> {
  return apiFetch<SamplesResponse>(`/api/data/${sid}/samples`, {
    method: 'DELETE',
  });
}

export async function getSessions(): Promise<SessionListItem[]> {
  return apiFetch<SessionListItem[]>('/api/sessions');
}

// ============================================================================
// Compare
// ============================================================================

export async function getCompareScatter(
  sid1: string,
  sid2: string,
  cycle1?: number,
  cycle2?: number,
  useRox?: boolean
): Promise<CompareScatterResponse> {
  const query = buildQuery({
    sid1,
    sid2,
    cycle1,
    cycle2,
    use_rox: useRox
  });
  return apiFetch<CompareScatterResponse>(`/api/compare/scatter${query}`);
}

export async function getCompareStats(
  sid1: string,
  sid2: string,
  cycle1?: number,
  cycle2?: number,
  useRox?: boolean
): Promise<CompareStatsResponse> {
  const query = buildQuery({
    sid1,
    sid2,
    cycle1,
    cycle2,
    use_rox: useRox
  });
  return apiFetch<CompareStatsResponse>(`/api/compare/stats${query}`);
}

// ============================================================================
// Statistics
// ============================================================================

export async function getStatistics(sid: string): Promise<StatisticsResponse> {
  return apiFetch<StatisticsResponse>(`/api/data/${sid}/statistics`);
}

// ============================================================================
// Presets
// ============================================================================

export async function getPresets(): Promise<PresetsListResponse> {
  return apiFetch<PresetsListResponse>('/api/presets');
}

export async function createPreset(
  name: string,
  settings: Record<string, any>
): Promise<PresetResponse> {
  return apiFetch<PresetResponse>('/api/presets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, settings }),
  });
}

export async function updatePreset(
  id: string,
  data: { name?: string; settings?: Record<string, any> }
): Promise<PresetResponse> {
  return apiFetch<PresetResponse>(`/api/presets/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export async function deletePreset(id: string): Promise<{ status: string }> {
  return apiFetch<{ status: string }>(`/api/presets/${id}`, {
    method: 'DELETE',
  });
}

// ============================================================================
// Quality
// ============================================================================

export async function getQuality(
  sid: string,
  useRox?: boolean
): Promise<QualityResponse> {
  const query = buildQuery({ use_rox: useRox });
  return apiFetch<QualityResponse>(`/api/data/${sid}/quality${query}`);
}

// ============================================================================
// Batch/Projects
// ============================================================================

export async function getProjects(): Promise<ProjectListResponse> {
  return apiFetch<ProjectListResponse>('/api/projects');
}

export async function createProject(
  name: string,
  sessionIds?: string[]
): Promise<ProjectResponse> {
  return apiFetch<ProjectResponse>('/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, session_ids: sessionIds }),
  });
}

export async function getProject(id: string): Promise<ProjectResponse> {
  return apiFetch<ProjectResponse>(`/api/projects/${id}`);
}

export async function updateProject(
  id: string,
  data: { name?: string; session_ids?: string[] }
): Promise<ProjectResponse> {
  return apiFetch<ProjectResponse>(`/api/projects/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export async function deleteProject(id: string): Promise<{ status: string }> {
  return apiFetch<{ status: string }>(`/api/projects/${id}`, {
    method: 'DELETE',
  });
}

export async function addProjectSession(
  projectId: string,
  sid: string
): Promise<{ status: string; session_ids: string[] }> {
  return apiFetch<{ status: string; session_ids: string[] }>(
    `/api/projects/${projectId}/sessions/${sid}`,
    {
      method: 'POST',
    }
  );
}

export async function removeProjectSession(
  projectId: string,
  sid: string
): Promise<{ status: string; session_ids: string[] }> {
  return apiFetch<{ status: string; session_ids: string[] }>(
    `/api/projects/${projectId}/sessions/${sid}`,
    {
      method: 'DELETE',
    }
  );
}

export async function getProjectSummary(id: string): Promise<ProjectSummaryResponse> {
  return apiFetch<ProjectSummaryResponse>(`/api/projects/${id}/summary`);
}
