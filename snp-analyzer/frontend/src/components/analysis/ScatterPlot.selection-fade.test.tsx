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

// P33 (feedback 2b979980): Plotly fades every UNSELECTED point to 20%
// (DESELECTDIM) the moment a box selection exists, and `uirevision` keeps
// that selection -- and therefore the fade -- alive across every re-render.
// In threshold-edit mode dragmode is "zoom", so Plotly's own double-click
// resets the axes and fires no deselect: the operator had no gesture left
// that put the plate back. The fade is off for good here, and double-click
// clears the selection in either tool.
vi.mock('plotly.js-dist-min', () => ({
  default: { newPlot: vi.fn(), react: vi.fn(), purge: vi.fn(), restyle: vi.fn(), relayout: vi.fn(), Plots: { resize: vi.fn() } },
}));
vi.mock('@/lib/api', () => ({ getScatter: vi.fn(), runClustering: vi.fn() }));
vi.mock('./ScatterViewControls', () => ({ ScatterViewControls: () => null }));

const response: ScatterResponse = {
  cycle: 1, allele2_dye: 'VIC',
  points: [
    { well: 'A1', sample_name: null, raw_fam: 1, raw_allele2: 2, raw_rox: null,
      norm_fam: 1, norm_allele2: 2, auto_cluster: 'Heterozygous', manual_type: null },
    { well: 'E12', sample_name: null, raw_fam: 0, raw_allele2: 0, raw_rox: null,
      norm_fam: 0, norm_allele2: 0, auto_cluster: 'NTC', manual_type: null },
  ],
};

type Handlers = Record<string, () => void>;
let handlers: Handlers;
/** A graph div that already carries a drawn selection rectangle. */
let selections: unknown[];
/** Plotly's per-trace record of the box that was dragged -- what drives the
 *  fade in the build this app ships (`layout.selections` stays empty there). */
let selectedpoints: number[] | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  handlers = {};
  selections = [];
  selectedpoints = undefined;
  useAnalysisStore.getState().clear();
  useAuthStore.setState({ user: null });
  useSessionStore.setState({ sessionId: 'run-a', wellGroups: null });
  useSelectionStore.setState({ currentCycle: 1, selectedGroup: null, selectedWells: [], focusSelectedWells: false });
  useDataStore.setState({
    scatterPoints: [],
    wellTypeAssignments: {},
    // useWellFilter() hides any well without a plate row, so the points the
    // fetch returns are only drawn if the plate knows about them.
    plateWells: response.points.map((point, index) => ({
      well: point.well, row: 0, col: index + 1, norm_fam: point.norm_fam, norm_allele2: point.norm_allele2,
      ratio: null, sample_name: null, auto_cluster: point.auto_cluster, manual_type: null,
    })),
  });
  useNavigationStore.setState({ qualityTarget: null, qualityLease: null, qualityNavigating: false });
  useSettingsStore.getState().resetToDefaults();
  vi.mocked(getScatter).mockResolvedValue(response);
  vi.mocked(Plotly.newPlot).mockImplementation(async (node) => {
    Object.assign(node, {
      on: (event: string, callback: () => void) => { handlers[event] = callback; },
      layout: { get selections() { return selections; } },
      get data() { return [{ get selectedpoints() { return selectedpoints; } }]; },
    });
  });
});

async function mounted() {
  const view = render(<ScatterPlot />);
  await waitFor(() => expect(Plotly.newPlot).toHaveBeenCalled());
  await waitFor(() => expect(handlers.plotly_doubleclick).toBeTypeOf('function'));
  return view;
}

type OpacityTrace = Record<string, { marker?: { opacity?: number } }>;
/** The traces of the most recent draw: the first mount draws before the
 *  points have arrived, so only the last call carries the genotype traces. */
function latestTraces(): OpacityTrace[] {
  const draws = [...vi.mocked(Plotly.newPlot).mock.calls, ...vi.mocked(Plotly.react).mock.calls];
  return draws[draws.length - 1][1] as OpacityTrace[];
}

it('keeps every trace opaque in both selection states, so a box selection never fades the plate', async () => {
  await mounted();
  await waitFor(() => expect(latestTraces().length).toBeGreaterThan(1));
  const traces = latestTraces();
  for (const trace of traces) {
    expect(trace.unselected?.marker?.opacity).toBe(1);
    expect(trace.selected?.marker?.opacity).toBe(1);
  }
});

it('clears the selection on double-click in threshold-edit mode, where Plotly fires no deselect', async () => {
  act(() => useSettingsStore.getState().setScatterTool('edit'));
  await mounted();
  act(() => useSelectionStore.getState().selectWells(['A1', 'E12']));
  selections = [{ type: 'rect' }];
  selectedpoints = [0, 1];

  act(() => handlers.plotly_doubleclick());

  expect(useSelectionStore.getState().selectedWells).toEqual([]);
  expect(Plotly.restyle).toHaveBeenCalledWith(expect.anything(), { selectedpoints: null });
  expect(Plotly.relayout).toHaveBeenCalledWith(expect.anything(), { selections: [] });
});

it('leaves the double-click to the boundary rays while those are armed', async () => {
  act(() => {
    useSettingsStore.getState().setScatterTool('edit');
    useSettingsStore.getState().setShowManualTypes(true);
    useSettingsStore.getState().setShowBoundaryLines(true);
  });
  await mounted();
  act(() => useSelectionStore.getState().selectWells(['A1']));

  act(() => handlers.plotly_doubleclick());

  // Double-click there means "delete this ray / add one here"; wiping the
  // well selection as a side effect of editing a boundary would be a
  // different, unasked-for edit.
  expect(useSelectionStore.getState().selectedWells).toEqual(['A1']);
});

it("drops Plotly's leftover selection when the tool changes, keeping the wells selected", async () => {
  await mounted();
  act(() => useSelectionStore.getState().selectWells(['A1']));
  selections = [{ type: 'rect' }];
  selectedpoints = [0];

  act(() => useSettingsStore.getState().setScatterTool('edit'));

  await waitFor(() => expect(Plotly.restyle).toHaveBeenCalledWith(expect.anything(), { selectedpoints: null }));
  expect(Plotly.relayout).toHaveBeenCalledWith(expect.anything(), { selections: [] });
  expect(useSelectionStore.getState().selectedWells).toEqual(['A1']);
});

it('leaves Plotly alone when there is no selection to drop', async () => {
  await mounted();
  vi.mocked(Plotly.relayout).mockClear();
  vi.mocked(Plotly.restyle).mockClear();

  act(() => useSettingsStore.getState().setScatterTool('edit'));

  expect(Plotly.relayout).not.toHaveBeenCalled();
  expect(Plotly.restyle).not.toHaveBeenCalledWith(expect.anything(), { selectedpoints: null });
});
