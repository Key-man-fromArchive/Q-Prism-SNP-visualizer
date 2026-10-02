import { render, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import Plotly from 'plotly.js-dist-min';
import { MarkerScatterPlot } from './MarkerScatterPlot';
import { useAnalysisStore } from '@/stores/analysis-store';
import { useAuthStore } from '@/stores/auth-store';
import { useLanguageStore } from '@/stores/language-store';
import { useSessionStore } from '@/stores/session-store';
import { useSettingsStore } from '@/stores/settings-store';

vi.mock('plotly.js-dist-min', () => ({
  default: { newPlot: vi.fn(), react: vi.fn(), purge: vi.fn(), restyle: vi.fn(), Plots: { resize: vi.fn() } },
}));
vi.mock('./ScatterViewControls', () => ({ ScatterViewControls: () => null }));

const marker = { id: 'm1', name: 'M1', wells: ['A1', 'A2', 'A3'], ploidy: 2 };
const point = (well: string, fam: number) => ({ well, sample_name: null, raw_fam: 1, raw_allele2: 2, raw_rox: null,
  norm_fam: fam, norm_allele2: 50, auto_cluster: null, manual_type: null });
type Trace = { name?: string; marker?: { size?: number | number[] }; customdata?: string[] };

beforeEach(() => {
  vi.clearAllMocks();
  useLanguageStore.getState().setLanguage('en');
  useSessionStore.setState({ sessionId: 'run-a', entryGeneration: 1 });
  useAuthStore.setState({ user: { id: 'u', username: 'u', display_name: 'U', role: 'user' } });
  useSettingsStore.getState().resetToDefaults();
  vi.mocked(Plotly.newPlot).mockImplementation(async (node) => { Object.assign(node, { on: vi.fn() }); });
  useAnalysisStore.setState({ result: { algorithm: 'auto', cycle: 1, assignments: {}, amplification_qc: {
    enabled: true, available: true, fraction: 1 / 3, fam_threshold: 1.2, allele2_threshold: 0.1, source: 'auto',
    baseline_cycle: 0, read_cycle: 1, no_amplification_wells: ['A2', 'A3'] } } });
});

it('draws flagged wells as their own small grey trace named with the count', async () => {
  render(<MarkerScatterPlot sessionId="run-a" marker={marker}
    region={{ assignments: { A1: 'Heterozygous', A2: 'Undetermined', A3: 'Undetermined' } } as never}
    points={[point('A1', 900), point('A2', 5), point('A3', 6)]}
    scatterProvenance={{ cycle: 1, useRox: false, backgroundMode: 'none' }} onBoundariesPersisted={vi.fn()} />);
  await waitFor(() => expect(Plotly.newPlot).toHaveBeenCalled());
  const traces = vi.mocked(Plotly.newPlot).mock.calls.at(-1)![1] as unknown as Trace[];
  const flagged = traces.find((tr) => tr.name === 'No amplification (n=2)')!;
  expect(flagged.customdata).toEqual(['A2', 'A3']);
  expect(flagged.marker?.size).toEqual([5, 5]);
  expect(traces.some((tr) => tr.name?.startsWith('Undetermined'))).toBe(false);
});
