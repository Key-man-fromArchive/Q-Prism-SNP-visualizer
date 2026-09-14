import type {
  BackgroundMode,
  UploadResponse,
  ScatterResponse,
  PlateResponse,
  AmplificationResponse,
  CtResponse,
  ProtocolResponse,
  ProtocolStep,
  ClusteringRequest,
  ClusteringResult,
  ClusterResponse,
  InputRevision,
  SessionInfoResponse,
  ManualWellTypeUpdate,
  WellTypesResponse,
  WellGroupsResponse,
  QcResponse,
  MarkerRegion,
  MarkersResponse,
  LayoutListResponse,
  SavedLayout,
  LayoutApplyRequest,
  LayoutApplyResult,
  SamplesResponse,
  SessionListItem,
  RawFileStatus,
  CompareScatterResponse,
  CompareStatsResponse,
  StatisticsResponse,
  PresetsListResponse,
  PresetResponse,
  PresetSettings,
  QualityResponse,
  ProjectListResponse,
  ProjectResponse,
  ProjectSummaryResponse,
  ASGSaveResultResponse,
  ImportParseRequest,
  ImportParseResponse,
  ImportPreviewResponse,
  MarkerCatalogEntry,
  MarkerCatalogListResponse,
  MarkerCatalogCreateRequest,
  MarkerCatalogUpdateRequest,
  FeedbackAttachment,
  FeedbackCategory,
  FeedbackComment,
  FeedbackItem,
  FeedbackListResponse,
  FeedbackStats,
  FeedbackStatus,
  FeedbackSubmitRequest,
  FeedbackUpdateRequest,
  VersionResponse,
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
import { parseClusterResponse } from '@/lib/analysis-context';

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
    throw responseError(res, await readErrorPayload(res));
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
  detail: unknown;
  code: string | null;

  constructor(message: string, status: number, payload: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
    this.detail = objectDetail(payload);
    this.code = detailCode(this.detail);
  }
}

function objectDetail(payload: unknown): unknown {
  return payload !== null && typeof payload === 'object' && 'detail' in payload
    ? payload.detail : null;
}

function detailCode(detail: unknown): string | null {
  if (detail !== null && typeof detail === 'object' && 'code' in detail && typeof detail.code === 'string') {
    return detail.code;
  }
  return null;
}

function errorMessage(detail: unknown, fallback: string): string {
  if (typeof detail === 'string') return detail;
  if (detail !== null && typeof detail === 'object' && 'message' in detail && typeof detail.message === 'string') {
    return detail.message;
  }
  return detail == null ? fallback : JSON.stringify(detail);
}

async function readErrorPayload(res: Response): Promise<unknown> {
  const text = await res.text().catch(() => '');
  try { return JSON.parse(text); } catch { return text; }
}

/* P18-AUTH-401: 401 here always means "this session is no longer valid" --
 * never "valid session, wrong permissions". The backend reserves 401 for
 * get_current_user failures (missing/invalid/expired token, disabled
 * account); everything that's an authenticated-but-not-permitted case
 * (non-admin, non-owner) is 403 (see app/auth.py: require_admin,
 * check_session_access, check_project_access). So clearing auth on every
 * 401 regardless of which endpoint sent it is correct under that contract,
 * not a missing scope check -- see docs/planning/feedback-2026-09-11/
 * evidence/P18-AUTH-401.md for the investigation that confirmed this. */
function responseError(res: Response, payload: unknown): ApiError {
  if (res.status === 401) useAuthStore.getState().clearAuth();
  return new ApiError(errorMessage(objectDetail(payload), `HTTP ${res.status}: ${res.statusText}`), res.status, payload);
}

async function blobFetch(url: string): Promise<Blob> {
  const res = await fetch(apiUrl(url), { credentials: 'same-origin' });
  if (!res.ok) throw responseError(res, await readErrorPayload(res));
  return res.blob();
}

async function importFetch<T>(url: string, init: RequestInit, structuredStatuses: Set<number>): Promise<T> {
  const res = await fetch(apiUrl(url), {
    ...init,
    credentials: 'same-origin',
  });

  const payload: unknown = await readErrorPayload(res);

  if ((res.ok || structuredStatuses.has(res.status)) && payload !== null && typeof payload === 'object' && !Array.isArray(payload)) {
    return payload as T;
  }

  throw responseError(res, payload);
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
  useRox?: boolean,
  background?: BackgroundMode
): Promise<ScatterResponse> {
  const query = buildQuery({ cycle, cycle_mode: cycle === undefined ? undefined : 'absolute', use_rox: useRox, background });
  return apiFetch<ScatterResponse>(`/api/data/${sid}/scatter${query}`);
}

export async function getPlate(
  sid: string,
  cycle?: number,
  useRox?: boolean,
  background?: BackgroundMode
): Promise<PlateResponse> {
  const query = buildQuery({ cycle, cycle_mode: cycle === undefined ? undefined : 'absolute', use_rox: useRox, background });
  return apiFetch<PlateResponse>(`/api/data/${sid}/plate${query}`);
}

export async function getAmplification(
  sid: string,
  wells: string[],
  useRox?: boolean,
  background?: BackgroundMode
): Promise<AmplificationResponse> {
  const query = buildQuery({ wells: wells.join(','), use_rox: useRox, background });
  return apiFetch<AmplificationResponse>(`/api/data/${sid}/amplification${query}`);
}

export async function getAllAmplification(
  sid: string,
  useRox?: boolean,
  background?: BackgroundMode
): Promise<AmplificationResponse> {
  const query = buildQuery({ use_rox: useRox, background });
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
  useRox?: boolean,
  background?: BackgroundMode,
  cycle?: number,
  resultRevision?: string
): Promise<Blob> {
  const query = buildQuery({ cycle, cycle_mode: cycle === undefined ? undefined : 'absolute', use_rox: useRox, background, result_revision: resultRevision });
  return blobFetch(`/api/data/${sid}/export/pdf${query}`);
}

export async function exportXlsx(
  sid: string,
  useRox?: boolean,
  background?: BackgroundMode,
  cycle?: number,
  resultRevision?: string
): Promise<Blob> {
  const query = buildQuery({ cycle, cycle_mode: cycle === undefined ? undefined : 'absolute', use_rox: useRox, background, result_revision: resultRevision });
  return blobFetch(`/api/data/${sid}/export/xlsx${query}`);
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
  const response = parseClusterResponse(await apiFetch<unknown>(`/api/data/${sid}/cluster`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...req, cycle_mode: 'absolute' }),
  }));
  if (response.algorithm === null) throw new Error('Invalid clustering response');
  return response;
}

export async function getCluster(sid: string): Promise<ClusterResponse> {
  return parseClusterResponse(await apiFetch<unknown>(`/api/data/${sid}/cluster`));
}

export async function getPloidy(sid: string): Promise<{ ploidy: number }> {
  return apiFetch<{ ploidy: number }>(`/api/data/${sid}/ploidy`);
}

export async function setPloidy(sid: string, ploidy: number, expectedRevision?: number): Promise<{ ploidy: number } & InputRevision> {
  return apiFetch(`/api/data/${sid}/ploidy`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ploidy, expected_input_revision: expectedRevision }),
  });
}

export async function listExamples(): Promise<{ examples: { ploidy: number; label: string }[] }> {
  return apiFetch<{ examples: { ploidy: number; label: string }[] }>('/api/examples');
}

export async function loadExample(ploidy: number): Promise<UploadResponse> {
  return apiFetch<UploadResponse>('/api/examples', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ploidy }),
  });
}

export type CycleSuggestion = {
  ntc_onset_status: 'detected' | 'not_detected' | 'not_evaluated';
  ntc_onset_reason: 'none' | 'no_ntc' | 'missing_signal' | 'insufficient_points';
  suggested_cycle: number | null;
  suggested_low: number | null;
  suggested_high: number | null;
  suggested_window: string | null;
  ntc_onset_cycle: number | null;
  ntc_wells: string[];
  amp_start: number | null;
  amp_end: number | null;
};

export async function suggestCycle(sid: string): Promise<CycleSuggestion> {
  return apiFetch<CycleSuggestion>(`/api/data/${sid}/suggest-cycle`);
}

export async function setWellTypes(
  sid: string,
  req: ManualWellTypeUpdate
): Promise<WellTypesResponse & InputRevision> {
  return apiFetch<WellTypesResponse & InputRevision>(`/api/data/${sid}/welltypes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
}

export async function getWellTypes(sid: string): Promise<WellTypesResponse> {
  return apiFetch<WellTypesResponse>(`/api/data/${sid}/welltypes`);
}

export async function deleteWellTypes(sid: string, expectedRevision?: number): Promise<{ status: string } & InputRevision> {
  return apiFetch(`/api/data/${sid}/welltypes${buildQuery({ expected_input_revision: expectedRevision })}`, {
    method: 'DELETE',
  });
}

export async function bulkSetWellTypes(
  sid: string,
  assignments: Record<string, string>,
  expectedRevision?: number
): Promise<WellTypesResponse & InputRevision> {
  return apiFetch<WellTypesResponse & InputRevision>(`/api/data/${sid}/welltypes/bulk`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ assignments, expected_input_revision: expectedRevision }),
  });
}

// ============================================================================
// Markers (multi-marker-per-plate, P4)
// ============================================================================

export async function getMarkers(sid: string): Promise<MarkersResponse> {
  return apiFetch<MarkersResponse>(`/api/data/${sid}/markers`);
}

/** Replaces the session's whole marker (assay) set. */
export async function saveMarkers(
  sid: string,
  markers: MarkerRegion[],
  expectedRevision?: number
): Promise<MarkersResponse & InputRevision> {
  return apiFetch<MarkersResponse & InputRevision>(`/api/data/${sid}/markers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ markers, expected_input_revision: expectedRevision }),
  });
}

/** Partial update of one marker's fields (name/wells/ploidy/color/threshold_config). */
export async function updateMarker(
  sid: string,
  markerId: string,
  patch: Partial<Pick<MarkerRegion, 'name' | 'wells' | 'ploidy' | 'color' | 'threshold_config'>>,
  expectedRevision?: number
): Promise<MarkersResponse & InputRevision> {
  return apiFetch<MarkersResponse & InputRevision>(`/api/data/${sid}/markers/${encodeURIComponent(markerId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...patch, expected_input_revision: expectedRevision }),
  });
}

export async function deleteMarkers(sid: string, expectedRevision?: number): Promise<{ status: string } & InputRevision> {
  return apiFetch(`/api/data/${sid}/markers${buildQuery({ expected_input_revision: expectedRevision })}`, {
    method: 'DELETE',
  });
}

// ============================================================================
// Marker (assay) CATALOG -- durable, per-user assay registry
// ============================================================================

/** Lists the current user's catalog assays (newest first). */
export async function listMarkerCatalog(): Promise<MarkerCatalogListResponse> {
  return apiFetch<MarkerCatalogListResponse>('/api/marker-catalog');
}

export async function getMarkerCatalogEntry(id: string): Promise<MarkerCatalogEntry> {
  return apiFetch<MarkerCatalogEntry>(`/api/marker-catalog/${encodeURIComponent(id)}`);
}

export async function createMarkerCatalogEntry(
  body: MarkerCatalogCreateRequest
): Promise<MarkerCatalogEntry> {
  return apiFetch<MarkerCatalogEntry>('/api/marker-catalog', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function updateMarkerCatalogEntry(
  id: string,
  patch: MarkerCatalogUpdateRequest
): Promise<MarkerCatalogEntry> {
  return apiFetch<MarkerCatalogEntry>(`/api/marker-catalog/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
}

export async function deleteMarkerCatalogEntry(id: string): Promise<{ status: string }> {
  return apiFetch<{ status: string }>(`/api/marker-catalog/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

/** Duplicates ANY existing catalog entry (by id) into the caller's OWN catalog. */
export async function copyMarkerCatalogEntry(id: string): Promise<MarkerCatalogEntry> {
  return apiFetch<MarkerCatalogEntry>(`/api/marker-catalog/${encodeURIComponent(id)}/copy`, {
    method: 'POST',
  });
}

/** Links session marker `markerId` to catalog assay `catalogId`; prefills the
 * session marker's ploidy/color from the catalog entry when still default. */
export async function attachMarkerCatalog(
  sid: string,
  markerId: string,
  catalogId: string,
  expectedRevision?: number
): Promise<MarkerRegion & InputRevision> {
  return apiFetch<MarkerRegion & InputRevision>(
    `/api/data/${sid}/markers/${encodeURIComponent(markerId)}/attach-catalog`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ catalog_id: catalogId, expected_input_revision: expectedRevision }),
    }
  );
}

// ============================================================================
// Layout library (per-user saved plate layouts, P4-S3)
// ============================================================================

/** Lists the current user's saved layouts (newest first). */
export async function listLayouts(): Promise<LayoutListResponse> {
  return apiFetch<LayoutListResponse>('/api/layouts');
}

/** Snapshots session `sid`'s CURRENT marker set into a new named layout. */
export async function saveLayout(name: string, sid: string): Promise<SavedLayout> {
  return apiFetch<SavedLayout>('/api/layouts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, sid }),
  });
}

export async function getLayout(id: string): Promise<SavedLayout> {
  return apiFetch<SavedLayout>(`/api/layouts/${encodeURIComponent(id)}`);
}

export async function deleteLayout(id: string): Promise<{ status: string }> {
  return apiFetch<{ status: string }>(`/api/layouts/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

/** Duplicates ANY existing layout (by id) into the caller's OWN library. */
export async function copyLayout(id: string): Promise<SavedLayout> {
  return apiFetch<SavedLayout>(`/api/layouts/${encodeURIComponent(id)}/copy`, {
    method: 'POST',
  });
}

/**
 * Applies a saved layout to session `req.sid`, replacing its marker set.
 *
 * L2/L3 (docs/multi-marker-ux-decision.md §3): never blind-apply. A 409
 * response means applying would silently change an existing marker's
 * ploidy -- callers must surface `err.payload.detail` (a
 * `LayoutApplyConflict`) and only retry with `force: true` after explicit
 * user confirmation. A 400 means the layout references wells not on the
 * target plate -- `err.payload.detail` is a human-readable message listing
 * them. Both are thrown as `ApiError` (status + raw payload preserved,
 * mirroring `previewImportFile`/`parseImportPreview`'s structured-error
 * pattern) rather than returned, so a caller that doesn't explicitly handle
 * them can't accidentally treat a conflict as success.
 */
export async function applyLayout(
  id: string,
  req: LayoutApplyRequest
): Promise<LayoutApplyResult> {
  return importFetch<LayoutApplyResult>(
    `/api/layouts/${encodeURIComponent(id)}/apply`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    },
    new Set() // no status is "structured success" -- 400/409 always throw ApiError
  );
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
  useRox?: boolean,
  background?: BackgroundMode,
  resultRevision?: string
): Promise<Blob> {
  const query = buildQuery({ cycle, cycle_mode: cycle === undefined ? undefined : 'absolute', use_rox: useRox, background, result_revision: resultRevision });
  return blobFetch(`/api/data/${sid}/export/csv${query}`);
}

// ============================================================================
// QC
// ============================================================================

export async function getQc(
  sid: string,
  cycle?: number,
  useRox?: boolean,
  background?: BackgroundMode
): Promise<QcResponse> {
  const query = buildQuery({ cycle, cycle_mode: cycle === undefined ? undefined : 'absolute', use_rox: useRox, background });
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

export async function getSessionInfo(sid: string): Promise<SessionInfoResponse> {
  return apiFetch<SessionInfoResponse>(`/api/sessions/${sid}`);
}

export async function deleteSession(sid: string): Promise<{ status: string }> {
  return apiFetch<{ status: string }>(`/api/sessions/${sid}`, {
    method: 'DELETE',
  });
}

export async function getRawFileStatus(sid: string): Promise<RawFileStatus> {
  return apiFetch<RawFileStatus>(`/api/sessions/${sid}/raw-file`);
}

/** Throws ApiError(404) for 'none'/'missing' and ApiError(410) for 'expired'
 *  -- callers should check getRawFileStatus() first and only offer this when
 *  status is 'available'; this still exists to fail cleanly on the race
 *  where a file expires between the two calls. */
export async function downloadRawFile(sid: string): Promise<Blob> {
  return blobFetch(`/api/sessions/${sid}/raw-file/download`);
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
  settings: PresetSettings
): Promise<PresetResponse> {
  return apiFetch<PresetResponse>('/api/presets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, settings }),
  });
}

export async function updatePreset(
  id: string,
  data: { name?: string; settings?: PresetSettings }
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
  useRox?: boolean,
  background?: BackgroundMode,
  resultRevision?: string
): Promise<ASGSaveResultResponse> {
  return apiFetch<ASGSaveResultResponse>('/api/asg/save-result', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session_id: sid,
      selected_cycle: selectedCycle,
      cycle_mode: selectedCycle === undefined ? undefined : 'absolute',
      use_rox: useRox,
      background,
      result_revision: resultRevision,
    }),
  });
}

// ============================================================================
// In-app user feedback
// ============================================================================

/** Files a feedback item, claiming any screenshots uploaded beforehand. */
export async function submitFeedback(body: FeedbackSubmitRequest): Promise<FeedbackItem> {
  return apiFetch<FeedbackItem>('/api/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** The caller's own submissions, newest first, with the admin's replies. */
export async function listMyFeedback(page = 1, perPage = 20): Promise<FeedbackListResponse> {
  return apiFetch<FeedbackListResponse>(
    `/api/feedback/my${buildQuery({ page, per_page: perPage })}`
  );
}

/** Admin triage view: every user's feedback. 403 for non-admins, and in ASG
 *  launch mode (which has no local administration at all). */
export async function listFeedback(params: {
  status?: FeedbackStatus;
  category?: FeedbackCategory;
  page?: number;
  per_page?: number;
} = {}): Promise<FeedbackListResponse> {
  return apiFetch<FeedbackListResponse>(`/api/feedback${buildQuery(params)}`);
}

export async function getFeedbackStats(): Promise<FeedbackStats> {
  return apiFetch<FeedbackStats>('/api/feedback/stats');
}

/** Partial admin update — omitted fields are left as they are, so setting a
 *  status never clears an existing note. */
export async function updateFeedback(
  id: string,
  patch: FeedbackUpdateRequest
): Promise<FeedbackItem> {
  return apiFetch<FeedbackItem>(`/api/feedback/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
}

/** Replies on a feedback thread. Allowed for the reporter and for an admin. */
export async function addFeedbackComment(id: string, body: string): Promise<FeedbackComment> {
  return apiFetch<FeedbackComment>(`/api/feedback/${encodeURIComponent(id)}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body }),
  });
}

/** Uploads one screenshot ahead of submission and returns its id for
 *  `submitFeedback`'s `attachment_ids`. PNG/JPEG/WebP, 2 MB each. */
export async function uploadFeedbackAttachment(file: File): Promise<FeedbackAttachment> {
  const formData = new FormData();
  formData.append('file', file);
  return apiFetch<FeedbackAttachment>('/api/feedback/attachments', {
    method: 'POST',
    body: formData,
  });
}

/** Resolved URL for an attachment's bytes, for use as an <img> src. Goes
 *  through apiUrl so it honours SNP_ROOT_PATH when mounted under a prefix. */
export function feedbackAttachmentUrl(attachmentId: string): string {
  return apiUrl(`/api/feedback/attachments/${encodeURIComponent(attachmentId)}`);
}

// ============================================================================
// Build identity
// ============================================================================

/** What version this instance is running. Unauthenticated: the footer showing
 *  it is on every screen, the login page included. */
export async function getVersion(): Promise<VersionResponse> {
  return apiFetch<VersionResponse>('/api/version');
}
