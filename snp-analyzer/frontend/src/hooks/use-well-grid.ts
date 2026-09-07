import { useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { useSelectionStore } from '@/stores/selection-store';
type Cell = { r: number; c: number };
function move(cell: Cell, key: string, rows: number, cols: number): Cell | null {
  const { r, c } = cell;
  const moves: Record<string, Cell> = {
    ArrowUp: { r: Math.max(c < 0 ? 0 : -1, r - 1), c },
    ArrowDown: { r: Math.min(rows - 1, r + 1), c },
    ArrowLeft: { r, c: Math.max(r < 0 ? 0 : -1, c - 1) },
    ArrowRight: { r, c: Math.min(cols - 1, c + 1) },
    Home: { r, c: 0 }, End: { r, c: cols - 1 },
  };
  return moves[key] ?? null;
}
function toggle(wells: string[]) {
  const selection = useSelectionStore.getState();
  const current = new Set(selection.selectedWells);
  const remove = wells.every(well => current.has(well));
  for (const well of wells) { if (remove) current.delete(well); else current.add(well); }
  selection.selectWells([...current]);
}
function range(rows: string[], cols: number[], a: Cell, b: Cell): string[] {
  return rows.flatMap((row, r) => cols.filter((_, c) =>
    r >= Math.min(a.r, b.r) && r <= Math.max(a.r, b.r)
    && c >= Math.min(a.c, b.c) && c <= Math.max(a.c, b.c)).map(col => `${row}${col}`));
}
/** Headers share the one roving tab stop: Up/Left from the first well reaches them. */
export function useWellGrid(rows: string[], cols: number[], available: string[]) {
  const [active, setActive] = useState<Cell>({ r: 0, c: 0 });
  const [anchor, setAnchor] = useState<Cell>({ r: 0, c: 0 });
  const domain = `${rows.join(',')}:${cols.join(',')}`;
  const [previousDomain, setPreviousDomain] = useState(domain);
  if (previousDomain !== domain) {
    setPreviousDomain(domain); setActive({ r: 0, c: 0 }); setAnchor({ r: 0, c: 0 });
  }
  const refs = useRef(new Map<string, HTMLButtonElement>());
  const valid = (wells: string[]) => wells.filter(well => available.includes(well));
  const selected = (cell: Cell) => {
    if (cell.r < 0) return valid(rows.map(row => `${row}${cols[cell.c]}`));
    if (cell.c < 0) return valid(cols.map(col => `${rows[cell.r]}${col}`));
    return valid([`${rows[cell.r]}${cols[cell.c]}`]);
  };
  const navigate = (event: KeyboardEvent, next: Cell) => {
    if (event.shiftKey && event.key.startsWith('Arrow')) {
      useSelectionStore.getState().selectWells(valid(range(rows, cols, anchor, next)));
    } else setAnchor(next);
    setActive(next);
    refs.current.get(`${next.r}:${next.c}`)?.focus();
  };
  const click = (event: MouseEvent, next: Cell) => {
    if (next.r < 0 || next.c < 0) { toggle(selected(next)); return; }
    if (event.shiftKey) {
      useSelectionStore.getState().selectWells(valid(range(rows, cols, anchor, next)));
      return;
    }
    setAnchor(next);
    if (event.ctrlKey || event.metaKey) toggle(selected(next));
    else useSelectionStore.getState().selectWells(selected(next));
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
    const next = move(active, event.key, rows.length, cols.length);
    if (next) navigate(event, next);
    else if (event.key === 'Enter' || event.key === ' ') toggle(selected(active));
    else if (event.key === 'Escape') useSelectionStore.getState().clearSelection();
    else return;
    event.preventDefault(); event.stopPropagation();
  };
  const cell = (r: number, c: number) => ({
    tabIndex: active.r === r && active.c === c ? 0 : -1,
    ref: (node: HTMLButtonElement | null) => {
      const key = `${r}:${c}`;
      if (node) refs.current.set(key, node); else refs.current.delete(key);
    },
    onFocus: () => setActive({ r, c }),
    onClick: (event: MouseEvent) => click(event, { r, c }),
  });
  return { cell, onKeyDown };
}
