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

// P4-S1-T1 (FB-04 §3-1): the canvas ratio comes from settings-store rather
// than being fixed, and toggling it must still redraw Plotly at the new
// size -- a dropdown that resizes CSS but leaves the chart at its old
// dimensions would be pointless. `Plots.resize` is exercised directly here
// because jsdom has no layout engine to actually change `clientHeight`/
// `clientWidth` when the CSS custom properties change, so the real resize
// this drives in a browser (via `config.responsive: true`'s own observer,
// left untouched) cannot be observed from this test.
vi.mock('plotly.js-dist-min', () => ({
  default: { newPlot: vi.fn(), react: vi.fn(), purge: vi.fn(), restyle: vi.fn(), Plots: { resize: vi.fn() } },
}));
vi.mock('@/lib/api', () => ({ getScatter: vi.fn(), runClustering: vi.fn() }));
vi.mock('./ScatterViewControls', () => ({ ScatterViewControls: () => null }));

const response = (dye: string): ScatterResponse => ({
  cycle: 1, allele2_dye: dye,
  points: [{ well: 'A1', sample_name: null, raw_fam: 1, raw_allele2: 2, raw_rox: null,
    norm_fam: 1, norm_allele2: 2, auto_cluster: null, manual_type: null }],
});

beforeEach(() => {
  vi.clearAllMocks();
  useAnalysisStore.getState().clear();
  useAuthStore.setState({ user: null });
  useSessionStore.setState({ sessionId: 'run-a', wellGroups: null });
  useSelectionStore.setState({ currentCycle: 1, selectedGroup: null, selectedWells: [], focusSelectedWells: false });
  useDataStore.setState({ scatterPoints: [], wellTypeAssignments: {} });
  useNavigationStore.setState({ qualityTarget: null, qualityLease: null, qualityNavigating: false });
  useSettingsStore.getState().resetToDefaults();
  vi.mocked(getScatter).mockResolvedValue(response('VIC'));
  vi.mocked(Plotly.newPlot).mockImplementation(async (node) => { Object.assign(node, { on: vi.fn() }); });
});

it('renders the canvas at the default 4:3 aspect', async () => {
  const view = render(<ScatterPlot />);
  await waitFor(() => expect(Plotly.newPlot).toHaveBeenCalled());
  const canvas = view.container.querySelector('.analysis-scatter-canvas') as HTMLElement;
  expect(canvas.style.getPropertyValue('--scatter-aspect-w')).toBe('4');
  expect(canvas.style.getPropertyValue('--scatter-aspect-h')).toBe('3');
});

it('switches the canvas to 1:1 when scatterAspect changes', async () => {
  const view = render(<ScatterPlot />);
  await waitFor(() => expect(Plotly.newPlot).toHaveBeenCalled());
  act(() => useSettingsStore.getState().setScatterAspect('1:1'));
  const canvas = view.container.querySelector('.analysis-scatter-canvas') as HTMLElement;
  await waitFor(() => {
    expect(canvas.style.getPropertyValue('--scatter-aspect-w')).toBe('1');
    expect(canvas.style.getPropertyValue('--scatter-aspect-h')).toBe('1');
  });
});

it('forces a Plotly resize after the initial mount when the aspect toggles', async () => {
  render(<ScatterPlot />);
  await waitFor(() => expect(Plotly.newPlot).toHaveBeenCalledTimes(1));
  expect(Plotly.Plots.resize).not.toHaveBeenCalled();
  act(() => useSettingsStore.getState().setScatterAspect('1:1'));
  await waitFor(() => expect(Plotly.Plots.resize).toHaveBeenCalledTimes(1));
  // A plain re-render pass (no aspect change) must not double-fire it.
  act(() => useSettingsStore.getState().setScatterAspect('1:1'));
  expect(Plotly.Plots.resize).toHaveBeenCalledTimes(1);
});

it('does not force a resize before the initial Plotly.newPlot has resolved', () => {
  vi.mocked(Plotly.newPlot).mockImplementation(() => new Promise(() => {})); // never resolves
  render(<ScatterPlot />);
  act(() => useSettingsStore.getState().setScatterAspect('1:1'));
  expect(Plotly.Plots.resize).not.toHaveBeenCalled();
});
