import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
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
