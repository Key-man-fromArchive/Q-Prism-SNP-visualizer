import { beforeEach, expect, it, vi } from 'vitest';
import { createLocationRestore } from './workspace-location';
import { getSessionInfo } from './api';
import { useAuthStore } from '@/stores/auth-store';
import { useSessionStore } from '@/stores/session-store';
import { useNavigationStore } from '@/stores/navigation-store';
import { useSelectionStore } from '@/stores/selection-store';
import type { SessionInfoResponse } from '@/types/api';
vi.mock('./api', () => ({ getSessionInfo: vi.fn() }));
const info: SessionInfoResponse = { session_id: 's', instrument: 'test', allele2_dye: 'VIC', num_wells: 1, num_cycles: 3,
  cycles: [0, 10, 40], has_rox: true, data_windows: null, suggested_cycle: 40, well_groups: null,
  input_revision: 0, analysis_status: 'completed', analysis_pending: false };
beforeEach(() => { vi.resetAllMocks(); useAuthStore.getState().setUser({ id: 'u', username: 'u', display_name: null, role: 'user' });
  useSessionStore.getState().reset(); history.replaceState(null, '', '/?session=s&cycle=0'); });
it('waits for authorized info before exposing the session, with playback stopped', async () => {
  let done!: (value: SessionInfoResponse) => void;
  vi.mocked(getSessionInfo).mockReturnValue(new Promise(resolve => { done = resolve; }));
  useSelectionStore.getState().setPlaying(true);
  const restore = createLocationRestore('u'); const pending = restore.run();
  expect(useSessionStore.getState().sessionId).toBeNull();
  expect(useNavigationStore.getState().status).toBe('restoring');
  expect(useSelectionStore.getState().isPlaying).toBe(false);
  done(info); await pending;
  expect(useSessionStore.getState()).toMatchObject({ sessionId: 's', entryReason: 'reopen', restoreQuery: '?session=s&cycle=0' });
});
it('same-SID latest request wins and logout invalidates an awaited response', async () => {
  let first!: (value: SessionInfoResponse) => void;
  vi.mocked(getSessionInfo).mockReturnValueOnce(new Promise(resolve => { first = resolve; })).mockResolvedValue(info);
  const restore = createLocationRestore('u'); const old = restore.run();
  history.replaceState(null, '', '/?session=s&cycle=40'); await restore.run(); first(info); await old;
  expect(useSessionStore.getState().restoreQuery).toBe('?session=s&cycle=40');
  vi.mocked(getSessionInfo).mockReturnValueOnce(new Promise(resolve => { first = resolve; }));
  const late = restore.run(); useAuthStore.getState().clearAuth(); first(info); await late;
  expect(useSessionStore.getState().sessionId).toBeNull();
});
it('rejects duplicate session keys before any request', async () => {
  history.replaceState(null, '', '/?session=s&session=other');
  await createLocationRestore('u').run();
  expect(getSessionInfo).not.toHaveBeenCalled();
  expect(useNavigationStore.getState().status).toBe('error');
});
it('an obsolete owner cannot even begin a restore or clear the new owner session', async () => {
  const restore = createLocationRestore('u');
  useAuthStore.getState().setUser({ id: 'new', username: 'new', role: 'user', display_name: null });
  useSessionStore.getState().setSession('new-session', info);
  await restore.run();
  expect(getSessionInfo).not.toHaveBeenCalled();
  expect(useSessionStore.getState().sessionId).toBe('new-session');
});
it.each([401, 403, 404, 500])('classifies request error %s without leaking its body', async status => {
  vi.mocked(getSessionInfo).mockRejectedValue(Object.assign(new Error('private body'), { status }));
  await createLocationRestore('u').run();
  if (status === 401) expect(useAuthStore.getState().isAuthenticated).toBe(false);
  else expect(useNavigationStore.getState().error).toBe(({ 403: 'forbidden', 404: 'not-found', 500: 'network' })[status]);
  expect(useSessionStore.getState().sessionId).toBeNull();
});
it.each(['project', 'references', 'library'])('restores independent %s without session APIs or URL rewriting', async tab => {
  history.replaceState(null, '', `/prefix/?tab=${tab}#anchor`);
  const original = location.href;
  await createLocationRestore('u').run();
  expect(useNavigationStore.getState()).toMatchObject({ tab, session: null, marker: null, cycle: null, status: 'ready' });
  expect(getSessionInfo).not.toHaveBeenCalled(); expect(location.href).toBe(original);
});
it.each(['quality', 'invalid', 'users'])('falls back safely from unavailable independent tab %s', async tab => {
  history.replaceState(null, '', `/?tab=${tab}`);
  await createLocationRestore('u').run();
  expect(useNavigationStore.getState()).toMatchObject({ tab: 'results', reasons: ['tab'] });
  expect(getSessionInfo).not.toHaveBeenCalled(); expect(location.search).toBe(`?tab=${tab}`);
});
