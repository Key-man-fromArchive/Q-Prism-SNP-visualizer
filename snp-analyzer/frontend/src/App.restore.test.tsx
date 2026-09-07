import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import App from './App';
import { StrictMode } from 'react';
import { act } from '@testing-library/react';
import type { ASGLaunchResponse } from '@/types/auth';
import { useAuthStore } from '@/stores/auth-store';
import { useSessionStore } from '@/stores/session-store';
import { useSettingsStore } from '@/stores/settings-store';
import { writeViewCache } from '@/lib/session-view-cache';
import { asgLaunch, getAuthConfig, getSessionInfo, runClustering } from '@/lib/api';
const info = { session_id: 's', instrument: 'test', allele2_dye: 'VIC', num_wells: 1, num_cycles: 3,
  cycles: [0, 10, 40], has_rox: true, data_windows: null, suggested_cycle: 40, well_groups: null,
  input_revision: 0, analysis_status: 'completed', analysis_pending: false };
vi.mock('@/lib/api', () => ({
  getAuthConfig: vi.fn(() => new Promise(() => {})), getMe: vi.fn(), asgLaunch: vi.fn(), asgLaunchCookie: vi.fn(),
  getCluster: vi.fn(async () => ({ algorithm: 'auto', cycle: 40, assignments: {} })),
  getMarkers: vi.fn(async () => ({ markers: [] })), getPloidy: vi.fn(async () => ({ ploidy: 2 })),
  getSessionInfo: vi.fn(async () => info), runClustering: vi.fn(),
}));
vi.mock('@/components/layout/Header', () => ({ Header: () => null }));
vi.mock('@/components/analysis/AnalysisTab', () => ({ AnalysisTab: () => <div>Restored analysis</div> }));
vi.mock('@/components/analysis/PlateSetupTab', () => ({ PlateSetupTab: () => null }));
vi.mock('@/components/analysis/MultiMarkerAnalysisPanel', () => ({ MultiMarkerAnalysisPanel: () => null }));
vi.mock('@/hooks/use-dark-mode', () => ({ useDarkMode: () => ({ toggle: vi.fn() }), useIsDarkMode: () => false }));
vi.mock('plotly.js-dist-min', () => ({ default: {} }));
beforeEach(() => {
  vi.clearAllMocks(); sessionStorage.clear(); history.replaceState(null, '', '/');
  vi.mocked(getSessionInfo).mockResolvedValue({ ...info, analysis_status: 'completed' });
  vi.mocked(getAuthConfig).mockReturnValue(new Promise(() => {}));
  useAuthStore.getState().setUser({ id: 'u', username: 'u', role: 'user', display_name: null });
  useAuthStore.getState().setAuthMode('local');
  useSessionStore.getState().setSession('s', info);
  writeViewCache('u', 's', { ...useSettingsStore.getState(), useRox: false });
});
it.each(['local', 'asg_launch'] as const)('restoration 401 returns to the correct %s authentication surface', async mode => {
  useAuthStore.getState().setAuthMode(mode);
  history.replaceState(null, '', '/?session=denied');
  vi.mocked(getSessionInfo).mockImplementation(async session => {
    if (session === 'denied') throw Object.assign(new Error('private auth body'), { status: 401 });
    return { ...info, analysis_status: 'completed' };
  });
  render(<App />);
  if (mode === 'local') await waitFor(() => expect(document.querySelector('#username')).not.toBeNull());
  else await screen.findByRole('link', { name: /ASG/ });
  expect(useAuthStore.getState().isAuthenticated).toBe(false);
  expect(screen.queryByText('Restored analysis')).not.toBeInTheDocument();
  expect(document.body.textContent).not.toContain('private auth body');
});
it('strips ASG credentials while preserving prefix/hash and never renders a secret-bearing error', async () => {
  useAuthStore.getState().clearAuth(); useAuthStore.getState().setLoading(true);
  history.replaceState(null, '', '/prefix/?token=secret&session=s#anchor');
  vi.mocked(getAuthConfig).mockResolvedValue({ auth_mode: 'asg_launch', asg_home_url: '/designer/' });
  vi.mocked(asgLaunch).mockRejectedValue(new Error('request failed token=secret'));
  render(<App />);
  await screen.findByRole('link', { name: /ASG/ });
  expect(document.body.textContent).not.toContain('secret');
  expect(location.href).not.toContain('secret');
  expect(location.pathname).toBe('/prefix/');
  expect(location.hash).toBe('#anchor');
});
it('StrictMode exchanges a token once and a late launch cannot revive a logged-out owner', async () => {
  useAuthStore.getState().clearAuth(); useAuthStore.getState().setLoading(true);
  history.replaceState(null, '', '/?token=secret');
  vi.mocked(getAuthConfig).mockResolvedValue({ auth_mode: 'asg_launch' });
  let done!: (value: ASGLaunchResponse) => void;
  vi.mocked(asgLaunch).mockReturnValue(new Promise(resolve => { done = resolve; }));
  render(<StrictMode><App /></StrictMode>);
  await waitFor(() => expect(asgLaunch).toHaveBeenCalledTimes(1));
  act(() => useAuthStore.getState().clearAuth());
  await act(async () => done({ user: { id: 'late', username: 'late', role: 'user', display_name: null },
    linked_context: { target_type: 'run', target_id: 'synthetic', context: {}, scope: [], expires_at: null } }));
  expect(useAuthStore.getState().isAuthenticated).toBe(false);
  expect(useAuthStore.getState().user).toBeNull();
  expect(getAuthConfig).toHaveBeenCalledTimes(1);
});
it.each([403, 404, 500])('shows initial URL failure %s without prior charts and retries server errors', async status => {
  history.replaceState(null, '', '/?session=denied&cycle=0');
  vi.mocked(getSessionInfo).mockImplementation(async session => {
    if (session === 'denied') throw Object.assign(new Error('private response'), { status });
    return { ...info, analysis_status: 'completed' };
  });
  render(<App />);
  await waitFor(() => expect(screen.getAllByRole('alert').some(element => /접근|찾을 수|복원하지|access|not found|Unable to restore/.test(element.textContent ?? ''))).toBe(true));
  expect(screen.queryByText('Restored analysis')).not.toBeInTheDocument();
  expect(screen.queryByText('private response')).not.toBeInTheDocument();
  expect(useSessionStore.getState().sessionId).toBeNull();
  if (status === 500) {
    vi.mocked(getSessionInfo).mockResolvedValue({ ...info, session_id: 'denied', analysis_status: 'completed' });
    fireEvent.click(screen.getByRole('button', { name: /Retry|재시도/ }));
    await screen.findByText('Restored analysis');
    expect(runClustering).not.toHaveBeenCalled();
  }
});
it('never runs App ROX initialization over a reopened cached false, and never analyzes', async () => {
  const setUseRox = vi.spyOn(useSettingsStore.getState(), 'setUseRox');
  render(<App />);
  await screen.findByText('Restored analysis');
  expect(useSettingsStore.getState().useRox).toBe(false);
  expect(setUseRox).not.toHaveBeenCalledWith(true);
  expect(runClustering).not.toHaveBeenCalled();
});
