import { act, render, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import Plotly from 'plotly.js-dist-min';
import { MarkerScatterPlot } from './MarkerScatterPlot';
import { getActiveChart } from '@/lib/chart-export-registry';
import { useAnalysisStore } from '@/stores/analysis-store';
import { useSessionStore } from '@/stores/session-store';
import { useAuthStore } from '@/stores/auth-store';
import { useNavigationStore } from '@/stores/navigation-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useSelectionStore } from '@/stores/selection-store';
import { useDataStore } from '@/stores/data-store';

vi.mock('plotly.js-dist-min', () => ({ default: { newPlot: vi.fn(), react: vi.fn(), purge: vi.fn() } }));
vi.mock('./ScatterViewControls', () => ({ ScatterViewControls: () => null }));

const marker = { id: 'm1', name: 'M1', wells: ['A1'], ploidy: 2 };
const point = { well: 'A1', sample_name: null, raw_fam: 1, raw_allele2: 2, raw_rox: null, norm_fam: 1, norm_allele2: 2, auto_cluster: null, manual_type: null };
const point2 = { ...point, well: 'A2', raw_fam: 2, norm_fam: 2 };

beforeEach(() => {
  vi.clearAllMocks();
  useSessionStore.setState({ sessionId: 'run-a', entryGeneration: 3 });
  useAuthStore.setState({ user: { id: 'u', username: 'u', display_name: 'U', role: 'user' } });
  useNavigationStore.setState({ cycle: 20 });
  useSettingsStore.setState({ useRox: false, backgroundMode: 'none' });
  useSelectionStore.setState({ selectedWells: [], focusSelectedWells: false });
  useAnalysisStore.setState({ result: { algorithm: 'auto', cycle: 20, assignments: {}, analysis_context: { result_revision: 'rev-a' } } as never });
  vi.mocked(Plotly.newPlot).mockImplementation(async node => { Object.assign(node, { on: vi.fn() }); });
});

it('publishes the scoped marker identity only after Plotly completes and clears it on unmount', async () => {
  const view = render(<MarkerScatterPlot sessionId="run-a" marker={marker} region={undefined} points={[point]} scatterProvenance={{ cycle: 20, useRox: false, backgroundMode: 'none' }} onBoundariesPersisted={vi.fn()} />);
  await waitFor(() => expect(getActiveChart('run-a', 'rev-a')).toMatchObject({ cycle: 20, useRox: false, backgroundMode: 'none', ownerId: 'u' }));
  expect(getActiveChart('run-a', 'rev-a')?.caption).toContain('A1');
  view.unmount();
  expect(getActiveChart('run-a', 'rev-a')).toBeNull();
});

it('does not publish a delayed marker render after owner or revision changes', async () => {
  let resolve!: () => void;
  vi.mocked(Plotly.newPlot).mockImplementationOnce(node => { Object.assign(node, { on: vi.fn() }); return new Promise<void>(done => { resolve = done; }); });
  render(<MarkerScatterPlot sessionId="run-a" marker={marker} region={undefined} points={[point]} scatterProvenance={{ cycle: 20, useRox: false, backgroundMode: 'none' }} onBoundariesPersisted={vi.fn()} />);
  await waitFor(() => expect(Plotly.newPlot).toHaveBeenCalled());
  useAuthStore.setState({ user: { id: 'other', username: 'other', display_name: 'Other', role: 'user' } });
  act(() => resolve());
  await waitFor(() => expect(getActiveChart('run-a', 'rev-a')).toBeNull());
});

it('uses a fresh marker render identity when selected-only changes its scoped pixels', async () => {
  vi.mocked(Plotly.react).mockResolvedValue(undefined);
  render(<MarkerScatterPlot sessionId="run-a" marker={{ ...marker, wells: ['A1', 'A2'] }} region={undefined}
    points={[point, point2]} scatterProvenance={{ cycle: 20, useRox: false, backgroundMode: 'none' }} onBoundariesPersisted={vi.fn()} />);
  await waitFor(() => expect(getActiveChart('run-a', 'rev-a')).not.toBeNull());
  const first = getActiveChart('run-a', 'rev-a')!;
  act(() => useSelectionStore.setState({ selectedWells: ['A1'], focusSelectedWells: true }));
  await waitFor(() => expect(getActiveChart('run-a', 'rev-a')?.identity).not.toBe(first.identity));
  expect(getActiveChart('run-a', 'rev-a')?.caption).toContain('visible wells A1');
  expect(getActiveChart('run-a', 'rev-a')?.caption).not.toContain('A2');
});
it('temporarily includes an existing scoped Omit point in pixels and caption but never an outside-marker target', async () => {
  useSessionStore.setState({ wellGroups: { other: ['B1'] } });
  useSelectionStore.setState({ selectedGroup: 'other', selectedWells: ['B1'], focusSelectedWells: true });
  useDataStore.setState({ wellTypeAssignments: { A1: 'Omit' } });
  useNavigationStore.setState({ qualityTarget: { session: 'run-a', well: 'A1', source: 'curve', basis: 'unversioned',
    cycle: 20, useRox: false, marker: 'm1', inputRevision: null, resultRevision: null },
    qualityLease: { owner: 'u', auth: useAuthStore.getState().generation, entry: 3, token: 1 } });
  const view = render(<MarkerScatterPlot sessionId="run-a" marker={marker} region={undefined}
    points={[{ ...point, manual_type: 'Omit' }, point2]} scatterProvenance={{ cycle: 20, useRox: false, backgroundMode: 'none' }} onBoundariesPersisted={vi.fn()} />);
  await waitFor(() => expect(getActiveChart('run-a', 'rev-a')?.caption).toContain('visible wells A1'));
  expect(view.container.querySelector('[data-visible-wells]')).toHaveAttribute('data-visible-wells', '1');
  act(() => useNavigationStore.getState().setQualityTarget(null));
  await waitFor(() => expect(view.container.querySelector('[data-visible-wells]')).toHaveAttribute('data-visible-wells', '0'));
  expect(useSelectionStore.getState().selectedGroup).toBe('other');
  expect(useDataStore.getState().wellTypeAssignments.A1).toBe('Omit');
});
