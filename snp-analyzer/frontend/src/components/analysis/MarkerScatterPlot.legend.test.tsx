import { render, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import Plotly from 'plotly.js-dist-min';
import { MarkerScatterPlot } from './MarkerScatterPlot';
import { useSessionStore } from '@/stores/session-store';
import { useAuthStore } from '@/stores/auth-store';
import { useSettingsStore } from '@/stores/settings-store';

// P5-A: the NTC quadrant and its dashed edges are drawn only while thresholds
// are edited; at rest the plot keeps a small corner diamond, a quiet boundary
// line style and a legend explaining both.
vi.mock('plotly.js-dist-min', () => ({
  default: { newPlot: vi.fn(), react: vi.fn(), purge: vi.fn(), restyle: vi.fn(), Plots: { resize: vi.fn() } },
}));
vi.mock('./ScatterViewControls', () => ({ ScatterViewControls: () => null }));

const marker = { id: 'm1', name: 'M1', wells: ['A1', 'A2'], ploidy: 2 };
const points = [
  { well: 'A1', sample_name: null, raw_fam: 1, raw_allele2: 2, raw_rox: null, norm_fam: 1000, norm_allele2: 2000, auto_cluster: null, manual_type: null },
  { well: 'A2', sample_name: null, raw_fam: 1, raw_allele2: 2, raw_rox: null, norm_fam: 3000, norm_allele2: 800, auto_cluster: null, manual_type: null },
];

type Trace = { name?: string; uid?: string; showlegend?: boolean; marker?: { size?: number | number[] }; line?: { width?: number } };
type Shape = { type: string; line?: { width?: number; color?: string } };

beforeEach(() => {
  vi.clearAllMocks();
  useSessionStore.setState({ sessionId: 'run-a', entryGeneration: 3 });
  useAuthStore.setState({ user: { id: 'u', username: 'u', display_name: 'U', role: 'user' } });
  useSettingsStore.getState().resetToDefaults();
  useSettingsStore.setState({ expertMode: false });
  vi.mocked(Plotly.newPlot).mockImplementation(async (node) => { Object.assign(node, { on: vi.fn() }); });
});

async function plotted() {
  render(<MarkerScatterPlot sessionId="run-a" marker={marker} region={{ assignments: { A1: 'Heterozygous', A2: 'Heterozygous' } } as never}
    points={points} scatterProvenance={{ cycle: 1, useRox: false, backgroundMode: 'none' }}
    onBoundariesPersisted={vi.fn()} />);
  await waitFor(() => expect(Plotly.newPlot).toHaveBeenCalled());
  const [traces, layout] = vi.mocked(Plotly.newPlot).mock.calls.at(-1)!.slice(1) as unknown as [Trace[], { shapes: Shape[]; xaxis: { range: number[] };
    legend: { orientation: string; x: number; y: number; bgcolor: string }; margin: { b: number; t: number } }];
  return { traces, layout };
}

it('draws no quadrant or dashed NTC edges at rest, only a small corner diamond', async () => {
  const { traces, layout } = await plotted();
  expect(layout.shapes.filter((s) => s.type === 'rect')).toHaveLength(0);
  expect(layout.shapes.every((s) => s.line?.color !== '#f59e0b')).toBe(true);
  const corner = traces.find((t) => t.uid === 'ntc-threshold')!;
  expect(corner.marker?.size).toBe(8);
});

it('keeps genotype boundary lines thin and grey at rest', async () => {
  const { layout } = await plotted();
  const cuts = layout.shapes.filter((s) => s.type === 'line');
  expect(cuts.length).toBeGreaterThan(0);
  expect(cuts.every((s) => s.line?.width === 1)).toBe(true);
});

it('shows the quadrant, dashed edges and the large handle while editing thresholds', async () => {
  useSettingsStore.setState({ scatterTool: 'edit' });
  const { traces, layout } = await plotted();
  expect(layout.shapes.filter((s) => s.type === 'rect')).toHaveLength(1);
  expect(layout.shapes.filter((s) => s.line?.color === '#f59e0b')).toHaveLength(2);
  expect(layout.shapes.some((s) => s.line?.width === 2)).toBe(true);
  expect(traces.find((t) => t.uid === 'ntc-threshold')!.marker?.size).toBe(13);
});

it('keeps a compact legend on its own row above the plot area and only lists the call classes', async () => {
  const { traces, layout } = await plotted();
  expect(layout.legend).toMatchObject({ orientation: 'h', xanchor: 'right', yanchor: 'bottom' });
  expect(layout.legend.x).toBeGreaterThan(0.5);
  // At or above the top edge of the plot area, with room reserved for it and the modebar.
  expect(layout.legend.y).toBeGreaterThanOrEqual(1);
  expect(layout.margin.t).toBeGreaterThanOrEqual(48);
  expect(layout.legend.bgcolor).toBeTruthy();
  expect(layout.margin.b).toBeLessThan(80);
  expect(traces.some((t) => t.name?.endsWith(' (n=2)'))).toBe(true);
  expect(traces.find((t) => t.uid === 'ntc-threshold')!.showlegend).toBe(false);
  expect(traces.find((t) => t.uid === 'legend-boundary')!.showlegend).toBe(false);
});

it('lists the call classes with counts plus the figure elements in expert mode', async () => {
  useSettingsStore.getState().setExpertMode(true);
  const { traces } = await plotted();
  expect(traces.some((t) => t.name?.endsWith(' (n=2)'))).toBe(true);
  expect(traces.find((t) => t.uid === 'ntc-threshold')!.showlegend).toBe(true);
  expect(traces.find((t) => t.uid === 'legend-boundary')!.name).toBeTruthy();
});

it('fits the axes to the data without an NTC well instead of reaching for the origin', async () => {
  const { layout } = await plotted();
  expect(layout.xaxis.range[0]).toBeGreaterThan(500);
});

it('keeps the NTC basis when the operator picked it', async () => {
  useSettingsStore.getState().setAxisMode('zero');
  const { layout } = await plotted();
  expect(layout.xaxis.range[0]).toBeLessThan(1000);
});
