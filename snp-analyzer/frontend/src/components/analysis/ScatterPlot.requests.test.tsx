import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { ScatterPlot } from './ScatterPlot';
import { getScatter, runClustering } from '@/lib/api';
import { useAnalysisStore } from '@/stores/analysis-store';
import { useSessionStore } from '@/stores/session-store';
import { useSelectionStore } from '@/stores/selection-store';
import { useDataStore } from '@/stores/data-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useAuthStore } from '@/stores/auth-store';
import { getActiveChart } from '@/lib/chart-export-registry';
import Plotly from 'plotly.js-dist-min';
import type { ScatterResponse } from '@/types/api';
import { useNavigationStore } from '@/stores/navigation-store';

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
it('uses the leased Omit reveal consistently for the rendered count without changing roles or filters', async () => {
  useAuthStore.setState({ user: { id: 'u', username: 'u', display_name: null, role: 'user' } });
  useSessionStore.setState({ sessionId: 'run-a', entryGeneration: 2, wellGroups: { other: ['B1'] } });
  useSettingsStore.setState({ useRox: false });
  useSelectionStore.setState({ selectedGroup: 'other', selectedWells: ['B1'], focusSelectedWells: true });
  useDataStore.setState({ wellTypeAssignments: { A1: 'Omit' } });
  useNavigationStore.setState({ qualityTarget: { session: 'run-a', well: 'A1', source: 'curve', basis: 'unversioned',
    cycle: 1, useRox: false, marker: null, inputRevision: null, resultRevision: null },
    qualityLease: { owner: 'u', auth: useAuthStore.getState().generation, entry: 2, token: 1 } });
  vi.mocked(getScatter).mockResolvedValue({ ...response('VIC'), points: [{ well: 'A1', sample_name: null,
    raw_fam: 0, raw_allele2: 0, raw_rox: null, norm_fam: 0, norm_allele2: 0, auto_cluster: null, manual_type: 'Omit' }] });
  vi.mocked(Plotly.newPlot).mockImplementation(async node => { Object.assign(node, { on: vi.fn() }); });
  const view = render(<ScatterPlot />);
  await waitFor(() => expect(view.container.querySelector('#scatter-plot')).toHaveAttribute('data-visible-wells', '1'));
  act(() => useNavigationStore.getState().setQualityTarget(null));
  await waitFor(() => expect(view.container.querySelector('#scatter-plot')).toHaveAttribute('data-visible-wells', '0'));
  expect(useSettingsStore.getState().useRox).toBe(false);
  expect(useSelectionStore.getState().selectedGroup).toBe('other');
  expect(useDataStore.getState().wellTypeAssignments.A1).toBe('Omit');
});

beforeEach(() => {
  vi.clearAllMocks();
  useAnalysisStore.getState().clear();
  useAuthStore.setState({ user: null });
  useSessionStore.setState({ sessionId: 'run-a', wellGroups: null });
  useSelectionStore.setState({ currentCycle: 1, selectedGroup: null, selectedWells: [], focusSelectedWells: false });
  useDataStore.setState({ scatterPoints: [], wellTypeAssignments: {} });
  useNavigationStore.setState({ qualityTarget: null, qualityLease: null, qualityNavigating: false });
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
it.each(['revision', 'entry', 'owner'] as const)('does not publish a delayed Plotly render after %s identity drift', async (drift) => {
  const rendered = deferred<void>();
  vi.mocked(getScatter).mockResolvedValue({ ...response('VIC'), points: [{ well: 'A1', sample_name: null, raw_fam: 1, raw_allele2: 2, raw_rox: null, norm_fam: 1, norm_allele2: 2, auto_cluster: null, manual_type: null }] });
  useAnalysisStore.getState().setSession('run-a', 'u');
  useAnalysisStore.setState({ result: { algorithm: 'auto', cycle: 1, assignments: {}, analysis_context: { result_revision: 'rev-a' } } as never });
  useAuthStore.setState({ user: { id: 'u', username: 'u', display_name: 'U', role: 'user' } });
  vi.mocked(Plotly.newPlot).mockImplementationOnce((node) => {
    Object.assign(node, { on: vi.fn() });
    return rendered.promise;
  });
  render(<ScatterPlot />);
  await waitFor(() => expect(Plotly.newPlot).toHaveBeenCalled());
  if (drift === 'revision') useAnalysisStore.setState({ result: { algorithm: 'auto', cycle: 1, assignments: {}, analysis_context: { result_revision: 'rev-b' } } as never });
  if (drift === 'entry') useSessionStore.setState({ entryGeneration: useSessionStore.getState().entryGeneration + 1 });
  if (drift === 'owner') useAuthStore.setState({ user: { id: 'other', username: 'other', display_name: 'Other', role: 'user' } });
  await act(async () => rendered.resolve());
  expect(getActiveChart('run-a', 'rev-a')).toBeNull();
});
it('publishes a new immutable export generation when selected-only changes the rendered wells', async () => {
  const points = ['A1', 'A2'].map((well, index) => ({ well, sample_name: null, raw_fam: index + 1,
    raw_allele2: 2, raw_rox: null, norm_fam: index + 1, norm_allele2: 2, auto_cluster: null, manual_type: null }));
  useDataStore.setState({ plateWells: points.map((point, index) => ({ ...point, row: 0, col: index + 1, ratio: null })) });
  useAnalysisStore.getState().setSession('run-a', 'u');
  useAnalysisStore.setState({ result: { algorithm: 'auto', cycle: 1, assignments: {}, analysis_context: { result_revision: 'rev-a' } } as never });
  useAuthStore.setState({ user: { id: 'u', username: 'u', display_name: 'U', role: 'user' } });
  vi.mocked(getScatter).mockResolvedValue({ ...response('VIC'), points });
  vi.mocked(Plotly.newPlot).mockImplementation(async node => { Object.assign(node, { on: vi.fn() }); });
  vi.mocked(Plotly.react).mockResolvedValue(undefined);
  render(<ScatterPlot />);
  await waitFor(() => expect(getActiveChart('run-a', 'rev-a')).not.toBeNull());
  const first = getActiveChart('run-a', 'rev-a')!;
  act(() => useSelectionStore.setState({ selectedWells: ['A1'], focusSelectedWells: true }));
  await waitFor(() => expect(getActiveChart('run-a', 'rev-a')?.identity).not.toBe(first.identity));
  expect(getActiveChart('run-a', 'rev-a')?.caption).toContain('visible wells A1');
  expect(getActiveChart('run-a', 'rev-a')?.caption).not.toContain('A2');
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
