import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useAnalysisWorkspace } from './use-analysis-workspace';
import { loadAnalysisSession, type ReadyAnalysisSession } from '@/lib/analysis-session';
import { useSessionStore } from '@/stores/session-store';
import { useAuthStore } from '@/stores/auth-store';
vi.mock('@/lib/analysis-session', () => ({ loadAnalysisSession: vi.fn() }));
vi.mock('@/lib/workspace-ready', () => ({ completeWorkspaceRestore: vi.fn().mockReturnValue({ accepted: true, cycle: 0 }) }));
vi.mock('@/lib/api', () => ({ getMarkers: vi.fn(), getSessionInfo: vi.fn() }));
const value: ReadyAnalysisSession = { markers: [], ploidy: 2, hasCompletedResult: true, info: {
  session_id: 's', instrument: 'synthetic', allele2_dye: 'VIC', num_wells: 2, num_cycles: 2, cycles: [0, 40],
  has_rox: false, data_windows: null, suggested_cycle: 40, well_groups: null, input_revision: 0,
  analysis_status: 'completed', analysis_pending: false, well_ids: ['A1', 'P24'],
} };
beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({ user: { id: 'u', username: 'u', role: 'admin', display_name: null } });
  useSessionStore.getState().setSession('s', { ...value.info, well_ids: undefined });
});
it('carries the fetched run inventory into reopened session metadata', async () => {
  vi.mocked(loadAnalysisSession).mockResolvedValue(value);
  renderHook(() => useAnalysisWorkspace());
  await waitFor(() => expect(useSessionStore.getState().sessionInfo?.well_ids).toEqual(['A1', 'P24']));
});
it('does not publish a departed session inventory when its response arrives late', async () => {
  let resolve!: (result: ReadyAnalysisSession) => void;
  vi.mocked(loadAnalysisSession).mockReturnValue(new Promise(done => { resolve = done; }));
  const hook = renderHook(() => useAnalysisWorkspace());
  hook.unmount();
  useSessionStore.getState().setSession('other', { ...value.info, session_id: 'other', well_ids: ['B2'] });
  await act(async () => resolve(value));
  expect(useSessionStore.getState().sessionInfo?.well_ids).toEqual(['B2']);
});
it('fresh sessions retain the supplied inventory without a cycle-derived replacement', () => {
  useSessionStore.getState().setSession('s', value.info, 'fresh');
  expect(useSessionStore.getState().sessionInfo?.well_ids).toEqual(['A1', 'P24']);
});
