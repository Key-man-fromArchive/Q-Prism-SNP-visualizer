import { act, render, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { ScatterPlot } from './ScatterPlot';
import { getScatter } from '@/lib/api';
import { useSessionStore } from '@/stores/session-store';
import { useSelectionStore } from '@/stores/selection-store';
import { useDataStore } from '@/stores/data-store';
import { useSettingsStore } from '@/stores/settings-store';
import Plotly from 'plotly.js-dist-min';
import type { ScatterResponse } from '@/types/api';

vi.mock('plotly.js-dist-min', () => ({ default: { newPlot: vi.fn().mockResolvedValue(undefined), react: vi.fn(), purge: vi.fn(), restyle: vi.fn() } }));
vi.mock('@/lib/api', () => ({ getScatter: vi.fn(), runClustering: vi.fn() }));
vi.mock('./ScatterViewControls', () => ({ ScatterViewControls: () => null }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
const response = (dye: string): ScatterResponse => ({ cycle: 1, points: [], allele2_dye: dye });

beforeEach(() => {
  vi.clearAllMocks();
  useSessionStore.setState({ sessionId: 'run-a' });
  useSelectionStore.setState({ currentCycle: 1 });
  useDataStore.setState({ scatterPoints: [] });
});

it('registers typed selection events and highlights a selected well', async () => {
  const handlers = new Map<string, (data: unknown) => void>();
  vi.mocked(Plotly.newPlot).mockImplementation(async (node) => {
    Object.assign(node, { on: (event: string, handler: (data: unknown) => void) => handlers.set(event, handler), data: [{ customdata: ['A1'] }] });
  });
  vi.mocked(getScatter).mockResolvedValue({ ...response('HEX'), points: [{ well: 'A1', sample_name: null, raw_fam: 1, raw_allele2: 2, raw_rox: null, norm_fam: 1, norm_allele2: 2, auto_cluster: null, manual_type: null }] });
  render(<ScatterPlot />);
  await waitFor(() => expect(handlers.has('plotly_selected')).toBe(true));
  act(() => handlers.get('plotly_click')?.({ points: [{ customdata: 'A1' }] }));
  expect(useSelectionStore.getState().selectedWell).toBe('A1');
  act(() => handlers.get('plotly_selected')?.({ points: [{ customdata: 'A1' }, { customdata: 42 }] }));
  expect(useSelectionStore.getState().selectedWells).toEqual(['A1']);
  expect(Plotly.restyle).toHaveBeenCalled();
  act(() => useSettingsStore.setState({ showManualTypes: true, showBoundaryLines: true }));
  act(() => useDataStore.setState({ boundaries: [0.7, 0.3] }));
});

it('ignores a late response from the previous session', async () => {
  const old = deferred<ScatterResponse>();
  vi.mocked(getScatter).mockReturnValueOnce(old.promise).mockResolvedValueOnce(response('VIC'));
  render(<ScatterPlot />);
  act(() => useSessionStore.setState({ sessionId: 'run-b' }));
  await waitFor(() => expect(useDataStore.getState().allele2Dye).toBe('VIC'));
  await act(async () => old.resolve(response('HEX')));
  expect(useDataStore.getState().allele2Dye).toBe('VIC');
});

it('does not publish a response after unmount', async () => {
  const pending = deferred<ScatterResponse>();
  vi.mocked(getScatter).mockReturnValueOnce(pending.promise);
  useDataStore.setState({ allele2Dye: 'VIC' });
  const view = render(<ScatterPlot />);
  view.unmount();
  await act(async () => pending.resolve(response('HEX')));
  expect(useDataStore.getState().allele2Dye).toBe('VIC');
});
