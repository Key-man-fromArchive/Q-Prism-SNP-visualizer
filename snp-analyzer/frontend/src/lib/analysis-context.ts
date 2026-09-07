import type { AnalysisContext, BackgroundMode, ClusterResponse, ClusteringAlgorithm, ClusteringRequest, MarkerRegion, ResolvedThresholdConfig, ThresholdConfig } from '@/types/api';

type ObjectValue = Record<string, unknown>;
export type AnalysisComparison = { status: 'match' | 'mismatch' | 'unknown'; reasons: string[] };
export type ResultInspection = {
  availability: 'missing' | 'completed';
  provenance: 'missing' | 'legacy_unknown' | 'incomplete' | 'verified';
  input: 'unknown' | 'current' | 'stale';
};
export type AnalysisViewParameters = {
  algorithm: ClusteringAlgorithm; ploidy: number; n_clusters: number; threshold_config: ResolvedThresholdConfig;
};
export type AnalysisRegionView = AnalysisViewParameters & { id: string; wells: string[] };
export type AnalysisView = AnalysisViewParameters & {
  cycle: number; use_rox: boolean; background: BackgroundMode; regions: AnalysisRegionView[];
};
export type AnalysisSessionDefaults = { ploidy: number; cycles: number[]; markers: MarkerRegion[] };
const defaultThresholds: ResolvedThresholdConfig = {
  ntc_threshold: 0.1, ntc_fam_max: null, ntc_allele2_max: null, allele1_ratio_max: 0.4,
  allele2_ratio_min: 0.6, boundaries: null, offset: 0, dosage_max: null,
};

function resolveThresholds(config: ThresholdConfig | null | undefined): ResolvedThresholdConfig {
  const provided = Object.fromEntries(Object.entries(config ?? {}).filter(([, value]) => value !== undefined));
  const resolved = { ...defaultThresholds, ...provided };
  if (!thresholds(resolved)) throw new Error('Invalid current threshold configuration');
  return structuredClone(resolved);
}
function resolveRegion(marker: MarkerRegion, request: ClusteringRequest): AnalysisRegionView {
  return { id: marker.id, wells: [...marker.wells], ploidy: marker.ploidy,
    algorithm: request.algorithm, n_clusters: request.n_clusters,
    threshold_config: resolveThresholds(marker.threshold_config ?? request.threshold_config) };
}
/** Resolve CURRENT request defaults only; this never reconstructs missing stored provenance.
 * Empty request.regions falls back to stored markers, matching _capture_analysis.
 * Region algorithm is the requested setting for comparison, not the effective AUTO/threshold.
 */
function resolveViewCycle(requested: number, cycles: number[], mode: 'legacy_latest' | 'absolute'): number {
  const cycle = mode === 'absolute' || requested > 0 ? requested : Math.max(...cycles);
  if (!cycles.includes(cycle)) throw new Error('Current cycle is unavailable');
  return cycle;
}
export function resolveAnalysisView(request: ClusteringRequest, session: AnalysisSessionDefaults,
  cycleMode: 'legacy_latest' | 'absolute' = 'legacy_latest'): AnalysisView {
  const markers = request.regions?.length ? request.regions : session.markers;
  const cycle = resolveViewCycle(request.cycle, session.cycles, cycleMode);
  return { cycle, use_rox: request.use_rox ?? true, background: request.background ?? 'none',
    algorithm: request.algorithm, n_clusters: request.n_clusters,
    ploidy: markers.length ? session.ploidy : (request.ploidy ?? session.ploidy),
    threshold_config: resolveThresholds(request.threshold_config),
    regions: markers.map(marker => resolveRegion(marker, request)) };
}

export function isObject(value: unknown): value is ObjectValue {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }
export function isRevision(value: unknown): value is number { return finite(value) && Number.isInteger(value) && value >= 0; }
function strings(value: unknown): value is string[] { return Array.isArray(value) && value.every(item => typeof item === 'string'); }
function stringMap(value: unknown): boolean { return isObject(value) && Object.values(value).every(item => typeof item === 'string'); }
function nullableNumber(value: unknown): boolean { return value === null || finite(value); }
function nullableNumbers(value: unknown): boolean { return value === null || (Array.isArray(value) && value.every(finite)); }
function enumValue(value: unknown, values: readonly string[]): boolean { return typeof value === 'string' && values.includes(value); }
function algorithm(value: unknown): boolean { return enumValue(value, ['threshold', 'auto', 'kmeans']); }

function thresholds(value: unknown): value is ResolvedThresholdConfig {
  if (!isObject(value)) return false;
  const required = ['ntc_threshold', 'allele1_ratio_max', 'allele2_ratio_min', 'offset'];
  const nullable = ['ntc_fam_max', 'ntc_allele2_max', 'dosage_max'];
  return required.every(key => finite(value[key])) && nullable.every(key => nullableNumber(value[key]))
    && nullableNumbers(value.boundaries);
}
function actualWindow(value: unknown): boolean {
  if (!isObject(value)) return false;
  return nullableNumbers(value.boundaries) && finite(value.offset) && nullableNumber(value.dosage_max)
    && typeof value.offset_uncertain === 'boolean' && typeof value.low_separation === 'boolean';
}
function parameters(value: unknown): value is ObjectValue {
  if (!isObject(value)) return false;
  return algorithm(value.requested_algorithm) && finite(value.ploidy) && finite(value.n_clusters)
    && typeof value.n_clusters_applied === 'boolean' && thresholds(value.threshold_config)
    && actualWindow(value.actual_window);
}
function origin(value: unknown): boolean {
  if (!isObject(value)) return false;
  return finite(value.fam) && finite(value.allele2) && enumValue(value.source, ['ntc', 'plate_floor', 'plate_min', 'zero']);
}
function provenance(value: ObjectValue): boolean {
  return stringMap(value.effective_well_types) && stringMap(value.manual_well_types)
    && strings(value.excluded_wells) && origin(value.ratio_origin);
}
function region(value: unknown): boolean {
  if (!isObject(value)) return false;
  return typeof value.marker_id === 'string' && typeof value.name === 'string' && strings(value.wells)
    && finite(value.ploidy) && algorithm(value.algorithm) && parameters(value.parameters);
}
function contextIdentity(value: ObjectValue): boolean {
  return value.schema_version === 1 && typeof value.result_revision === 'string'
    && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value.result_revision)
    && typeof value.analysed_at === 'string' && /(?:Z|\+00:00)$/.test(value.analysed_at)
    && Number.isFinite(Date.parse(value.analysed_at)) && isRevision(value.input_revision);
}
function contextConditions(value: ObjectValue): boolean {
  return isRevision(value.cycle) && typeof value.use_rox === 'boolean'
    && typeof value.normalization_applied === 'boolean'
    && enumValue(value.background, ['none', 'pre_read', 'channel_min'])
    && (algorithm(value.algorithm) || value.algorithm === 'mixed');
}
function viewConditions(value: ObjectValue): boolean {
  return isRevision(value.cycle) && typeof value.use_rox === 'boolean'
    && enumValue(value.background, ['none', 'pre_read', 'channel_min']);
}

function clusterStatus(value: ObjectValue): boolean {
  if (value.input_revision !== undefined && !isRevision(value.input_revision)) return false;
  if (value.analysis_pending !== undefined && typeof value.analysis_pending !== 'boolean') return false;
  return value.analysis_status === undefined || enumValue(value.analysis_status, ['idle', 'computing', 'completed', 'failed']);
}
function clusterShape(value: unknown): value is ClusterResponse {
  if (!isObject(value)) return false;
  return (value.algorithm === null || typeof value.algorithm === 'string')
    && isRevision(value.cycle) && stringMap(value.assignments) && clusterStatus(value);
}
/** Validate the result envelope; incomplete historical provenance remains inspectable. */
export function parseClusterResponse(value: unknown): ClusterResponse {
  if (!clusterShape(value)) throw new Error('Invalid clustering response');
  return value;
}
/** Presence alone (server context_status) is not proof of complete provenance. */
export function isCompleteAnalysisContext(value: unknown): value is AnalysisContext {
  if (!isObject(value) || !contextIdentity(value) || !contextConditions(value)) return false;
  if (!parameters(value.parameters) || !provenance(value.parameters)) return false;
  return Array.isArray(value.regions) && value.regions.every(region)
    && value.parameters.scope === (value.regions.length ? 'regions' : 'whole_plate');
}

export function inspectResult(result: ClusterResponse | null, currentRevision: number | null): ResultInspection {
  if (!result || result.algorithm === null) return { availability: 'missing', provenance: 'missing', input: 'unknown' };
  if (result.analysis_context == null) return { availability: 'completed', provenance: 'legacy_unknown', input: 'unknown' };
  if (!isCompleteAnalysisContext(result.analysis_context) || !consistentResult(result, result.analysis_context)) return { availability: 'completed', provenance: 'incomplete', input: 'unknown' };
  const input = isRevision(currentRevision) ? (currentRevision === result.analysis_context.input_revision ? 'current' : 'stale') : 'unknown';
  return { availability: 'completed', provenance: 'verified', input };
}

function consistentResult(result: ClusterResponse, context: AnalysisContext): boolean {
  if (result.cycle !== context.cycle) return false;
  const regions = result.regions ?? [];
  if (!Array.isArray(regions) || regions.length !== context.regions.length) return false;
  return context.regions.every((region, index) => {
    const actual = regions[index];
    return isObject(actual) && same([actual.id, actual.name, actual.wells, actual.ploidy],
      [region.marker_id, region.name, region.wells, region.ploidy]);
  });
}

function same(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) && Array.isArray(right)) return left.length === right.length && left.every((value, index) => same(value, right[index]));
  if (isObject(left) && isObject(right)) return Object.keys(left).length === Object.keys(right).length && Object.keys(left).every(key => same(left[key], right[key]));
  return left === right;
}
function compareParameters(captured: ObjectValue, view: ObjectValue): string[] {
  const reasons: string[] = [];
  if (view.algorithm !== captured.requested_algorithm) reasons.push('algorithm');
  if (view.ploidy !== captured.ploidy) reasons.push('ploidy');
  if (captured.n_clusters_applied && view.n_clusters !== captured.n_clusters) reasons.push('n_clusters');
  if (!same(view.threshold_config, captured.threshold_config)) reasons.push('threshold_config');
  return reasons;
}
function viewParameters(value: ObjectValue): boolean {
  return algorithm(value.algorithm) && finite(value.ploidy) && finite(value.n_clusters) && thresholds(value.threshold_config);
}
function validView(value: ObjectValue): boolean { return viewParameters(value) && viewConditions(value); }
function compareRegion(captured: AnalysisContext['regions'][number], value: unknown): boolean {
  if (!isObject(value) || !viewParameters(value)) return false;
  return value.id === captured.marker_id && same(value.wells, captured.wells)
    && compareParameters(captured.parameters, value).length === 0;
}
/** View uses absolute cycle and fully resolved per-marker configs; no hidden defaults. */
export function compareAnalysisView(context: unknown, view: unknown): AnalysisComparison {
  if (!isCompleteAnalysisContext(context) || !isObject(view)) return { status: 'unknown', reasons: ['context'] };
  if (!validView(view)) return { status: 'unknown', reasons: ['view'] };
  const reasons = compareParameters(context.parameters, view);
  for (const key of ['cycle', 'use_rox', 'background'] as const) {
    if (context[key] !== view[key]) reasons.push(key);
  }
  if (!Array.isArray(view.regions)) return { status: 'unknown', reasons: ['regions'] };
  const regions = view.regions;
  if (regions.length !== context.regions.length || !context.regions.every((item, index) => compareRegion(item, regions[index]))) reasons.push('regions');
  return { status: reasons.length ? 'mismatch' : 'match', reasons };
}
