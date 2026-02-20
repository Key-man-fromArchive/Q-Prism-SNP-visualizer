import { useMemo, useCallback } from 'react';
import { useSelectionStore } from '@/stores/selection-store';
import { useSessionStore } from '@/stores/session-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useDataStore } from '@/stores/data-store';

export function useWellFilter() {
  const selectedGroup = useSelectionStore((s) => s.selectedGroup);
  const wellGroups = useSessionStore((s) => s.wellGroups);
  const showEmptyWells = useSettingsStore((s) => s.showEmptyWells);
  const wellTypeAssignments = useDataStore((s) => s.wellTypeAssignments);
  const plateWells = useDataStore((s) => s.plateWells);

  // Set of wells that have data (from parser)
  const dataWells = useMemo(
    () => new Set(plateWells.map((w) => w.well)),
    [plateWells]
  );

  const isWellVisible = useCallback(
    (wellId: string) => {
      // 1. Empty check: manually typed as Empty → hidden unless showEmptyWells
      if (!showEmptyWells && wellTypeAssignments[wellId] === 'Empty') return false;
      // 2. No data → always hidden
      if (!dataWells.has(wellId)) return false;
      // 3. Group filter: if a group is selected, only show wells in that group
      if (selectedGroup && wellGroups?.[selectedGroup]) {
        return wellGroups[selectedGroup].includes(wellId);
      }
      return true;
    },
    [selectedGroup, wellGroups, showEmptyWells, wellTypeAssignments, dataWells]
  );

  // Compute visible rows and columns from wells that pass filter
  const { visibleRows, visibleCols } = useMemo(() => {
    const rows = new Set<string>();
    const cols = new Set<number>();

    for (const w of plateWells) {
      if (isWellVisible(w.well)) {
        rows.add(w.well[0]);
        cols.add(parseInt(w.well.slice(1), 10));
      }
    }

    const rowOrder = 'ABCDEFGH';
    const sortedRows = [...rows].sort((a, b) => rowOrder.indexOf(a) - rowOrder.indexOf(b));
    const sortedCols = [...cols].sort((a, b) => a - b);

    return { visibleRows: sortedRows, visibleCols: sortedCols };
  }, [plateWells, isWellVisible]);

  return { isWellVisible, visibleRows, visibleCols, dataWells };
}
