import { describe, expect, it } from 'vitest';
import { createUndoStore } from './undo-store';

describe('shared manual command history', () => {
  it('moves only on success, snapshots immutable maps, and keeps a failed redo branch', () => {
    const store = createUndoStore();
    const before = {}, after = { A1: 'Unknown' };
    const ticket = store.getState().begin();
    expect(store.getState().begin()).toBeNull();
    expect(store.getState().cursor).toBe(0);
    store.getState().commitEdit(ticket!, before, after, 1);
    after.A1 = 'NTC';
    expect(store.getState().commands[0].after).toEqual({ A1: 'Unknown' });
    const undo = store.getState().begin();
    store.getState().commitMove(undo!, -1, 2);
    const failed = store.getState().begin();
    store.getState().fail(failed!, 'failed');
    expect(store.getState()).toMatchObject({ cursor: 0, revision: 2, pending: false, error: 'failed' });
    expect(store.getState().commands).toHaveLength(1);
    const edit = store.getState().begin();
    store.getState().commitEdit(edit!, {}, { A2: 'Omit' }, 3);
    expect(store.getState().commands).toHaveLength(1);
    expect(store.getState().commands[0].after).toEqual({ A2: 'Omit' });
  });
  it('retains exactly 50 commands and rejects responses from before reset', () => {
    const store = createUndoStore();
    for (let index = 0; index < 55; index++) {
      const ticket = store.getState().begin();
      store.getState().commitEdit(ticket!, { A1: String(index) }, { A1: String(index + 1) }, index + 1);
    }
    expect(store.getState()).toMatchObject({ cursor: 50, revision: 55 });
    expect(store.getState().commands).toHaveLength(50);
    expect(store.getState().commands[0].before).toEqual({ A1: '5' });
    const obsolete = store.getState().begin();
    store.getState().reset();
    const current = store.getState().begin();
    store.getState().commitEdit(obsolete!, {}, { A1: 'NTC' }, 99);
    store.getState().fail(obsolete!, 'failed');
    expect(store.getState()).toMatchObject({ cursor: 0, pending: true, error: null });
    store.getState().finish(current!);
    expect(store.getState().pending).toBe(false);
  });
});
