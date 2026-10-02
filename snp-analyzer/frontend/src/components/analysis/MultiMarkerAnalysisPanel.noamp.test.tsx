import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MultiMarkerAnalysisPanel } from './MultiMarkerAnalysisPanel';
import { runClustering } from '@/lib/api';
import { useLanguageStore } from '@/stores/language-store';
import { useNavigationStore } from '@/stores/navigation-store';
import { useAnalysisStore } from '@/stores/analysis-store';
import { useSessionStore } from '@/stores/session-store';
import { useSelectionStore } from '@/stores/selection-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useQcUiStore } from '@/stores/qc-ui-store';
import type { AmplificationQcResult, MarkerRegion } from '@/types/api';
vi.mock('@/lib/api', () => ({ runClustering: vi.fn().mockResolvedValue({ algorithm: 'auto', cycle: 20, assignments: {} }),
  suggestCycle: vi.fn(),
  getScatter: vi.fn().mockResolvedValue({ points: [], allele2_dye: 'VIC' }),
  listMarkerCatalog: vi.fn().mockResolvedValue({ entries: [] }) }));
vi.mock('./CycleControl', () => ({ CycleControl: () => null }));
vi.mock('./MarkerScatterPlot', () => ({ MarkerScatterPlot: () => null }));
vi.mock('./PlateView', () => ({ PlateView: () => null }));
vi.mock('./WellSelectionToolbar', () => ({ WellSelectionToolbar: () => null }));
vi.mock('./WellDetailPanel', () => ({ WellDetailPanel: () => null }));
vi.mock('./ResultsTable', () => ({ ResultsTable: () => null }));
vi.mock('./AmplificationOverlay', () => ({ AmplificationOverlay: () => null }));

const markers: MarkerRegion[] = [{ id: 'm', name: 'Synthetic marker', wells: ['A1', 'A2', 'A3'], ploidy: 2, color: '#000000' }];
const qc: AmplificationQcResult = {
  enabled: true, available: true, fraction: 1 / 3, fam_threshold: 1.2, allele2_threshold: 0.1,
  source: 'auto', baseline_cycle: 0, read_cycle: 20, no_amplification_wells: ['A1', 'A2', 'A3'],
};
function setResult(assignments: Record<string, string>, counts: Record<string, number>) {
  useAnalysisStore.setState({ result: { algorithm: 'auto', cycle: 20, assignments, amplification_qc: qc,
    regions: [{ ...markers[0], assignments, offset: 0, offset_uncertain: false, low_separation: false, genotype_counts: counts }] } });
}

beforeEach(() => {
  useLanguageStore.getState().setLanguage('en');
  vi.clearAllMocks();
  useSettingsStore.getState().resetToDefaults();
  useQcUiStore.setState({ bySession: {} });
  useSessionStore.setState({ sessionId: 'multi', initialAnalysisAvailable: false });
  useAnalysisStore.getState().setSession('multi', 'u');
  useNavigationStore.setState({ status: 'ready', surface: 'analysis' });
  useSelectionStore.getState().setCycle(20);
});
afterEach(() => vi.useRealTimers());

it('counts flagged wells in their own cell and says so when the whole marker did not amplify', async () => {
  setResult({ A1: 'Undetermined', A2: 'Undetermined', A3: 'Undetermined' }, { Undetermined: 3, excluded: 0 });
  render(<MultiMarkerAnalysisPanel markers={markers} />);
  expect(await screen.findByTestId('genotype-count-no-amplification')).toHaveTextContent('3');
  expect(screen.getByTestId('genotype-count-no-amplification')).toHaveTextContent('No amplification');
  expect(screen.getByTestId('marker-no-amplification')).toHaveTextContent('This marker did not amplify.');
  expect(screen.getByTestId('amplification-qc-summary')).toHaveTextContent('FAM ≥ 1.20');
});

it('keeps real undetermined wells in the undetermined count and shows no marker note', async () => {
  useAnalysisStore.setState({ result: null });
  setResult({ A1: 'Undetermined', A2: 'Undetermined', A3: 'Heterozygous' },
    { Undetermined: 2, Heterozygous: 1, excluded: 0 });
  useAnalysisStore.setState({ result: { ...useAnalysisStore.getState().result!,
    amplification_qc: { ...qc, no_amplification_wells: ['A1'] } } });
  render(<MultiMarkerAnalysisPanel markers={markers} />);
  expect(await screen.findByTestId('genotype-count-no-amplification')).toHaveTextContent('1');
  expect(screen.queryByTestId('marker-no-amplification')).toBeNull();
});

it('sends the operator choices with the analysis request only when they differ from the defaults', async () => {
  vi.useFakeTimers();
  useNavigationStore.setState({ exportRestoring: false, qualityEpoch: 0, qualityNavigating: false });
  render(<MultiMarkerAnalysisPanel markers={markers} />);
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });
  act(() => useNavigationStore.setState({ cycle: 21 }));
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });
  expect(vi.mocked(runClustering).mock.calls.at(-1)![1]).not.toHaveProperty('amplification_qc');
  act(() => useQcUiStore.getState().patchSettings('multi', { famThreshold: 2 }));
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });
  expect(vi.mocked(runClustering).mock.calls.at(-1)![1]).toMatchObject({
    amplification_qc: { enabled: true, fraction: 1 / 3, fam_threshold: 2, allele2_threshold: null } });
});
