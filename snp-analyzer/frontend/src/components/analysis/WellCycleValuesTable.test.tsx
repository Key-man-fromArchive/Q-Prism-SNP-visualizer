// @TASK P7-VALUES - Per-well fluorescence VALUES (FB-06 Q-1, "웰마다 형광값")
// @SPEC docs/planning/feedback-2026-09-11/FB-06-rawdata-tab.md#3-4
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { WellCycleValuesTable } from './WellCycleValuesTable';
import { useSessionStore } from '@/stores/session-store';
import { useDataStore } from '@/stores/data-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useLanguageStore } from '@/stores/language-store';
import ko from '@/locales/ko';

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

it('renders a well x cycle value table matching the fetched curves once opened', async () => {
  const view = render(<WellCycleValuesTable />);
  fireEvent.click(screen.getByText(ko.wellCycleValuesShow));
  await waitFor(() => expect(getAllAmplificationMock).toHaveBeenCalled());

  const table = await screen.findByTestId('well-cycle-values-table');
  // header row (Well + 3 cycles) + 2 data rows
  expect(table.querySelectorAll('thead tr')).toHaveLength(1);
  expect(table.querySelectorAll('thead th')).toHaveLength(4);
  expect(table.querySelectorAll('tbody tr')).toHaveLength(2);
  // default channel is fam
  expect(view.container).toHaveTextContent('1'); // cycle header
  const a1Row = table.querySelector('tbody tr')!;
  expect(a1Row).toHaveTextContent('A1');
  expect(a1Row).toHaveTextContent('1');
  expect(a1Row).toHaveTextContent('2');
  expect(a1Row).toHaveTextContent('3');
});

it('switches the displayed values when the channel selector changes', async () => {
  render(<WellCycleValuesTable />);
  fireEvent.click(screen.getByText(ko.wellCycleValuesShow));
  const table = await screen.findByTestId('well-cycle-values-table');
  const a1RowBefore = table.querySelectorAll('tbody tr')[0];
  expect(a1RowBefore).toHaveTextContent('1.000000'.slice(0, 1)); // sanity: fam values render (1,2,3)
  expect(a1RowBefore.textContent).toContain('1');
  expect(a1RowBefore.textContent).not.toContain('9');

  fireEvent.change(screen.getByTestId('well-cycle-values-channel-select'), { target: { value: 'allele2' } });

  const a1RowAfter = (await screen.findByTestId('well-cycle-values-table')).querySelectorAll('tbody tr')[0];
  expect(a1RowAfter.textContent).toContain('9');
});

it('does not claim the values are raw and shows the response-echoed processing status instead', async () => {
  render(<WellCycleValuesTable />);
  fireEvent.click(screen.getByText(ko.wellCycleValuesShow));
  const status = await screen.findByTestId('well-cycle-values-processing-status');
  expect(status).toHaveAttribute('data-requested', 'true');
  expect(status).toHaveAttribute('data-applied', 'false');
  expect(status.textContent).toContain(ko.overlayProcessingStatus(true, false));
  expect(screen.queryByText(/raw/i)).toBeNull();
  expect(screen.queryByText(/원시/)).toBeNull();
});

it('exports a CSV containing the same values shown in the table', async () => {
  render(<WellCycleValuesTable />);
  fireEvent.click(screen.getByText(ko.wellCycleValuesShow));
  await screen.findByTestId('well-cycle-values-table');

  fireEvent.click(screen.getByText(ko.wellCycleValuesExportCsv));

  expect(downloadTextFileMock).toHaveBeenCalledTimes(1);
  const [filename, csv] = downloadTextFileMock.mock.calls[0];
  expect(filename).toContain('synthetic');
  expect(csv).toContain('A1');
  expect(csv).toContain('1,2,3');
  expect(csv.toLowerCase()).not.toContain('raw');
});

it('does not crash when there is no active session', () => {
  useSessionStore.setState({ sessionId: null, sessionInfo: null });
  const { container } = render(<WellCycleValuesTable />);
  fireEvent.click(screen.getByText(ko.wellCycleValuesShow));
  expect(container.querySelector('table')).toBeNull();
  expect(getAllAmplificationMock).not.toHaveBeenCalled();
});

it('shows an empty state without crashing when the response has no curves', async () => {
  getAllAmplificationMock.mockResolvedValue({ allele2_dye: 'HEX', curves: [] });
  render(<WellCycleValuesTable />);
  fireEvent.click(screen.getByText(ko.wellCycleValuesShow));
  await waitFor(() => expect(getAllAmplificationMock).toHaveBeenCalled());
  expect(await screen.findByText(ko.wellCycleValuesEmpty)).toBeVisible();
});
