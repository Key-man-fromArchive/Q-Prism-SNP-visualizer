import { expect, it } from 'vitest';
import { connectAnalysisProjection } from './analysis-projection';
import { useAnalysisStore } from '@/stores/analysis-store';
import { useDataStore } from '@/stores/data-store';

it('projects accepted results only, retains the projection on failure, and clears it on session change', () => {
  useAnalysisStore.getState().setSession('s', 'u');
  const disconnect = connectAnalysisProjection();
  const old = useAnalysisStore.getState().beginRequest('analysis');
  const ticket = useAnalysisStore.getState().beginRequest('analysis');
  const result = { algorithm: 'auto', cycle: 20, assignments: { A1: 'NTC' }, boundaries: [0.6], offset: 1 };
  useAnalysisStore.getState().accept(ticket, result);
  useAnalysisStore.getState().accept(old, { ...result, assignments: {} });
  expect(useDataStore.getState()).toMatchObject({ clusterAssignments: result.assignments, boundaries: [0.6], offset: 1 });
  useAnalysisStore.getState().fail(useAnalysisStore.getState().beginRequest('analysis'), new Error('offline'));
  expect(useDataStore.getState().clusterAssignments).toEqual(result.assignments);
  useAnalysisStore.getState().clear();
  expect(useDataStore.getState().clusterAssignments).toEqual({});
  expect(useDataStore.getState().boundaries).toBeNull();
  disconnect();
});

// Regression: the scatter/genotype tables (WellDetailPanel, ResultsTable)
// read auto_cluster/confidence off `scatterPoints`, NOT off `clusterAssignments`
// or `plateWells`. A fresh session's auto-cluster-on-load never refetches
// scatter data (nothing dispatches "analysis-result-changed" for it), so if
// the projection only updates `clusterAssignments`/`plateWells` the tables
// stay blank forever even though the backend now has real per-well calls and
// confidences cached. The projection must also carry `assignments` and
// `confidences` onto the already-loaded `scatterPoints`.
it('projects assignments and confidences onto already-loaded scatterPoints', () => {
  useAnalysisStore.getState().setSession('s2', 'u');
  useDataStore.setState({
    scatterPoints: [
      { well: 'A1', norm_fam: 1, norm_allele2: 0, raw_fam: 1, raw_allele2: 0, raw_rox: null,
        sample_name: null, auto_cluster: null, manual_type: null, confidence: null },
      { well: 'B1', norm_fam: 0, norm_allele2: 1, raw_fam: 0, raw_allele2: 1, raw_rox: null,
        sample_name: null, auto_cluster: null, manual_type: null, confidence: null },
    ],
  });
  const disconnect = connectAnalysisProjection();
  const ticket = useAnalysisStore.getState().beginRequest('analysis');
  const result = {
    algorithm: 'auto', cycle: 20,
    assignments: { A1: 'Allele 1 Homo' },
    confidences: { A1: 0.87 },
  };
  useAnalysisStore.getState().accept(ticket, result);

  const points = useDataStore.getState().scatterPoints;
  const a1 = points.find((p) => p.well === 'A1');
  const b1 = points.find((p) => p.well === 'B1');
  expect(a1?.auto_cluster).toBe('Allele 1 Homo');
  expect(a1?.confidence).toBe(0.87);
  // B1 got no assignment/confidence back from this clustering run -- it
  // must not keep a stale call or confidence from before.
  expect(b1?.auto_cluster).toBeNull();
  expect(b1?.confidence).toBeNull();
  disconnect();
});
