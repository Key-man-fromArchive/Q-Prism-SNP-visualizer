import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useKeyboardAssignment } from './use-keyboard-assignment';
import { setWellTypes } from '@/lib/api';
import { useSessionStore } from '@/stores/session-store';
import { useNavigationStore } from '@/stores/navigation-store';
import { useAnalysisStore } from '@/stores/analysis-store';
import { useSelectionStore } from '@/stores/selection-store';
import { useLanguageStore } from '@/stores/language-store';
vi.mock('@/lib/api', () => ({ setWellTypes: vi.fn() }));
beforeEach(() => {
  vi.clearAllMocks();
  useLanguageStore.getState().setLanguage('en');
  useSessionStore.setState({ sessionId: 's', entryGeneration: 1 });
  useNavigationStore.setState({ session: 's', tab: 'analysis', status: 'ready', exportRestoring: false });
  useAnalysisStore.getState().setSession('s', 'owner');
  useSelectionStore.getState().selectWell('A1');
});
it('blocks duplicate mutations, retains selection on failure, and announces failure', async () => {
  let reject!: (error: Error) => void;
  vi.mocked(setWellTypes).mockReturnValue(new Promise((_, fail) => { reject = fail; }));
  const hook = renderHook(() => useKeyboardAssignment());
  act(() => { void hook.result.current.assign('NTC'); void hook.result.current.assign('Unknown'); });
  expect(setWellTypes).toHaveBeenCalledTimes(1);
  await act(async () => reject(new Error('offline')));
  expect(useSelectionStore.getState().selectedWells).toEqual(['A1']);
  expect(hook.result.current.message).toContain('offline');
  expect(hook.result.current.message).toContain('selection retained');
});
it('announces a successful assignment without clearing the selected wells', async () => {
  vi.mocked(setWellTypes).mockResolvedValue({ assignments: { A1: 'NTC' }, input_revision: 1 });
  const hook = renderHook(() => useKeyboardAssignment());
  await act(async () => { await hook.result.current.assign('NTC'); });
  expect(hook.result.current.message).toBe('Type updated for 1 wells. Selection retained.');
  expect(useSelectionStore.getState().selectedWells).toEqual(['A1']);
});
it('shares a pending ticket across popup and global shortcut hook instances', async () => {
  let resolve!: (value: Awaited<ReturnType<typeof setWellTypes>>) => void;
  vi.mocked(setWellTypes).mockReturnValue(new Promise(done => { resolve = done; }));
  const popup = renderHook(() => useKeyboardAssignment());
  const global = renderHook(() => useKeyboardAssignment());
  act(() => { void popup.result.current.assign('NTC'); });
  popup.unmount();
  act(() => { void global.result.current.assign('Unknown'); });
  expect(setWellTypes).toHaveBeenCalledTimes(1);
  await act(async () => resolve({ assignments: { A1: 'NTC' }, input_revision: 1 }));
});
it('ignores late completion after session reentry and does not clear a new selection', async () => {
  let resolve!: (value: Awaited<ReturnType<typeof setWellTypes>>) => void;
  vi.mocked(setWellTypes).mockReturnValue(new Promise(done => { resolve = done; }));
  const hook = renderHook(() => useKeyboardAssignment());
  act(() => { void hook.result.current.assign('NTC'); });
  useSessionStore.setState({ entryGeneration: 2 });
  useSelectionStore.getState().selectWell('B1');
  await act(async () => resolve({ assignments: { A1: 'NTC' }, input_revision: 1 }));
  expect(useSelectionStore.getState().selectedWells).toEqual(['B1']);
  expect(hook.result.current.message).toBe('');
});
