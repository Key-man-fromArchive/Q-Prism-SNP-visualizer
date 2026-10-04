// @TASK P12-TOGGLE - Amplification curve view, extracted from WellDetailPanel
// @SPEC docs/planning/feedback-2026-09-11/evidence/P12-PLOT-TOGGLE.md
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import Plotly from 'plotly.js-dist-min';
import { AmplificationCurvePanel } from './AmplificationCurvePanel';
import { useSessionStore } from '@/stores/session-store';
import { useSelectionStore } from '@/stores/selection-store';
import { useDataStore } from '@/stores/data-store';
import { useLanguageStore } from '@/stores/language-store';
import { useCurveViewStore } from '@/stores/curve-view-store';
import { getAmplification } from '@/lib/api';
import en from '@/locales/en';
import ko from '@/locales/ko';
import { wellInfo } from '@/lib/genotype';

vi.mock('plotly.js-dist-min', () => ({ default: { react: vi.fn(), purge: vi.fn(), Plots: { resize: vi.fn() }, relayout: vi.fn(), restyle: vi.fn() } }));
vi.mock('@/lib/api', () => ({ getAmplification: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  useLanguageStore.getState().setLanguage('en');
  useCurveViewStore.setState({ channels: 'both', colourBasis: 'channel', yScale: 'linear' });
  useSelectionStore.setState({ selectedWell: null, selectedWells: [] });
  useDataStore.setState({ plateWells: [], scatterPoints: [] });
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
  expect(screen.getByText(en.curveSelectWells)).toBeVisible();
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

// @TASK MULTI-CURVE-T2 - several selected wells draw together
const SESSION = { session_id: 's', instrument: 'synthetic', allele2_dye: 'VIC', num_wells: 4, num_cycles: 3, has_rox: false, data_windows: null, suggested_cycle: 2, well_groups: null };
const curveOf = (well: string, fam = [0.1, 0.5, 1]) => ({ well, cycles: [1, 2, 3], norm_fam: fam, norm_allele2: [0.2, 0.3, 0.4] });
type Drawn = { name: string; line: { color: string; dash?: string }; y: (number | null)[] };
const lastTraces = () => vi.mocked(Plotly.react).mock.calls.at(-1)![1] as unknown as Drawn[];
const lastLayout = () => vi.mocked(Plotly.react).mock.calls.at(-1)![2] as { yaxis: { type: string } };

function selectMany(wells: string[]) {
  useSessionStore.setState({ sessionId: 's', sessionInfo: SESSION as never });
  useSelectionStore.setState({ selectedWells: wells, selectedWell: wells.length === 1 ? wells[0] : null, currentCycle: 2 });
  vi.mocked(getAmplification).mockResolvedValue({ allele2_dye: 'VIC', curves: wells.map((w) => curveOf(w)) });
}

it('requests all selected wells once, sorted, and draws FAM solid / Allele2 dashed in the channel colours', async () => {
  selectMany(['A3', 'A1', 'A2']);
  render(<AmplificationCurvePanel active />);
  await waitFor(() => expect(Plotly.react).toHaveBeenCalledTimes(1));
  expect(vi.mocked(getAmplification).mock.calls[0].slice(0, 2)).toEqual(['s', ['A1', 'A2', 'A3']]);
  expect(vi.mocked(getAmplification).mock.calls[0][4]).toBeInstanceOf(AbortSignal);
  const traces = lastTraces();
  expect(traces).toHaveLength(6);
  expect(traces[0].line).toMatchObject({ color: '#2563eb', dash: 'solid' });
  expect(traces[1].line).toMatchObject({ color: '#dc2626', dash: 'dash' });
  expect(screen.getByTestId('curve-selected-count')).toHaveTextContent(en.curveSelectedWells(3));
  await waitFor(() => expect(screen.getByTestId('curve-summary')).toHaveTextContent('3 wells shown'));
});

it('does not refetch or redraw when the cycle moves; only the cycle line is relaid out', async () => {
  selectMany(['A1', 'A2']);
  render(<AmplificationCurvePanel active />);
  await waitFor(() => expect(Plotly.react).toHaveBeenCalledTimes(1));
  vi.mocked(Plotly.relayout).mockClear();
  act(() => useSelectionStore.setState({ currentCycle: 3 }));
  act(() => useSelectionStore.setState({ currentCycle: 1 }));
  expect(getAmplification).toHaveBeenCalledTimes(1);
  expect(Plotly.react).toHaveBeenCalledTimes(1);
  expect(Plotly.relayout).toHaveBeenCalledTimes(2);
  expect(vi.mocked(Plotly.relayout).mock.calls[0][1]).toMatchObject({ shapes: [{ x0: 3, x1: 3 }] });
});

it('does not redraw when only the plate rows are replaced (PlateView refetches per cycle)', async () => {
  selectMany(['A1', 'A2']);
  render(<AmplificationCurvePanel active />);
  await waitFor(() => expect(Plotly.react).toHaveBeenCalledTimes(1));
  act(() => useDataStore.setState({ plateWells: [{ well: 'A1', manual_type: null, auto_cluster: null }] as never }));
  expect(Plotly.react).toHaveBeenCalledTimes(1);
});

it('filters by channel without refetching', async () => {
  selectMany(['A1', 'A2']);
  render(<AmplificationCurvePanel active />);
  await waitFor(() => expect(Plotly.react).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByTestId('curve-channels-fam'));
  await waitFor(() => expect(Plotly.react).toHaveBeenCalledTimes(2));
  expect(lastTraces()).toHaveLength(2);
  expect(lastTraces().every((tr) => tr.line.dash === 'solid')).toBe(true);
  expect(getAmplification).toHaveBeenCalledTimes(1);
});

it('colours by call when asked, naming unassigned wells, and disables the call basis without call data', async () => {
  selectMany(['A1', 'A2']);
  render(<AmplificationCurvePanel active />);
  await waitFor(() => expect(Plotly.react).toHaveBeenCalledTimes(1));
  expect(screen.getByTestId('curve-colour-basis-call')).toBeDisabled();
  act(() => useDataStore.setState({ scatterPoints: [{ well: 'A1', manual_type: null, auto_cluster: 'AA' }] as never }));
  expect(screen.getByTestId('curve-colour-basis-call')).toBeEnabled();
  const drawn = vi.mocked(Plotly.react).mock.calls.length;
  fireEvent.click(screen.getByTestId('curve-colour-basis-call'));
  await waitFor(() => expect(Plotly.react).toHaveBeenCalledTimes(drawn + 1));
  expect(lastTraces().map((tr) => tr.name).some((n) => n.includes(en.wellTypeUnassigned))).toBe(true);
});

it('states the active colour basis in one caption, with the real channel labels', async () => {
  selectMany(['A1', 'A2']);
  render(<AmplificationCurvePanel active />);
  await waitFor(() => expect(Plotly.react).toHaveBeenCalledTimes(1));
  expect(screen.getByTestId('curve-colour-caption')).toHaveTextContent(en.curveColourCaption('channel', 'FAM', 'VIC'));
  act(() => useDataStore.setState({ scatterPoints: [{ well: 'A1', manual_type: null, auto_cluster: 'AA' }] as never }));
  fireEvent.click(screen.getByTestId('curve-colour-basis-call'));
  await waitFor(() => expect(screen.getByTestId('curve-colour-caption')).toHaveTextContent(en.curveColourCaption('call', 'FAM', 'VIC')));
  fireEvent.click(screen.getByTestId('curve-colour-basis-well'));
  await waitFor(() => expect(screen.getByTestId('curve-colour-caption')).toHaveTextContent('Colour: well'));
  expect(screen.getAllByTestId('curve-colour-caption')).toHaveLength(1);
  expect(ko.curveColourCaption('channel', 'FAM', 'VIC')).toBe('색: 채널 (FAM 실선 · VIC 점선)');
  expect(ko.curveColourCaption('call', 'FAM', 'VIC')).toBe('색: 콜 (플레이트와 동일한 색)');
  expect(ko.curveColourCaption('well', 'FAM', 'VIC')).toBe('색: 웰');
});

it('stays a white sheet with the LIGHT palette in dark mode', async () => {
  document.body.classList.add('dark');
  try {
    selectMany(['A1', 'A2']);
    render(<AmplificationCurvePanel active />);
    await waitFor(() => expect(Plotly.react).toHaveBeenCalledTimes(1));
    expect(lastLayout()).toMatchObject({ paper_bgcolor: '#ffffff', plot_bgcolor: '#ffffff', font: { color: '#16211f' }, legend: { bgcolor: 'rgba(255,255,255,0.8)' } });
    act(() => useDataStore.setState({ scatterPoints: [{ well: 'A1', manual_type: null, auto_cluster: 'AA' }] as never }));
    const drawn = vi.mocked(Plotly.react).mock.calls.length;
    fireEvent.click(screen.getByTestId('curve-colour-basis-call'));
    await waitFor(() => expect(Plotly.react).toHaveBeenCalledTimes(drawn + 1));
    const light = wellInfo('AA', 2, false).color;
    expect(lastTraces().some((tr) => tr.line.color === light)).toBe(true);
  } finally { document.body.classList.remove('dark'); }
});

it('offers the well colour basis only for 12 wells or fewer', async () => {
  const wells = Array.from({ length: 13 }, (_, i) => `W${i}`);
  selectMany(wells);
  render(<AmplificationCurvePanel active />);
  await waitFor(() => expect(Plotly.react).toHaveBeenCalledTimes(1));
  expect(screen.getByTestId('curve-colour-basis-well')).toBeDisabled();
  act(() => useSelectionStore.setState({ selectedWells: wells.slice(0, 12) }));
  await waitFor(() => expect(screen.getByTestId('curve-colour-basis-well')).toBeEnabled());
});

it('switches the y axis to log for one or several wells and reports hidden non-positive values', async () => {
  selectMany(['A1']);
  vi.mocked(getAmplification).mockResolvedValue({ allele2_dye: 'VIC', curves: [curveOf('A1', [0, 1, 2])] });
  render(<AmplificationCurvePanel active />);
  await waitFor(() => expect(Plotly.react).toHaveBeenCalledTimes(1));
  expect(lastLayout().yaxis.type).toBe('linear');
  expect(screen.queryByTestId('curve-hidden-nonpositive')).toBeNull();
  fireEvent.click(screen.getByTestId('curve-yscale-log'));
  await waitFor(() => expect(Plotly.react).toHaveBeenCalledTimes(2));
  expect(lastLayout().yaxis.type).toBe('log');
  expect(lastTraces()[0].y).toEqual([null, 1, 2]);
  expect(screen.getByTestId('curve-hidden-nonpositive')).toHaveTextContent(en.curveHiddenNonPositive(1));
  expect(getAmplification).toHaveBeenCalledTimes(1);
  // Single-well view has no multi-well controls.
  expect(screen.queryByTestId('curve-channels')).toBeNull();
});

it('says how many wells have no curve data', async () => {
  selectMany(['A1', 'A2', 'A3']);
  vi.mocked(getAmplification).mockResolvedValue({ allele2_dye: 'VIC', curves: [curveOf('A1'), curveOf('A2')] });
  render(<AmplificationCurvePanel active />);
  await screen.findByTestId('curve-missing-wells');
  expect(screen.getByTestId('curve-missing-wells')).toHaveTextContent(en.curveNoCurveWells(1));
});

it('waits 150 ms only when several wells change to several other wells, and aborts the superseded request', async () => {
  selectMany(['A1', 'A2']);
  render(<AmplificationCurvePanel active />);
  await waitFor(() => expect(getAmplification).toHaveBeenCalledTimes(1));
  const firstSignal = vi.mocked(getAmplification).mock.calls[0][4] as AbortSignal;
  act(() => useSelectionStore.setState({ selectedWells: ['A1', 'A2', 'A3'] }));
  expect(getAmplification).toHaveBeenCalledTimes(1);
  expect(firstSignal.aborted).toBe(true);
  await waitFor(() => expect(getAmplification).toHaveBeenCalledTimes(2), { timeout: 1000 });
  // Going down to a single well is immediate.
  act(() => useSelectionStore.setState({ selectedWells: ['A1'], selectedWell: 'A1' }));
  expect(getAmplification).toHaveBeenCalledTimes(3);
});

it('shows the select-wells placeholder after the selection is cleared', async () => {
  selectMany(['A1', 'A2']);
  render(<AmplificationCurvePanel active />);
  await waitFor(() => expect(Plotly.react).toHaveBeenCalledTimes(1));
  act(() => useSelectionStore.setState({ selectedWells: [], selectedWell: null }));
  expect(screen.getByText(en.curveSelectWells)).toBeVisible();
});
