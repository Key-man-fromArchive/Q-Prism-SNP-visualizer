// P13-FE - the well detail's full-cycle series gets its line chart back, above the numbers.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import Plotly from 'plotly.js-dist-min';
import { WellDetailPanel } from './WellDetailPanel';
import { useSessionStore } from '@/stores/session-store';
import { useSelectionStore } from '@/stores/selection-store';
import { useDataStore } from '@/stores/data-store';
import { useLanguageStore } from '@/stores/language-store';
import { getAmplification } from '@/lib/api';

vi.mock('plotly.js-dist-min', () => ({ default: { react: vi.fn(), purge: vi.fn(), Plots: { resize: vi.fn() } } }));
vi.mock('@/lib/api', () => ({ getAmplification: vi.fn() }));

const windows = [{ name: 'Pre-read', start_cycle: 1, end_cycle: 1 }, { name: 'Amplification', start_cycle: 2, end_cycle: 3 }];

async function setup(labels?: Record<string, string>) {
  useLanguageStore.getState().setLanguage('en');
  useSessionStore.setState({ sessionId: 's', sessionInfo: { session_id: 's', instrument: 'synthetic', allele2_dye: 'VIC', num_wells: 1, num_cycles: 3, has_rox: false, data_windows: windows, suggested_cycle: 2, well_groups: null } });
  useSelectionStore.setState({ selectedWell: 'A1', currentCycle: 2 });
  useDataStore.setState({ allele2Dye: 'VIC', channelLabels: labels as never,
    scatterPoints: [{ well: 'A1', sample_name: 'S', auto_cluster: null, manual_type: null, confidence: null, norm_fam: 1, norm_allele2: 1, raw_fam: 2, raw_allele2: 2, raw_rox: null }] });
  vi.mocked(getAmplification).mockResolvedValue({ allele2_dye: 'VIC', curves: [{ well: 'A1', cycles: [1, 2, 3], norm_fam: [0.1, 0.2, 0.3], norm_allele2: [0.9, 0.8, 0.7] }] });
  const view = render(<WellDetailPanel />);
  await screen.findByTestId('well-timeseries-table');
  return view;
}

beforeEach(() => vi.clearAllMocks());

it('plots both series with the table headers as names, a current-cycle line and the data windows', async () => {
  await setup();
  await waitFor(() => expect(Plotly.react).toHaveBeenCalled());
  const [, traces, layout, config] = vi.mocked(Plotly.react).mock.calls.at(-1) as unknown as [unknown, { name: string; y: number[] }[], { shapes: { x0: number; x1: number; type: string; line?: { dash?: string } }[] }, { displayModeBar: boolean; responsive: boolean }];
  const headers = Array.from(screen.getByTestId('well-timeseries-table').querySelectorAll('th')).map((th) => th.textContent);
  expect(traces.slice(0, 2).map((t) => t.name)).toEqual([headers[1], headers[2]]);
  // current-cycle point highlights on both lines
  expect(traces).toHaveLength(4);
  expect(traces[0].y).toEqual([0.1, 0.2, 0.3]);
  expect(layout.shapes.some((s) => s.type === 'line' && s.x0 === 2 && s.line?.dash === 'dot')).toBe(true);
  expect(layout.shapes.filter((s) => s.type === 'rect')).toHaveLength(2);
  expect(config).toMatchObject({ displayModeBar: false, responsive: true });
});

it('places the chart above the numbers and does not fetch again', async () => {
  const { container } = await setup();
  const plot = screen.getByTestId('well-timeseries-plot');
  const table = screen.getByTestId('well-timeseries-table');
  expect(plot.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(parseInt(plot.style.height, 10)).toBeGreaterThanOrEqual(170);
  expect(container.querySelector('details')).toContainElement(plot);
  expect(getAmplification).toHaveBeenCalledTimes(1);
  const details = container.querySelector('details')!;
  details.open = true; fireEvent(details, new Event('toggle'));
  expect(getAmplification).toHaveBeenCalledTimes(1);
});

it('uses the marker allele names and purges on unmount', async () => {
  const { unmount } = await setup({ fam: 'FAM', allele2: 'VIC' });
  await waitFor(() => expect(Plotly.react).toHaveBeenCalled());
  const traces = vi.mocked(Plotly.react).mock.calls.at(-1)![1] as unknown as { name: string }[];
  expect(traces.slice(0, 2).map((t) => t.name)).toEqual(Array.from(screen.getByTestId('well-timeseries-table').querySelectorAll('th')).slice(1).map((th) => th.textContent));
  unmount();
  expect(Plotly.purge).toHaveBeenCalled();
});
