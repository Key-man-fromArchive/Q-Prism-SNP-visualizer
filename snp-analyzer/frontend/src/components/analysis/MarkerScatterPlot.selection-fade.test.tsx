import { act, render, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import Plotly from 'plotly.js-dist-min';
import { MarkerScatterPlot } from './MarkerScatterPlot';
import { useSessionStore } from '@/stores/session-store';
import { useAuthStore } from '@/stores/auth-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useSelectionStore } from '@/stores/selection-store';

// P33 (feedback 2b979980): same contract as ScatterPlot.selection-fade.test.tsx
// for the per-marker plot -- Plotly's 20% fade of every unselected point is off
// for good, and a double-click clears the selection in either tool (this plot
// has no boundary double-click gesture of its own to protect).
vi.mock('plotly.js-dist-min', () => ({
  default: { newPlot: vi.fn(), react: vi.fn(), purge: vi.fn(), restyle: vi.fn(), relayout: vi.fn(), Plots: { resize: vi.fn() } },
}));
vi.mock('./ScatterViewControls', () => ({ ScatterViewControls: () => null }));

const marker = { id: 'm1', name: 'M1', wells: ['A1', 'A2'], ploidy: 2 };
const points = [
  { well: 'A1', sample_name: null, raw_fam: 1, raw_allele2: 2, raw_rox: null,
    norm_fam: 1, norm_allele2: 2, auto_cluster: 'Heterozygous', manual_type: null },
  { well: 'A2', sample_name: null, raw_fam: 0, raw_allele2: 0, raw_rox: null,
    norm_fam: 0, norm_allele2: 0, auto_cluster: 'NTC', manual_type: null },
];

let handlers: Record<string, () => void>;
let selections: unknown[];
let selectedpoints: number[] | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  handlers = {};
  selections = [];
  selectedpoints = undefined;
  useSessionStore.setState({ sessionId: 'run-a', entryGeneration: 3 });
  useAuthStore.setState({ user: { id: 'u', username: 'u', display_name: 'U', role: 'user' } });
  useSelectionStore.setState({ selectedWells: [], selectedGroup: null });
  useSettingsStore.getState().resetToDefaults();
  vi.mocked(Plotly.newPlot).mockImplementation(async (node) => {
    Object.assign(node, {
      on: (event: string, callback: () => void) => { handlers[event] = callback; },
      layout: { get selections() { return selections; } },
      get data() { return [{ get selectedpoints() { return selectedpoints; } }]; },
    });
  });
});

async function mounted() {
  const view = render(<MarkerScatterPlot sessionId="run-a" marker={marker} region={undefined}
    points={points} scatterProvenance={{ cycle: 1, useRox: false, backgroundMode: 'none' }}
    onBoundariesPersisted={vi.fn()} />);
  await waitFor(() => expect(handlers.plotly_doubleclick).toBeTypeOf('function'));
  return view;
}

it('keeps every trace opaque in both selection states', async () => {
  await mounted();
  const traces = vi.mocked(Plotly.newPlot).mock.calls[0][1] as Array<Record<string, { marker?: { opacity?: number } }>>;
  expect(traces.length).toBeGreaterThan(1);
  for (const trace of traces) {
    expect(trace.unselected?.marker?.opacity).toBe(1);
    expect(trace.selected?.marker?.opacity).toBe(1);
  }
});

it('clears the selection on double-click, which Plotly does not do in threshold-edit mode', async () => {
  act(() => useSettingsStore.getState().setScatterTool('edit'));
  await mounted();
  act(() => useSelectionStore.getState().selectWells(['A1', 'A2']));
  selections = [{ type: 'rect' }];
  selectedpoints = [0, 1];

  act(() => handlers.plotly_doubleclick());

  expect(useSelectionStore.getState().selectedWells).toEqual([]);
  expect(Plotly.restyle).toHaveBeenCalledWith(expect.anything(), { selectedpoints: null });
  expect(Plotly.relayout).toHaveBeenCalledWith(expect.anything(), { selections: [] });
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
