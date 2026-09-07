import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { StrictMode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { QcBadges } from './QcBadges';
import { getQc, suggestCycle } from '@/lib/api';
import { analyzeRecommended } from '@/lib/analysis-actions';
import { useAuthStore } from '@/stores/auth-store';
import { useSessionStore } from '@/stores/session-store';
import { useAnalysisStore } from '@/stores/analysis-store';
import { useNavigationStore } from '@/stores/navigation-store';
import { useLanguageStore } from '@/stores/language-store';
import { useSettingsStore } from '@/stores/settings-store';
import type { QcResponse } from '@/types/api';

vi.mock('@/lib/api', () => ({ getQc: vi.fn(), suggestCycle: vi.fn(), runClustering: vi.fn() }));
export const qcFixture = (): QcResponse => ({ call_rate: .75, n_called: 3, n_total: 4, cluster_separation: null,
  ntc_check: { ok: false, status: 'warning', scope: 'plate', cycle: 0, use_rox: false, normalization_applied: false,
    background: 'none', wells: [
      { well: 'A1', signal: 7, flagged: true, reason: 'signal_above_threshold' },
      { well: 'A2', signal: 1, flagged: false, reason: 'none' },
      { well: 'A3', signal: null, flagged: null, reason: 'missing_signal' },
    ] },
  input_revision: null, current_input_revision: 0, result_revision: null, analysis_context: null,
  context_status: 'legacy_unknown', judgment_status: 'legacy_unknown', judgment_reason: 'context_missing',
  analysis_status: 'completed', analysis_pending: false });

beforeEach(() => {
  vi.resetAllMocks();
  useLanguageStore.setState({ language: 'en' });
  useSettingsStore.setState({ useRox: false, backgroundMode: 'none' });
  useAuthStore.getState().setUser({ id: 'u', username: 'u', display_name: null, role: 'user' });
  useSessionStore.getState().setSession('s', { session_id: 's', instrument: 'synthetic', allele2_dye: 'VIC', num_wells: 4,
    num_cycles: 3, has_rox: false, data_windows: null, suggested_cycle: 0, well_groups: null });
  useAnalysisStore.getState().setSession('s', 'u');
  useNavigationStore.setState({ status: 'ready', session: 's', cycle: 0, availableCycles: [0, 10, 40] });
  vi.mocked(getQc).mockResolvedValue(qcFixture());
});

it('separates flagged, unavailable and normal NTC wells without inventing a zero signal', async () => {
  render(<QcBadges />);
  fireEvent.click(await screen.findByTestId('ntc-status'));
  const warning = await screen.findByRole('group', { name: 'Flagged NTC wells' });
  expect(within(warning).getByText(/A1/)).toBeInTheDocument();
  expect(within(warning).queryByText(/A2|A3/)).not.toBeInTheDocument();
  expect(within(screen.getByRole('group', { name: 'Unevaluable NTC wells' })).getByText(/A3/)).toBeInTheDocument();
  expect(within(screen.getByRole('region', { name: 'Stored judgment QC' })).getByText(/Legacy judgment/)).toBeInTheDocument();
});
it('keeps call rate visible in the compact summary without claiming missing judgment counts', async () => {
  render(<QcBadges />);
  expect(await screen.findByTestId('ntc-status')).toHaveTextContent('Call 75%');
});

it.each(['ok', 'warning', 'no_ntc', 'insufficient'] as const)('renders distinct NTC state %s', async status => {
  const data = qcFixture(); data.ntc_check.status = status;
  vi.mocked(getQc).mockResolvedValue(data);
  render(<QcBadges />);
  expect(await screen.findByTestId('ntc-status')).toHaveAttribute('data-status', status);
});

it('refetches when analysis completes without changing the displayed cycle', async () => {
  render(<QcBadges />); await screen.findByTestId('ntc-status');
  act(() => useAnalysisStore.setState({ result: { algorithm: 'auto', cycle: 0, assignments: { A1: 'Unknown' } }, status: 'completed' }));
  await waitFor(() => expect(getQc).toHaveBeenCalledTimes(2));
});
it('shows local pending while a deferred recommendation still has server-completed QC', async () => {
  let resolve!: (value: Awaited<ReturnType<typeof suggestCycle>>) => void;
  vi.mocked(suggestCycle).mockReturnValue(new Promise(done => { resolve = done; }));
  render(<QcBadges />); await screen.findByTestId('ntc-status');
  let pending!: Promise<boolean>;
  act(() => { pending = analyzeRecommended({ cycle: 0, algorithm: 'auto', n_clusters: 4 }, vi.fn()); });
  await screen.findByTestId('ntc-status');
  expect(screen.getByText(/Analysis pending/)).toBeInTheDocument();
  expect(screen.queryByText('Latest analysis completed')).not.toBeInTheDocument();
  act(() => useAnalysisStore.getState().clear());
  await act(async () => { resolve({ suggested_cycle: null } as Awaited<ReturnType<typeof suggestCycle>>); await pending; });
});
it('qualifies local input verification failure independently of a verified server snapshot', async () => {
  const data = qcFixture(); data.judgment_status = 'verified';
  vi.mocked(getQc).mockResolvedValue(data);
  useAnalysisStore.getState().failInputRefresh(new Error('offline'));
  render(<QcBadges />); await screen.findByTestId('ntc-status');
  expect(screen.getByText('Input revision could not be verified.')).toBeInTheDocument();
});

it('discards an old owner response after synchronous logout', async () => {
  let resolve!: (data: QcResponse) => void;
  vi.mocked(getQc).mockReturnValue(new Promise(done => { resolve = done; }));
  render(<QcBadges />);
  act(() => useAuthStore.getState().clearAuth());
  await act(async () => resolve(qcFixture()));
  expect(screen.queryByTestId('ntc-status')).not.toBeInTheDocument();
});

it('uses marker metrics without pooled separation and handles unselected markers', async () => {
  const data = qcFixture(); data.authoritative = 'markers'; data.cluster_separation = 99;
  data.markers = [{ id: 'm1', name: 'Marker One', ploidy: 2, call_rate: .5, n_called: 1, n_total: 2, cluster_separation: 1.25 },
    { id: 'm2', name: 'Marker Two', ploidy: 4, call_rate: 1, n_called: 2, n_total: 2, cluster_separation: 2.5 }];
  vi.mocked(getQc).mockResolvedValue(data);
  render(<QcBadges />);
  fireEvent.click(await screen.findByTestId('ntc-status'));
  expect(await screen.findByText('Marker One')).toBeInTheDocument();
  expect(screen.getByText('Marker Two')).toBeInTheDocument();
  expect(screen.queryByText(/99\.00/)).not.toBeInTheDocument();
  act(() => useNavigationStore.getState().setMarker('m2'));
  expect(screen.queryByText('Marker One')).not.toBeInTheDocument();
});

it.each(['en', 'ko'] as const)('presents all judgment states in %s and never calls missing counts completed', async language => {
  useLanguageStore.setState({ language });
  for (const status of ['verified', 'stale', 'legacy_unknown', 'missing'] as const) {
    const data = qcFixture(); data.judgment_status = status;
    vi.mocked(getQc).mockResolvedValue(data);
    const view = render(<QcBadges />); await screen.findByTestId('ntc-status');
    fireEvent.click(screen.getByTestId('ntc-status'));
    expect(screen.getByTestId('ntc-status').textContent).not.toContain('undefined');
    const counts = screen.queryByText(/3\/4/);
    if (status === 'missing') expect(counts).not.toBeInTheDocument();
    else expect(counts).toBeInTheDocument();
    view.unmount();
  }
});

it('retries failed QC without displaying the previous conditions as current', async () => {
  vi.mocked(getQc).mockRejectedValueOnce(new Error('offline')).mockResolvedValue(qcFixture());
  render(<QcBadges />);
  expect(await screen.findByRole('alert')).toHaveTextContent('QC unavailable');
  fireEvent.click(screen.getByRole('button', { name: 'Refresh QC' }));
  expect(await screen.findByTestId('ntc-status')).toBeInTheDocument();
});

it('performs one logical request per initial load and explicit refresh in StrictMode', async () => {
  render(<StrictMode><QcBadges /></StrictMode>);
  await screen.findByTestId('ntc-status');
  expect(getQc).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Refresh QC' }));
  await screen.findByTestId('ntc-status');
  expect(getQc).toHaveBeenCalledTimes(2);
});

it('ignores late old-cycle and same-SID reentry responses', async () => {
  let finish!: (data: QcResponse) => void;
  vi.mocked(getQc).mockReturnValueOnce(new Promise(done => { finish = done; })).mockResolvedValue(qcFixture());
  render(<QcBadges />);
  act(() => useNavigationStore.getState().setCycle(40));
  await screen.findByTestId('ntc-status');
  const old = qcFixture(); old.ntc_check.status = 'ok';
  await act(async () => finish(old));
  expect(screen.getByTestId('ntc-status')).toHaveAttribute('data-status', 'warning');
  const info = useSessionStore.getState().sessionInfo!;
  act(() => useSessionStore.getState().setSession('s', info));
  expect(screen.queryByTestId('ntc-status')).not.toBeInTheDocument();
});

it('updates plate conditions for useRox/background and revision changes, not marker selection alone', async () => {
  render(<QcBadges />); await screen.findByTestId('ntc-status');
  act(() => useAnalysisStore.getState().updateInputRevision('s', 'u', 1));
  await waitFor(() => expect(getQc).toHaveBeenCalledTimes(2));
  act(() => useNavigationStore.getState().setMarker('different'));
  expect(getQc).toHaveBeenCalledTimes(2);
  act(() => useSettingsStore.getState().setUseRox(true));
  await waitFor(() => expect(getQc).toHaveBeenLastCalledWith('s', 0, true, 'none'));
  act(() => useSettingsStore.getState().setBackgroundMode('pre_read'));
  await waitFor(() => expect(getQc).toHaveBeenLastCalledWith('s', 0, true, 'pre_read'));
});

it('separates requested reference normalization from captured and current applied bases', async () => {
  const data = qcFixture();
  data.analysis_context = { schema_version: 1, result_revision: 'r1', analysed_at: '2026-01-01', cycle: 10,
    use_rox: true, normalization_applied: false, background: 'pre_read', algorithm: 'auto', parameters: {}, regions: [], input_revision: 0 };
  data.ntc_check.use_rox = false;
  vi.mocked(getQc).mockResolvedValue(data);
  render(<QcBadges />); fireEvent.click(await screen.findByTestId('ntc-status'));
  expect(within(screen.getByRole('region', { name: 'Stored judgment QC' })).getByText(/Reference normalization requested: yes/)).toBeInTheDocument();
  expect(screen.getByText(/Reference normalization requested: no/)).toBeInTheDocument();
});
