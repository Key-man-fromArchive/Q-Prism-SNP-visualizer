import { act, render, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import Plotly from 'plotly.js-dist-min';
import { ScatterPlot } from './ScatterPlot';
import { getScatter } from '@/lib/api';
import { useAnalysisStore } from '@/stores/analysis-store';
import { useSessionStore } from '@/stores/session-store';
import { useSelectionStore } from '@/stores/selection-store';
import { useDataStore } from '@/stores/data-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useAuthStore } from '@/stores/auth-store';
import { useNavigationStore } from '@/stores/navigation-store';
import type { ScatterResponse } from '@/types/api';

vi.mock('plotly.js-dist-min', () => ({
  default: { newPlot: vi.fn(), react: vi.fn(), purge: vi.fn(), restyle: vi.fn(), relayout: vi.fn(), Plots: { resize: vi.fn() } },
}));
vi.mock('@/lib/api', () => ({ getScatter: vi.fn(), runClustering: vi.fn() }));
vi.mock('./ScatterViewControls', () => ({ ScatterViewControls: () => null }));

const response: ScatterResponse = {
  cycle: 1, allele2_dye: 'VIC',
  points: [{ well: 'A1', sample_name: null, raw_fam: 1, raw_allele2: 2, raw_rox: null,
    norm_fam: 100, norm_allele2: 20, auto_cluster: null, manual_type: null }],
};

beforeEach(() => {
  vi.clearAllMocks();
  useAnalysisStore.getState().clear();
  useAuthStore.setState({ user: null });
  useSessionStore.setState({ sessionId: 'run-a', wellGroups: null });
  useSelectionStore.setState({ currentCycle: 1, selectedGroup: null, selectedWells: [], focusSelectedWells: false });
  useDataStore.setState({ scatterPoints: [], wellTypeAssignments: {}, plateWells: [{ well: 'A1' }] as never });
  useNavigationStore.setState({ qualityTarget: null, qualityLease: null, qualityNavigating: false });
  useSettingsStore.getState().resetToDefaults();
  vi.mocked(getScatter).mockResolvedValue(response);
  vi.mocked(Plotly.newPlot).mockImplementation(async (node) => { Object.assign(node, { on: vi.fn() }); });
  vi.mocked(Plotly.react).mockResolvedValue(undefined as never);
});

type Call = [unknown, Array<{ x: number[]; y: number[]; uid?: string }>, { xaxis: { title: { text: string } }; yaxis: { title: { text: string } } }];
const lastRender = (): Call => {
  const calls = [...vi.mocked(Plotly.newPlot).mock.calls, ...vi.mocked(Plotly.react).mock.calls];
  return calls[calls.length - 1] as unknown as Call;
};

it('plots FAM on x and VIC on y by default', async () => {
  render(<ScatterPlot />);
  await waitFor(() => expect(Plotly.newPlot).toHaveBeenCalled());
  const [, traces, layout] = lastRender();
  expect(layout.xaxis.title.text).toContain('FAM');
  expect(layout.yaxis.title.text).toContain('VIC');
  expect(traces[0].x).toEqual([100]);
  expect(traces[0].y).toEqual([20]);
});

it('swaps points, axis titles and the NTC corner when scatterOrientation is allele2_x', async () => {
  useSettingsStore.getState().setScatterOrientation('allele2_x');
  render(<ScatterPlot />);
  await waitFor(() => expect(Plotly.newPlot).toHaveBeenCalled());
  const [, traces, layout] = lastRender();
  expect(layout.xaxis.title.text).toContain('VIC');
  expect(layout.yaxis.title.text).toContain('FAM');
  expect(traces[0].x).toEqual([20]);
  expect(traces[0].y).toEqual([100]);
  const corner = traces.find((t) => t.uid === 'ntc-threshold')!;
  expect(corner.x[0]).toBeLessThan(corner.y[0]); // allele2 corner (small) on x, fam (large) on y
});

it('re-renders with swapped axes when the option is toggled', async () => {
  render(<ScatterPlot />);
  await waitFor(() => expect(Plotly.newPlot).toHaveBeenCalled());
  await waitFor(() => expect(lastRender()[2].xaxis.title.text).toContain('FAM'));
  act(() => useSettingsStore.getState().setScatterOrientation('allele2_x'));
  await waitFor(() => expect(lastRender()[2].xaxis.title.text).toContain('VIC'));
});
