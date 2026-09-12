// @TASK P10-PROTOCOL - merged amplification curve + per-well value card
// @SPEC docs/planning/feedback-2026-09-11/evidence/P10-PROTOCOL-UI.md
//
// Supersedes WellCycleValuesTable.test.tsx (deleted alongside its
// component -- both card + comment absorbed into this one) and adds the
// merge-specific guarantees (shared channel selector, single fetch, fully
// collapsed by default) the two previously-separate cards could not make.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import Plotly from 'plotly.js-dist-min';
import { FluorescenceDataCard } from './FluorescenceDataCard';
import { useSessionStore } from '@/stores/session-store';
import { useDataStore } from '@/stores/data-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useLanguageStore } from '@/stores/language-store';
import ko from '@/locales/ko';

vi.mock('plotly.js-dist-min', () => ({ default: { react: vi.fn(), purge: vi.fn() } }));

const getAllAmplificationMock = vi.fn();
const downloadTextFileMock = vi.fn();
vi.mock('@/lib/api', () => ({
  getAllAmplification: (...args: unknown[]) => getAllAmplificationMock(...args),
}));
vi.mock('@/hooks/use-exports', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/use-exports')>('@/hooks/use-exports');
  return { ...actual, downloadTextFile: (...args: unknown[]) => downloadTextFileMock(...args) };
});

beforeEach(() => {
  vi.clearAllMocks();
  useLanguageStore.setState({ language: 'ko' });
  useSettingsStore.setState({ useRox: true, backgroundMode: 'none' });
  useDataStore.setState({ wellTypeAssignments: {}, allele2Dye: 'HEX', channelLabels: null });
  useSessionStore.setState({
    sessionId: 'synthetic',
    sessionInfo: {
      session_id: 'synthetic', instrument: 'Synthetic', allele2_dye: 'HEX',
      num_cycles: 3, num_wells: 2, has_rox: true,
      data_windows: null, suggested_cycle: null, well_groups: null,
    },
  });
  getAllAmplificationMock.mockResolvedValue({
    allele2_dye: 'HEX',
    normalization_applied: false,
    background_mode: 'none',
    curves: [
      { well: 'A1', cycles: [1, 2, 3], norm_fam: [1, 2, 3], norm_allele2: [9, 8, 7], effective_type: 'Allele 1 Homo' },
      { well: 'A2', cycles: [1, 2, 3], norm_fam: [4, 5, 6], norm_allele2: [6, 5, 4], effective_type: 'Allele 2 Homo' },
    ],
  });
});

it('starts fully collapsed: no channel selector, view tabs or CSV button visible', () => {
  render(<FluorescenceDataCard />);
  expect(screen.queryByTestId('fluorescence-channel-select')).not.toBeInTheDocument();
  expect(screen.queryByTestId('fluorescence-view-curve-tab')).not.toBeInTheDocument();
  expect(screen.queryByText(ko.wellCycleValuesExportCsv)).not.toBeInTheDocument();
  expect(getAllAmplificationMock).not.toHaveBeenCalled();
});

it('fetches once when expanded and shows the curve view by default', async () => {
  render(<FluorescenceDataCard />);
  fireEvent.click(screen.getByText(ko.fluorescenceShow));
  await waitFor(() => expect(Plotly.react).toHaveBeenCalledTimes(1));
  expect(getAllAmplificationMock).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('fluorescence-view-curve-tab')).toHaveAttribute('aria-selected', 'true');
  expect(screen.queryByTestId('fluorescence-values-table')).not.toBeInTheDocument();
});

it('switching to the values tab does not trigger a second fetch', async () => {
  render(<FluorescenceDataCard />);
  fireEvent.click(screen.getByText(ko.fluorescenceShow));
  await waitFor(() => expect(getAllAmplificationMock).toHaveBeenCalledTimes(1));

  fireEvent.click(screen.getByTestId('fluorescence-view-values-tab'));
  await screen.findByTestId('fluorescence-values-table');
  expect(getAllAmplificationMock).toHaveBeenCalledTimes(1);
});

it('shares one channel selection between the curve and values views', async () => {
  render(<FluorescenceDataCard />);
  fireEvent.click(screen.getByText(ko.fluorescenceShow));
  await waitFor(() => expect(Plotly.react).toHaveBeenCalled());

  fireEvent.change(screen.getByTestId('fluorescence-channel-select'), { target: { value: 'allele2' } });
  await waitFor(() => expect(Plotly.react).toHaveBeenCalledTimes(2));
  const curveTraces = vi.mocked(Plotly.react).mock.calls[1][1] as unknown as { y: number[] }[];
  expect(curveTraces[0].y).toEqual([9, 8, 7]); // A1's norm_allele2

  fireEvent.click(screen.getByTestId('fluorescence-view-values-tab'));
  const table = await screen.findByTestId('fluorescence-values-table');
  // Still allele2 (9,8,7 for A1), not reset back to fam when switching tabs.
  expect(table.querySelectorAll('tbody tr')[0].textContent).toContain('9');
});

it('the color-by control only appears for the curve view, not the values view', async () => {
  render(<FluorescenceDataCard />);
  fireEvent.click(screen.getByText(ko.fluorescenceShow));
  await waitFor(() => expect(Plotly.react).toHaveBeenCalled());
  expect(screen.getByTestId('fluorescence-color-by-select')).toBeInTheDocument();

  fireEvent.click(screen.getByTestId('fluorescence-view-values-tab'));
  expect(screen.queryByTestId('fluorescence-color-by-select')).not.toBeInTheDocument();
});

it('shows one honest processing-status badge shared by both views', async () => {
  render(<FluorescenceDataCard />);
  fireEvent.click(screen.getByText(ko.fluorescenceShow));
  const status = await screen.findByTestId('fluorescence-processing-status');
  expect(status).toHaveAttribute('data-requested', 'true');
  expect(status).toHaveAttribute('data-applied', 'false');
  expect(screen.queryAllByTestId('fluorescence-processing-status')).toHaveLength(1);
});

it('exports a CSV containing the same values shown in the values table', async () => {
  render(<FluorescenceDataCard />);
  fireEvent.click(screen.getByText(ko.fluorescenceShow));
  fireEvent.click(screen.getByTestId('fluorescence-view-values-tab'));
  await screen.findByTestId('fluorescence-values-table');

  fireEvent.click(screen.getByText(ko.wellCycleValuesExportCsv));

  expect(downloadTextFileMock).toHaveBeenCalledTimes(1);
  const [filename, csv] = downloadTextFileMock.mock.calls[0];
  expect(filename).toContain('synthetic');
  expect(csv).toContain('A1');
  expect(csv).toContain('1,2,3');
  expect(csv.toLowerCase()).not.toContain('raw');
});

it('shows an empty state in the values view without crashing when the response has no curves', async () => {
  getAllAmplificationMock.mockResolvedValue({ allele2_dye: 'HEX', curves: [] });
  render(<FluorescenceDataCard />);
  fireEvent.click(screen.getByText(ko.fluorescenceShow));
  fireEvent.click(screen.getByTestId('fluorescence-view-values-tab'));
  await waitFor(() => expect(getAllAmplificationMock).toHaveBeenCalled());
  expect(await screen.findByText(ko.wellCycleValuesEmpty)).toBeVisible();
});

it('does not crash and does not fetch when there is no active session', () => {
  useSessionStore.setState({ sessionId: null, sessionInfo: null });
  const { container } = render(<FluorescenceDataCard />);
  fireEvent.click(screen.getByText(ko.fluorescenceShow));
  expect(container.querySelector('table')).toBeNull();
  expect(getAllAmplificationMock).not.toHaveBeenCalled();
});
