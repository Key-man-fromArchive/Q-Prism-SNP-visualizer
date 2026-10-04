// @TASK P4-S2 - Right-click well-type popup shared by both analysis views
// @TEST components/analysis/WellContextMenu.test.tsx
import { useCallback, useState } from 'react';
import type { MouseEvent } from 'react';
import { useSessionStore } from '@/stores/session-store';
import { useSelectionStore } from '@/stores/selection-store';
import { parseWellType } from '@/lib/well-type-input';
import { useKeyboardAssignment } from '@/hooks/use-keyboard-assignment';

// Only the plate grid and scatter plots carry this; right-clicks elsewhere keep
// the browser menu.
export const WELL_CONTEXT_ATTRIBUTE = 'data-well-context';

// Plotly SVG points carry no `data-well`; the scatter plots mirror the hovered
// point's well onto their container with this attribute instead.
export const HOVER_WELL_ATTRIBUTE = 'data-hover-well';

function targetWells(target: EventTarget | null): string[] {
  const el = target instanceof Element ? target : null;
  if (!el?.closest(`[${WELL_CONTEXT_ATTRIBUTE}]`)) return [];
  const selected = useSelectionStore.getState().selectedWells;
  if (selected.length > 0) return selected;
  const wellId = el?.closest('[data-well]')?.getAttribute('data-well')
    ?? el?.closest(`[${HOVER_WELL_ATTRIBUTE}]`)?.getAttribute(HOVER_WELL_ATTRIBUTE);
  return wellId ? [wellId] : [];
}

/** Attach `onContextMenu` to a wrapper; it only acts inside `data-well-context` zones. */
export function useWellContextMenu() {
  const { assign, message } = useKeyboardAssignment();
  const sessionId = useSessionStore((s) => s.sessionId);
  const clearSelection = useSelectionStore((s) => s.clearSelection);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [wells, setWells] = useState<string[]>([]);

  const onContextMenu = useCallback((e: MouseEvent) => {
    const targets = targetWells(e.target);
    if (targets.length === 0) return;
    e.preventDefault();
    setPosition({ x: e.clientX, y: e.clientY });
    setWells(targets);
  }, []);

  const close = useCallback(() => {
    setPosition(null);
    setWells([]);
  }, []);

  const onAssign = useCallback(
    async (wellType: string) => {
      if (!sessionId || wells.length === 0) return;
      const assignment = parseWellType(wellType);
      if (!assignment) return;
      const succeeded = await assign(assignment, wells);
      if (!succeeded) return;
      close();
      if (useSelectionStore.getState().selectedWells.join('|') === wells.join('|')) clearSelection();
    },
    [sessionId, wells, clearSelection, assign, close]
  );

  return { onContextMenu, position, wells, onAssign, close, message };
}
