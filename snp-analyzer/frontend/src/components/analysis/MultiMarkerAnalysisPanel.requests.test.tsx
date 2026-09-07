import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MultiMarkerAnalysisPanel } from './MultiMarkerAnalysisPanel';
import { getScatter, runClustering, suggestCycle } from '@/lib/api';
import { useDataStore } from '@/stores/data-store';
import { useNavigationStore } from '@/stores/navigation-store';
import { useAnalysisStore } from '@/stores/analysis-store';
import { useSessionStore } from '@/stores/session-store';
import { useSelectionStore } from '@/stores/selection-store';
import type { MarkerRegion } from '@/types/api';
vi.mock('@/lib/api', () => ({ runClustering: vi.fn(), suggestCycle: vi.fn(),
  getScatter: vi.fn().mockResolvedValue({ points: [], allele2_dye: 'VIC' }),
  listMarkerCatalog: vi.fn().mockResolvedValue({ entries: [] }) }));
vi.mock('./CycleControl', () => ({ CycleControl: () => null }));
vi.mock('./MarkerScatterPlot', () => ({ MarkerScatterPlot: () => null }));
vi.mock('./PlateView', () => ({ PlateView: () => null }));
vi.mock('./WellSelectionToolbar', () => ({ WellSelectionToolbar: () => null }));
vi.mock('./WellDetailPanel', () => ({ WellDetailPanel: () => null }));
vi.mock('./ResultsTable', () => ({ ResultsTable: () => null }));
vi.mock('./AmplificationOverlay', () => ({ AmplificationOverlay: () => null }));
const markers: MarkerRegion[] = [{ id: 'm', name: 'Synthetic marker', wells: ['A1'], ploidy: 2, color: '#000000' }];
beforeEach(() => {
  vi.clearAllMocks();
  useSessionStore.setState({ sessionId: 'multi', initialAnalysisAvailable: false });
  useAnalysisStore.getState().setSession('multi', 'u');
  useNavigationStore.setState({ status: 'ready' });
  useSelectionStore.getState().setCycle(20);
});
afterEach(() => vi.useRealTimers());
it('a QC jump and Return establish baselines without automatic analysis, while later edits still run', async () => {
  vi.useFakeTimers();
  useNavigationStore.setState({ exportRestoring: false, qualityEpoch: 0, qualityNavigating: false });
  render(<MultiMarkerAnalysisPanel markers={markers} />);
  await act(async () => { await vi.advanceTimersByTimeAsync(300); });
  act(() => useNavigationStore.setState({ qualityNavigating: true }));
  act(() => useNavigationStore.setState({ cycle: 0, qualityEpoch: 1, qualityNavigating: false }));
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });
  expect(runClustering).not.toHaveBeenCalled();
  act(() => useNavigationStore.setState({ cycle: 20, qualityEpoch: 2 }));
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });
  expect(runClustering).not.toHaveBeenCalled();
  act(() => useNavigationStore.setState({ cycle: 21 }));
  await act(async () => { await vi.advanceTimersByTimeAsync(250); });
  expect(runClustering).toHaveBeenCalledTimes(1);
});
it('does not publish detached scatter points after unmount and session replacement', async () => {
  let resolve!: (value: Awaited<ReturnType<typeof getScatter>>) => void;
  vi.mocked(getScatter).mockReturnValueOnce(new Promise(done => { resolve = done; }));
  const view = render(<MultiMarkerAnalysisPanel markers={markers} />);
  view.unmount();
  useAnalysisStore.getState().setSession('new', 'u');
  useDataStore.setState({ scatterPoints: [] });
  await act(async () => resolve({ points: [{ well: 'A1', norm_fam: 4, norm_allele2: 2,
    raw_fam: 4, raw_allele2: 2, raw_rox: null, sample_name: null, auto_cluster: null,
    manual_type: null }], allele2_dye: 'VIC', cycle: 20 }));
  expect(useDataStore.getState().scatterPoints).toEqual([]);
});
it('current-cycle multi analysis publishes through the shared owner without requesting a suggestion', async () => {
  vi.mocked(runClustering).mockResolvedValue({ algorithm: 'auto', cycle: 20, assignments: { A1: 'NTC' } });
  render(<MultiMarkerAnalysisPanel markers={markers} />);
  fireEvent.click(screen.getByTestId('multi-analyze-current'));
  await waitFor(() => expect(useAnalysisStore.getState().result?.assignments).toEqual({ A1: 'NTC' }));
  expect(suggestCycle).not.toHaveBeenCalled();
});
it('requests zero without replacing it with an omitted cycle', async () => {
  useSelectionStore.setState({ currentCycle: 0 });
  render(<MultiMarkerAnalysisPanel markers={markers} />);
  await waitFor(() => expect(getScatter).toHaveBeenCalledWith('multi', 0, expect.any(Boolean), expect.any(String)));
});
it('keeps scatter rendering live, consumes the restored cycle, and only analyses a later genuine edit', async () => {
  vi.useFakeTimers();
  useNavigationStore.getState().setExportRestoring(true);
  render(<MultiMarkerAnalysisPanel markers={markers} />);
  await act(async () => { await vi.advanceTimersByTimeAsync(260); });
  expect(getScatter).toHaveBeenCalled();
  expect(runClustering).not.toHaveBeenCalled();
  // The stored result moves 20 -> 40 while export suppression is active.
  act(() => useSelectionStore.getState().setCycle(40));
  await act(async () => { await vi.advanceTimersByTimeAsync(260); });
  expect(runClustering).not.toHaveBeenCalled();
  useNavigationStore.getState().setExportRestoring(false);
  await act(async () => { await vi.advanceTimersByTimeAsync(260); });
  expect(runClustering).not.toHaveBeenCalled();
  // Only a later operator change is a new automatic-analysis request.
  act(() => useSelectionStore.getState().setCycle(21));
  await act(async () => { await vi.advanceTimersByTimeAsync(260); });
  expect(runClustering).toHaveBeenCalled();
  useNavigationStore.getState().setExportRestoring(true);
  useNavigationStore.getState().beginRestore('replacement');
  expect(useNavigationStore.getState().exportRestoring).toBe(false);
});
