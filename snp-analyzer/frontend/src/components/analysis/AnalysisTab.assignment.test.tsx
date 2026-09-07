import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { AnalysisTab } from './AnalysisTab';
import { setWellTypes, runClustering, suggestCycle } from '@/lib/api';
import { useAnalysisStore } from '@/stores/analysis-store';
import { useSessionStore } from '@/stores/session-store';
import { useSelectionStore } from '@/stores/selection-store';
import { useSettingsStore } from '@/stores/settings-store';

vi.mock('@/lib/api', () => ({
  setWellTypes: vi.fn().mockResolvedValue({}),
  getWellGroups: vi.fn().mockResolvedValue({ groups: {} }),
  getWellTypes: vi.fn().mockResolvedValue({ assignments: {} }),
  getCluster: vi.fn(), getPloidy: vi.fn(), runClustering: vi.fn(), suggestCycle: vi.fn(),
}));
vi.mock('./CycleControl', () => ({ CycleControl: () => null }));
vi.mock('./ScatterPlot', () => ({ ScatterPlot: () => null }));
vi.mock('./PlateView', () => ({ PlateView: () => null }));
vi.mock('./WellDetailPanel', () => ({ WellDetailPanel: () => null }));
vi.mock('./ResultsTable', () => ({ ResultsTable: () => null }));
vi.mock('./AmplificationOverlay', () => ({ AmplificationOverlay: () => null }));
vi.mock('./GroupManager', () => ({ GroupManager: () => null }));
vi.mock('./WellSelectionToolbar', () => ({ WellSelectionToolbar: () => null }));
vi.mock('./WellTypePopup', () => ({
  WellTypePopup: ({ onAssign }: { onAssign: (value: string) => void }) => <>
    <button onClick={() => onAssign('NTC')}>Assign valid type</button>
    <button onClick={() => onAssign('invalid-type')}>Assign invalid type</button>
  </>,
}));

beforeEach(() => {
  vi.clearAllMocks();
  useSessionStore.setState({ sessionId: 'synthetic-assignment', wellGroups: null });
  useSelectionStore.setState({ currentCycle: 0, selectedWells: ['A1', 'A2'], selectedGroup: null });
  useAnalysisStore.getState().setSession('synthetic-assignment', 'u');
});
it('returns the current profile to AUTO without manual cuts when boundary mode is turned off', () => {
  useSettingsStore.setState({ showManualTypes: true, showBoundaryLines: true });
  render(<AnalysisTab />);
  useAnalysisStore.getState().setCurrentRequest({ algorithm: 'threshold', cycle: 20, n_clusters: 4,
    threshold_config: { ntc_threshold: 0.1, allele1_ratio_max: 0.4, allele2_ratio_min: 0.6, boundaries: [0.5] } });
  fireEvent.click(screen.getByTestId('boundary-mode-toggle'));
  expect(useAnalysisStore.getState().currentRequest?.algorithm).toBe('auto');
  expect(useAnalysisStore.getState().currentRequest?.threshold_config?.boundaries).toBeUndefined();
  expect(runClustering).not.toHaveBeenCalled();
});

it('passes the validated popup type and selected wells to the API', async () => {
  render(<AnalysisTab />);
  fireEvent.contextMenu(document.body);
  fireEvent.click(screen.getByRole('button', { name: 'Assign valid type' }));
  await waitFor(() => expect(setWellTypes).toHaveBeenCalledWith('synthetic-assignment', {
    wells: ['A1', 'A2'], well_type: 'NTC',
  }));
  await waitFor(() => expect(useSelectionStore.getState().selectedWells).toEqual([]));
});

it('blocks invalid popup input before the API and preserves the selection', async () => {
  render(<AnalysisTab />);
  fireEvent.contextMenu(document.body);
  fireEvent.click(screen.getByRole('button', { name: 'Assign invalid type' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Assign invalid type' })).toBeVisible());
  expect(setWellTypes).not.toHaveBeenCalled();
  expect(useSelectionStore.getState().selectedWells).toEqual(['A1', 'A2']);
});
it('runs the current cycle explicitly without asking for a recommended cycle', async () => {
  useSelectionStore.getState().setCycle(20);
  vi.mocked(runClustering).mockResolvedValue({ algorithm: 'auto', cycle: 20, assignments: {} });
  render(<AnalysisTab />);
  fireEvent.click(screen.getByTestId('analyze-current'));
  await waitFor(() => expect(runClustering).toHaveBeenCalled());
  expect(suggestCycle).not.toHaveBeenCalled();
  expect(vi.mocked(runClustering).mock.calls[0]?.[1].cycle).toBe(20);
});
