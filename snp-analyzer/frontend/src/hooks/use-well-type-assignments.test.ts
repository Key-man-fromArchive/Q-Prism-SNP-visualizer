import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { getWellTypes } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { useSessionStore } from '@/stores/session-store';
import { useAnalysisStore } from '@/stores/analysis-store';
import { useDataStore } from '@/stores/data-store';
import { useWellTypeAssignments } from './use-well-type-assignments';
vi.mock('@/lib/api', () => ({ getWellTypes: vi.fn() }));
const snapshot = (type: string, revision: number) => ({ assignments: { A1: type }, manual_assignments: { A1: type }, input_revision: revision });
function held() { let resolve!: (value: ReturnType<typeof snapshot>) => void; const promise = new Promise<ReturnType<typeof snapshot>>(done => { resolve = done; }); return { promise, resolve }; }
beforeEach(() => {
  vi.resetAllMocks(); useSessionStore.getState().reset();
  useAuthStore.setState({ user: { id: 'u', username: 'u', role: 'admin', display_name: null } });
  useSessionStore.setState({ sessionId: 's' });
  useAnalysisStore.getState().setSession('s', 'u');
  useAnalysisStore.getState().updateInputRevision('s', 'u', 0);
  useDataStore.getState().setWellTypeAssignments({});
});
it.each(['session', 'entry', 'logout'])('rejects old %s GET completions before any global or local publication', async change => {
  const old = held(); vi.mocked(getWellTypes).mockReturnValueOnce(old.promise).mockResolvedValue(snapshot('Omit', 1));
  const accepted = vi.fn(); renderHook(() => useWellTypeAssignments(accepted));
  await act(async () => {
    if (change === 'session') useSessionStore.setState({ sessionId: 'new' });
    else if (change === 'entry') useSessionStore.setState({ entryGeneration: 99 });
    else useAuthStore.getState().clearAuth();
  });
  const calls = accepted.mock.calls.length;
  const current = useDataStore.getState().wellTypeAssignments;
  await act(async () => old.resolve(snapshot('NTC', 0)));
  expect(useDataStore.getState().wellTypeAssignments).toEqual(current);
  expect(accepted).toHaveBeenCalledTimes(calls);
});
it('latest refresh wins and a pre-mutation GET cannot overwrite a confirmed newer revision', async () => {
  const first = held(), second = held();
  vi.mocked(getWellTypes).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  renderHook(() => useWellTypeAssignments());
  act(() => { window.dispatchEvent(new Event('welltypes-changed')); });
  await act(async () => second.resolve(snapshot('Omit', 2)));
  await act(async () => first.resolve(snapshot('NTC', 0)));
  expect(useDataStore.getState().wellTypeAssignments).toEqual({ A1: 'Omit' });
  vi.mocked(getWellTypes).mockResolvedValue(snapshot('NTC', 1));
  useAnalysisStore.getState().updateInputRevision('s', 'u', 2);
  await act(async () => { window.dispatchEvent(new Event('welltypes-changed')); });
  expect(useDataStore.getState().wellTypeAssignments).toEqual({ A1: 'Omit' });
});
