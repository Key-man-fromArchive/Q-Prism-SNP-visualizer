import { render, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import Plotly from 'plotly.js-dist-min';
import { MarkerScatterPlot } from './MarkerScatterPlot';
import { useSessionStore } from '@/stores/session-store';
import { useAuthStore } from '@/stores/auth-store';
import { useSettingsStore } from '@/stores/settings-store';

vi.mock('plotly.js-dist-min', () => ({
  default: { newPlot: vi.fn(), react: vi.fn(), purge: vi.fn(), restyle: vi.fn(), relayout: vi.fn(), Plots: { resize: vi.fn() } },
}));
vi.mock('./ScatterViewControls', () => ({ ScatterViewControls: () => null }));

const marker = { id: 'm1', name: 'M1', wells: ['A1'], ploidy: 2, allele_labels: { fam: 'WT', allele2: 'MT' } };
const point = { well: 'A1', sample_name: null, raw_fam: 1, raw_allele2: 2, raw_rox: null,
  norm_fam: 100, norm_allele2: 20, auto_cluster: null, manual_type: null };

beforeEach(() => {
  vi.clearAllMocks();
  useSessionStore.setState({ sessionId: 'run-a', entryGeneration: 3 });
  useAuthStore.setState({ user: { id: 'u', username: 'u', display_name: 'U', role: 'user' } });
  useSettingsStore.getState().resetToDefaults();
  vi.mocked(Plotly.newPlot).mockImplementation(async (node) => { Object.assign(node, { on: vi.fn() }); });
});

type Call = [unknown, Array<{ x: number[]; y: number[]; customdata?: string[] }>, { xaxis: { title: { text: string } }; yaxis: { title: { text: string } } }];

async function plotted(): Promise<Call> {
  render(<MarkerScatterPlot sessionId="run-a" marker={marker} region={undefined}
    points={[point]} scatterProvenance={{ cycle: 1, useRox: false, backgroundMode: 'none' }}
    allele2Dye="VIC" onBoundariesPersisted={vi.fn()} />);
  await waitFor(() => expect(Plotly.newPlot).toHaveBeenCalled());
  return vi.mocked(Plotly.newPlot).mock.calls[0] as unknown as Call;
}

it('keeps FAM on x and the allele-2 dye on y by default', async () => {
  const [, traces, layout] = await plotted();
  const points = traces.find((trace) => trace.customdata)!;
  expect([points.x, points.y]).toEqual([[100], [20]]);
  expect(layout.xaxis.title.text).toContain('WT');
  expect(layout.yaxis.title.text).toContain('MT');
});

it('swaps the points and the allele-named axis titles when scatterOrientation is allele2_x', async () => {
  useSettingsStore.getState().setScatterOrientation('allele2_x');
  const [, traces, layout] = await plotted();
  const points = traces.find((trace) => trace.customdata)!;
  expect([points.x, points.y]).toEqual([[20], [100]]);
  expect(layout.xaxis.title.text).toContain('MT');
  expect(layout.yaxis.title.text).toContain('WT');
});
