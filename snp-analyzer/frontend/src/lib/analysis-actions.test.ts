import { beforeEach, expect, it, vi } from 'vitest';
import { useAnalysisStore } from '@/stores/analysis-store';
import { runClustering, suggestCycle } from '@/lib/api';
import { analyzeCurrent, analyzeRecommended } from './analysis-actions';
import type { ClusteringRequest } from '@/types/api';
import { useNavigationStore } from '@/stores/navigation-store';

vi.mock('@/lib/api', () => ({ runClustering: vi.fn(), suggestCycle: vi.fn() }));
const request: ClusteringRequest = { cycle: 20, algorithm: 'auto', use_rox: false, n_clusters: 4 };
const result = { cycle: 20, algorithm: 'auto', assignments: { A1: 'Allele 1 Homo' }, input_revision: 0 };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => {
  vi.resetAllMocks();
  useAnalysisStore.getState().setSession('s', 'u');
  useNavigationStore.setState({ status: 'ready' });
});
it('retains explicit full-curve recommendation including zero onset, then invalidates changed inputs', async () => {
  const suggestion = { suggested_cycle: 0, suggested_low: 0, suggested_high: 0, suggested_window: null,
    ntc_onset_cycle: 0, ntc_onset_status: 'detected' as const, ntc_onset_reason: 'none' as const,
    ntc_wells: ['A1'], amp_start: 0, amp_end: 40 };
  useAnalysisStore.getState().updateInputRevision('s', 'u', 0);
  vi.mocked(suggestCycle).mockResolvedValue(suggestion);
  vi.mocked(runClustering).mockResolvedValue({ ...result, cycle: 0 });
  await analyzeRecommended(request, vi.fn());
  expect(useAnalysisStore.getState().recommendation).toEqual({ suggestion, inputRevision: 0 });
  useAnalysisStore.getState().updateInputRevision('s', 'u', 1);
  expect(useAnalysisStore.getState().recommendation).toBeNull();
});
it('drops a recommendation whose inputs change while suggestion is in flight', async () => {
  const suggestion = deferred<Awaited<ReturnType<typeof suggestCycle>>>();
  useAnalysisStore.getState().updateInputRevision('s', 'u', 0);
  vi.mocked(suggestCycle).mockReturnValue(suggestion.promise);
  vi.mocked(runClustering).mockResolvedValue({ ...result, input_revision: 1 });
  const pending = analyzeRecommended(request, vi.fn());
  useAnalysisStore.getState().updateInputRevision('s', 'u', 1);
  suggestion.resolve({ suggested_cycle: 20 } as Awaited<ReturnType<typeof suggestCycle>>);
  await pending;
  expect(useAnalysisStore.getState().recommendation).toBeNull();
});
it('drops an onset outcome when the submitted analysis itself advances input revision', async () => {
  useAnalysisStore.getState().updateInputRevision('s', 'u', 0);
  vi.mocked(suggestCycle).mockResolvedValue({ suggested_cycle: 20 } as Awaited<ReturnType<typeof suggestCycle>>);
  vi.mocked(runClustering).mockResolvedValue({ ...result, input_revision: 1 });
  await analyzeRecommended(request, vi.fn());
  expect(useAnalysisStore.getState().recommendation).toBeNull();
});
it('does not supersede a restoration load with a current or recommended action', async () => {
  const load = useAnalysisStore.getState().beginRequest('load');
  useNavigationStore.setState({ status: 'restoring' });
  expect(await analyzeCurrent(request)).toBe(false);
  expect(await analyzeRecommended(request, vi.fn())).toBe(false);
  expect(useAnalysisStore.getState().isCurrent(load)).toBe(true);
  expect(runClustering).not.toHaveBeenCalled();
  expect(suggestCycle).not.toHaveBeenCalled();
});
it('analyzes the explicit current cycle without requesting a recommendation', async () => {
  vi.mocked(runClustering).mockResolvedValue(result);
  expect(await analyzeCurrent(request)).toBe(true);
  expect(runClustering).toHaveBeenCalledWith('s', request);
  expect(suggestCycle).not.toHaveBeenCalled();
  expect(useAnalysisStore.getState().result).toEqual(result);
  expect(useAnalysisStore.getState().submittedRequest).toEqual(request);
});
it('keeps the submitted snapshot separate from subsequent explicit view changes', async () => {
  vi.mocked(runClustering).mockResolvedValue(result);
  await analyzeCurrent(request);
  const view = { ...request, cycle: 40 };
  useAnalysisStore.getState().setCurrentRequest(view);
  view.cycle = 10;
  expect(useAnalysisStore.getState().currentRequest?.cycle).toBe(40);
  expect(useAnalysisStore.getState().submittedRequest?.cycle).toBe(20);
});
it('does not overwrite a newer current view when a submitted request completes', async () => {
  const pending = deferred<typeof result>();
  vi.mocked(runClustering).mockReturnValue(pending.promise);
  const completed = analyzeCurrent(request);
  useAnalysisStore.getState().setCurrentRequest({ ...request, cycle: 40 });
  pending.resolve(result);
  await completed;
  expect(useAnalysisStore.getState().currentRequest?.cycle).toBe(40);
  expect(useAnalysisStore.getState().submittedRequest?.cycle).toBe(20);
});
it('publishes only the latest analysis completion', async () => {
  const old = deferred<typeof result>();
  vi.mocked(runClustering).mockReturnValueOnce(old.promise).mockResolvedValueOnce({ ...result, cycle: 40 });
  const first = analyzeCurrent(request);
  expect(await analyzeCurrent({ ...request, cycle: 40 })).toBe(true);
  old.resolve(result);
  expect(await first).toBe(false);
  expect(useAnalysisStore.getState().result?.cycle).toBe(40);
});
it('retains a completed result when the latest explicit analysis fails', async () => {
  vi.mocked(runClustering).mockResolvedValueOnce(result).mockRejectedValueOnce(new Error('offline'));
  await analyzeCurrent(request);
  expect(await analyzeCurrent(request)).toBe(false);
  expect(useAnalysisStore.getState()).toMatchObject({ result, status: 'failed', pending: false });
});
it('does not navigate or submit an obsolete recommendation after session replacement', async () => {
  const suggestion = deferred<Awaited<ReturnType<typeof suggestCycle>>>();
  vi.mocked(suggestCycle).mockReturnValue(suggestion.promise);
  const navigate = vi.fn();
  const pending = analyzeRecommended(request, navigate);
  useAnalysisStore.getState().setSession('other', 'u');
  suggestion.resolve({ suggested_cycle: 40 } as Awaited<ReturnType<typeof suggestCycle>>);
  expect(await pending).toBe(false);
  expect(navigate).not.toHaveBeenCalled();
  expect(runClustering).not.toHaveBeenCalled();
});
it('uses the suggested cycle only for the separate recommended action', async () => {
  vi.mocked(suggestCycle).mockResolvedValue({ suggested_cycle: 40 } as Awaited<ReturnType<typeof suggestCycle>>);
  vi.mocked(runClustering).mockResolvedValue({ ...result, cycle: 40 });
  const navigate = vi.fn();
  expect(await analyzeRecommended(request, navigate)).toBe(true);
  expect(navigate).toHaveBeenCalledWith(40);
  expect(runClustering).toHaveBeenCalledWith('s', { ...request, cycle: 40 });
});
it('a newer current-cycle command invalidates the pending recommendation in the same session', async () => {
  const suggestion = deferred<Awaited<ReturnType<typeof suggestCycle>>>();
  vi.mocked(suggestCycle).mockReturnValue(suggestion.promise);
  vi.mocked(runClustering).mockResolvedValue(result);
  const navigate = vi.fn();
  const old = analyzeRecommended(request, navigate);
  await analyzeCurrent(request);
  suggestion.resolve({ suggested_cycle: 40 } as Awaited<ReturnType<typeof suggestCycle>>);
  expect(await old).toBe(false);
  expect(navigate).not.toHaveBeenCalled();
  expect(runClustering).toHaveBeenCalledTimes(1);
});
it('rechecks authority after the navigation callback before sending the analysis', async () => {
  vi.mocked(suggestCycle).mockResolvedValue({ suggested_cycle: 40 } as Awaited<ReturnType<typeof suggestCycle>>);
  expect(await analyzeRecommended(request, () => useAnalysisStore.getState().clear())).toBe(false);
  expect(runClustering).not.toHaveBeenCalled();
});
