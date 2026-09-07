import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import Plotly from 'plotly.js-dist-min';
import { CompareTab } from './CompareTab';
import { getSessions } from '@/lib/api';
import { useLanguageStore } from '@/stores/language-store';

vi.mock('plotly.js-dist-min', () => ({ default: { newPlot: vi.fn(), purge: vi.fn() } }));
vi.mock('@/lib/api', () => {
  const run = { session_id: 'a', instrument: 'Synthetic', allele2_dye: 'HEX', num_wells: 1,
    points: [{ well: 'A1', norm_fam: 2, norm_allele2: 3 }],
    mean_fam: 2, mean_allele2: 3, std_fam: 0, std_allele2: 0 };
  return {
    getSessions: vi.fn(),
    getCompareScatter: vi.fn().mockResolvedValue({ run1: run, run2: { ...run, session_id: 'b' } }),
    getCompareStats: vi.fn().mockResolvedValue({ run1: run, run2: run,
      correlation: { fam_r: 1, allele2_r: 1, n_matched_wells: 1 } }),
  };
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
    await waitFor(() => expect(error).toHaveBeenCalledWith('Failed to load sessions:', failure));
    expect(getSessions).toHaveBeenCalledTimes(1);
  } finally { error.mockRestore(); }
});
