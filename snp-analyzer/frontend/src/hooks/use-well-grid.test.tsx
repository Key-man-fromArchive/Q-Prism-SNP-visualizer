import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { beforeEach, expect, it } from 'vitest';
import { useWellGrid } from './use-well-grid';
import { useSelectionStore } from '@/stores/selection-store';

function Grid() {
  const grid = useWellGrid(['A', 'B'], [1, 2], ['A1', 'A2', 'B1', 'B2']);
  return <div role="grid" onKeyDown={grid.onKeyDown}>
    {[-1, 0, 1].flatMap(r => [-1, 0, 1].filter(c => r !== -1 || c !== -1).map(c =>
      <button key={`${r}:${c}`} {...grid.cell(r, c)}>{`${r}:${c}`}</button>))}
  </div>;
}
beforeEach(() => useSelectionStore.getState().clearSelection());
it('provides one tab stop, moves to headers, toggles a column, and clears selection', () => {
  render(<Grid />);
  const first = screen.getByRole('button', { name: '0:0' });
  expect(first.tabIndex).toBe(0);
  act(() => first.focus());
  fireEvent.keyDown(first, { key: 'ArrowUp' });
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '-1:0' }));
  fireEvent.keyDown(document.activeElement!, { key: 'Enter' });
  expect(useSelectionStore.getState().selectedWells).toEqual(['A1', 'B1']);
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  expect(useSelectionStore.getState().selectedWells).toEqual([]);
});
it('extends a rectangular range and toggles a well without moving cycles', () => {
  render(<Grid />);
  const first = screen.getByRole('button', { name: '0:0' });
  act(() => first.focus());
  fireEvent.keyDown(first, { key: 'ArrowRight', shiftKey: true });
  fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown', shiftKey: true });
  expect(useSelectionStore.getState().selectedWells).toEqual(['A1', 'A2', 'B1', 'B2']);
  fireEvent.keyDown(document.activeElement!, { key: ' ' });
  expect(useSelectionStore.getState().selectedWells).toEqual(['A1', 'A2', 'B1']);
});
it('restores one valid entry when a visible grid domain changes', () => {
  const hook = renderHook(({ rows }) => useWellGrid(rows, [1, 2], ['A1', 'B1']), { initialProps: { rows: ['A', 'B'] } });
  act(() => hook.result.current.cell(1, 1).onFocus());
  expect(hook.result.current.cell(1, 1).tabIndex).toBe(0);
  hook.rerender({ rows: ['A'] });
  expect(hook.result.current.cell(0, 0).tabIndex).toBe(0);
});
it('replaces plain pointer selection, toggles with Ctrl and extends with Shift', () => {
  render(<Grid />);
  const first = screen.getByRole('button', { name: '0:0' });
  const last = screen.getByRole('button', { name: '1:1' });
  fireEvent.click(first);
  fireEvent.click(last);
  expect(useSelectionStore.getState().selectedWells).toEqual(['B2']);
  fireEvent.click(first, { ctrlKey: true });
  expect(useSelectionStore.getState().selectedWells).toEqual(['B2', 'A1']);
  fireEvent.click(last, { shiftKey: true });
  expect(useSelectionStore.getState().selectedWells).toEqual(['A1', 'A2', 'B1', 'B2']);
});
