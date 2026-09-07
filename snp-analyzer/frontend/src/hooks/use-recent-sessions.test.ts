import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { ApiError, getSessionInfo, getSessions } from '@/lib/api';
import { useRecentSessions } from './use-recent-sessions';
import { useAuthStore } from '@/stores/auth-store';
import { useSessionStore } from '@/stores/session-store';
vi.mock('@/lib/api', async original => ({ ...await original<typeof import('@/lib/api')>(), getSessionInfo: vi.fn(), getSessions: vi.fn() }));
const info = { session_id: 's', instrument: 'Synthetic', allele2_dye: 'VIC', num_wells: 96, num_cycles: 40,
  has_rox: false, data_windows: null, suggested_cycle: 40, well_groups: null,
  cycles: [40], input_revision: 0, analysis_status: 'idle' as const, analysis_pending: false };
beforeEach(() => {
  vi.resetAllMocks(); useSessionStore.getState().reset();
  useAuthStore.setState({ user: { id: 'u', username: 'u', display_name: null, role: 'admin' } });
  vi.mocked(getSessions).mockResolvedValue([]);
});
it('distinguishes failed list from empty and allows explicit refresh', async () => {
  vi.mocked(getSessions).mockRejectedValueOnce(new Error('private URL'));
  const hook = renderHook(() => useRecentSessions());
  await waitFor(() => expect(hook.result.current.listError).toBe('network'));
  await act(async () => { await hook.result.current.reload(); });
  expect(hook.result.current).toMatchObject({ status: 'ready', sessions: [], listError: null });
});
it.each([{ response: [null] }, { response: [{}] }, { response: [{ session_id: 3 }] }])('rejects malformed recent entries %j without replacing safe state', async ({ response }) => {
  const hook = renderHook(() => useRecentSessions());
  await waitFor(() => expect(hook.result.current.status).toBe('ready'));
  vi.mocked(getSessions).mockResolvedValueOnce(response as Awaited<ReturnType<typeof getSessions>>);
  await act(async () => { await hook.result.current.reload(); });
  expect(hook.result.current).toMatchObject({ status: 'error', listError: 'invalid', sessions: [] });
});
it.each([[401, 'unauthorized'], [403, 'forbidden'], [404, 'not_found'], [500, 'server']] as const)('keeps failed open %s separate and admits no stale session', async (status, reason) => {
  vi.mocked(getSessionInfo).mockRejectedValueOnce(new ApiError('secret', status, {}));
  const hook = renderHook(() => useRecentSessions());
  await act(async () => { await hook.result.current.open('missing'); });
  expect(hook.result.current.openError).toBe(reason);
  expect(useSessionStore.getState().sessionId).toBeNull();
});
it('latest explicit open wins and logout invalidates a held response', async () => {
  let resolve!: (value: typeof info) => void;
  vi.mocked(getSessionInfo).mockReturnValueOnce(new Promise(done => { resolve = done; })).mockResolvedValueOnce({ ...info, session_id: 'new' });
  const hook = renderHook(() => useRecentSessions());
  act(() => { void hook.result.current.open('old'); });
  await act(async () => { await hook.result.current.open('new'); });
  await act(async () => resolve({ ...info, session_id: 'old' }));
  expect(useSessionStore.getState().sessionId).toBe('new');
  vi.mocked(getSessionInfo).mockReturnValueOnce(new Promise(done => { resolve = done; }));
  act(() => { void hook.result.current.open('old'); });
  act(() => useAuthStore.getState().clearAuth());
  await act(async () => resolve({ ...info, session_id: 'old' }));
  expect(useSessionStore.getState().sessionId).toBeNull();
});
