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
  WellGroupsResponse,
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
  ASGSaveResultResponse,
  ImportParseRequest,
  ImportParseResponse,
  ImportPreviewResponse,
} from '@/types/api';
import type {
  ASGLaunchResponse,
  AuthConfigResponse,
  LoginRequest,
  LoginResponse,
  UserListItem,
  AdminDashboardResponse
} from '@/types/auth';
import { useAuthStore } from '@/stores/auth-store';
import { runtimeApiBasePath } from '@/lib/runtime-paths';

/**
 * Build query string from params object, skipping undefined values
 */
function buildQuery(params: Record<string, string | number | boolean | undefined>): string {
  const entries = Object.entries(params)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);

  return entries.length > 0 ? `?${entries.join('&')}` : '';
}

const apiBasePath = runtimeApiBasePath();

function apiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const suffix = normalized === "/api" ? "" : normalized.replace(/^\/api(?=\/)/, "");
  return `${apiBasePath}${suffix}`;
}

/**
 * Generic fetch wrapper with error handling and auth cookie support
 */
async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiUrl(url), {
    ...init,
    credentials: 'same-origin',
  });

  if (!res.ok) {
    // Auto-clear auth on 401
    if (res.status === 401) {
      useAuthStore.getState().clearAuth();
    }

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

export class ApiError extends Error {
  status: number;
  payload: unknown;

  constructor(message: string, status: number, payload: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
  }
}

async function importFetch<T>(url: string, init: RequestInit, structuredStatuses: Set<number>): Promise<T> {
  const res = await fetch(apiUrl(url), {
    ...init,
    credentials: 'same-origin',
  });

  const payload: unknown = await res.json().catch(() => null);

  if (res.ok || structuredStatuses.has(res.status)) {
    return payload as T;
  }

  if (res.status === 401) {
    useAuthStore.getState().clearAuth();
  }

  let message = `HTTP ${res.status}: ${res.statusText}`;
  if (payload && typeof payload === 'object' && 'detail' in payload) {
    const detail = (payload as { detail: unknown }).detail;
    message = typeof detail === 'string' ? detail : JSON.stringify(detail);
  }

  throw new ApiError(message, res.status, payload);
}

export async function previewImportFile(file: File): Promise<ImportPreviewResponse> {
  const formData = new FormData();
  formData.append('file', file);

  return importFetch<ImportPreviewResponse>('/api/import/preview', {
    method: 'POST',
    body: formData,
  }, new Set([422]));
}

export async function parseImportPreview(request: ImportParseRequest): Promise<ImportParseResponse> {
  return importFetch<ImportParseResponse>('/api/import/parse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  }, new Set([409, 422]));
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
  const res = await fetch(apiUrl(`/api/data/${sid}/export/pdf${query}`), { credentials: 'same-origin' });

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
// Well Groups
// ============================================================================

export async function getWellGroups(sid: string): Promise<WellGroupsResponse> {
  return apiFetch<WellGroupsResponse>(`/api/data/${sid}/groups`);
}

export async function createWellGroup(
  sid: string,
  name: string,
  wells: string[]
): Promise<{ status: string; name: string; wells: string[] }> {
  return apiFetch(`/api/data/${sid}/groups`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, wells }),
  });
}

export async function deleteWellGroup(
  sid: string,
  name: string
): Promise<{ status: string }> {
  return apiFetch<{ status: string }>(`/api/data/${sid}/groups/${encodeURIComponent(name)}`, {
    method: 'DELETE',
  });
}

export async function deleteAllWellGroups(sid: string): Promise<{ status: string }> {
  return apiFetch<{ status: string }>(`/api/data/${sid}/groups`, {
    method: 'DELETE',
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
  const res = await fetch(apiUrl(`/api/data/${sid}/export/csv${query}`), { credentials: 'same-origin' });

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

export async function getSessionInfo(sid: string): Promise<UploadResponse> {
  return apiFetch<UploadResponse>(`/api/sessions/${sid}`);
}

export async function deleteSession(sid: string): Promise<{ status: string }> {
  return apiFetch<{ status: string }>(`/api/sessions/${sid}`, {
    method: 'DELETE',
  });
}

export async function bulkDeleteSessions(sessionIds: string[]): Promise<{ status: string; deleted: number }> {
  return apiFetch<{ status: string; deleted: number }>('/api/sessions/bulk-delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_ids: sessionIds }),
  });
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

export async function bulkAddProjectSessions(
  projectId: string,
  sessionIds: string[]
): Promise<{ status: string; added: number; session_ids: string[] }> {
  return apiFetch<{ status: string; added: number; session_ids: string[] }>(
    `/api/projects/${projectId}/sessions/bulk-add`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_ids: sessionIds }),
    }
  );
}

export async function bulkRemoveProjectSessions(
  projectId: string,
  sessionIds: string[]
): Promise<{ status: string; removed: number; session_ids: string[] }> {
  return apiFetch<{ status: string; removed: number; session_ids: string[] }>(
    `/api/projects/${projectId}/sessions/bulk-remove`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_ids: sessionIds }),
    }
  );
}

export async function getProjectSummary(id: string): Promise<ProjectSummaryResponse> {
  return apiFetch<ProjectSummaryResponse>(`/api/projects/${id}/summary`);
}

// ============================================================================
// Auth
// ============================================================================

export async function login(req: LoginRequest): Promise<LoginResponse> {
  return apiFetch<LoginResponse>('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
}

export async function getAuthConfig(): Promise<AuthConfigResponse> {
  return apiFetch<AuthConfigResponse>('/api/auth/config');
}

export async function asgLaunch(token: string): Promise<ASGLaunchResponse> {
  return apiFetch<ASGLaunchResponse>('/api/auth/asg-launch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
}

export async function asgLaunchCookie(): Promise<ASGLaunchResponse> {
  return apiFetch<ASGLaunchResponse>('/api/auth/asg-launch-cookie', {
    method: 'POST',
  });
}

export async function logout(): Promise<void> {
  await apiFetch<{ status: string }>('/api/auth/logout', { method: 'POST' });
}

export async function getMe(): Promise<LoginResponse> {
  return apiFetch<LoginResponse>('/api/auth/me');
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await apiFetch<{ status: string }>('/api/auth/change-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
  });
}

// ============================================================================
// User Management (admin)
// ============================================================================

export async function getUsers(): Promise<{ users: UserListItem[] }> {
  return apiFetch<{ users: UserListItem[] }>('/api/users');
}

export async function createUser(data: {
  username: string;
  password: string;
  display_name?: string;
  role?: string;
}): Promise<UserListItem> {
  return apiFetch<UserListItem>('/api/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export async function updateUser(
  id: string,
  data: { display_name?: string; role?: string; is_active?: boolean; password?: string }
): Promise<UserListItem> {
  return apiFetch<UserListItem>(`/api/users/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export async function deleteUser(id: string): Promise<{ status: string }> {
  return apiFetch<{ status: string }>(`/api/users/${id}`, { method: 'DELETE' });
}

export async function getAdminDashboard(): Promise<AdminDashboardResponse> {
  return apiFetch<AdminDashboardResponse>('/api/users/dashboard');
}

export async function saveAsgResult(
  sid: string,
  selectedCycle?: number,
  useRox?: boolean
): Promise<ASGSaveResultResponse> {
  return apiFetch<ASGSaveResultResponse>('/api/asg/save-result', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session_id: sid,
      selected_cycle: selectedCycle,
      use_rox: useRox,
    }),
  });
}
