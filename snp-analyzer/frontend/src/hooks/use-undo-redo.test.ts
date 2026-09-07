import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useUndoRedo } from './use-undo-redo';
import { useUndoStore } from '@/stores/undo-store';
vi.mock('@/lib/manual-commands', () => ({ canMoveManual: () => true, undoManual: vi.fn(), redoManual: vi.fn() }));
beforeEach(() => useUndoStore.getState().reset());
it('subscribes both header and shortcut instances to the same successful command and global pending', () => {
  const header = renderHook(() => useUndoRedo());
  const keyboard = renderHook(() => useUndoRedo());
  expect(header.result.current.canUndo).toBe(false);
  act(() => {
    const ticket = useUndoStore.getState().begin()!;
    useUndoStore.getState().commitEdit(ticket, {}, { A1: 'NTC' }, 1);
  });
  expect(header.result.current.canUndo).toBe(true);
  expect(keyboard.result.current.canUndo).toBe(true);
  act(() => { useUndoStore.getState().begin(); });
  expect(header.result.current.canUndo).toBe(false);
  expect(keyboard.result.current.canUndo).toBe(false);
});
