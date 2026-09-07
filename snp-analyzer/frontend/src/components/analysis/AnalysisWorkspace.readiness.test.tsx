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
