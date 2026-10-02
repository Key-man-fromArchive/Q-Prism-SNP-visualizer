import { render, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import Plotly from 'plotly.js-dist-min';
import { AmplificationCurvePanel } from './AmplificationCurvePanel';
import { useSessionStore } from '@/stores/session-store';
import { useSelectionStore } from '@/stores/selection-store';
import { useDataStore } from '@/stores/data-store';
import { useLanguageStore } from '@/stores/language-store';
import { getAmplification } from '@/lib/api';

vi.mock('plotly.js-dist-min', () => ({ default: { react: vi.fn(), purge: vi.fn(), Plots: { resize: vi.fn() } } }));
vi.mock('@/lib/api', () => ({ getAmplification: vi.fn() }));

const readLabels = {
  1: { stage: 'pre_read', pcr_cycle: 0, temperature: 25 },
  2: { stage: 'amplification', pcr_cycle: 36, temperature: 40 },
  3: { stage: 'post_read', pcr_cycle: 40, temperature: 25 },
};

function setup(hasCurve: boolean | undefined, labels: typeof readLabels | null) {
  useSessionStore.setState({ sessionId: 's', sessionInfo: {
    session_id: 's', instrument: 'StepOnePlus', allele2_dye: 'VIC', num_wells: 1, num_cycles: 3, has_rox: true,
    data_windows: null, suggested_cycle: 2, well_groups: null, read_labels: labels, has_amplification_curve: hasCurve,
  } as never });
  useSelectionStore.setState({ selectedWell: 'A1', currentCycle: 2 });
  useDataStore.setState({ allele2Dye: 'VIC' });
  vi.mocked(getAmplification).mockResolvedValue({ allele2_dye: 'VIC', curves: [{ well: 'A1', cycles: [1, 2, 3], norm_fam: [0, 1, 1], norm_allele2: [0, 1, 1] }] } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  useLanguageStore.getState().setLanguage('en');
});

it('labels the x axis with read names when the run has no amplification curve', async () => {
  setup(false, readLabels);
  render(<AmplificationCurvePanel active />);
  await waitFor(() => expect(Plotly.react).toHaveBeenCalled());
  const layout = vi.mocked(Plotly.react).mock.calls.at(-1)![2] as { xaxis: { tickvals?: number[]; ticktext?: string[] } };
  expect(layout.xaxis.tickvals).toEqual([1, 2, 3]);
  expect(layout.xaxis.ticktext?.[0]).toContain('Pre-read');
  expect(layout.xaxis.ticktext?.[1]).toBe('Amplification 1/1 · PCR 36 · 40°C');
  expect(layout.xaxis.ticktext?.[2]).toContain('Post-read');
});

it('keeps numeric cycle ticks for real amplification curves', async () => {
  setup(true, readLabels);
  render(<AmplificationCurvePanel active />);
  await waitFor(() => expect(Plotly.react).toHaveBeenCalled());
  const layout = vi.mocked(Plotly.react).mock.calls.at(-1)![2] as { xaxis: { ticktext?: string[] } };
  expect(layout.xaxis.ticktext).toBeUndefined();
});
