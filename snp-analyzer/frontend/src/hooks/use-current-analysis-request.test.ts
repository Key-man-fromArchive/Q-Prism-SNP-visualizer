import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it } from 'vitest';
import { useCurrentAnalysisRequest } from './use-current-analysis-request';
import { useAnalysisStore } from '@/stores/analysis-store';
import { useNavigationStore } from '@/stores/navigation-store';
import type { ClusteringRequest } from '@/types/api';
const request: ClusteringRequest = { algorithm: 'auto', cycle: 20, n_clusters: 4,
  threshold_config: { ntc_threshold: 0.1, allele1_ratio_max: 0.4, allele2_ratio_min: 0.6 } };
beforeEach(() => {
  useAnalysisStore.getState().setSession('s', 'u');
  useNavigationStore.setState({ status: 'ready', tab: 'analysis' });
});
it('preserves direct manual configuration when an NTC control rerender registers its changed field', () => {
  const { rerender } = renderHook(({ value }) => useCurrentAnalysisRequest(value, 'analysis'), { initialProps: { value: request } });
  const manual: ClusteringRequest = { ...request, algorithm: 'threshold', threshold_config: { ...request.threshold_config!, ntc_threshold: 0.2, boundaries: [0.7, 0.3] } };
  act(() => useAnalysisStore.getState().setCurrentRequest(manual));
  rerender({ value: { ...request, threshold_config: { ...request.threshold_config!, ntc_threshold: 0.2 } } });
  expect(useAnalysisStore.getState().currentRequest).toEqual(manual);
  rerender({ value: { ...request, cycle: 40, threshold_config: { ...request.threshold_config!, ntc_threshold: 0.2 } } });
  expect(useAnalysisStore.getState().currentRequest).toEqual({ ...manual, cycle: 40 });
});
it('does not register hidden surfaces or overwrite a direct action on a view-only rerender', () => {
  const { rerender } = renderHook(() => useCurrentAnalysisRequest(request, 'analysis'));
  const direct = { ...request, algorithm: 'kmeans' as const };
  act(() => useAnalysisStore.getState().setCurrentRequest(direct));
  rerender();
  expect(useAnalysisStore.getState().currentRequest).toEqual(direct);
  act(() => useNavigationStore.setState({ tab: 'settings' }));
  rerender();
  expect(useAnalysisStore.getState().currentRequest).toEqual(direct);
});
