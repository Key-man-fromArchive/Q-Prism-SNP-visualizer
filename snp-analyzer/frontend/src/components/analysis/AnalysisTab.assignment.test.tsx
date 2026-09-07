import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { AnalysisTab } from './AnalysisTab';
import { setWellTypes } from '@/lib/api';
import { useSessionStore } from '@/stores/session-store';
import { useSelectionStore } from '@/stores/selection-store';

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
