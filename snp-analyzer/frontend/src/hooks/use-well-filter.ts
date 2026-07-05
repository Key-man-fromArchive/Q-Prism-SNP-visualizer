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
      // 1. Omit: manually excluded (bad/spiked reading) → always hidden from plots
      if (wellTypeAssignments[wellId] === 'Omit') return false;
      // 2. Empty check: manually typed as Empty → hidden unless showEmptyWells
      if (!showEmptyWells && wellTypeAssignments[wellId] === 'Empty') return false;
      // 3. No data → always hidden
      if (!dataWells.has(wellId)) return false;
      // 4. Group filter: if a group is selected, only show wells in that group
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

    const sortedRows = [...rows].sort((a, b) => ROW_ALPHABET.indexOf(a) - ROW_ALPHABET.indexOf(b));
    const sortedCols = [...cols].sort((a, b) => a - b);

    return { visibleRows: sortedRows, visibleCols: sortedCols };
  }, [plateWells, isWellVisible]);

  // Detect the full physical plate layout (96 = 8×12, 384 = 16×24, 1536 = 32×48)
  // from the highest occupied row/column, so the plate view can render every
  // well position — not just the ones that happen to contain data.
  const { plateRows, plateCols } = useMemo(() => {
    let maxRowIdx = 0;
    let maxCol = 1;
    for (const w of plateWells) {
      const rowIdx = ROW_ALPHABET.indexOf(w.well[0]);
      if (rowIdx > maxRowIdx) maxRowIdx = rowIdx;
      const col = parseInt(w.well.slice(1), 10);
      if (col > maxCol) maxCol = col;
    }

    let rows = 8;
    let cols = 12;
    if (maxRowIdx > 15 || maxCol > 24) {
      rows = 32;
      cols = 48;
    } else if (maxRowIdx > 7 || maxCol > 12) {
      rows = 16;
      cols = 24;
    }

    return {
      plateRows: ROW_ALPHABET.slice(0, rows).split(''),
      plateCols: Array.from({ length: cols }, (_, i) => i + 1),
    };
  }, [plateWells]);

  return { isWellVisible, visibleRows, visibleCols, plateRows, plateCols, dataWells };
}

const ROW_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
