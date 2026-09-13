import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { AnalysisWorkspace } from './AnalysisWorkspace';
import { getCluster, getMarkers, getPloidy, getSessionInfo, runClustering } from '@/lib/api';
import { useAnalysisStore } from '@/stores/analysis-store';
import { useSessionStore } from '@/stores/session-store';
import { useAuthStore } from '@/stores/auth-store';
import type { UploadResponse } from '@/types/api';
import { useNavigationStore } from '@/stores/navigation-store';
import { useSettingsStore } from '@/stores/settings-store';
import { writeViewCache } from '@/lib/session-view-cache';
import { useLanguageStore } from '@/stores/language-store';

vi.mock('@/lib/api', () => ({ getCluster: vi.fn(), getMarkers: vi.fn(), getPloidy: vi.fn(), getSessionInfo: vi.fn(), runClustering: vi.fn() }));
vi.mock('./AnalysisTab', () => ({ AnalysisTab: () => <div>single-ready</div> }));
vi.mock('./MultiMarkerAnalysisPanel', () => ({ MultiMarkerAnalysisPanel: () => <div>multi-ready</div> }));
vi.mock('./PlateSetupTab', () => ({ PlateSetupTab: () => null }));
const info: UploadResponse = { session_id: 's', instrument: 'test', allele2_dye: 'VIC', num_wells: 1,
  num_cycles: 40, has_rox: false, data_windows: null, suggested_cycle: 40, well_groups: null };
beforeEach(() => {
  sessionStorage.clear();
  vi.resetAllMocks();
  useAuthStore.getState().setUser({ id: 'u', username: 'u', display_name: null, role: 'user' });
  useSessionStore.getState().setSession('s', info);
  vi.mocked(getMarkers).mockResolvedValue({ markers: [] });
  vi.mocked(getPloidy).mockResolvedValue({ ploidy: 2 });
  vi.mocked(getSessionInfo).mockResolvedValue({ ...info, cycles: [0, 20, 40], input_revision: 0, analysis_status: 'idle', analysis_pending: false });
});
it('applies the explicit URL zero and cached ROX false before ready without analysis', async () => {
  useSessionStore.getState().setSession('s', { ...info, has_rox: true }, 'reopen', '?session=s&cycle=0&surface=analysis');
  writeViewCache('u', 's', { ...useSettingsStore.getState(), useRox: false });
  useSettingsStore.setState({ useRox: true });
  vi.mocked(getSessionInfo).mockResolvedValue({ ...info, has_rox: true, cycles: [0, 20, 40], input_revision: 0, analysis_status: 'completed', analysis_pending: false });
  vi.mocked(getCluster).mockResolvedValue({ algorithm: 'auto', cycle: 20, assignments: {} });
  const ready = vi.fn();
  const unsubscribe = useNavigationStore.subscribe(state => { if (state.status === 'ready') ready(useSettingsStore.getState().useRox, state.cycle); });
  render(<AnalysisWorkspace />);
  await screen.findByText('single-ready');
  expect(ready).toHaveBeenLastCalledWith(false, 0);
  expect(runClustering).not.toHaveBeenCalled();
  unsubscribe();
});
it('does not mount a single-analysis consumer until the stored result has also loaded', async () => {
  let resolve!: (value: { algorithm: null; cycle: number; assignments: Record<string, string> }) => void;
  vi.mocked(getCluster).mockReturnValue(new Promise(done => { resolve = done; }));
  render(<AnalysisWorkspace />);
  await act(async () => { await Promise.resolve(); });
  expect(screen.queryByText('single-ready')).not.toBeInTheDocument();
  await act(async () => resolve({ algorithm: null, cycle: 0, assignments: {} }));
  await waitFor(() => expect(screen.getByText('single-ready')).toBeInTheDocument());
});
it('keeps consumers blocked when marker or result loading fails', async () => {
  vi.mocked(getMarkers).mockRejectedValue(new Error('offline'));
  vi.mocked(getCluster).mockResolvedValue({ algorithm: null, cycle: 0, assignments: {} });
  render(<AnalysisWorkspace />);
  await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  expect(screen.queryByText('single-ready')).not.toBeInTheDocument();
});
it('runs a fresh missing-result session once, while preserving explicit cycle and normalization', async () => {
  useSessionStore.getState().setSession('s', info, 'fresh');
  vi.mocked(getCluster).mockResolvedValue({ algorithm: null, cycle: 0, assignments: {} });
  vi.mocked(runClustering).mockResolvedValue({ algorithm: 'auto', cycle: 40, assignments: {} });
  const { rerender } = render(<StrictMode><AnalysisWorkspace /></StrictMode>);
  await waitFor(() => expect(runClustering).toHaveBeenCalledTimes(1));
  rerender(<StrictMode><AnalysisWorkspace /></StrictMode>);
  expect(runClustering).toHaveBeenCalledTimes(1);
  expect(vi.mocked(runClustering).mock.calls[0]?.[1].cycle).toBe(40);
});
it('retries failed readiness without granting a reopened session automatic analysis', async () => {
  vi.mocked(getCluster).mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ algorithm: null, cycle: 0, assignments: {} });
  render(<AnalysisWorkspace />);
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: /Retry|재시도/ }));
  await screen.findByText('single-ready');
  expect(runClustering).not.toHaveBeenCalled();
});
it('does not automatically analyze a reopened missing result or a fresh completed empty result', async () => {
  vi.mocked(getCluster).mockResolvedValue({ algorithm: null, cycle: 0, assignments: {} });
  const first = render(<AnalysisWorkspace />);
  await screen.findByText('single-ready');
  expect(runClustering).not.toHaveBeenCalled();
  first.unmount();
  useSessionStore.getState().setSession('s', info, 'fresh');
  vi.mocked(getCluster).mockResolvedValue({ algorithm: 'auto', cycle: 20, assignments: {} });
  render(<AnalysisWorkspace />);
  await screen.findByText('single-ready');
  expect(runClustering).not.toHaveBeenCalled();
  expect(useSessionStore.getState().initialAnalysisAvailable).toBe(false);
});
it('refreshes authoritative input revision and marker routing after a mutation event without analyzing a single plate', async () => {
  vi.mocked(getCluster).mockResolvedValue({ algorithm: 'auto', cycle: 20, assignments: {}, input_revision: 0 });
  render(<AnalysisWorkspace />);
  await screen.findByText('single-ready');
  vi.mocked(getMarkers).mockResolvedValue({ markers: [{ id: 'm', name: 'Synthetic', wells: ['A1'], ploidy: 2, color: '#000' }] });
  vi.mocked(getSessionInfo).mockResolvedValue({ ...info, cycles: [0, 20, 40], input_revision: 1, analysis_status: 'completed', analysis_pending: false });
  act(() => window.dispatchEvent(new CustomEvent('markers-changed')));
  await screen.findByText('multi-ready');
  expect(useAnalysisStore.getState().currentInputRevision).toBe(1);
  expect(useAnalysisStore.getState().result?.input_revision).toBe(0);
  expect(runClustering).not.toHaveBeenCalled();
});
it('does not describe retained results as current when a post-mutation revision refresh fails', async () => {
  vi.mocked(getCluster).mockResolvedValue({ algorithm: 'auto', cycle: 20, assignments: { A1: 'NTC' }, input_revision: 0 });
  render(<AnalysisWorkspace />);
  await screen.findByText('single-ready');
  vi.mocked(getSessionInfo).mockRejectedValue(new Error('metadata unavailable'));
  act(() => window.dispatchEvent(new CustomEvent('welltypes-changed')));
  await waitFor(() => expect(useAnalysisStore.getState().currentInputRevision).toBeNull());
  await waitFor(() => expect(useAnalysisStore.getState().inputRevisionError).toBeInstanceOf(Error));
  expect(useAnalysisStore.getState().result?.assignments).toEqual({ A1: 'NTC' });
  expect(useAnalysisStore.getState().status).toBe('completed');
});
it('settles malformed mutation metadata as a separate revision error', async () => {
  vi.mocked(getCluster).mockResolvedValue({ algorithm: 'auto', cycle: 20, assignments: {}, input_revision: 0 });
  render(<AnalysisWorkspace />);
  await screen.findByText('single-ready');
  vi.mocked(getSessionInfo).mockResolvedValue({ ...info, cycles: [20, 40], input_revision: -1, analysis_status: 'completed', analysis_pending: false });
  act(() => window.dispatchEvent(new CustomEvent('welltypes-changed')));
  await waitFor(() => expect(useAnalysisStore.getState().inputRevisionError).toBeInstanceOf(Error));
  expect(useAnalysisStore.getState().inputRevisionRefreshing).toBe(false);
  expect(useAnalysisStore.getState().currentInputRevision).toBeNull();
  expect(useAnalysisStore.getState().status).toBe('completed');
});

// P17-MARKER-FLASH: a markers-changed refetch used to unmount the whole
// results panel (no loading state) for its duration -- worse on a 0<->1
// marker transition since that also swapped which component was mounted.
// The panel now keeps showing the previous (still-correct, just momentarily
// stale) content with a small aria-busy badge overlaid on top instead.
it.each([false, true])('keeps the previous results panel mounted, with an aria-busy refresh badge, while an external marker reload is held (initial marker: %s)', async initialMarker => {
  const marker = { id: 'm', name: 'Synthetic', wells: ['A1'], ploidy: 2, color: '#000' };
  vi.mocked(getMarkers).mockResolvedValue({ markers: initialMarker ? [marker] : [] });
  vi.mocked(getCluster).mockResolvedValue({ algorithm: 'auto', cycle: 20, assignments: { A1: 'NTC' }, input_revision: 0 });
  render(<AnalysisWorkspace />);
  await screen.findByText(initialMarker ? 'multi-ready' : 'single-ready');
  let resolve!: (value: { markers: typeof marker[] }) => void;
  vi.mocked(getMarkers).mockReturnValue(new Promise(done => { resolve = done; }));
  act(() => window.dispatchEvent(new CustomEvent('markers-changed')));
  // The collapsed context-summary's marker-dependent copy still goes
  // "unavailable" while the refetch is in flight (unchanged) --
  expect(screen.getByTestId('marker-scope-unavailable')).toBeInTheDocument();
  // -- but the actual results panel the user is looking at does not disappear.
  expect(screen.getByText(initialMarker ? 'multi-ready' : 'single-ready')).toBeInTheDocument();
  const indicator = screen.getByTestId('marker-refresh-indicator');
  expect(indicator).toHaveAttribute('role', 'status');
  expect(indicator).toHaveAttribute('aria-live', 'polite');
  expect(indicator.parentElement).toHaveAttribute('aria-busy', 'true');
  expect(useAnalysisStore.getState().result?.assignments).toEqual({ A1: 'NTC' });
  await act(async () => resolve({ markers: initialMarker ? [] : [marker] }));
  await screen.findByText(initialMarker ? 'single-ready' : 'multi-ready');
  expect(screen.queryByTestId('marker-refresh-indicator')).not.toBeInTheDocument();
  expect(runClustering).not.toHaveBeenCalled();
});

// P17-MARKER-FLASH: a failed refetch used to leave the panel unmounted
// forever (silent, permanent blank), because `markerEntry` was nulled
// up front and never restored on failure. The panel is no longer gated by
// that flag at all, so it keeps showing the last-known-good content with an
// inline, non-blocking error badge instead of going silently blank.
it('keeps the previous results panel visible and surfaces an inline error when a marker refresh fails', async () => {
  vi.mocked(getCluster).mockResolvedValue({ algorithm: 'auto', cycle: 20, assignments: { A1: 'NTC' }, input_revision: 0 });
  render(<AnalysisWorkspace />);
  await screen.findByText('single-ready');
  vi.mocked(getMarkers).mockRejectedValue(new Error('offline'));
  act(() => window.dispatchEvent(new CustomEvent('markers-changed')));
  await waitFor(() => expect(useAnalysisStore.getState().inputRevisionError).toBeInstanceOf(Error));
  expect(screen.getByTestId('marker-scope-unavailable')).toBeInTheDocument();
  expect(screen.getByText('single-ready')).toBeInTheDocument();
  const errorBadge = screen.getByTestId('marker-refresh-error');
  expect(errorBadge).toHaveAttribute('role', 'alert');
  expect(screen.queryByTestId('marker-refresh-indicator')).not.toBeInTheDocument();
  expect(useAnalysisStore.getState().result?.assignments).toEqual({ A1: 'NTC' });
  expect(runClustering).not.toHaveBeenCalled();
});

it('retains scope for type-only refresh and ignores an older marker response after the latest reload', async () => {
  vi.mocked(getCluster).mockResolvedValue({ algorithm: 'auto', cycle: 20, assignments: {}, input_revision: 0 });
  render(<AnalysisWorkspace />);
  await screen.findByText('single-ready');
  let resolveOld!: (value: { markers: [] }) => void;
  vi.mocked(getMarkers).mockReturnValueOnce(new Promise(done => { resolveOld = done; }));
  act(() => window.dispatchEvent(new CustomEvent('welltypes-changed')));
  expect(screen.getByText('single-ready')).toBeInTheDocument();
  expect(screen.queryByTestId('marker-scope-unavailable')).not.toBeInTheDocument();
  vi.mocked(getMarkers).mockResolvedValue({ markers: [{ id: 'm', name: 'Synthetic', wells: ['A1'], ploidy: 2, color: '#000' }] });
  act(() => window.dispatchEvent(new CustomEvent('markers-changed')));
  expect(screen.getByTestId('marker-scope-unavailable')).toBeInTheDocument();
  await screen.findByText('multi-ready');
  await act(async () => resolveOld({ markers: [] }));
  expect(screen.getByText('multi-ready')).toBeInTheDocument();
  expect(screen.queryByText('single-ready')).not.toBeInTheDocument();
  expect(runClustering).not.toHaveBeenCalled();
});

it('withdraws verified view equality during a held marker reload without discarding completion', async () => {
  useLanguageStore.setState({ language: 'en' });
  vi.mocked(getCluster).mockResolvedValue({ algorithm: 'auto', cycle: 20, assignments: {}, input_revision: 0 });
  render(<AnalysisWorkspace />);
  await screen.findByText('single-ready');
  const threshold = { ntc_threshold: 0.1, ntc_fam_max: null, ntc_allele2_max: null,
    allele1_ratio_max: 0.4, allele2_ratio_min: 0.6, boundaries: null, offset: 0, dosage_max: null };
  act(() => useAnalysisStore.setState({ currentRequest: { algorithm: 'auto', cycle: 20, use_rox: false,
    background: 'none', n_clusters: 4, ploidy: 2, threshold_config: threshold },
    result: { algorithm: 'auto', cycle: 20, assignments: {}, analysis_context: {
      schema_version: 1, result_revision: '11111111-1111-4111-8111-111111111111', analysed_at: '2026-09-07T00:00:00Z',
      cycle: 20, use_rox: false, normalization_applied: false, background: 'none', algorithm: 'auto', input_revision: 0, regions: [],
      parameters: { requested_algorithm: 'auto', ploidy: 2, n_clusters: 4, n_clusters_applied: false, threshold_config: threshold,
        actual_window: { boundaries: [0.7, 0.3], offset: 0, dosage_max: null, offset_uncertain: false, low_separation: false },
        scope: 'whole_plate', effective_well_types: {}, manual_well_types: {}, excluded_wells: [],
        ratio_origin: { fam: 0, allele2: 0, source: 'zero' } },
    } } }));
  expect(screen.getByText(/Current conditions match/)).toBeInTheDocument();
  vi.mocked(getMarkers).mockReturnValue(new Promise(() => {}));
  act(() => window.dispatchEvent(new CustomEvent('markers-changed')));
  expect(screen.queryByText(/Current conditions match|Current view differs/)).not.toBeInTheDocument();
  expect(screen.getByText(/Current analysis conditions cannot be compared/)).toBeInTheDocument();
  expect(screen.getByText('Last completed cycle: 20')).toBeInTheDocument();
});

// P4-S3-T1 (FB-03 §3-3): an always-present scope selector replaces the old
// dismissible split-marker banner and its bannerDismissed/prevSessionId state.
it('shows an always-present scope selector instead of a dismissible split-marker banner', async () => {
  vi.mocked(getCluster).mockResolvedValue({ algorithm: null, cycle: 0, assignments: {} });
  render(<AnalysisWorkspace />);
  await screen.findByText('single-ready');
  expect(screen.getByTestId('analysis-scope-selector')).toBeInTheDocument();
  expect(screen.getByTestId('scope-whole-plate')).toBeInTheDocument();
  expect(screen.getByTestId('scope-split-marker-cta')).toBeInTheDocument();
  expect(screen.queryByTestId('split-marker-banner')).not.toBeInTheDocument();
  expect(screen.queryByTestId('split-marker-dismiss')).not.toBeInTheDocument();
});

it('routes to the Plate Setup surface from the scope selector split CTA', async () => {
  vi.mocked(getCluster).mockResolvedValue({ algorithm: null, cycle: 0, assignments: {} });
  render(<AnalysisWorkspace />);
  await screen.findByText('single-ready');
  fireEvent.click(screen.getByTestId('scope-split-marker-cta'));
  expect(useNavigationStore.getState().tab).toBe('plate');
});

// P4-S3-T1 (FB-03 §3-1): the context summary is a collapsed disclosure by
// default -- only its one-line summary is on by default.
it('collapses the analysis context summary to a one-line disclosure by default', async () => {
  vi.mocked(getCluster).mockResolvedValue({ algorithm: null, cycle: 0, assignments: {} });
  render(<AnalysisWorkspace />);
  await screen.findByText('single-ready');
  const details = screen.getByTestId('analysis-context-summary');
  expect(details.tagName).toBe('DETAILS');
  expect(details).not.toHaveAttribute('open');
  expect(screen.getByTestId('analysis-context-summary-line')).toBeInTheDocument();
});
