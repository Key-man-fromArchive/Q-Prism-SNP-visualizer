// @TASK P2-H2 - allele names in the amplification overlay, fluorescence card and statistics
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import Plotly from 'plotly.js-dist-min';
import { AmplificationOverlay } from './AmplificationOverlay';
import { FluorescenceDataCard } from './FluorescenceDataCard';
import { StatisticsTab } from '@/components/statistics/StatisticsTab';
import { useSessionStore } from '@/stores/session-store';
import { useDataStore } from '@/stores/data-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useLanguageStore } from '@/stores/language-store';

vi.mock('plotly.js-dist-min', () => ({ default: { react: vi.fn(), purge: vi.fn() } }));

const getAllAmplificationMock = vi.fn();
const getStatisticsMock = vi.fn();
const getMarkersMock = vi.fn();
vi.mock('@/lib/api', () => ({
  getAllAmplification: (...a: unknown[]) => getAllAmplificationMock(...a),
  getStatistics: (...a: unknown[]) => getStatisticsMock(...a),
  getMarkers: (...a: unknown[]) => getMarkersMock(...a),
}));

const NAMES = { fam: 'WT', allele2: 'MT' };
type Trace = { name: string };

beforeEach(() => {
  vi.clearAllMocks();
  getAllAmplificationMock.mockResolvedValue({
    allele2_dye: 'VIC', normalization_applied: true, background_mode: 'none',
    curves: [
      { well: 'A1', cycles: [1, 2], norm_fam: [1, 2], norm_allele2: [2, 3], effective_type: 'Allele 1 Homo' },
      { well: 'A2', cycles: [1, 2], norm_fam: [1, 2], norm_allele2: [2, 3], effective_type: 'Heterozygous' },
      { well: 'A3', cycles: [1, 2], norm_fam: [1, 2], norm_allele2: [2, 3], effective_type: 'NTC' },
    ],
  });
  getStatisticsMock.mockResolvedValue({
    allele_frequency: { p: 0.5, q: 0.5, total_genotyped: 4, n_aa: 1, n_ab: 2, n_bb: 1 },
    hwe: { chi2: 0, p_value: 1, expected_aa: 1, expected_ab: 2, expected_bb: 1, in_hwe: true },
    genotype_distribution: { 'Allele 1 Homo': 1, Heterozygous: 2, 'Allele 2 Homo': 1, NTC: 1 },
    total_wells: 5,
  });
  getMarkersMock.mockResolvedValue({ markers: [{ id: 'm1', allele_labels: NAMES }] });
  useSessionStore.setState({
    sessionId: 'synthetic',
    sessionInfo: {
      session_id: 'synthetic', instrument: 'Synthetic', allele2_dye: 'VIC',
      num_cycles: 2, num_wells: 3, has_rox: true,
      data_windows: null, suggested_cycle: null, well_groups: null,
    },
  });
  useDataStore.setState({ wellTypeAssignments: {} });
  useSettingsStore.setState({ useRox: true, backgroundMode: 'none', ploidy: 2 });
  useLanguageStore.setState({ language: 'en' });
});

function legendNames(): string[] {
  const calls = vi.mocked(Plotly.react).mock.calls;
  const traces = calls[calls.length - 1][1] as unknown as Trace[];
  return traces.map((t) => t.name);
}

it('overlay legend shows allele names for diploid calls and keeps NTC', async () => {
  const view = render(<AmplificationOverlay alleleLabels={NAMES} />);
  fireEvent.click(view.container.querySelector('#toggle-overlay-btn')!);
  await waitFor(() => expect(Plotly.react).toHaveBeenCalled());
  expect(legendNames()).toEqual(['WT/WT', 'WT/MT', 'NTC']);
});

it('overlay legend keeps the stored labels without names', async () => {
  const view = render(<AmplificationOverlay />);
  fireEvent.click(view.container.querySelector('#toggle-overlay-btn')!);
  await waitFor(() => expect(Plotly.react).toHaveBeenCalled());
  expect(legendNames()).toEqual(['Allele 1 Homo', 'Heterozygous', 'NTC']);
});

it('fluorescence card legend uses allele names when given', async () => {
  render(<FluorescenceDataCard alleleLabels={NAMES} />);
  fireEvent.click(document.querySelector('#fluorescence-toggle-btn')!);
  await waitFor(() => expect(Plotly.react).toHaveBeenCalled());
  expect(legendNames()).toEqual(['WT/WT', 'WT/MT', 'NTC']);
});

it('statistics table shows names when every marker shares them', async () => {
  render(<StatisticsTab />);
  expect((await screen.findAllByText('WT/MT')).length).toBeGreaterThan(0);
  expect(screen.getAllByText('WT/WT').length).toBeGreaterThan(0);
  expect(screen.queryByText('Heterozygous')).toBeNull();
});

it('statistics table keeps stored labels when markers disagree or lookup fails', async () => {
  getMarkersMock.mockResolvedValue({ markers: [
    { id: 'm1', allele_labels: NAMES },
    { id: 'm2', allele_labels: { fam: 'C', allele2: 'T' } },
  ] });
  const first = render(<StatisticsTab />);
  expect(await screen.findByText('Heterozygous')).toBeTruthy();
  first.unmount();
  getMarkersMock.mockRejectedValue(new Error('down'));
  render(<StatisticsTab />);
  expect(await screen.findByText('Heterozygous')).toBeTruthy();
});
