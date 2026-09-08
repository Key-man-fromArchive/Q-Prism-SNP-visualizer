import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import Plotly from 'plotly.js-dist-min';
import { CompareTab } from './CompareTab';
import { getSessions, getCompareScatter, getCompareStats } from '@/lib/api';
import { useLanguageStore } from '@/stores/language-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useAuthStore } from '@/stores/auth-store';
import { useSessionStore } from '@/stores/session-store';

vi.mock('plotly.js-dist-min', () => ({ default: { newPlot: vi.fn(), purge: vi.fn() } }));
vi.mock('@/lib/api', () => {
  const run = { session_id: 'a', instrument: 'Synthetic', allele2_dye: 'HEX', num_wells: 1, n_wells: 1, cycle: 40,
    points: [{ well: 'A1', norm_fam: 2, norm_allele2: 3 }],
    mean_fam: 2, mean_allele2: 3, std_fam: 0, std_allele2: 0 };
  return {
    getSessions: vi.fn(),
    getCompareScatter: vi.fn().mockResolvedValue({ run1: run, run2: { ...run, session_id: 'b' } }),
    getCompareStats: vi.fn().mockResolvedValue({ run1: run, run2: { ...run, session_id: 'b' },
      correlation: { fam_r: 1, allele2_r: 1, n_matched_wells: 1 } }),
  };
});
it.each(['scatter', 'stats'] as const)('rejects malformed successful %s before plotting', async kind => {
  if (kind === 'scatter') vi.mocked(getCompareScatter).mockResolvedValueOnce(null as unknown as Awaited<ReturnType<typeof getCompareScatter>>);
  else vi.mocked(getCompareStats).mockResolvedValueOnce(null as unknown as Awaited<ReturnType<typeof getCompareStats>>);
  render(<CompareTab />); await screen.findByLabelText('Run A:');
  fireEvent.change(screen.getByLabelText('Run A:'), { target: { value: 'a' } });
  fireEvent.change(screen.getByLabelText('Run B:'), { target: { value: 'b' } });
  fireEvent.click(screen.getByRole('button', { name: 'Compare' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Failed to compare runs');
  expect(Plotly.newPlot).not.toHaveBeenCalled();
});

beforeEach(() => {
  vi.clearAllMocks();
  useLanguageStore.setState({ language: 'en' });
  vi.mocked(getSessions).mockResolvedValue(['a', 'b'].map((session_id) => ({
    session_id, instrument: `Synthetic ${session_id}`, num_wells: 1, num_cycles: 2, uploaded_at: '2026-09-07',
  })));
});

it('uses typed titles and purges the rendered comparison node on unmount', async () => {
  const view = render(<CompareTab />);
  await screen.findByLabelText('Run A:');
  fireEvent.change(screen.getByLabelText('Run A:'), { target: { value: 'a' } });
  fireEvent.change(screen.getByLabelText('Run B:'), { target: { value: 'b' } });
  fireEvent.click(screen.getByRole('button', { name: 'Compare' }));
  await waitFor(() => expect(Plotly.newPlot).toHaveBeenCalled());
  const [node, traces, layout] = vi.mocked(Plotly.newPlot).mock.calls[0];
  expect(traces).toHaveLength(2);
  expect(layout).toMatchObject({ xaxis: { title: { text: 'FAM' } }, yaxis: { title: { text: 'HEX' } } });
  view.unmount();
  expect(Plotly.purge).toHaveBeenCalledWith(node);
});

it('handles session-list rejection without an unhandled promise', async () => {
  const failure = new Error('synthetic session failure');
  vi.mocked(getSessions).mockRejectedValue(failure);
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    render(<CompareTab />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load sessions');
    expect(screen.queryByText(/Upload at least/)).not.toBeInTheDocument();
    expect(getSessions).toHaveBeenCalledTimes(1);
  } finally { error.mockRestore(); }
});
it.each([false, true])('handles real stats wire shape with nullable Pearson and wrong identity=%s', async wrong => {
  const run = { session_id: 'a', instrument: 'Synthetic', allele2_dye: 'HEX', n_wells: 1, mean_fam: 2, mean_allele2: 3, std_fam: 0, std_allele2: 0 };
  vi.mocked(getCompareStats).mockResolvedValueOnce({ run1: { ...run, session_id: wrong ? 'other' : 'a' }, run2: { ...run, session_id: 'b' }, correlation: { fam_r: null, allele2_r: null, n_matched_wells: 1 } });
  render(<CompareTab />); await screen.findByLabelText('Run A:');
  fireEvent.change(screen.getByLabelText('Run A:'), { target: { value: 'a' } });
  fireEvent.change(screen.getByLabelText('Run B:'), { target: { value: 'b' } });
  fireEvent.click(screen.getByRole('button', { name: 'Compare' }));
  if (wrong) {
    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to compare runs');
    expect(Plotly.newPlot).not.toHaveBeenCalled();
  } else {
    expect(await screen.findAllByText('Unavailable')).toHaveLength(2);
    expect(Plotly.newPlot).toHaveBeenCalled();
  }
});
it('identifies duplicate runs consistently and rejects held results after changing selection', async () => {
  vi.mocked(getSessions).mockResolvedValue(['a', 'b', 'c'].map(session_id => ({ session_id, instrument: 'Same', raw_filename: 'duplicate.eds', uploaded_at: '2026-09-07', num_wells: 1, num_cycles: 2 })));
  let resolve!: (value: Awaited<ReturnType<typeof getCompareScatter>>) => void;
  vi.mocked(getCompareScatter).mockReturnValueOnce(new Promise(done => { resolve = done; }));
  render(<CompareTab />);
  const options = await screen.findAllByRole('option', { name: /duplicate.eds.*2026-09-07/ });
  expect(new Set(options.map(option => option.textContent)).size).toBe(3);
  fireEvent.change(screen.getByLabelText('Run A:'), { target: { value: 'a' } });
  fireEvent.change(screen.getByLabelText('Run B:'), { target: { value: 'b' } });
  fireEvent.click(screen.getByRole('button', { name: 'Compare' }));
  fireEvent.change(screen.getByLabelText('Run B:'), { target: { value: 'c' } });
  const run = { session_id: 'a', instrument: 'Same', allele2_dye: 'HEX', cycle: 40, num_wells: 0, points: [] };
  await act(async () => resolve({ run1: run, run2: { ...run, session_id: 'b' } }));
  expect(Plotly.newPlot).not.toHaveBeenCalled();
});
it.each([{}, [null]])('renders retryable safe error for malformed successful lists %j', async payload => {
  vi.mocked(getSessions).mockResolvedValue(payload as Awaited<ReturnType<typeof getSessions>>);
  render(<CompareTab />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load sessions');
  expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
});
it.each(['owner', 'entry', 'rox'] as const)('ignores a held comparison after %s changes', async boundary => {
  let resolve!: (value: Awaited<ReturnType<typeof getCompareScatter>>) => void;
  vi.mocked(getCompareScatter).mockReturnValueOnce(new Promise(done => { resolve = done; }));
  render(<CompareTab />); await screen.findByLabelText('Run A:');
  fireEvent.change(screen.getByLabelText('Run A:'), { target: { value: 'a' } });
  fireEvent.change(screen.getByLabelText('Run B:'), { target: { value: 'b' } });
  fireEvent.click(screen.getByRole('button', { name: 'Compare' }));
  await act(async () => {
    if (boundary === 'owner') useAuthStore.getState().clearAuth();
    if (boundary === 'entry') useSessionStore.setState(state => ({ entryGeneration: state.entryGeneration + 1 }));
    if (boundary === 'rox') { const previous = useSettingsStore.getState().useRox; useSettingsStore.setState({ useRox: !previous }); useSettingsStore.setState({ useRox: previous }); }
    const run = { session_id: 'a', instrument: 'Same', allele2_dye: 'HEX', cycle: 40, num_wells: 0, points: [] };
    resolve({ run1: run, run2: { ...run, session_id: 'b' } });
  });
  expect(Plotly.newPlot).not.toHaveBeenCalled();
});
