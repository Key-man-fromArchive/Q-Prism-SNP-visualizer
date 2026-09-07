import { beforeEach, expect, it, vi } from 'vitest';
import { ApiError, bulkSetWellTypes, getWellTypes } from './api';
import { assignManualWells, undoManual, redoManual } from './manual-commands';
import { useUndoStore } from '@/stores/undo-store';
import { useAuthStore } from '@/stores/auth-store';
import { useSessionStore } from '@/stores/session-store';
import { useAnalysisStore } from '@/stores/analysis-store';
import { useNavigationStore } from '@/stores/navigation-store';
import { useDataStore } from '@/stores/data-store';

vi.mock('./api', async importOriginal => ({ ...await importOriginal<typeof import('./api')>(),
  getWellTypes: vi.fn(), bulkSetWellTypes: vi.fn() }));
const snapshot = (manual: Record<string, string>, revision: number) => ({
  assignments: { A1: 'Unknown', ...manual }, imported_assignments: { A1: 'Unknown' },
  manual_assignments: manual, input_revision: revision,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
beforeEach(() => {
  vi.restoreAllMocks(); vi.resetAllMocks();
  useSessionStore.getState().reset();
  useAuthStore.setState({ user: { id: 'u', username: 'test', role: 'admin', display_name: null }, isAuthenticated: true });
  useSessionStore.setState({ sessionId: 's' });
  useAnalysisStore.getState().setSession('s', 'u');
  useAnalysisStore.getState().updateInputRevision('s', 'u', 0);
  useNavigationStore.setState({ session: 's', status: 'ready', exportRestoring: false });
  useDataStore.getState().setWellTypeAssignments({ A1: 'Unknown' });
  vi.mocked(getWellTypes).mockResolvedValue(snapshot({}, 0));
  vi.mocked(bulkSetWellTypes).mockImplementation(async (_sid, map, rev) => snapshot(map, rev! + 1));
});
it('records exact absence vs equal imported manual value, undo and redo with CAS and one event per success', async () => {
  const event = vi.spyOn(window, 'dispatchEvent');
  expect(await assignManualWells(['A1', 'A2'], 'Unknown')).toBe(true);
  expect(bulkSetWellTypes).toHaveBeenLastCalledWith('s', { A1: 'Unknown', A2: 'Unknown' }, 0);
  expect(await undoManual()).toBe(true);
  expect(bulkSetWellTypes).toHaveBeenLastCalledWith('s', {}, 1);
  expect(await redoManual()).toBe(true);
  expect(bulkSetWellTypes).toHaveBeenLastCalledWith('s', { A1: 'Unknown', A2: 'Unknown' }, 2);
  expect(useAnalysisStore.getState().currentInputRevision).toBe(3);
  expect(event.mock.calls.filter(([value]) => value.type === 'welltypes-changed')).toHaveLength(3);
});
it('serializes all callers and leaves redo intact for no-op edits', async () => {
  const held = deferred<ReturnType<typeof snapshot>>();
  vi.mocked(getWellTypes).mockReturnValueOnce(held.promise);
  const edit = assignManualWells(['A1'], 'NTC');
  expect(await assignManualWells(['A2'], 'Omit')).toBe(false);
  expect(await undoManual()).toBe(false);
  held.resolve(snapshot({}, 0)); await edit;
  await undoManual();
  vi.mocked(getWellTypes).mockResolvedValue(snapshot({}, 2));
  expect(await assignManualWells([], 'NTC')).toBe(false);
  expect(useUndoStore.getState().commands).toHaveLength(1);
  vi.mocked(getWellTypes).mockResolvedValue(snapshot({ A2: 'Omit' }, 2));
  expect(await assignManualWells(['A2'], 'Omit')).toBe(false);
  expect(useUndoStore.getState().cursor).toBe(0);
  expect(bulkSetWellTypes).toHaveBeenCalledTimes(2);
});
it('preserves values and pointer after failed undo then redo, but clears redo after a successful new edit', async () => {
  await assignManualWells(['A1'], 'NTC');
  vi.mocked(bulkSetWellTypes).mockRejectedValueOnce(new Error('private server detail'));
  expect(await undoManual()).toBe(false);
  expect(useUndoStore.getState()).toMatchObject({ cursor: 1, error: 'failed' });
  expect(useDataStore.getState().wellTypeAssignments).toEqual({ A1: 'NTC' });
  await undoManual();
  vi.mocked(bulkSetWellTypes).mockRejectedValueOnce(new Error('offline'));
  expect(await redoManual()).toBe(false);
  expect(useUndoStore.getState().cursor).toBe(0);
  vi.mocked(getWellTypes).mockResolvedValue(snapshot({}, 2));
  await assignManualWells(['A2'], 'Omit');
  expect(useUndoStore.getState().commands).toHaveLength(1);
  expect(await redoManual()).toBe(false);
});
it('invalidates on 409, refreshes authoritative manual state without retrying the mutation', async () => {
  await assignManualWells(['A1'], 'NTC');
  vi.mocked(bulkSetWellTypes).mockRejectedValueOnce(new ApiError('private', 409, {}));
  vi.mocked(getWellTypes).mockResolvedValue(snapshot({ A2: 'Omit' }, 4));
  const event = vi.spyOn(window, 'dispatchEvent');
  expect(await undoManual()).toBe(false);
  expect(bulkSetWellTypes).toHaveBeenCalledTimes(2);
  expect(useUndoStore.getState()).toMatchObject({ commands: [], cursor: 0, error: 'conflict', pending: false });
  expect(useAnalysisStore.getState().currentInputRevision).toBe(4);
  expect(useDataStore.getState().wellTypeAssignments).toEqual({ A1: 'Unknown', A2: 'Omit' });
  expect(event).toHaveBeenCalledTimes(1);
});
it.each(['success', 'conflict', 'failure'])('ignores late %s after same-SID entry reset and owner replacement', async outcome => {
  const held = deferred<ReturnType<typeof snapshot>>();
  vi.mocked(bulkSetWellTypes).mockReturnValueOnce(held.promise);
  const edit = assignManualWells(['A1'], 'NTC');
  await vi.waitFor(() => expect(bulkSetWellTypes).toHaveBeenCalledTimes(1));
  useSessionStore.getState().reset();
  useSessionStore.setState({ sessionId: 's' });
  useAuthStore.setState({ user: { id: 'other', username: 'other', role: 'admin', display_name: null } });
  useDataStore.getState().setWellTypeAssignments({ A9: 'Omit' });
  const event = vi.spyOn(window, 'dispatchEvent');
  if (outcome === 'success') held.resolve(snapshot({ A1: 'NTC' }, 1));
  else held.reject(new ApiError('private', outcome === 'conflict' ? 409 : 500, {}));
  expect(await edit).toBe(false);
  expect(useUndoStore.getState()).toMatchObject({ commands: [], pending: false, error: null });
  expect(useDataStore.getState().wellTypeAssignments).toEqual({ A9: 'Omit' });
  expect(event).not.toHaveBeenCalled();
});
it('fails closed while restoring or when the exact manual snapshot is absent', async () => {
  useNavigationStore.setState({ status: 'restoring' });
  expect(await assignManualWells(['A1'], 'NTC')).toBe(false);
  expect(getWellTypes).not.toHaveBeenCalled();
  useNavigationStore.setState({ status: 'ready' });
  vi.mocked(getWellTypes).mockResolvedValue({ assignments: {}, input_revision: 0 } as ReturnType<typeof snapshot>);
  expect(await assignManualWells(['A1'], 'NTC')).toBe(false);
  expect(bulkSetWellTypes).not.toHaveBeenCalled();
});
it('invalidates old history before a new edit when an external revision was accepted', async () => {
  await assignManualWells(['A1'], 'NTC');
  useAnalysisStore.getState().updateInputRevision('s', 'u', 2);
  vi.mocked(getWellTypes).mockResolvedValue(snapshot({ A9: 'Omit' }, 2));
  expect(await assignManualWells(['A2'], 'NTC')).toBe(false);
  expect(bulkSetWellTypes).toHaveBeenCalledTimes(1);
  expect(useUndoStore.getState()).toMatchObject({ commands: [], error: 'conflict' });
});
it('invalidates conflict history even if the refresh fails and never leaks server detail', async () => {
  await assignManualWells(['A1'], 'NTC');
  vi.mocked(bulkSetWellTypes).mockRejectedValueOnce(new ApiError('private', 409, {}));
  vi.mocked(getWellTypes).mockRejectedValueOnce(new Error('secret'));
  expect(await undoManual()).toBe(false);
  expect(useUndoStore.getState()).toMatchObject({ commands: [], error: 'conflict', pending: false });
  expect(useAnalysisStore.getState().currentInputRevision).toBeNull();
});
