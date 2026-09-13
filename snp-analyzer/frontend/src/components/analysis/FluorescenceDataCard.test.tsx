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

// @TASK P19-CYCLE-ALIGN - a well's values must land in the column matching
// its own cycle number, not whichever column its array index happens to
// fall in. A2 here has no cycle-2 reading at all, so its cycle-3 reading
// must not shift left into the "2" column (the pre-fix bug: the table used
// curves[0].cycles as every row's column keys).
it('aligns each well\'s cells to the correct cycle-number column when wells have different cycle sets', async () => {
  getAllAmplificationMock.mockResolvedValue({
    allele2_dye: 'HEX',
    normalization_applied: false,
    background_mode: 'none',
    curves: [
      { well: 'A1', cycles: [1, 2, 3], norm_fam: [10, 20, 30], norm_allele2: [1, 1, 1], effective_type: 'Allele 1 Homo' },
      { well: 'A2', cycles: [1, 3], norm_fam: [40, 60], norm_allele2: [2, 2], effective_type: 'Allele 2 Homo' },
    ],
  });
  render(<FluorescenceDataCard />);
  fireEvent.click(screen.getByText(ko.fluorescenceShow));
  fireEvent.click(screen.getByTestId('fluorescence-view-values-tab'));
  const table = await screen.findByTestId('fluorescence-values-table');

  const headerCells = Array.from(table.querySelectorAll('thead th')).map((th) => th.textContent);
  expect(headerCells).toEqual([ko.well, '1', '2', '3']);

  const rows = table.querySelectorAll('tbody tr');
  const a2Cells = Array.from(rows[1].querySelectorAll('td')).map((td) => td.textContent);
  expect(a2Cells[0]).toBe('A2');
  expect(a2Cells[1]).toBe('40.000'); // A2's cycle 1
  expect(a2Cells[3]).toBe('60.000'); // A2's cycle 3, its true column
  expect(a2Cells[3]).not.toBe(a2Cells[2]); // cycle 3's value must not also land in cycle 2's column
});

// @TASK P19-CYCLE-ALIGN - a missing (well, cycle) reading must never render
// (or export) as indistinguishable from a real 0 reading.
it('renders a missing (well, cycle) cell distinctly from a real 0 reading, and exports the same distinction', async () => {
  getAllAmplificationMock.mockResolvedValue({
    allele2_dye: 'HEX',
    normalization_applied: false,
    background_mode: 'none',
    curves: [
      { well: 'A1', cycles: [1, 2], norm_fam: [0, 5], norm_allele2: [0, 0], effective_type: 'Allele 1 Homo' },
      { well: 'A2', cycles: [2], norm_fam: [7], norm_allele2: [1], effective_type: 'Allele 2 Homo' },
    ],
  });
  render(<FluorescenceDataCard />);
  fireEvent.click(screen.getByText(ko.fluorescenceShow));
  fireEvent.click(screen.getByTestId('fluorescence-view-values-tab'));
  const table = await screen.findByTestId('fluorescence-values-table');

  const rows = table.querySelectorAll('tbody tr');
  const a1Cells = Array.from(rows[0].querySelectorAll('td')).map((td) => td.textContent);
  const a2Cells = Array.from(rows[1].querySelectorAll('td')).map((td) => td.textContent);
  expect(a1Cells[1]).toBe('0.000'); // A1's real cycle-1 reading of 0
  expect(a2Cells[1]).not.toBe('0.000'); // A2 has NO cycle-1 reading at all
  expect(a2Cells[1]).not.toBe('');
  expect(a2Cells[2]).toBe('7.000');

  fireEvent.click(screen.getByText(ko.wellCycleValuesExportCsv));
  const [, csv] = downloadTextFileMock.mock.calls[0];
  const lines = (csv as string).split('\n');
  expect(lines).toContain('A1,0,5');
  expect(lines).toContain('A2,,7');
  expect(lines).not.toContain('A2,0,7');
});

// @TASK P19-CYCLE-ALIGN - users must be told when wells don't share a
// cycle set, since the blanks that follow otherwise have no visible cause.
it('shows a notice when wells have different cycle sets, and no notice when they match', async () => {
  getAllAmplificationMock.mockResolvedValueOnce({
    allele2_dye: 'HEX',
    normalization_applied: false,
    background_mode: 'none',
    curves: [
      { well: 'A1', cycles: [1, 2, 3], norm_fam: [10, 20, 30], norm_allele2: [1, 1, 1], effective_type: 'Allele 1 Homo' },
      { well: 'A2', cycles: [1, 3], norm_fam: [40, 60], norm_allele2: [2, 2], effective_type: 'Allele 2 Homo' },
    ],
  });
  const { unmount } = render(<FluorescenceDataCard />);
  fireEvent.click(screen.getByText(ko.fluorescenceShow));
  fireEvent.click(screen.getByTestId('fluorescence-view-values-tab'));
  await screen.findByTestId('fluorescence-values-table');
  expect(screen.getByText(ko.wellCycleValuesCycleMismatchNotice)).toBeVisible();
  unmount();

  // Default beforeEach fixture: A1 and A2 both have cycles [1, 2, 3].
  render(<FluorescenceDataCard />);
  fireEvent.click(screen.getByText(ko.fluorescenceShow));
  fireEvent.click(screen.getByTestId('fluorescence-view-values-tab'));
  await screen.findByTestId('fluorescence-values-table');
  expect(screen.queryByText(ko.wellCycleValuesCycleMismatchNotice)).not.toBeInTheDocument();
});
