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
