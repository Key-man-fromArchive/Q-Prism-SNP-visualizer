import { useUndoStore } from '@/stores/undo-store';
import { useAnalysisStore } from '@/stores/analysis-store';
import { useNavigationStore } from '@/stores/navigation-store';
import { canMoveManual, undoManual, redoManual } from '@/lib/manual-commands';

/** Header and keyboard observe one shared, server-confirmed history. */
export function useUndoRedo() {
  const history = useUndoStore();
  useAnalysisStore();
  useNavigationStore();
  return {
    undo: undoManual, redo: redoManual,
    canUndo: !history.pending && history.cursor > 0 && canMoveManual(-1),
    canRedo: !history.pending && history.cursor < history.commands.length && canMoveManual(1),
    pending: history.pending, error: history.error,
  };
}
