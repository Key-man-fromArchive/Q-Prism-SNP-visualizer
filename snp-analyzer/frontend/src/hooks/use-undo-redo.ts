import { useRef, useCallback } from 'react';
import { useSessionStore } from '@/stores/session-store';
import { bulkSetWellTypes } from '@/lib/api';

const MAX_HISTORY = 50;

export function useUndoRedo(): {
  pushSnapshot: (welltypes: Record<string, string>) => void;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  canUndo: boolean;
  canRedo: boolean;
} {
  const sessionId = useSessionStore((s) => s.sessionId);

  // History stack: array of snapshots
  const historyRef = useRef<Record<string, string>[]>([]);
  // Current position in history (-1 = no history)
  const currentIndexRef = useRef<number>(-1);
  // Guard flag to prevent re-entrant snapshots during undo/redo
  const isApplyingRef = useRef<boolean>(false);

  const pushSnapshot = useCallback((welltypes: Record<string, string>) => {
    // Don't push snapshots while we're applying undo/redo
    if (isApplyingRef.current) {
      return;
    }

    // Deep copy the welltypes object
    const snapshot = { ...welltypes };

    // Truncate any redo history
    historyRef.current = historyRef.current.slice(0, currentIndexRef.current + 1);

    // Push new snapshot
    historyRef.current.push(snapshot);

    // Limit history size
    if (historyRef.current.length > MAX_HISTORY) {
      historyRef.current.shift();
    } else {
      currentIndexRef.current++;
    }
  }, []);

  const undo = useCallback(async () => {
    if (!sessionId || currentIndexRef.current <= 0) {
      return;
    }

    isApplyingRef.current = true;
    try {
      currentIndexRef.current--;
      const snapshot = historyRef.current[currentIndexRef.current];

      await bulkSetWellTypes(sessionId, snapshot);

      // Dispatch custom event for other components to listen
      window.dispatchEvent(new CustomEvent('welltypes-changed'));
    } finally {
      isApplyingRef.current = false;
    }
  }, [sessionId]);

  const redo = useCallback(async () => {
    if (!sessionId || currentIndexRef.current >= historyRef.current.length - 1) {
      return;
    }

    isApplyingRef.current = true;
    try {
      currentIndexRef.current++;
      const snapshot = historyRef.current[currentIndexRef.current];

      await bulkSetWellTypes(sessionId, snapshot);

      // Dispatch custom event for other components to listen
      window.dispatchEvent(new CustomEvent('welltypes-changed'));
    } finally {
      isApplyingRef.current = false;
    }
  }, [sessionId]);

  const canUndo = currentIndexRef.current > 0;
  const canRedo = currentIndexRef.current < historyRef.current.length - 1;

  return {
    pushSnapshot,
    undo,
    redo,
    canUndo,
    canRedo,
  };
}
