import { describe, expect, it } from 'vitest';
import type { AnalysisContext, ResolvedThresholdConfig } from '@/types/api';
import { compareAnalysisView, inspectResult, resolveAnalysisView } from './analysis-context';

export const thresholds: ResolvedThresholdConfig = { ntc_threshold: 0.1, ntc_fam_max: null,
  ntc_allele2_max: null, allele1_ratio_max: 0.4, allele2_ratio_min: 0.6,
  boundaries: null, offset: 0, dosage_max: null };
export function context(): AnalysisContext {
  return { schema_version: 1, result_revision: '11111111-1111-4111-8111-111111111111',
    analysed_at: '2026-09-07T00:00:00Z', cycle: 20, use_rox: false, normalization_applied: false,
    background: 'none', algorithm: 'threshold', input_revision: 0, regions: [],
    parameters: { requested_algorithm: 'kmeans', ploidy: 2, n_clusters: 4, n_clusters_applied: true,
      threshold_config: { ...thresholds }, actual_window: { boundaries: null, offset: 0,
        offset_uncertain: false, dosage_max: null, low_separation: false }, scope: 'whole_plate',
      effective_well_types: {}, manual_well_types: {}, excluded_wells: [],
      ratio_origin: { fam: 0, allele2: 0, source: 'zero' } } };
}
export function view() {
  return { cycle: 20, use_rox: false, background: 'none' as const, algorithm: 'kmeans' as const,
    ploidy: 2, n_clusters: 4, threshold_config: { ...thresholds }, regions: [] };
}

describe('captured analysis contracts', () => {
  it('resolves only current request defaults, stored markers and inherited config as backend does', () => {
    const request = { algorithm: 'kmeans' as const, cycle: 0, n_clusters: 4, use_rox: false, ploidy: 8,
      threshold_config: { ...thresholds, ntc_threshold: 0.5 } };
    const markers = [{ id: 'm', name: 'M', wells: ['A1'], ploidy: 4 }];
    const resolved = resolveAnalysisView(request, { ploidy: 2, cycles: [20, 40], markers });
    expect(resolved).toMatchObject({ cycle: 40, use_rox: false, background: 'none', ploidy: 2,
      regions: [{ id: 'm', ploidy: 4, algorithm: 'kmeans', n_clusters: 4, threshold_config: { ntc_threshold: 0.5, offset: 0 } }] });
    expect(resolveAnalysisView({ algorithm: 'auto', cycle: 0, n_clusters: 4 }, { ploidy: 2, cycles: [0], markers: [] }))
      .toMatchObject({ cycle: 0, use_rox: true, threshold_config: thresholds });
    const override = { ...markers[0], threshold_config: { ...thresholds, boundaries: [0.5], dosage_max: 2 } };
    expect(resolveAnalysisView({ ...request, regions: [override] }, { ploidy: 2, cycles: [40], markers: [] }).regions[0].threshold_config)
      .toEqual(override.threshold_config);
  });
  it('uses requested algorithm, preserves false and zero, and never guesses current revision', () => {
    const stored = { algorithm: 'kmeans', cycle: 20, assignments: {}, analysis_context: context() };
    expect(compareAnalysisView(stored.analysis_context, view())).toEqual({ status: 'match', reasons: [] });
    expect(inspectResult(stored, null)).toMatchObject({ availability: 'completed', provenance: 'verified', input: 'unknown' });
    expect(inspectResult(stored, 0).input).toBe('current');
    expect(inspectResult(stored, 1).input).toBe('stale');
  });
  it('distinguishes missing, legacy, and incomplete provenance', () => {
    expect(inspectResult({ algorithm: null, cycle: 0, assignments: {} }, 0).availability).toBe('missing');
    expect(inspectResult({ algorithm: 'auto', cycle: 20, assignments: {} }, 0).provenance).toBe('legacy_unknown');
    const incomplete = context(); delete incomplete.parameters.manual_well_types;
    expect(compareAnalysisView(incomplete, view()).status).toBe('unknown');
    expect(inspectResult({ algorithm: 'auto', cycle: 20, assignments: {}, analysis_context: incomplete }, 0).provenance).toBe('incomplete');
  });
  it.each(['cycle', 'use_rox', 'background', 'algorithm', 'ploidy', 'n_clusters'] as const)('detects %s changes', (key) => {
    const changed = { ...view(), [key]: { cycle: 40, use_rox: true, background: 'pre_read', algorithm: 'auto', ploidy: 4, n_clusters: 3 }[key] };
    expect(compareAnalysisView(context(), changed).status).toBe('mismatch');
  });
  it.each(Object.keys(thresholds))('detects complete threshold field %s', (key) => {
    const changed = view();
    Object.assign(changed.threshold_config, { [key]: key === 'boundaries' ? [0.7, 0.3] : 1 });
    expect(compareAnalysisView(context(), changed).reasons).toContain('threshold_config');
  });
  it('does not compare unused cluster count or display metadata', () => {
    const stored = context(); stored.parameters.n_clusters_applied = false;
    expect(compareAnalysisView(stored, { ...view(), n_clusters: 9, language: 'ko', selectedMarker: 'x' })).toEqual({ status: 'match', reasons: [] });
  });
  it('compares mixed-region resolved inputs and ordered well membership, not marker labels', () => {
    const stored = context();
    stored.algorithm = 'mixed'; stored.parameters.scope = 'regions'; stored.parameters.n_clusters_applied = false;
    stored.regions = [{ marker_id: 'm', name: 'Original', wells: ['A1', 'A2'], ploidy: 4, algorithm: 'auto',
      parameters: { ...stored.parameters, ploidy: 4, n_clusters_applied: false } }];
    const regionView = { ...view(), id: 'm', name: 'Renamed', color: 'red', wells: ['A1', 'A2'], ploidy: 4 };
    const current = { ...view(), regions: [regionView] };
    expect(compareAnalysisView(stored, current).status).toBe('match');
    expect(compareAnalysisView(stored, { ...current, regions: [{ ...regionView, wells: ['A2', 'A1'] }] }).reasons).toContain('regions');
    expect(compareAnalysisView(stored, { ...current, regions: [{ ...regionView, threshold_config: { ...thresholds, offset: 1 } }] }).status).toBe('mismatch');
    expect(compareAnalysisView(stored, { ...current, regions: [] }).status).toBe('mismatch');
  });
  it('supports actual absolute zero without interpreting it as a last-cycle sentinel', () => {
    const stored = context(); stored.cycle = 0;
    expect(compareAnalysisView(stored, { ...view(), cycle: 0 }).status).toBe('match');
  });
  it('missing view conditions are unknown, not a valid comparison', () => {
    const incomplete: Record<string, unknown> = { ...view() }; delete incomplete.use_rox;
    expect(compareAnalysisView(context(), incomplete).status).toBe('unknown');
  });
  it.each(['requested_algorithm', 'scope'])('rejects nonstring enum %s', key => {
    const stored = context(); stored.parameters[key] = [String(stored.parameters[key])];
    expect(compareAnalysisView(stored, view()).status).toBe('unknown');
  });
  it('does not trust context that disagrees with the retained result', () => {
    const stored = { algorithm: 'auto', cycle: 40, assignments: {}, analysis_context: context() };
    expect(inspectResult(stored, 0).provenance).toBe('incomplete');
  });
  it.each(['algorithm', 'background'] as const)('rejects array-valued captured %s', key => {
    const stored = context(); Object.assign(stored, { [key]: [stored[key]] });
    expect(compareAnalysisView(stored, view()).status).toBe('unknown');
  });
  it('rejects malformed origin and manual provenance without guessing', () => {
    const stored = context(); stored.parameters.ratio_origin = { fam: 0, allele2: 0, source: ['zero'] };
    expect(compareAnalysisView(stored, view()).status).toBe('unknown');
    stored.parameters.ratio_origin = { fam: 0, allele2: 0, source: 'zero' };
    stored.parameters.manual_well_types = { A1: 1 };
    expect(compareAnalysisView(stored, view()).status).toBe('unknown');
  });
  it('checks result-region correspondence without comparing requested versus actual algorithms', () => {
    const stored = context(); stored.parameters.scope = 'regions';
    const region = { marker_id: 'm', name: 'M', wells: ['A1'], ploidy: 4, algorithm: 'auto' as const, parameters: { ...stored.parameters, ploidy: 4 } };
    stored.regions = [region];
    const result = { algorithm: 'kmeans', cycle: 20, assignments: {}, analysis_context: stored,
      regions: [{ id: 'm', name: 'M', wells: ['A1'], ploidy: 4, assignments: {}, offset: 0, offset_uncertain: false, low_separation: false }] };
    expect(inspectResult(result, 0).provenance).toBe('verified');
    for (const patch of [{ id: 'different' }, { name: 'renamed' }, { wells: ['A2'] }, { ploidy: 6 }]) {
      expect(inspectResult({ ...result, regions: [{ ...result.regions[0], ...patch }] }, 0).provenance).toBe('incomplete');
    }
  });
  it('rejects invalid current defaults rather than filling captured conditions', () => {
    const request = { algorithm: 'auto' as const, cycle: 1, n_clusters: 4 };
    expect(() => resolveAnalysisView(request, { ploidy: 2, cycles: [], markers: [] })).toThrow('unavailable');
    expect(() => resolveAnalysisView({ ...request, threshold_config: { ...thresholds, offset: null } }, { ploidy: 2, cycles: [1], markers: [] })).toThrow('threshold');
  });
  it.each(['manual_well_types', 'effective_well_types', 'ratio_origin', 'excluded_wells', 'threshold_config', 'actual_window'])('does not fill missing captured %s from defaults', key => {
    const stored = context(); delete stored.parameters[key];
    expect(compareAnalysisView(stored, view()).status).toBe('unknown');
  });
});
