import { render, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import Plotly from 'plotly.js-dist-min';
import { MarkerScatterPlot } from './MarkerScatterPlot';
import { useSessionStore } from '@/stores/session-store';
import { useAuthStore } from '@/stores/auth-store';
import { useSettingsStore } from '@/stores/settings-store';

// Chart text shows names exactly as written: markup characters and template
// placeholders in sample names and allele labels are not interpreted.
vi.mock('plotly.js-dist-min', () => ({
  default: { newPlot: vi.fn(), react: vi.fn(), purge: vi.fn(), restyle: vi.fn(), Plots: { resize: vi.fn() } },
}));
vi.mock('./ScatterViewControls', () => ({ ScatterViewControls: () => null }));

const marker = { id: 'm1', name: 'M1', wells: ['A1'], ploidy: 2, allele_labels: { fam: 'W<T', allele2: 'M&T' } };
const points = [
  { well: 'A1', sample_name: '<b>x</b> %{y}', raw_fam: 1, raw_allele2: 2, raw_rox: null, norm_fam: 1000, norm_allele2: 2000, auto_cluster: null, manual_type: null },
];

type Trace = { name?: string; text?: string[] };
type Layout = { xaxis: { title: { text: string } }; yaxis: { title: { text: string } } };

beforeEach(() => {
  vi.clearAllMocks();
  useSessionStore.setState({ sessionId: 'run-a', entryGeneration: 3 });
  useAuthStore.setState({ user: { id: 'u', username: 'u', display_name: 'U', role: 'user' } });
  useSettingsStore.getState().resetToDefaults();
  vi.mocked(Plotly.newPlot).mockImplementation(async (node) => { Object.assign(node, { on: vi.fn() }); });
});

it('shows sample names, allele labels and axis titles literally', async () => {
  render(<MarkerScatterPlot sessionId="run-a" marker={marker} region={{ assignments: { A1: 'Heterozygous' } } as never}
    points={points} scatterProvenance={{ cycle: 1, useRox: false, backgroundMode: 'none' }}
    onBoundariesPersisted={vi.fn()} />);
  await waitFor(() => expect(Plotly.newPlot).toHaveBeenCalled());
  const [traces, layout] = vi.mocked(Plotly.newPlot).mock.calls.at(-1)!.slice(1) as unknown as [Trace[], Layout];
  const data = traces.find((t) => t.text?.length)!;
  expect(data.text![0]).toContain('(&lt;b&gt;x&lt;/b&gt; &#37;{y})');
  expect(data.text![0]).not.toContain('<b>x</b>');
  expect(data.name).toContain('W&lt;T');
  expect(data.name).toContain('M&amp;T');
  expect(`${layout.xaxis.title.text}${layout.yaxis.title.text}`).toContain('W&lt;T');
});
