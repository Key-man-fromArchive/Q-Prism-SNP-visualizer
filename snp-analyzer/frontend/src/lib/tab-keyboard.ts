import type { KeyboardEvent } from 'react';
export function navigateTabs(event: KeyboardEvent) {
  if (event.defaultPrevented || event.nativeEvent.keyCode === 229) return;
  if (event.altKey || event.ctrlKey || event.metaKey || event.nativeEvent.isComposing) return;
  const tabs = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)')];
  const index = tabs.findIndex(tab => tab === document.activeElement);
  const moves: Record<string, number> = { ArrowRight: (index + 1) % tabs.length,
    ArrowLeft: (index - 1 + tabs.length) % tabs.length, Home: 0, End: tabs.length - 1 };
  const next = tabs[moves[event.key]];
  if (!next) return;
  event.preventDefault(); event.stopPropagation(); next.focus(); next.click();
}

/**
 * Roving-focus keyboard navigation for a fixed-`cols`-wide grid of
 * `role="gridcell"` buttons (P29-CALENDAR's date grid). Unlike `navigateTabs`,
 * arrow keys only move focus -- they do not activate the cell, matching how
 * native date pickers behave (Enter/Space on the focused button selects it).
 */
export function navigateGrid(event: KeyboardEvent, cols: number) {
  if (event.defaultPrevented || event.nativeEvent.keyCode === 229) return;
  if (event.altKey || event.ctrlKey || event.metaKey || event.nativeEvent.isComposing) return;
  const cells = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="gridcell"]:not(:disabled)')];
  const index = cells.findIndex(cell => cell === document.activeElement);
  if (index === -1) return;
  const row = Math.floor(index / cols);
  const moves: Record<string, number> = {
    ArrowRight: index + 1, ArrowLeft: index - 1,
    ArrowDown: index + cols, ArrowUp: index - cols,
    Home: row * cols, End: row * cols + cols - 1,
  };
  const nextIndex = moves[event.key];
  const next = nextIndex === undefined ? undefined : cells[nextIndex];
  if (!next || nextIndex === undefined || nextIndex < 0 || nextIndex >= cells.length) return;
  event.preventDefault(); event.stopPropagation(); next.focus();
}
