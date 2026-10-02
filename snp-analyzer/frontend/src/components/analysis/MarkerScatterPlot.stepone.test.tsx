import { render, waitFor } from '@testing-library/react';
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
import { useLanguageStore } from '@/stores/language-store';

vi.mock('plotly.js-dist-min', () => ({ default: { newPlot: vi.fn(), react: vi.fn(), purge: vi.fn() } }));
vi.mock('./ScatterViewControls', () => ({ ScatterViewControls: () => null }));

const point = { well: 'A1', sample_name: null, raw_fam: 1, raw_allele2: 2, raw_rox: null, norm_fam: 1, norm_allele2: 2, auto_cluster: null, manual_type: 'Heterozygous' };
const named = { id: 'm1', name: 'QPrism1', wells: ['A1'], ploidy: 2, allele_labels: { fam: 'WT', allele2: 'MT' } };
const plain = { ...named, allele_labels: null };
const readLabels = { 2: { stage: 'amplification', pcr_cycle: 36, temperature: 40 }, 3: { stage: 'amplification', pcr_cycle: 37, temperature: 40 } };

function renderPlot(marker: typeof named | typeof plain) {
  return render(<MarkerScatterPlot sessionId="run-a" marker={marker as never}
    region={{ ...marker, assignments: { A1: 'Heterozygous' }, offset: 0, offset_uncertain: false, low_separation: false } as never} points={[point]} allele2Dye="VIC"
    scatterProvenance={{ cycle: 2, useRox: true, backgroundMode: 'none' }} onBoundariesPersisted={vi.fn()} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  useLanguageStore.getState().setLanguage('en');
  useSessionStore.setState({ sessionId: 'run-a', entryGeneration: 3, sessionInfo: {
    session_id: 'run-a', instrument: 'StepOnePlus', allele2_dye: 'VIC', num_cycles: 3, num_wells: 1,
    has_rox: true, data_windows: null, suggested_cycle: 2, well_groups: null, read_labels: readLabels,
  } as never });
  useAuthStore.setState({ user: { id: 'u', username: 'u', display_name: 'U', role: 'user' } });
  useNavigationStore.setState({ cycle: 2 });
  useSettingsStore.setState({ useRox: true, backgroundMode: 'none', axisMode: 'auto', lockAspect: false });
  useSelectionStore.setState({ selectedWells: [], focusSelectedWells: false });
  useDataStore.setState({ wellTypeAssignments: {}, roxOutlierWells: [], normalizationApplied: false, allele2Dye: 'VIC' });
  useAnalysisStore.setState({ result: { algorithm: 'auto', cycle: 2, assignments: {}, analysis_context: { result_revision: 'rev-a' } } as never });
  vi.mocked(Plotly.newPlot).mockImplementation(async node => { Object.assign(node, { on: vi.fn() }); });
});

it('titles the axes with dye and allele name and names legend entries after the alleles', async () => {
  renderPlot(named);
  await waitFor(() => expect(Plotly.newPlot).toHaveBeenCalled());
  const [traces, layout] = vi.mocked(Plotly.newPlot).mock.calls.at(-1)!.slice(1) as [Array<{ name: string }>, { xaxis: { title: { text: string } }; yaxis: { title: { text: string } } }];
  expect(layout.xaxis.title.text).toBe('FAM · WT');
  expect(layout.yaxis.title.text).toBe('VIC · MT');
  expect(traces.map(trace => trace.name)).toContain('WT/MT');
});

it('keeps the existing axis titles and call names without allele names', async () => {
  renderPlot(plain);
  await waitFor(() => expect(Plotly.newPlot).toHaveBeenCalled());
  const [traces, layout] = vi.mocked(Plotly.newPlot).mock.calls.at(-1)!.slice(1) as [Array<{ name: string }>, { xaxis: { title: { text: string } }; yaxis: { title: { text: string } } }];
  expect(layout.xaxis.title.text).toBe('FAM');
  expect(layout.yaxis.title.text).toBe('VIC');
  expect(traces.map(trace => trace.name)).toContain('Heterozygous');
});

it('writes marker, allele names and the cycle label into the PNG caption', async () => {
  renderPlot(named);
  await waitFor(() => expect(getActiveChart('run-a', 'rev-a')).not.toBeNull());
  const caption = getActiveChart('run-a', 'rev-a')!.caption;
  expect(caption).toContain('QPrism1');
  expect(caption).toContain('FAM · WT');
  expect(caption).toContain('VIC · MT');
  expect(caption).toContain('Amplification 1/2 · PCR 36 · 40°C');
});
