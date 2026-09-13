// @TASK P12-TOGGLE - Amplification curve view, extracted from WellDetailPanel
// @SPEC docs/planning/feedback-2026-09-11/evidence/P12-PLOT-TOGGLE.md
import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import Plotly from 'plotly.js-dist-min';
import { AmplificationCurvePanel } from './AmplificationCurvePanel';
import { useSessionStore } from '@/stores/session-store';
import { useSelectionStore } from '@/stores/selection-store';
import { useDataStore } from '@/stores/data-store';
import { useLanguageStore } from '@/stores/language-store';
import { getAmplification } from '@/lib/api';
import en from '@/locales/en';

vi.mock('plotly.js-dist-min', () => ({ default: { react: vi.fn(), purge: vi.fn(), Plots: { resize: vi.fn() } } }));
vi.mock('@/lib/api', () => ({ getAmplification: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  useLanguageStore.getState().setLanguage('en');
});

// @TASK P8-E2E-DEBT (equivalent guarantee, P12-PLOT-TOGGLE) - the curve is
// never nested inside a <details>/disclosure: it's shown by picking this
// view, not by expanding anything.
it('renders the curve immediately, with no collapsed disclosure anywhere in its markup', async () => {
  useSessionStore.setState({ sessionId: 's', sessionInfo: { session_id: 's', instrument: 'synthetic', allele2_dye: 'VIC', num_wells: 1, num_cycles: 2, has_rox: false, data_windows: null, suggested_cycle: 40, well_groups: null } });
  useSelectionStore.setState({ selectedWell: 'A1', currentCycle: 40 });
  useDataStore.setState({ allele2Dye: 'VIC' });
  vi.mocked(getAmplification).mockResolvedValue({ allele2_dye: 'VIC', curves: [{ well: 'A1', cycles: [20, 40], norm_fam: [0, 1], norm_allele2: [0, 1] }] });
  const { container } = render(<AmplificationCurvePanel active />);
  await waitFor(() => expect(Plotly.react).toHaveBeenCalled());
  const plot = container.querySelector('#amplification-plot');
  expect(plot).toBeVisible();
  expect(container.querySelector('details')).toBeNull();
});

it('fetches the curve regardless of `active`, so switching to this view shows the current well immediately', async () => {
  useSessionStore.setState({ sessionId: 's', sessionInfo: { session_id: 's', instrument: 'synthetic', allele2_dye: 'VIC', num_wells: 1, num_cycles: 2, has_rox: false, data_windows: null, suggested_cycle: 40, well_groups: null } });
  useSelectionStore.setState({ selectedWell: 'A1', currentCycle: 40 });
  useDataStore.setState({ allele2Dye: 'VIC' });
  vi.mocked(getAmplification).mockResolvedValue({ allele2_dye: 'VIC', curves: [{ well: 'A1', cycles: [20, 40], norm_fam: [0, 1], norm_allele2: [0, 1] }] });
  render(<AmplificationCurvePanel active={false} />);
  await waitFor(() => expect(getAmplification).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(Plotly.react).toHaveBeenCalled());
});

it('resizes once the view becomes active, recovering from a first draw made while hidden', async () => {
  useSessionStore.setState({ sessionId: 's', sessionInfo: { session_id: 's', instrument: 'synthetic', allele2_dye: 'VIC', num_wells: 1, num_cycles: 2, has_rox: false, data_windows: null, suggested_cycle: 40, well_groups: null } });
  useSelectionStore.setState({ selectedWell: 'A1', currentCycle: 40 });
  useDataStore.setState({ allele2Dye: 'VIC' });
  vi.mocked(getAmplification).mockResolvedValue({ allele2_dye: 'VIC', curves: [{ well: 'A1', cycles: [20, 40], norm_fam: [0, 1], norm_allele2: [0, 1] }] });
  const view = render(<AmplificationCurvePanel active={false} />);
  await waitFor(() => expect(Plotly.react).toHaveBeenCalled());
  expect(Plotly.Plots.resize).not.toHaveBeenCalled();
  view.rerender(<AmplificationCurvePanel active />);
  expect(Plotly.Plots.resize).toHaveBeenCalledTimes(1);
});

it('shows a placeholder instead of an empty plot when no well is selected', () => {
  useSessionStore.setState({ sessionId: null, sessionInfo: null });
  useSelectionStore.setState({ selectedWell: null });
  const { container } = render(<AmplificationCurvePanel active />);
  expect(screen.getByText(en.clickWellToSee)).toBeVisible();
  expect(container.querySelector('#amplification-plot')).toBeNull();
});

it('shows a placeholder instead of an empty plot for a single-cycle run', () => {
  useSessionStore.setState({ sessionId: 's', sessionInfo: { session_id: 's', instrument: 'synthetic', allele2_dye: 'VIC', num_wells: 1, num_cycles: 1, has_rox: false, data_windows: null, suggested_cycle: 0, well_groups: null } });
  useSelectionStore.setState({ selectedWell: 'A1', currentCycle: 0 });
  const { container } = render(<AmplificationCurvePanel active />);
  expect(screen.getByText(en.curveNoMultiCycleData)).toBeVisible();
  expect(container.querySelector('#amplification-plot')).toBeNull();
  expect(getAmplification).not.toHaveBeenCalled();
});

// @TASK P20-STALE-DATA - a well switch whose request fails must not leave
// the PREVIOUS well's curve on screen looking like it belongs to the well
// now selected; the failure must be visible, not just console.error'd.
// @SPEC docs/planning/feedback-2026-09-11/evidence/P20-STALE-DATA.md
it('shows a visible error instead of the previous well\'s curve when a well switch fetch fails', async () => {
  useSessionStore.setState({ sessionId: 's', sessionInfo: { session_id: 's', instrument: 'synthetic', allele2_dye: 'VIC', num_wells: 2, num_cycles: 2, has_rox: false, data_windows: null, suggested_cycle: 40, well_groups: null } });
  useSelectionStore.setState({ selectedWell: 'A1', currentCycle: 40 });
  useDataStore.setState({ allele2Dye: 'VIC' });
  vi.mocked(getAmplification).mockResolvedValueOnce({ allele2_dye: 'VIC', curves: [{ well: 'A1', cycles: [20, 40], norm_fam: [0, 1], norm_allele2: [0, 1] }] });
  render(<AmplificationCurvePanel active />);
  await waitFor(() => expect(Plotly.react).toHaveBeenCalledTimes(1));

  vi.mocked(getAmplification).mockRejectedValueOnce(new Error('Synthetic network failure'));
  act(() => useSelectionStore.setState({ selectedWell: 'A2' }));

  await screen.findByRole('alert');
  expect(screen.getByRole('alert')).toHaveTextContent(en.statusLoadFailed);
  // The A2 fetch failed -- Plotly must never have been told to draw A2's
  // (nonexistent) data, and the A1 curve it drew earlier must be purged so
  // it is not left on screen looking like it belongs to A2.
  expect(Plotly.react).toHaveBeenCalledTimes(1);
  expect(Plotly.purge).toHaveBeenCalled();
});

it('shows a visible error for a well with no curve data (not a silent no-op)', async () => {
  useSessionStore.setState({ sessionId: 's', sessionInfo: { session_id: 's', instrument: 'synthetic', allele2_dye: 'VIC', num_wells: 1, num_cycles: 2, has_rox: false, data_windows: null, suggested_cycle: 40, well_groups: null } });
  useSelectionStore.setState({ selectedWell: 'A1', currentCycle: 40 });
  useDataStore.setState({ allele2Dye: 'VIC' });
  vi.mocked(getAmplification).mockResolvedValue({ allele2_dye: 'VIC', curves: [] });
  render(<AmplificationCurvePanel active />);
  await screen.findByText(en.noDataForWell('A1'));
  expect(Plotly.react).not.toHaveBeenCalled();
});

it('clears a previous well\'s curve immediately when a new well is selected, before the new fetch resolves', async () => {
  useSessionStore.setState({ sessionId: 's', sessionInfo: { session_id: 's', instrument: 'synthetic', allele2_dye: 'VIC', num_wells: 2, num_cycles: 2, has_rox: false, data_windows: null, suggested_cycle: 40, well_groups: null } });
  useSelectionStore.setState({ selectedWell: 'A1', currentCycle: 40 });
  useDataStore.setState({ allele2Dye: 'VIC' });
  vi.mocked(getAmplification).mockResolvedValueOnce({ allele2_dye: 'VIC', curves: [{ well: 'A1', cycles: [20, 40], norm_fam: [0, 1], norm_allele2: [0, 1] }] });
  render(<AmplificationCurvePanel active />);
  await waitFor(() => expect(Plotly.react).toHaveBeenCalledTimes(1));

  let resolve!: (value: Awaited<ReturnType<typeof getAmplification>>) => void;
  vi.mocked(getAmplification).mockReturnValueOnce(new Promise((done) => { resolve = done; }));
  act(() => useSelectionStore.setState({ selectedWell: 'A2' }));

  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(en.loading));
  expect(Plotly.react).toHaveBeenCalledTimes(1);
  expect(Plotly.purge).toHaveBeenCalled();

  await act(async () => resolve({ allele2_dye: 'VIC', curves: [{ well: 'A2', cycles: [20, 40], norm_fam: [0.2, 0.4], norm_allele2: [0.1, 0.2] }] }));
  await waitFor(() => expect(Plotly.react).toHaveBeenCalledTimes(2));
});
