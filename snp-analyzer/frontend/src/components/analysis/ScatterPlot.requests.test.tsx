import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { ScatterPlot } from './ScatterPlot';
import { getScatter, runClustering } from '@/lib/api';
import { useAnalysisStore } from '@/stores/analysis-store';
import { useSessionStore } from '@/stores/session-store';
import { useSelectionStore } from '@/stores/selection-store';
import { useDataStore } from '@/stores/data-store';
import { useSettingsStore } from '@/stores/settings-store';
import Plotly from 'plotly.js-dist-min';
import type { ScatterResponse } from '@/types/api';

vi.mock('plotly.js-dist-min', () => ({ default: { newPlot: vi.fn().mockResolvedValue(undefined), react: vi.fn(), purge: vi.fn(), restyle: vi.fn() } }));
vi.mock('@/lib/api', () => ({ getScatter: vi.fn(), runClustering: vi.fn() }));
vi.mock('./ScatterViewControls', () => ({ ScatterViewControls: ({ dosageCeiling }: { dosageCeiling: { onApply: (value: number) => void } }) =>
  <button onClick={() => dosageCeiling.onApply(3)}>Apply synthetic dosage ceiling</button> }));

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
it('fetches the actual zero cycle instead of suppressing the view', async () => {
  useSelectionStore.setState({ currentCycle: 0 });
  vi.mocked(getScatter).mockResolvedValue({ ...response('VIC'), cycle: 0 });
  render(<ScatterPlot />);
  await waitFor(() => expect(getScatter).toHaveBeenCalledWith('run-a', 0, expect.any(Boolean), expect.any(String)));
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
it('routes explicit dosage fitting through the shared owner without forcing manual boundaries', async () => {
  useAnalysisStore.getState().setSession('run-a', 'u');
  vi.mocked(getScatter).mockResolvedValue(response('VIC'));
  vi.mocked(runClustering).mockResolvedValue({ algorithm: 'auto', cycle: 1, assignments: { A1: 'NTC' } });
  render(<ScatterPlot />);
  fireEvent.click(screen.getByRole('button', { name: 'Apply synthetic dosage ceiling' }));
  await waitFor(() => expect(useAnalysisStore.getState().result?.assignments).toEqual({ A1: 'NTC' }));
  expect(vi.mocked(runClustering).mock.calls.at(-1)?.[1]).toMatchObject({ algorithm: 'auto',
    threshold_config: { boundaries: null, offset: 0, dosage_max: 3 } });
});
it('does not change accepted dosage metadata when fitting fails', async () => {
  useAnalysisStore.getState().setSession('run-a', 'u');
  useDataStore.setState({ dosageMax: 6 });
  vi.mocked(getScatter).mockResolvedValue(response('VIC'));
  vi.mocked(runClustering).mockRejectedValue(new Error('Synthetic fitting failure'));
  render(<ScatterPlot />);
  fireEvent.click(screen.getByRole('button', { name: 'Apply synthetic dosage ceiling' }));
  await waitFor(() => expect(useAnalysisStore.getState().status).toBe('failed'));
  expect(useDataStore.getState().dosageMax).toBe(6);
});
it('restores displayed boundary drafts after a failed manual edit', async () => {
  useAnalysisStore.getState().setSession('run-a', 'u');
  useSettingsStore.setState({ showBoundaryLines: true, showManualTypes: true, scatterTool: 'edit', ploidy: 4 });
  useDataStore.setState({ boundaries: [0.7, 0.3], offset: 1 });
  vi.mocked(getScatter).mockResolvedValue({ ...response('VIC'), points: [{ well: 'A1', sample_name: null, raw_fam: 1, raw_allele2: 2, raw_rox: null, norm_fam: 1, norm_allele2: 2, auto_cluster: null, manual_type: null }] });
  vi.mocked(Plotly.newPlot).mockImplementation(async node => {
    Object.assign(node, { on: vi.fn(), _fullLayout: { xaxis: { _length: 100, range: [0, 1] }, yaxis: { _length: 100, range: [0, 1] } } });
  });
  vi.mocked(runClustering).mockRejectedValue(new Error('Synthetic manual failure'));
  const view = render(<ScatterPlot />);
  await waitFor(() => expect(Plotly.newPlot).toHaveBeenCalled());
  const before = vi.mocked(Plotly.newPlot).mock.calls.at(-1)?.[2]?.shapes?.length;
  fireEvent.doubleClick(view.container.querySelector('#scatter-plot')!, { clientX: 25, clientY: 25 });
  await waitFor(() => expect(useAnalysisStore.getState().status).toBe('failed'));
  expect(useDataStore.getState().boundaries).toEqual([0.7, 0.3]);
  await waitFor(() => expect(vi.mocked(Plotly.react).mock.calls.at(-1)?.[2]?.shapes?.length).toBe(before));
});
